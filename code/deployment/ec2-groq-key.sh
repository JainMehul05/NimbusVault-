#!/usr/bin/env bash
# Fetch the Groq key from SSM Parameter Store with the instance role and store it for the
# intelligence container only. The value is never printed or passed as an argument.
set -euo pipefail
umask 077
f=/opt/nimbusvault-private/groq-api-key
/usr/local/bin/aws ssm get-parameter --region ap-southeast-2 --name /nimbusvault/groq/api-key --with-decryption \
  --query Parameter.Value --output text > "$f.tmp"
grep -qE '^gsk_[A-Za-z0-9]{20,}$' "$f.tmp" || { rm -f "$f.tmp"; echo "invalid key format"; exit 3; }
chown 10001:10001 "$f.tmp"; chmod 0400 "$f.tmp"; mv -f "$f.tmp" "$f"
stat -c 'groq key stored: owner=%u mode=%a bytes=%s' "$f"
