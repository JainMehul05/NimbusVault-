#!/usr/bin/env bash
# Read-only EC2 host/application readiness and isolation evidence. Prints no secrets.
set -uo pipefail
cd /opt/nimbusvault
C=(docker compose --env-file /opt/nimbusvault-private/compose.env -f deployment/compose.ec2.yml)
j() { printf '%s=%s\n' "$1" "$2"; }
tok=$(curl -sf -m 3 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
md() { curl -sf -m 3 -H "X-aws-ec2-metadata-token: $tok" "http://169.254.169.254/latest/meta-data/$1"; }
j instance_type "$(md instance-type)"; j az "$(md placement/availability-zone)"; j ami "$(md ami-id)"
j imdsv1_rejected "$(curl -s -o /dev/null -w '%{http_code}' -m 3 http://169.254.169.254/latest/meta-data/instance-id)"
j role "$(md iam/security-credentials/)"
j os "$(. /etc/os-release; echo "$PRETTY_NAME")"; j kernel "$(uname -r)"; j arch "$(uname -m)"
j cpus "$(nproc)"; j mem_total_mib "$(free -m | awk '/Mem:/{print $2}')"; j mem_available_mib "$(free -m | awk '/Mem:/{print $7}')"
j swap_mib "$(free -m | awk '/Swap:/{print $2}')"
j root_fs "$(df -h / | tail -1 | awk '{print $2" size, "$3" used, "$4" free"}')"
j deadline "$(cat /run/nimbus-deadline 2>/dev/null)"
j timers "$(systemctl list-timers --all --no-legend 'nimbus*' | awk '{print $1" "$2" "$(NF-1)}' | tr '\n' ';')"
j watchdog_last "$(systemctl show nimbus-credit-watchdog.service -p Result -p ExecMainExitTimestamp --value | tr '\n' ' ')"
j listening "$(ss -lntH | awk '{print $4}' | sort -u | tr '\n' ' ')"
j docker "$(docker --version)"; j compose "$(docker compose version --short)"
"${C[@]}" ps --format '{{.Service}}:{{.State}}:{{.Health}}' | sed 's/^/service=/'
j oom_events "$(journalctl -k --no-pager 2>/dev/null | grep -ci 'out of memory')"
docker stats --no-stream --format 'stats={{.Name}} mem={{.MemUsage}} cpu={{.CPUPerc}}'
docker system df --format 'disk={{.Type}} {{.Size}}'
j model_assets "$(du -sh model-assets | cut -f1)"
# Metadata isolation: only the intelligence container (aws-egress bridge) may reach IMDS.
j api_imds "$("${C[@]}" exec -T api node -e "fetch('http://169.254.169.254/latest/api/token',{method:'PUT',headers:{'X-aws-ec2-metadata-token-ttl-seconds':'60'},signal:AbortSignal.timeout(3000)}).then(r=>console.log('reachable',r.status)).catch(e=>console.log('blocked',e.cause?.code||e.name))" 2>&1 | tail -1)"
j api_internet "$("${C[@]}" exec -T api node -e "fetch('https://sts.ap-southeast-2.amazonaws.com',{signal:AbortSignal.timeout(4000)}).then(r=>console.log('reachable',r.status)).catch(e=>console.log('blocked',e.cause?.code||e.name))" 2>&1 | tail -1)"
j intelligence_role_identity "$("${C[@]}" exec -T intelligence python -c "import boto3;a=boto3.client('sts',region_name='ap-southeast-2').get_caller_identity()['Arn'];print(a.split(':')[5].split('/')[0:2])" 2>&1 | tail -1)"
j ollama_internet "$("${C[@]}" exec -T ollama python -c "import urllib.request
try: urllib.request.urlopen('https://ollama.com',timeout=4); print('reachable')
except Exception as e: print('blocked', type(e).__name__)" 2>&1 | tail -1)"
j postgres_host_port "$(ss -lntH | grep -c ':5432 ')"
j health "$(curl -s -m 5 http://127.0.0.1:3100/api/v1/health)"
"${C[@]}" exec -T intelligence python -c "
import os,json,urllib.request
h={'x-service-token':os.environ['INTERNAL_SERVICE_TOKEN']}
r=json.loads(urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8101/health',headers=h),timeout=5).read())
print('intelligence_health='+json.dumps(r)[:600])
bad=urllib.request.Request('http://127.0.0.1:8101/health',headers={'x-service-token':'x'*48})
try: urllib.request.urlopen(bad,timeout=5); print('invalid_token=accepted')
except Exception as e: print('invalid_token=rejected', getattr(e,'code',type(e).__name__))
" 2>&1 | tail -2
