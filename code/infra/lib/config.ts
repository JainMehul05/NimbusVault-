import type { App } from 'aws-cdk-lib'

export type EnvName = 'staging' | 'production'

/** Everything that varies between environments or deployments, in one place. */
export interface DeployConfig {
  envName: EnvName
  /** Account is read from the caller's credentials; region defaults to us-east-1. */
  account?: string
  region: string
  /** Two zones; override with -c azs=us-east-1a,us-east-1c if an instance type is unavailable in one. */
  availabilityZones: string[]

  /** Image tag in ECR. Immutable; CI passes the git SHA. */
  imageTag: string
  /** Set to 0 for the very first deployment, before any image or schema exists. */
  desiredCount: number

  /** "owner/repo" allowed to deploy through GitHub OIDC. Empty disables the deploy role. */
  githubRepo: string
  /** Branch (and GitHub environment) allowed to assume the deploy role. */
  githubBranch: string
  /** Only one GitHub OIDC provider can exist per account; set false if you already have it. */
  createOidcProvider: boolean

  /** Optional custom domain with an ACM certificate in us-east-1. */
  domainName?: string
  certificateArn?: string

  alarmEmail?: string
  monthlyBudgetUsd: number
  /** AWS WAF costs about $8 a month, so it is opt-in. Requires region us-east-1. */
  enableWaf: boolean

  aiEmbeddingProvider: 'local' | 'none'
  aiGenerationProvider: 'none' | 'openai' | 'anthropic'
  aiGenerationModel?: string
  ocrEnabled: boolean

  db: {
    instanceSize: 'micro' | 'small' | 'medium'
    multiAz: boolean
    backupDays: number
    allocatedGb: number
    maxAllocatedGb: number
    deletionProtection: boolean
  }
  api: { cpu: number; memory: number; max: number }
  worker: { cpu: number; memory: number; max: number; spot: boolean }
  logRetentionDays: 14 | 30 | 90
}

const DEFAULTS: Record<EnvName, Pick<DeployConfig, 'db' | 'api' | 'worker' | 'logRetentionDays' | 'monthlyBudgetUsd'>> = {
  staging: {
    db: { instanceSize: 'micro', multiAz: false, backupDays: 1, allocatedGb: 20, maxAllocatedGb: 50, deletionProtection: false },
    api: { cpu: 256, memory: 512, max: 2 },
    worker: { cpu: 512, memory: 2048, max: 1, spot: true },
    logRetentionDays: 14,
    monthlyBudgetUsd: 70,
  },
  production: {
    db: { instanceSize: 'micro', multiAz: false, backupDays: 14, allocatedGb: 20, maxAllocatedGb: 100, deletionProtection: true },
    api: { cpu: 512, memory: 1024, max: 4 },
    worker: { cpu: 1024, memory: 2048, max: 2, spot: true },
    logRetentionDays: 30,
    monthlyBudgetUsd: 100,
  },
}

const bool = (v: unknown, fallback: boolean) => (v === undefined || v === '' ? fallback : String(v) === 'true')

/** Reads `-c key=value` context. Invalid combinations fail at synth time, before anything is created. */
export function loadConfig(app: App): DeployConfig {
  const ctx = (key: string): string | undefined => {
    const v = app.node.tryGetContext(key)
    return v === undefined || v === '' ? undefined : String(v)
  }
  const envName = (ctx('env') ?? 'staging') as EnvName
  if (!(envName in DEFAULTS)) throw new Error(`Unknown env "${envName}" (use staging or production)`)

  const region = ctx('region') ?? process.env.CDK_DEFAULT_REGION ?? 'us-east-1'
  const config: DeployConfig = {
    ...DEFAULTS[envName],
    envName,
    account: process.env.CDK_DEFAULT_ACCOUNT || undefined,
    region,
    availabilityZones: (ctx('azs') ?? `${region}a,${region}b`).split(','),
    imageTag: ctx('imageTag') ?? 'bootstrap',
    desiredCount: Number(ctx('desiredCount') ?? 1),
    githubRepo: ctx('githubRepo') ?? '',
    githubBranch: ctx('githubBranch') ?? 'main',
    createOidcProvider: bool(ctx('createOidcProvider'), true),
    domainName: ctx('domainName'),
    certificateArn: ctx('certificateArn'),
    alarmEmail: ctx('alarmEmail'),
    enableWaf: bool(ctx('enableWaf'), false),
    aiEmbeddingProvider: (ctx('aiEmbeddingProvider') ?? 'local') as DeployConfig['aiEmbeddingProvider'],
    aiGenerationProvider: (ctx('aiGenerationProvider') ?? 'none') as DeployConfig['aiGenerationProvider'],
    aiGenerationModel: ctx('aiGenerationModel'),
    ocrEnabled: bool(ctx('ocrEnabled'), false),
  }
  if (ctx('monthlyBudgetUsd')) config.monthlyBudgetUsd = Number(ctx('monthlyBudgetUsd'))
  if (ctx('dbMultiAz')) config.db = { ...config.db, multiAz: bool(ctx('dbMultiAz'), false) }
  if (ctx('dbInstanceSize')) config.db = { ...config.db, instanceSize: ctx('dbInstanceSize') as DeployConfig['db']['instanceSize'] }

  if (config.availabilityZones.length !== 2) throw new Error('azs must name exactly two availability zones')
  if (!!config.domainName !== !!config.certificateArn) throw new Error('domainName and certificateArn must be set together')
  if (config.certificateArn && !config.certificateArn.includes(':us-east-1:')) throw new Error('CloudFront certificates must be in us-east-1')
  if (config.enableWaf && config.region !== 'us-east-1') throw new Error('enableWaf requires region us-east-1 (CloudFront-scoped web ACL)')
  if (!Number.isInteger(config.desiredCount) || config.desiredCount < 0) throw new Error('desiredCount must be a whole number')
  if (config.githubRepo && !/^[\w.-]+\/[\w.-]+$/.test(config.githubRepo)) throw new Error('githubRepo must look like owner/repo')
  if (!['none', 'openai', 'anthropic'].includes(config.aiGenerationProvider)) throw new Error('Unknown aiGenerationProvider')
  if (!['none', 'local'].includes(config.aiEmbeddingProvider)) throw new Error('Unknown aiEmbeddingProvider')
  return config
}
