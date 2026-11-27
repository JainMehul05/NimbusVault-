#!/usr/bin/env bash
# Shared by the deployment scripts. Needs: aws, jq, docker (push only), node.
set -euo pipefail

: "${ENVIRONMENT:?Set ENVIRONMENT to staging or production}"
: "${AWS_REGION:?Set AWS_REGION}"
case "$ENVIRONMENT" in staging | production) ;; *) echo "ENVIRONMENT must be staging or production" >&2; exit 1 ;; esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FOUNDATION="NimbusVault-${ENVIRONMENT}-Foundation"
PLATFORM="NimbusVault-${ENVIRONMENT}-Platform"
export CDK_DEFAULT_REGION="$AWS_REGION"
export AWS_DEFAULT_REGION="$AWS_REGION" AWS_PAGER=""

log() { printf '\n==> %s\n' "$*"; }

# output STACK KEY — empty when the stack or output does not exist.
output() {
  aws cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text 2>/dev/null | grep -v '^None$' || true
}

# Extra context such as: githubRepo=owner/repo alarmEmail=me@example.com (space separated).
cdk_run() {
  local args=(-c "env=$ENVIRONMENT" -c "region=$AWS_REGION")
  local pair
  for pair in ${CDK_CONTEXT:-}; do args+=(-c "$pair"); done
  (cd "$ROOT/infra" && CDK_DEFAULT_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)" npx cdk "$@" "${args[@]}")
}
