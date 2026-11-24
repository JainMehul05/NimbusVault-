import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as iam from 'aws-cdk-lib/aws-iam'
import type { Construct } from 'constructs'
import { acceptWildcards, named } from './accepted-risks'
import type { DeployConfig } from './config'

/**
 * What must exist before the first image can be pushed: the container registry and the role
 * GitHub Actions assumes through OIDC (no long-lived AWS keys anywhere).
 */
export class FoundationStack extends Stack {
  readonly repositoryName: string
  readonly deployRoleName?: string

  constructor(scope: Construct, id: string, props: StackProps & { config: DeployConfig }) {
    super(scope, id, { ...props, description: 'NimbusVault container registry and deployment identity' })
    const { config } = props

    this.repositoryName = `nimbusvault-${config.envName}/backend`
    const repository = new ecr.Repository(this, 'BackendRepository', {
      repositoryName: this.repositoryName,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      encryption: ecr.RepositoryEncryption.AES_256,
      removalPolicy: config.envName === 'production' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      emptyOnDelete: config.envName !== 'production',
      lifecycleRules: [
        { rulePriority: 1, description: 'Drop untagged layers', tagStatus: ecr.TagStatus.UNTAGGED, maxImageAge: Duration.days(1) },
        { rulePriority: 2, description: 'Keep recent images for rollback', maxImageCount: 20 },
      ],
    })
    new CfnOutput(this, 'RepositoryUri', { value: repository.repositoryUri })

    if (!config.githubRepo) return

    const issuer = 'token.actions.githubusercontent.com'
    const providerArn = config.createOidcProvider
      ? new iam.CfnOIDCProvider(this, 'GitHubOidc', { url: `https://${issuer}`, clientIdList: ['sts.amazonaws.com'] }).attrArn
      : this.formatArn({ service: 'iam', region: '', resource: 'oidc-provider', resourceName: issuer })

    this.deployRoleName = `nimbusvault-${config.envName}-deploy`
    const role = new iam.Role(this, 'DeployRole', {
      roleName: this.deployRoleName,
      description: `Assumed by GitHub Actions in ${config.githubRepo}`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.FederatedPrincipal(
        providerArn,
        {
          StringEquals: {
            [`${issuer}:aud`]: 'sts.amazonaws.com',
            // Only jobs that run in this protected GitHub environment can deploy.
            [`${issuer}:sub`]: `repo:${config.githubRepo}:environment:${config.envName}`,
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
    })
    repository.grantPullPush(role)
    repository.grant(role, 'ecr:DescribeImages', 'ecr:DescribeImageScanFindings')
    role.addToPolicy(new iam.PolicyStatement({
      sid: 'AssumeCdkBootstrapRoles',
      actions: ['sts:AssumeRole'],
      resources: [this.formatArn({ service: 'iam', region: '', resource: 'role', resourceName: `cdk-*-role-${this.account}-${this.region}` })],
    }))
    role.addToPolicy(new iam.PolicyStatement({
      sid: 'ReadStackOutputs',
      actions: ['cloudformation:DescribeStacks'],
      resources: [this.formatArn({ service: 'cloudformation', resource: 'stack', resourceName: `NimbusVault-${config.envName}-*/*` })],
    }))
    const account = named.account(this)
    acceptWildcards(role, 'CDK bootstrap roles and stack ids carry generated parts; both patterns are limited to this account, region and project. ecr:GetAuthorizationToken has no resource scope.', [
      '*',
      `arn:<AWS::Partition>:iam::${account}:role/cdk-*-role-${account}-${this.region}`,
      `arn:<AWS::Partition>:cloudformation:${this.region}:${account}:stack/NimbusVault-${config.envName}-*/*`,
    ])
    new CfnOutput(this, 'DeployRoleArn', { value: role.roleArn })
  }
}
