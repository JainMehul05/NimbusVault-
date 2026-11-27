#!/usr/bin/env bash
# One-time account preparation with administrator credentials. Creates billable resources only
# in the sense of an empty registry and the CDK toolkit bucket (cents per month).
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

log "Account $(aws sts get-caller-identity --query Account --output text), region $AWS_REGION, environment $ENVIRONMENT"
(cd "$ROOT/infra" && npx cdk bootstrap "aws://$(aws sts get-caller-identity --query Account --output text)/$AWS_REGION")
cdk_run deploy "$FOUNDATION" --require-approval broadening

log "Registry: $(output "$FOUNDATION" RepositoryUri)"
ROLE="$(output "$FOUNDATION" DeployRoleArn)"
[ -z "$ROLE" ] || log "GitHub variable AWS_DEPLOY_ROLE_ARN = $ROLE"
