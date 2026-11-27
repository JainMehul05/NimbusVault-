import { Stack, Token, Validations } from 'aws-cdk-lib'
import type { Bucket, CfnBucket } from 'aws-cdk-lib/aws-s3'
import type { IConstruct } from 'constructs'

/**
 * Accepted findings of the AwsSolutions rule pack, each with its reason. Anything not listed
 * here fails synthesis, so this file is the complete list of deliberate deviations.
 */
export function accept(scope: IConstruct, rules: Record<string, string>): void {
  for (const [id, reason] of Object.entries(rules)) {
    Validations.of(scope).acknowledge({ id: `AwsSolutions::AwsSolutions-${id}`, reason })
  }
}

/** IAM wildcard findings are acknowledged one resource pattern at a time, never as a whole. */
export function acceptWildcards(scope: IConstruct, reason: string, resources: string[]): void {
  accept(scope, Object.fromEntries(resources.map((r) => [`IAM5[Resource::${r}]`, reason])))
}

/** How the rule pack names things: literal values when known, `<Reference>` when not. */
export const named = {
  account: (scope: IConstruct) => {
    const { account } = Stack.of(scope)
    return Token.isUnresolved(account) ? '<AWS::AccountId>' : account
  },
  objectsIn: (bucket: Bucket) => `<${Stack.of(bucket).getLogicalId(bucket.node.defaultChild as CfnBucket)}.Arn>/*`,
}

export const REASONS = {
  taskEnvironment: 'Only non-secret settings are plain environment variables; every credential is injected from Secrets Manager.',
  ecrToken: 'ecr:GetAuthorizationToken does not support resource-level permissions; image and log access are scoped.',
  rotation:
    'Scheduled rotation needs a Lambda with a paid VPC endpoint (no NAT here) and would sign everyone out (JWT keys). Rotation is a documented manual runbook.',
  urlsCarryTokens:
    'Share-link tokens appear in request paths, so edge and load-balancer access logs would store live credentials. The API writes structured request logs with tokens redacted.',
}
