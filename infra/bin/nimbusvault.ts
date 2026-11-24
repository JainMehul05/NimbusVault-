import { App, Tags, Validations } from 'aws-cdk-lib'
import { AwsSolutionsChecks } from 'cdk-nag'
import { loadConfig } from '../lib/config'
import { FoundationStack } from '../lib/foundation-stack'
import { PlatformStack } from '../lib/platform-stack'

const app = new App()
const config = loadConfig(app)
const env = { account: config.account, region: config.region }
const prefix = `NimbusVault-${config.envName}`

const foundation = new FoundationStack(app, `${prefix}-Foundation`, { env, config, terminationProtection: config.envName === 'production' })
new PlatformStack(app, `${prefix}-Platform`, {
  env,
  config,
  repositoryName: foundation.repositoryName,
  deployRoleName: foundation.deployRoleName,
  terminationProtection: config.envName === 'production',
}).addStackDependency(foundation)

// Fails synthesis on any security finding that is not explicitly acknowledged in the code.
Validations.of(app).addPlugins(new AwsSolutionsChecks(app))

Tags.of(app).add('Project', 'NimbusVault')
Tags.of(app).add('Environment', config.envName)
Tags.of(app).add('ManagedBy', 'CDK')
