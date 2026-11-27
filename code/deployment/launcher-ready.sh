#!/usr/bin/env bash
# Verification only: boot/session machinery has already armed these safeguards.
set -euo pipefail
for unit in nimbus-runtime-limit.timer nimbus-deadline-poweroff.timer nimbus-credit-watchdog.timer; do
  systemctl is-active --quiet "$unit" || { echo "FAIL safeguard: $unit"; exit 1; }
done
echo 'OK host runtime, absolute deadline and credit watchdog timers active'
cd /opt/nimbusvault
C=(docker compose --env-file /opt/nimbusvault-private/compose.env -f deployment/compose.ec2.yml)
"${C[@]}" exec -T postgres pg_isready -q -U nimbusvault -d nimbusvault
"${C[@]}" exec -T intelligence python - <<'PY'
import json, os, urllib.request
headers={'x-service-token':os.environ['INTERNAL_SERVICE_TOKEN']}
for route in ('health','warmup'):
    req=urllib.request.Request('http://127.0.0.1:8101/'+route, headers=headers,
                              data=b'' if route=='warmup' else None)
    with urllib.request.urlopen(req, timeout=300) as r: data=json.load(r)
    if route=='health': assert data.get('status')=='ok'
    else:
        runtime = data.get('runtime') or 'AI'
        assert data.get('available') is True and data.get('warmed') is True, f"{runtime} readiness not confirmed: {data.get('reason')}"
if data.get('external'):
    # Groq mode: no Qwen load and no quota spent; availability = key configured and not cooling down.
    print(f"OK fresh MiniLM embedding; fast cloud AI ready ({data.get('runtime')} {data.get('model')}, external, Qwen not loaded)")
else:
    print('OK fresh MiniLM embedding and genuine Qwen readiness generation')
PY
curl -fsS --max-time 30 http://127.0.0.1:3100/api/v1/health/ready | \
  python3 -c 'import sys,json; d=json.load(sys.stdin)["data"]; assert d["status"]=="ready" and d["checks"]["database"]=="ok"'
echo 'OK backend database/storage application readiness'
