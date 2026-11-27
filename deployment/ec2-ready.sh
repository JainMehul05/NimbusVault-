#!/usr/bin/env bash
# Bounded host readiness check, run through SSM by scripts/aws-runtime.py after each start.
# Replaces a single curl whose connection-reset error (exit 56) was not retried: Docker's port
# proxy accepts connections before Express is listening, so early probes are reset.
# Prints one labelled line per stage; exit 0 only when every stage passes before the deadline.
#   ec2-ready.sh [deadline-seconds]
set -uo pipefail
limit="${1:-330}"
start=$(date +%s)
left() { echo $(( limit - ($(date +%s) - start) )); }
cd /opt/nimbusvault || { echo "STAGE host: FAIL /opt/nimbusvault missing"; exit 10; }
C=(docker compose --env-file /opt/nimbusvault-private/compose.env -f deployment/compose.ec2.yml)
wait_for() { # name, command...
  local name="$1"; shift
  while [ "$(left)" -gt 0 ]; do
    if "$@" >/dev/null 2>&1; then echo "STAGE $name: OK after $(( $(date +%s) - start ))s"; return 0; fi
    sleep 3
  done
  echo "STAGE $name: FAIL (deadline ${limit}s)"; return 1
}
fail() { echo "DIAGNOSTICS:"; systemctl --no-pager -n 0 status nimbusvault.service 2>&1 | sed -n 1,4p
  "${C[@]}" ps --format '{{.Service}} {{.State}} {{.Health}}' 2>&1
  journalctl -u nimbusvault.service -b --no-pager -n 15 2>&1 | grep -viE 'secret|token|password' | cut -c1-220
  "${C[@]}" logs --tail 8 api intelligence 2>&1 | grep -viE 'secret|token|password|authorization' | cut -c1-220
  exit "$1"; }

wait_for docker systemctl is-active --quiet docker || fail 11
# nimbusvault.service is a oneshot running `compose up --wait`, so 'active' means every container
# passed its own health check; 'failed' is terminal and is reported immediately.
while [ "$(left)" -gt 0 ]; do
  state=$(systemctl show nimbusvault.service -p ActiveState --value)
  [ "$state" = active ] && { echo "STAGE compose: OK after $(( $(date +%s) - start ))s"; break; }
  [ "$state" = failed ] && { echo "STAGE compose: FAIL nimbusvault.service failed"; fail 12; }
  sleep 3
done
[ "$state" = active ] || { echo "STAGE compose: FAIL (deadline)"; fail 12; }
wait_for postgres "${C[@]}" exec -T postgres pg_isready -q -U nimbusvault -d nimbusvault || fail 13
# Validate the real health payload, tolerating refused/reset/timeouts until the deadline.
wait_for backend bash -c "curl -s --max-time 5 http://127.0.0.1:3100/api/v1/health | grep -q '\"status\":\"ok\"'" || fail 14
wait_for intelligence "${C[@]}" exec -T intelligence python -c "import os,urllib.request; urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8101/health',headers={'x-service-token':os.environ['INTERNAL_SERVICE_TOKEN']}),timeout=4)" || fail 15
wait_for ollama "${C[@]}" exec -T ollama ollama list || fail 16
if grep -q '^PUBLIC_PORT=' /opt/nimbusvault-private/container.env 2>/dev/null; then
  ip=$(curl -s -m 3 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' | xargs -I{} curl -s -m 3 -H 'X-aws-ec2-metadata-token: {}' http://169.254.169.254/latest/meta-data/local-ipv4)
  # The public origin listener must refuse requests without the CloudFront secret.
  wait_for origin-guard bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://$ip:8080/api/v1/health)\" = 403 ]" || fail 17
fi
echo "STAGE deadline: $(cat /run/nimbus-deadline 2>/dev/null || echo unknown)"
echo "READY in $(( $(date +%s) - start ))s"
