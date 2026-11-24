import { App } from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../lib/config'
import { FoundationStack } from '../lib/foundation-stack'
import { PlatformStack } from '../lib/platform-stack'

const build = (context: Record<string, string> = {}) => {
  const app = new App({ context: { env: 'production', githubRepo: 'owner/repo', ...context } })
  const config = loadConfig(app)
  const env = { account: '123456789012', region: config.region }
  const foundation = new FoundationStack(app, 'F', { env, config })
  const platform = new PlatformStack(app, 'P', { env, config, repositoryName: foundation.repositoryName, deployRoleName: foundation.deployRoleName })
  return { f: Template.fromStack(foundation), p: Template.fromStack(platform) }
}

type Statement = { Sid?: string; Effect: string; Action: string | string[]; Resource: unknown; Condition?: unknown }
const statements = (t: Template): Statement[] =>
  Object.values(t.findResources('AWS::IAM::Policy')).flatMap((r) => r.Properties.PolicyDocument.Statement)

describe('network', () => {
  const { p } = build()

  it('has no NAT gateways and no internet-facing load balancer', () => {
    p.resourceCountIs('AWS::EC2::NatGateway', 0)
    p.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', { Scheme: 'internal' })
  })

  it('opens nothing to the internet', () => {
    const open = (rule: { CidrIp?: unknown; CidrIpv6?: unknown }) => rule.CidrIp === '0.0.0.0/0' || rule.CidrIpv6 === '::/0'
    for (const sg of Object.values(p.findResources('AWS::EC2::SecurityGroup'))) {
      expect((sg.Properties.SecurityGroupIngress ?? []).some(open)).toBe(false)
    }
    for (const r of Object.values(p.findResources('AWS::EC2::SecurityGroupIngress'))) expect(open(r.Properties)).toBe(false)
  })

  it('lets only the API and worker reach PostgreSQL', () => {
    const toDb = Object.values(p.findResources('AWS::EC2::SecurityGroupIngress', { Properties: { FromPort: 5432 } }))
    expect(toDb).toHaveLength(2)
  })
})

describe('data', () => {
  const { p } = build()

  it('keeps the database private, encrypted, TLS-only, backed up and protected', () => {
    p.hasResource('AWS::RDS::DBInstance', {
      DeletionPolicy: 'Snapshot',
      Properties: Match.objectLike({ PubliclyAccessible: false, StorageEncrypted: true, BackupRetentionPeriod: 14, DeletionProtection: true, Engine: 'postgres', EngineVersion: Match.stringLikeRegexp('^16\.') }),
    })
    p.hasResourceProperties('AWS::RDS::DBParameterGroup', { Family: 'postgres16', Parameters: Match.objectLike({ 'rds.force_ssl': '1' }) })
  })

  it('makes every bucket private and TLS-only, and versions files', () => {
    for (const b of Object.values(p.findResources('AWS::S3::Bucket'))) {
      expect(b.Properties.PublicAccessBlockConfiguration).toEqual({ BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true })
      expect(b.Properties.BucketEncryption).toBeDefined()
    }
    p.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain', Properties: Match.objectLike({ BucketName: 'nimbusvault-production-files-123456789012-us-east-1', VersioningConfiguration: { Status: 'Enabled' } }) })
    const policies = Object.values(p.findResources('AWS::S3::BucketPolicy'))
    expect(policies.length).toBe(Object.keys(p.findResources('AWS::S3::Bucket')).length)
    for (const policy of policies) expect(JSON.stringify(policy)).toContain('aws:SecureTransport')
  })

  it('expires abandoned uploads and limits CORS to the site', () => {
    const [bucket] = Object.values(p.findResources('AWS::S3::Bucket', { Properties: { BucketName: 'nimbusvault-production-files-123456789012-us-east-1' } }))
    const rules = bucket.Properties.LifecycleConfiguration.Rules
    expect(rules).toEqual(expect.arrayContaining([expect.objectContaining({ Prefix: 'staging/', ExpirationInDays: 1 }), expect.objectContaining({ AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } })]))
    const [cors] = bucket.Properties.CorsConfiguration.CorsRules
    expect(JSON.stringify(cors.AllowedOrigins)).not.toContain('*')
    expect(JSON.stringify(cors.AllowedOrigins)).toContain('DomainName')
  })
})

describe('compute', () => {
  const { p } = build({ aiGenerationProvider: 'anthropic', imageTag: 'abc123' })
  const tasks = Object.values(p.findResources('AWS::ECS::TaskDefinition'))

  it('runs hardened containers with secrets only from Secrets Manager', () => {
    expect(tasks).toHaveLength(3)
    for (const t of tasks) {
      const [c] = t.Properties.ContainerDefinitions
      expect(c.ReadonlyRootFilesystem).toBe(true)
      expect(c.Privileged).toBeFalsy()
      expect(JSON.stringify(c.Image)).toContain(':abc123')
      const env = Object.fromEntries(c.Environment.map((e: { Name: string; Value: unknown }) => [e.Name, e.Value]))
      for (const name of Object.keys(env)) expect(name).not.toMatch(/SECRET|PASSWORD|API_KEY|ACCESS_KEY/)
      expect(env.NODE_ENV).toBe('production')
      expect(env.DB_SSL_CA).toBeDefined()
      expect(c.Secrets.map((s: { Name: string }) => s.Name).sort()).toEqual(['AI_GENERATION_API_KEY', 'DB_PASSWORD', 'DB_USER', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'])
    }
  })

  it('separates API and worker duties and trusts exactly two proxies', () => {
    const env = (family: string) => {
      const t = tasks.find((x) => x.Properties.Family.endsWith(family))!
      return Object.fromEntries(t.Properties.ContainerDefinitions[0].Environment.map((e: { Name: string; Value: unknown }) => [e.Name, e.Value]))
    }
    expect(env('api')).toMatchObject({ AI_WORKER_ENABLED: 'false', MAINTENANCE_ENABLED: 'false', TRUST_PROXY: '2' })
    expect(env('worker')).toMatchObject({ AI_WORKER_ENABLED: 'true' })
  })

  it('rolls back failed deployments and autoscales', () => {
    for (const s of Object.values(p.findResources('AWS::ECS::Service'))) {
      expect(s.Properties.DeploymentConfiguration.DeploymentCircuitBreaker).toEqual({ Enable: true, Rollback: true })
      expect(s.Properties.EnableExecuteCommand).toBeFalsy()
    }
    p.resourceCountIs('AWS::ApplicationAutoScaling::ScalingPolicy', 2)
  })

  it('gives the application only object access to its own bucket', () => {
    const s = statements(p).filter((x) => x.Sid === 'FileObjects' || x.Sid === 'FileBucket')
    expect(s).toHaveLength(2)
    for (const x of s) {
      expect(JSON.stringify(x.Resource)).toContain('DataFiles')
      expect([x.Action].flat().some((a) => a.includes('*'))).toBe(false)
    }
  })

  it('never grants administrator-style permissions', () => {
    for (const s of [...statements(p), ...statements(build().f)]) {
      for (const a of [s.Action].flat()) expect(a === '*' || /^(iam|sts|s3|ecs|rds|secretsmanager|kms):\*$/.test(a)).toBe(false)
      if (s.Resource === '*') {
        for (const a of [s.Action].flat()) expect(a).toMatch(/^(ecr:GetAuthorizationToken|ecs:(Describe|Register)\w+|logs:(Create|Put|Describe)\w+|ec2:Describe\w+)$/)
      }
    }
  })

  it('can be created before any image exists', () => {
    const { p: first } = build({ desiredCount: '0' })
    first.allResourcesProperties('AWS::ECS::Service', { DesiredCount: 0 })
    first.resourceCountIs('AWS::ApplicationAutoScaling::ScalingPolicy', 0)
  })
})

describe('edge', () => {
  const { p } = build()
  const [cdn] = Object.values(p.findResources('AWS::CloudFront::Distribution'))
  const c = cdn.Properties.DistributionConfig

  it('serves the app and API from one HTTPS origin without caching the API', () => {
    expect(c.DefaultCacheBehavior.ViewerProtocolPolicy).toBe('redirect-to-https')
    const [api] = c.CacheBehaviors
    expect(api).toMatchObject({ PathPattern: '/api/*', ViewerProtocolPolicy: 'https-only', CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad' })
    expect(api.AllowedMethods).toContain('DELETE')
    p.resourceCountIs('AWS::CloudFront::VpcOrigin', 1)
    p.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1)
  })

  it('routes deep links to the app without masking API errors', () => {
    expect(c.CustomErrorResponses).toBeUndefined()
    const [fn] = Object.values(p.findResources('AWS::CloudFront::Function'))
    const handler = new Function(`${fn.Properties.FunctionCode}; return handler`)() as (e: object) => { uri: string }
    const route = (uri: string) => handler({ request: { uri } }).uri
    expect(['/', '/files/abc', '/share/Ab_-9', '/nope'].map(route)).toEqual(Array(4).fill('/index.html'))
    expect(['/assets/index-x.js', '/favicon.svg', '/index.html'].map(route)).toEqual(['/assets/index-x.js', '/favicon.svg', '/index.html'])
  })

  it('sends strict security headers', () => {
    const [h] = Object.values(p.findResources('AWS::CloudFront::ResponseHeadersPolicy'))
    const s = h.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig
    const csp = JSON.stringify(s.ContentSecurityPolicy.ContentSecurityPolicy)
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline|\*\.s3/)
    expect(s.StrictTransportSecurity.AccessControlMaxAgeSec).toBeGreaterThanOrEqual(31536000)
    expect(s.FrameOptions.FrameOption).toBe('DENY')
  })

  it('supports a custom domain with TLS 1.2, and an optional WAF', () => {
    const { p: custom } = build({ domainName: 'vault.example.com', certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/x', enableWaf: 'true' })
    custom.hasResourceProperties('AWS::CloudFront::Distribution', { DistributionConfig: Match.objectLike({ Aliases: ['vault.example.com'], ViewerCertificate: Match.objectLike({ MinimumProtocolVersion: 'TLSv1.2_2021' }), WebACLId: Match.anyValue() }) })
    custom.resourceCountIs('AWS::WAFv2::WebACL', 1)
    p.resourceCountIs('AWS::WAFv2::WebACL', 0)
  })
})

describe('delivery and operations', () => {
  const { f, p } = build({ alarmEmail: 'ops@example.com' })

  it('scans images, keeps tags immutable and prunes old ones', () => {
    f.hasResourceProperties('AWS::ECR::Repository', { ImageScanningConfiguration: { ScanOnPush: true }, ImageTagMutability: 'IMMUTABLE', LifecyclePolicy: Match.anyValue() })
  })

  it('lets only the named repository and environment deploy, without stored keys', () => {
    f.resourceCountIs('AWS::IAM::User', 0)
    f.resourceCountIs('AWS::IAM::AccessKey', 0)
    f.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: [Match.objectLike({ Action: 'sts:AssumeRoleWithWebIdentity', Condition: { StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com', 'token.actions.githubusercontent.com:sub': 'repo:owner/repo:environment:production' } } })],
      }),
    })
    const { f: none } = build({ githubRepo: '' })
    none.resourceCountIs('AWS::IAM::Role', 0)
  })

  it('alarms on the things that matter and notifies someone', () => {
    const alarms = Object.values(p.findResources('AWS::CloudWatch::Alarm'))
    expect(alarms.length).toBeGreaterThanOrEqual(15)
    for (const a of alarms) expect(a.Properties.AlarmActions).toHaveLength(1)
    p.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: 'ops@example.com' })
    p.resourceCountIs('AWS::Logs::MetricFilter', 4)
  })

  it('caps spend with a budget and expires logs', () => {
    p.hasResourceProperties('AWS::Budgets::Budget', { Budget: Match.objectLike({ BudgetLimit: { Amount: 100, Unit: 'USD' } }) })
    for (const l of Object.values(p.findResources('AWS::Logs::LogGroup'))) expect(l.Properties.RetentionInDays).toBeLessThanOrEqual(90)
  })
})

describe('configuration', () => {
  it('rejects mistakes before anything is created', () => {
    const load = (context: Record<string, string>) => () => loadConfig(new App({ context }))
    expect(load({ env: 'prod' })).toThrow(/Unknown env/)
    expect(load({ domainName: 'a.example.com' })).toThrow(/together/)
    expect(load({ domainName: 'a', certificateArn: 'arn:aws:acm:eu-west-1:1:certificate/x' })).toThrow(/us-east-1/)
    expect(load({ enableWaf: 'true', region: 'eu-west-1' })).toThrow(/us-east-1/)
    expect(load({ desiredCount: '-1' })).toThrow(/desiredCount/)
    expect(load({ githubRepo: 'nope' })).toThrow(/owner\/repo/)
    expect(load({ aiGenerationProvider: 'magic' })).toThrow(/aiGenerationProvider/)
  })

  it('sizes staging smaller than production', () => {
    const staging = loadConfig(new App({ context: { env: 'staging' } }))
    const production = loadConfig(new App({ context: { env: 'production' } }))
    expect(staging.api.cpu).toBeLessThan(production.api.cpu)
    expect(staging.db.deletionProtection).toBe(false)
  })
})
