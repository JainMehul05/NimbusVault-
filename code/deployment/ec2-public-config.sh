#!/usr/bin/env bash
# Switch the approved host between private and public (CloudFront) mode. Run through SSM.
#   ec2-public-config.sh public <https://dxxxx.cloudfront.net> <origin-secret-b64> <invite-code-b64>
#   ec2-public-config.sh private
# Secrets arrive base64-encoded, are written only to root-only env files and are never printed.
set -euo pipefail
cd /opt/nimbusvault
P=/opt/nimbusvault-private
setv() { # file key value
  local f="$1" k="$2" v="$3"
  if grep -q "^$k=" "$f"; then
    python3 - "$f" "$k" "$v" <<'PY'
import sys; f,k,v=sys.argv[1:]; lines=open(f).read().splitlines()
open(f,'w').write('\n'.join(f'{k}={v}' if l.startswith(k+'=') else l for l in lines)+'\n')
PY
  else printf '%s=%s\n' "$k" "$v" >> "$f"; fi
}
delv() { sed -i "/^$2=/d" "$1"; }
mode="$1"
if [ "$mode" = public ]; then
  url="$2"; [[ "$url" =~ ^https://[a-z0-9]+\.(cloudfront\.net|execute-api\.ap-southeast-2\.amazonaws\.com)$ ]] || { echo "invalid AWS public URL"; exit 2; }
  secret=$(echo "$3" | base64 -d); invite=$(echo "$4" | base64 -d)
  [ ${#secret} -ge 32 ] && [ ${#invite} -ge 8 ] || { echo "secret/invite too short"; exit 2; }
  tok=$(curl -s -m 3 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
  ip=$(curl -s -m 3 -H "X-aws-ec2-metadata-token: $tok" http://169.254.169.254/latest/meta-data/local-ipv4)
  [[ "$ip" =~ ^172\.31\.[0-9]+\.[0-9]+$ ]] || { echo "unexpected private IP"; exit 2; }
  for f in $P/container.env $P/compose.env; do
    setv $f FRONTEND_URL "$url,http://127.0.0.1:3200"
    setv $f COOKIE_SECURE true
    setv $f TRUST_PROXY "172.16.0.0/12"
    setv $f PUBLIC_PORT 3101
    setv $f ORIGIN_SHARED_SECRET "$secret"
    setv $f REGISTRATION_MODE invite
    setv $f REGISTRATION_INVITE_CODE "$invite"
    setv $f MAX_USERS 50
    setv $f DEFAULT_STORAGE_QUOTA_BYTES 20971520
    setv $f MAX_FILES_PER_USER 25
    setv $f GLOBAL_STORAGE_CAP_BYTES 524288000
    setv $f UPLOAD_ALLOWED_EXTENSIONS "txt,md,pdf,docx"
    setv $f MAX_FILE_BYTES 5242880
    setv $f AI_MAX_FILE_BYTES 5242880
    setv $f AI_QUERY_RATE_LIMIT 10
    setv $f AI_DAILY_QUESTION_LIMIT 40
    setv $f REGISTER_RATE_LIMIT 5
    setv $f AWS_OPERATIONS_ENABLED true
    setv $f AWS_WRITES_ENABLED true
  done
  setv $P/intelligence.env AWS_OPERATIONS_ENABLED true
  setv $P/intelligence.env AWS_WRITES_ENABLED true
  setv $P/compose.env PUBLIC_BIND_IP "$ip"
  echo "public mode configured for $url (origin bound to private IP)"
elif [ "$mode" = private ]; then
  for f in $P/container.env $P/compose.env; do
    for k in PUBLIC_PORT ORIGIN_SHARED_SECRET REGISTRATION_INVITE_CODE PUBLIC_BIND_IP; do delv $f $k; done
    setv $f FRONTEND_URL "http://127.0.0.1:3200"
    setv $f COOKIE_SECURE false
    setv $f REGISTRATION_MODE closed
    setv $f AWS_WRITES_ENABLED false
  done
  setv $P/intelligence.env AWS_WRITES_ENABLED false
  echo "private mode configured"
else echo "usage"; exit 2; fi
chmod 600 $P/*.env
docker compose --env-file $P/compose.env -f deployment/compose.ec2.yml up -d --wait --wait-timeout 240 >/dev/null 2>&1
docker compose --env-file $P/compose.env -f deployment/compose.ec2.yml ps --format '{{.Service}} {{.Health}}' | tr '\n' ' '; echo
ss -lntH | awk '{print $4}' | grep -E ':(3100|8080)$' | tr '\n' ' '; echo
