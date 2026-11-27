import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import type { Construct } from 'constructs'
import { acceptWildcards, named } from './accepted-risks'
import type { DeployConfig } from './config'
import { Data } from './data'
import { Edge } from './edge'
import { Ingress } from './ingress'
import { Monitoring } from './monitoring'
import { Network } from './network'
import { Service } from './service'

const API_PORT = 3000

export interface PlatformProps extends StackProps {
  config: DeployConfig
  repositoryName: string
  deployRoleName?: string
}

/** The running system. Split into constructs by concern, deployed as one unit. */
export class PlatformStack extends Stack {
  private readonly zones: string[]

  constructor(scope: Construct, id: string, props: PlatformProps) {
    super(scope, id, { ...props, description: 'NimbusVault application platform' })
    this.zones = props.config.availabilityZones
    const { config } = props

    // Order follows the references: the CDN points at the load balancer, the file bucket's CORS
    // rule and the API's allowed origin both point at the CDN.
    const filesBucketName = `nimbusvault-${config.envName}-files-${this.account}-${config.region}`
    const network = new Network(this, 'Network', { apiPort: API_PORT })
    const ingress = new Ingress(this, 'Ingress', { config, network, apiPort: API_PORT })
    const edge = new Edge(this, 'Edge', { config, alb: ingress.alb, filesBucketName })
    const data = new Data(this, 'Data', { config, network, siteOrigin: edge.siteOrigin, bucketName: filesBucketName })
    const service = new Service(this, 'Service', {
      config,
      network,
      data,
      targetGroup: ingress.targetGroup,
      siteOrigin: edge.siteOrigin,
      repositoryName: props.repositoryName,
      apiPort: API_PORT,
    })
    new Monitoring(this, 'Monitoring', { config, data, ingress, service })

    if (props.deployRoleName) this.grantDeployments(props.deployRoleName, service, edge)

    const output = (name: string, value: string) => new CfnOutput(this, name, { value })
    output('SiteUrl', edge.siteOrigin)
    output('DistributionId', edge.distribution.distributionId)
    output('SiteBucketName', edge.siteBucket.bucketName)
    output('FilesBucketName', data.bucket.bucketName)
    output('ClusterName', service.cluster.clusterName)
    output('ApiServiceName', service.apiService.serviceName)
    output('WorkerServiceName', service.workerService.serviceName)
    output('MigrationTaskArn', service.migrationTask.taskDefinitionArn)
    output('MigrationSubnets', network.vpc.publicSubnets.map((s) => s.subnetId).join(','))
    output('MigrationSecurityGroup', network.workerSg.securityGroupId)
    output('MigrationLogGroup', service.logGroups.migrate.logGroupName)
    output('DatabaseEndpoint', data.database.dbInstanceEndpointAddress)
    output('DatabaseId', data.database.instanceIdentifier)
  }

  /** Taken from configuration, so synthesis never has to look anything up in an AWS account. */
  override get availabilityZones(): string[] {
    return this.zones
  }

  /** Publishing the site and running migrations, for the GitHub Actions role. */
  private grantDeployments(roleName: string, service: Service, edge: Edge): void {
    const role = iam.Role.fromRoleName(this, 'DeployRole', roleName)
    role.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'PublishSite',
      actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
      resources: [edge.siteBucket.arnForObjects('*')],
    }))
    role.addToPrincipalPolicy(new iam.PolicyStatement({ sid: 'ListSite', actions: ['s3:ListBucket'], resources: [edge.siteBucket.bucketArn] }))
    role.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'InvalidateCdn',
      actions: ['cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation'],
      resources: [edge.distribution.distributionArn],
    }))
    role.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'RunMigrations',
      actions: ['ecs:RunTask'],
      resources: [this.formatArn({ service: 'ecs', resource: 'task-definition', resourceName: `${service.migrationTask.family}:*` })],
      conditions: { ArnEquals: { 'ecs:cluster': service.cluster.clusterArn } },
    }))
    role.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'RegisterMigrationRevision',
      // These two actions do not support resource-level permissions.
      actions: ['ecs:RegisterTaskDefinition', 'ecs:DescribeTaskDefinition'],
      resources: ['*'],
    }))
    role.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'WatchDeployment',
      actions: ['ecs:DescribeTasks', 'ecs:DescribeServices'],
      resources: ['*'],
      conditions: { ArnEquals: { 'ecs:cluster': service.cluster.clusterArn } },
    }))
    role.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'PassTaskRoles',
      actions: ['iam:PassRole'],
      resources: [service.migrationTask.taskRole.roleArn, service.migrationTask.obtainExecutionRole().roleArn],
      conditions: { StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' } },
    }))
    role.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'ReadMigrationLogs',
      actions: ['logs:FilterLogEvents', 'logs:GetLogEvents'],
      resources: [service.logGroups.migrate.logGroupArn],
    }))
    acceptWildcards(role, 'ECS describe/register actions have no resource scope (cluster-conditioned where possible); site objects and migration revisions need a suffix wildcard.', [
      '*',
      named.objectsIn(edge.siteBucket),
      `arn:<AWS::Partition>:ecs:${this.region}:${named.account(this)}:task-definition/${service.migrationTask.family}:*`,
    ])
  }
}
