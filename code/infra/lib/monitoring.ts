import { Duration } from 'aws-cdk-lib'
import * as budgets from 'aws-cdk-lib/aws-budgets'
import * as cw from 'aws-cdk-lib/aws-cloudwatch'
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions'
import { Construct } from 'constructs'
import type { DeployConfig } from './config'
import type { Data } from './data'
import type { Ingress } from './ingress'
import type { Service } from './service'

/** Alarms, log-derived metrics, a dashboard and a monthly budget. */
export class Monitoring extends Construct {
  readonly topic: sns.Topic

  constructor(scope: Construct, id: string, props: { config: DeployConfig; data: Data; ingress: Ingress; service: Service }) {
    super(scope, id)
    const { config, data, ingress, service } = props
    const namespace = `NimbusVault/${config.envName}`

    this.topic = new sns.Topic(this, 'Alarms', { displayName: `NimbusVault ${config.envName} alarms`, enforceSSL: true })
    this.topic.addToResourcePolicy(new iam.PolicyStatement({
      principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
      actions: ['sns:Publish'],
      resources: [this.topic.topicArn],
    }))
    if (config.alarmEmail) this.topic.addSubscription(new subs.EmailSubscription(config.alarmEmail))

    const alarm = (
      name: string,
      metric: cw.IMetric,
      threshold: number,
      description: string,
      options: Partial<cw.CreateAlarmOptions> = {}
    ) => {
      const a = new cw.Alarm(this, name, {
        metric,
        threshold,
        alarmDescription: description,
        evaluationPeriods: 3,
        datapointsToAlarm: 2,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
        ...options,
      })
      a.addAlarmAction(new actions.SnsAction(this.topic))
      a.addOkAction(new actions.SnsAction(this.topic))
      return a
    }
    const below = { comparisonOperator: cw.ComparisonOperator.LESS_THAN_THRESHOLD }
    const five = { period: Duration.minutes(5) }

    // The application logs JSON; these turn specific events into metrics without extra agents.
    const eventMetric = (name: string, group: logs.LogGroup, event: string, valueField?: string) => {
      const filter = new logs.MetricFilter(this, `${name}Filter`, {
        logGroup: group,
        metricNamespace: namespace,
        metricName: name,
        filterPattern: logs.FilterPattern.stringValue('$.event', '=', event),
        metricValue: valueField ? `$.${valueField}` : '1',
        ...(valueField ? {} : { defaultValue: 0 }),
      })
      return filter.metric({ statistic: valueField ? 'Maximum' : 'Sum', period: Duration.minutes(5) })
    }
    const http5xx = eventMetric('ServerErrors', service.logGroups.api, 'http_5xx')
    const jobFailures = eventMetric('AiJobFailures', service.logGroups.worker, 'ai_job_failed')
    const queueWait = eventMetric('AiQueueWaitSeconds', service.logGroups.worker, 'ai_queue', 'waitSeconds')
    const maintenance = eventMetric('MaintenanceFailures', service.logGroups.worker, 'maintenance_failed')

    const albMetric = ingress.alb.metrics
    const target5xx = ingress.targetGroup.metrics.httpCodeTarget(elb.HttpCodeTarget.TARGET_5XX_COUNT, five)
    const unhealthy = ingress.targetGroup.metrics.unhealthyHostCount(five)
    const latency = ingress.targetGroup.metrics.targetResponseTime({ ...five, statistic: 'p95' })

    alarm('Alb5xx', albMetric.httpCodeElb(elb.HttpCodeElb.ELB_5XX_COUNT, five), 10, 'Load balancer errors: no healthy API tasks or timeouts')
    alarm('Target5xx', target5xx, 10, 'API is returning server errors')
    alarm('UnhealthyHosts', unhealthy, 0, 'An API task is failing health checks')
    alarm('SlowResponses', latency, 3, '95th percentile API latency above 3 seconds')
    alarm('LoggedServerErrors', http5xx, 10, 'Server errors in the API log')
    alarm('ApiCpu', service.apiService.metricCpuUtilization(five), 85, 'API CPU saturated')
    alarm('ApiMemory', service.apiService.metricMemoryUtilization(five), 85, 'API memory nearly exhausted')
    alarm('WorkerMemory', service.workerService.metricMemoryUtilization(five), 90, 'Worker memory nearly exhausted')
    alarm('AiJobFailed', jobFailures, 5, 'Documents are failing to index')
    alarm('AiQueueBacklog', queueWait, 1800, 'Documents have waited over 30 minutes to be indexed')
    alarm('MaintenanceFailed', maintenance, 0, 'Cleanup tasks are failing', { evaluationPeriods: 2 })

    const db = data.database
    alarm('DbCpu', db.metricCPUUtilization(five), 85, 'Database CPU saturated')
    alarm('DbStorage', db.metricFreeStorageSpace(five), 3 * 1024 ** 3, 'Less than 3 GB of database storage left', below)
    alarm('DbMemory', db.metricFreeableMemory(five), 80 * 1024 ** 2, 'Database memory nearly exhausted', below)
    alarm('DbConnections', db.metricDatabaseConnections(five), 60, 'Database connections near the limit for this instance size')

    const dashboard = new cw.Dashboard(this, 'Dashboard', { dashboardName: `NimbusVault-${config.envName}` })
    const graph = (title: string, left: cw.IMetric[], right: cw.IMetric[] = []) => new cw.GraphWidget({ title, left, right, width: 8 })
    dashboard.addWidgets(
      graph('Requests and errors', [albMetric.requestCount(five)], [target5xx, http5xx]),
      graph('Latency (p95)', [latency]),
      graph('API', [service.apiService.metricCpuUtilization(five), service.apiService.metricMemoryUtilization(five)]),
      graph('Worker', [service.workerService.metricCpuUtilization(five), service.workerService.metricMemoryUtilization(five)]),
      graph('AI queue', [queueWait], [jobFailures]),
      graph('Database', [db.metricCPUUtilization(five)], [db.metricDatabaseConnections(five)]),
      graph('Database storage', [db.metricFreeStorageSpace(five)])
    )

    const notify = (threshold: number, type: 'ACTUAL' | 'FORECASTED'): budgets.CfnBudget.NotificationWithSubscribersProperty => ({
      notification: { comparisonOperator: 'GREATER_THAN', threshold, thresholdType: 'PERCENTAGE', notificationType: type },
      subscribers: [
        { subscriptionType: 'SNS', address: this.topic.topicArn },
        ...(config.alarmEmail ? [{ subscriptionType: 'EMAIL', address: config.alarmEmail }] : []),
      ],
    })
    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `nimbusvault-${config.envName}-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: config.monthlyBudgetUsd, unit: 'USD' },
        costFilters: { TagKeyValue: ['user:Project$NimbusVault'] },
      },
      notificationsWithSubscribers: [notify(50, 'ACTUAL'), notify(80, 'ACTUAL'), notify(100, 'FORECASTED')],
    })
  }
}
