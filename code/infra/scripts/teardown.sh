#!/usr/bin/env bash
# Deletes an environment. Destructive, so it needs the environment name typed as confirmation:
#   ENVIRONMENT=staging AWS_REGION=us-east-1 infra/scripts/teardown.sh staging
# The file bucket, its access logs and a final database snapshot are kept; the closing notes
# explain how to remove them.
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[ "${1:-}" = "$ENVIRONMENT" ] || { echo "Refusing: pass the environment name ($ENVIRONMENT) to confirm" >&2; exit 1; }

FILES="$(output "$PLATFORM" FilesBucketName)"
SITE="$(output "$PLATFORM" SiteBucketName)"

if [ "$ENVIRONMENT" = production ]; then
  echo "Production has termination and deletion protection. Disable them deliberately first:" >&2
  echo "  aws cloudformation update-termination-protection --no-enable-termination-protection --stack-name $PLATFORM" >&2
  echo "  aws rds modify-db-instance --db-instance-identifier $(output "$PLATFORM" DatabaseId) --no-deletion-protection --apply-immediately" >&2
fi

if [ -n "$SITE" ]; then
  log "Emptying the (rebuildable) site bucket, including old versions"
  while :; do
    BATCH="$(aws s3api list-object-versions --bucket "$SITE" --max-items 500 --output json |
      jq -c '{Objects: [(.Versions // [])[], (.DeleteMarkers // [])[] | {Key, VersionId}], Quiet: true}')"
    [ "$(jq '.Objects | length' <<<"$BATCH")" -gt 0 ] || break
    aws s3api delete-objects --bucket "$SITE" --delete "$BATCH" >/dev/null
  done
fi

log "Destroying $PLATFORM and $FOUNDATION"
cdk_run destroy "$PLATFORM" --force
cdk_run destroy "$FOUNDATION" --force

cat <<EOF

Kept on purpose (and still billed):
  - file bucket s3://$FILES and its access-log bucket
  - the final RDS snapshot (and automated backups until they expire)
When you are certain, empty and delete them in the console or with the AWS CLI.
EOF
