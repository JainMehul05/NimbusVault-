#!/usr/bin/env bash
# Confirms that the deployed site and API answer through CloudFront.
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

URL="$(output "$PLATFORM" SiteUrl)"
aws ecs wait services-stable --cluster "$(output "$PLATFORM" ClusterName)" \
  --services "$(output "$PLATFORM" ApiServiceName)" "$(output "$PLATFORM" WorkerServiceName)"

for attempt in $(seq 1 20); do
  if curl -fsS --max-time 10 "$URL/api/v1/health/ready" | jq -e '.data.status == "ready"' >/dev/null &&
    curl -fsS --max-time 10 "$URL/files/deep-link" | grep -q '<div id="root">'; then
    log "Healthy: $URL"
    exit 0
  fi
  sleep 15
done
echo "Not healthy after 5 minutes: $URL" >&2
exit 1
