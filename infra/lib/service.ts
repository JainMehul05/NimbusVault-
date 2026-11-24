import { Duration } from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import type * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as secrets from 'aws-cdk-lib/aws-secretsmanager'
import { RemovalPolicy } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { accept, acceptWildcards, named, REASONS } from './accepted-risks'
import type { DeployConfig } from './config'
import type { Data } from './data'
import type { Network } from './network'

export interface ServiceProps {
  config: DeployConfig
  network: Network
  data: Data
  targetGroup: elb.ApplicationTargetGroup
  /** The address people use; the only browser origin the API accepts. */
  siteOrigin: string
  repositoryName: string
  apiPort: number
}

/** ECS cluster with the API service, the background worker and the one-off migration task. */
export class Service extends Construct {
  readonly cluster: ecs.Cluster
  readonly migrationTask: ecs.FargateTaskDefinition
  readonly logGroups: Record<'api' | 'worker' | 'migrate', logs.LogGroup>
  readonly apiService: ecs.FargateService
  readonly workerService: ecs.FargateService

  private readonly repository: ecr.IRepository
  private readonly taskRole: iam.Role
  private readonly jwtAccess: secrets.Secret
  private readonly jwtRefresh: secrets.Secret
  private readonly aiKey?: secrets.Secret

  constructor(scope: Construct, id: string, private readonly props: ServiceProps) {
    super(scope, id)
    const { config, network, data } = props
    const production = config.envName === 'production'

    this.repository = ecr.Repository.fromRepositoryName(this, 'Repository', props.repositoryName)
    this.cluster = new ecs.Cluster(this, 'Cluster', { vpc: network.vpc, containerInsightsV2: ecs.ContainerInsights.DISABLED, enableFargateCapacityProviders: true })

    accept(this.cluster, { ECS4: 'Container Insights bills per custom metric; standard ECS metrics and log-derived metrics cover the alarms.' })

    const logGroup = (name: string) =>
      new logs.LogGroup(this, `${name}Logs`, {
        retention: config.logRetentionDays as logs.RetentionDays,
        removalPolicy: production ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      })
    this.logGroups = { api: logGroup('Api'), worker: logGroup('Worker'), migrate: logGroup('Migrate') }

    const randomSecret = (name: string, description: string) => {
      const secret = new secrets.Secret(this, name, {
        description,
        generateSecretString: { passwordLength: 64, excludePunctuation: true },
        removalPolicy: production ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      })
      accept(secret, { SMG4: REASONS.rotation })
      return secret
    }
    this.jwtAccess = randomSecret('JwtAccessSecret', 'NimbusVault access-token signing key')
    this.jwtRefresh = randomSecret('JwtRefreshSecret', 'NimbusVault reserved second signing key')
    if (config.aiGenerationProvider !== 'none') {
      // Created with a random placeholder; put the real key in with the AWS CLI after deploying.
      this.aiKey = randomSecret('AiGenerationKey', `API key for ${config.aiGenerationProvider}`)
    }

    // One role for application code: exactly the object operations it performs, on this bucket.
    this.taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'NimbusVault application permissions',
    })
    this.taskRole.addToPolicy(new iam.PolicyStatement({
      sid: 'FileObjects',
      actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:AbortMultipartUpload', 's3:ListMultipartUploadParts'],
      resources: [data.bucket.arnForObjects('*')],
    }))
    acceptWildcards(this.taskRole, 'Object-level actions on the one bucket the application owns; keys are generated per file.', [named.objectsIn(data.bucket)])
    // HeadBucket (health check), and a 404 instead of 403 for missing objects.
    this.taskRole.addToPolicy(new iam.PolicyStatement({ sid: 'FileBucket', actions: ['s3:ListBucket'], resources: [data.bucket.bucketArn] }))

    this.migrationTask = this.task('Migration', 512, 1024, 'migrate', ['node', 'scripts/migrate.cjs'], {})
    ;({ api: this.apiService, worker: this.workerService } = this.services())
  }

  /** Environment shared by every container. Secrets are injected by ECS, never baked in. */
  private environment(extra: Record<string, string>): Record<string, string> {
    const { config, data } = this.props
    return {
      NODE_ENV: 'production',
      APP_VERSION: config.imageTag,
      LOG_LEVEL: 'info',
      API_PREFIX: 'v1',
      DB_HOST: data.database.dbInstanceEndpointAddress,
      DB_PORT: data.database.dbInstanceEndpointPort,
      DB_NAME: 'nimbusvault',
      DB_SSL_CA: '/app/certs/rds-global-bundle.pem',
      DB_CONNECTION_LIMIT: '8',
      AWS_REGION: config.region,
      AWS_S3_BUCKET: data.bucket.bucketName,
      BCRYPT_ROUNDS: '12',
      AI_EMBEDDING_PROVIDER: config.aiEmbeddingProvider,
      AI_LOCAL_MODEL_CACHE_DIR: '/app/models',
      AI_LOCAL_ALLOW_DOWNLOAD: 'false',
      AI_GENERATION_PROVIDER: config.aiGenerationProvider,
      ...(config.aiGenerationModel ? { AI_GENERATION_MODEL: config.aiGenerationModel } : {}),
      AI_OCR_ENABLED: String(config.ocrEnabled),
      ...extra,
    }
  }

  private task(
    name: string,
    cpu: number,
    memoryLimitMiB: number,
    logs: 'api' | 'worker' | 'migrate',
    command: string[],
    environment: Record<string, string>,
    container: Partial<ecs.ContainerDefinitionOptions> = {}
  ): ecs.FargateTaskDefinition {
    const { database } = this.props.data
    const definition = new ecs.FargateTaskDefinition(this, `${name}Task`, {
      family: `nimbusvault-${this.props.config.envName}-${name.toLowerCase()}`,
      cpu,
      memoryLimitMiB,
      taskRole: this.taskRole,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
      volumes: [{ name: 'tmp' }],
    })
    const c = definition.addContainer('app', {
      image: ecs.ContainerImage.fromEcrRepository(this.repository, this.props.config.imageTag),
      command,
      essential: true,
      readonlyRootFilesystem: true,
      logging: ecs.LogDrivers.awsLogs({ logGroup: this.logGroups[logs], streamPrefix: logs, mode: ecs.AwsLogDriverMode.NON_BLOCKING }),
      environment: this.environment(environment),
      secrets: {
        DB_USER: ecs.Secret.fromSecretsManager(database.secret!, 'username'),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(database.secret!, 'password'),
        JWT_ACCESS_SECRET: ecs.Secret.fromSecretsManager(this.jwtAccess),
        JWT_REFRESH_SECRET: ecs.Secret.fromSecretsManager(this.jwtRefresh),
        ...(this.aiKey ? { AI_GENERATION_API_KEY: ecs.Secret.fromSecretsManager(this.aiKey) } : {}),
      },
      stopTimeout: Duration.seconds(35),
      ...container,
    })
    c.addMountPoints({ containerPath: '/tmp', sourceVolume: 'tmp', readOnly: false })
    accept(definition, { ECS2: REASONS.taskEnvironment })
    acceptWildcards(definition, REASONS.ecrToken, ['*'])
    return definition
  }

  private services(): { api: ecs.FargateService; worker: ecs.FargateService } {
    const { config, network, apiPort, siteOrigin } = this.props

    const apiTask = this.task('Api', config.api.cpu, config.api.memory, 'api', ['node', 'dist/main.js'], {
      PORT: String(apiPort),
      FRONTEND_URL: siteOrigin,
      // Two proxies in front: CloudFront, then the load balancer.
      TRUST_PROXY: '2',
      AI_WORKER_ENABLED: 'false',
      MAINTENANCE_ENABLED: 'false',
    }, {
      portMappings: [{ containerPort: apiPort }],
      healthCheck: {
        command: ['CMD', 'node', 'scripts/healthcheck.cjs', 'http'],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(30),
      },
    })
    const workerTask = this.task('Worker', config.worker.cpu, config.worker.memory, 'worker', ['node', 'dist/worker.js'], {
      FRONTEND_URL: siteOrigin,
      AI_WORKER_ENABLED: 'true',
      AI_WORKER_HEARTBEAT_FILE: '/tmp/worker-heartbeat',
    }, {
      healthCheck: {
        command: ['CMD', 'node', 'scripts/healthcheck.cjs', 'worker'],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
    })

    const common = {
      cluster: this.cluster,
      desiredCount: config.desiredCount,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      circuitBreaker: { enable: true, rollback: true },
      propagateTags: ecs.PropagatedTagSource.SERVICE,
      enableExecuteCommand: false,
    }
    const api = new ecs.FargateService(this, 'ApiService', {
      ...common,
      serviceName: `nimbusvault-${config.envName}-api`,
      taskDefinition: apiTask,
      securityGroups: [network.apiSg],
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      healthCheckGracePeriod: Duration.seconds(60),
    })
    api.attachToApplicationTargetGroup(this.props.targetGroup)

    const worker = new ecs.FargateService(this, 'WorkerService', {
      ...common,
      serviceName: `nimbusvault-${config.envName}-worker`,
      taskDefinition: workerTask,
      securityGroups: [network.workerSg],
      // Jobs are durable and resumable, so a short gap during a deploy is fine.
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      capacityProviderStrategies: [{ capacityProvider: config.worker.spot ? 'FARGATE_SPOT' : 'FARGATE', weight: 1 }],
    })

    if (config.desiredCount > 0) {
      api.autoScaleTaskCount({ minCapacity: config.desiredCount, maxCapacity: Math.max(config.api.max, config.desiredCount) })
        .scaleOnCpuUtilization('ApiCpu', { targetUtilizationPercent: 60, scaleInCooldown: Duration.minutes(5), scaleOutCooldown: Duration.minutes(1) })
      worker.autoScaleTaskCount({ minCapacity: config.desiredCount, maxCapacity: Math.max(config.worker.max, config.desiredCount) })
        .scaleOnCpuUtilization('WorkerCpu', { targetUtilizationPercent: 70, scaleInCooldown: Duration.minutes(10), scaleOutCooldown: Duration.minutes(3) })
    }
    return { api, worker }
  }
}
