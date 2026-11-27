#!/usr/bin/env bash
# Approved-host maintenance: apply a reviewed intelligence source patch as a thin image layer
# (no network pulls) and/or set the cloud operation flags, then recreate only that service.
#   ec2-apply-patch.sh <internal.py base64 | -> <operations:true|false> <writes:true|false>
set -euo pipefail
cd /opt/nimbusvault
C=(docker compose --env-file /opt/nimbusvault-private/compose.env -f deployment/compose.ec2.yml)
if [ "$1" != "-" ]; then
  work=$(mktemp -d)
  echo "$1" | base64 -d > "$work/internal.py"
  cp "$work/internal.py" /opt/nimbusvault/intelligence/app/internal.py
  docker image inspect nimbusvault-ec2-intelligence:bundled >/dev/null 2>&1 \
    || docker tag nimbusvault-ec2-intelligence:prepared nimbusvault-ec2-intelligence:bundled
  printf 'FROM nimbusvault-ec2-intelligence:bundled\nCOPY internal.py /app/intelligence/app/internal.py\n' > "$work/Dockerfile"
  DOCKER_BUILDKIT=0 docker build -q --pull=false -t nimbusvault-ec2-intelligence:prepared "$work"
  sha256sum /opt/nimbusvault/intelligence/app/internal.py
fi
for f in container.env intelligence.env compose.env; do
  sed -i -E "s/^AWS_OPERATIONS_ENABLED=.*/AWS_OPERATIONS_ENABLED=$2/; s/^AWS_WRITES_ENABLED=.*/AWS_WRITES_ENABLED=$3/" "/opt/nimbusvault-private/$f"
done
"${C[@]}" up -d --wait --wait-timeout 240 intelligence api
"${C[@]}" ps --format '{{.Service}} {{.State}} {{.Health}}'
grep -E '^AWS_(OPERATIONS|WRITES)_ENABLED' /opt/nimbusvault-private/intelligence.env
