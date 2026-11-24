import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as logs from 'aws-cdk-lib/aws-logs'
import { RemovalPolicy } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { accept } from './accepted-risks'

/**
 * Two-AZ VPC without NAT gateways (which would roughly double the bill).
 *  - public subnets:   Fargate tasks. They have public IPs for outbound calls (ECR, Secrets
 *                      Manager, AI providers) but their security groups accept no inbound
 *                      traffic except from the load balancer.
 *  - isolated subnets: load balancer and database. No route to the internet in either direction.
 */
export class Network extends Construct {
  readonly vpc: ec2.Vpc
  readonly albSg: ec2.SecurityGroup
  readonly apiSg: ec2.SecurityGroup
  readonly workerSg: ec2.SecurityGroup
  readonly dbSg: ec2.SecurityGroup

  constructor(scope: Construct, id: string, props: { apiPort: number }) {
    super(scope, id)

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.20.0.0/16'),
      maxAzs: 2,
      natGateways: 0,
      restrictDefaultSecurityGroup: true,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24, mapPublicIpOnLaunch: false },
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    })
    // Rejected traffic only: enough to spot probing and misconfiguration at negligible cost.
    this.vpc.addFlowLog('Rejected', {
      trafficType: ec2.FlowLogTrafficType.REJECT,
      destination: ec2.FlowLogDestination.toCloudWatchLogs(
        new logs.LogGroup(this, 'FlowLogs', { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY })
      ),
    })
    // Free, and keeps file traffic to S3 off the public path.
    this.vpc.addGatewayEndpoint('S3', { service: ec2.GatewayVpcEndpointAwsService.S3 })

    const sg = (name: string, description: string, allowAllOutbound: boolean) =>
      new ec2.SecurityGroup(this, name, { vpc: this.vpc, description, allowAllOutbound })
    this.albSg = sg('AlbSg', 'Internal load balancer', false)
    this.apiSg = sg('ApiSg', 'API tasks', true)
    this.workerSg = sg('WorkerSg', 'Worker and migration tasks', true)
    this.dbSg = sg('DbSg', 'PostgreSQL', false)

    // CloudFront reaches the internal ALB through VPC-origin network interfaces inside this VPC.
    this.albSg.addIngressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.tcp(80), 'CloudFront VPC origin')
    this.albSg.addEgressRule(this.apiSg, ec2.Port.tcp(props.apiPort), 'API tasks')
    this.apiSg.addIngressRule(this.albSg, ec2.Port.tcp(props.apiPort), 'Load balancer only')
    this.dbSg.addIngressRule(this.apiSg, ec2.Port.tcp(5432), 'API')
    this.dbSg.addIngressRule(this.workerSg, ec2.Port.tcp(5432), 'Worker and migrations')

    accept(this.albSg, { EC23: 'Ingress is the VPC CIDR only (a CloudFormation reference the rule cannot evaluate).' })
  }
}
