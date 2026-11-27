import { Duration } from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import { Construct } from 'constructs'
import { accept, REASONS } from './accepted-risks'
import type { DeployConfig } from './config'
import type { Network } from './network'

/** Internal load balancer: no public address, reachable only through the CloudFront VPC origin. */
export class Ingress extends Construct {
  readonly alb: elb.ApplicationLoadBalancer
  readonly targetGroup: elb.ApplicationTargetGroup

  constructor(scope: Construct, id: string, props: { config: DeployConfig; network: Network; apiPort: number }) {
    super(scope, id)
    const { network } = props

    this.alb = new elb.ApplicationLoadBalancer(this, 'Alb', {
      vpc: network.vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroup: network.albSg,
      idleTimeout: Duration.seconds(120),
      dropInvalidHeaderFields: true,
      deletionProtection: props.config.envName === 'production',
    })
    this.targetGroup = new elb.ApplicationTargetGroup(this, 'ApiTargets', {
      vpc: network.vpc,
      port: props.apiPort,
      protocol: elb.ApplicationProtocol.HTTP,
      targetType: elb.TargetType.IP,
      deregistrationDelay: Duration.seconds(30),
      healthCheck: {
        // Liveness, not readiness: a database outage must not make ECS cycle healthy tasks.
        path: '/api/v1/health',
        interval: Duration.seconds(15),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 4,
      },
    })
    this.alb.addListener('Http', { port: 80, open: false, defaultTargetGroups: [this.targetGroup] })

    accept(this.alb, { ELB2: REASONS.urlsCarryTokens })
  }
}
