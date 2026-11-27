#!/usr/bin/env bash
# EC2 user-data: no credentials, private files, downloads or application secrets.
# Arms two on-instance stop safeguards before any lengthy installation:
#  1. nimbus-runtime-limit.timer: poweroff 3h45min after every boot (boot-scoped,
#     so Docker/application restarts cannot extend it).
#  2. nimbus-deadline.service: at every boot reads the absolute approved deadline
#     from the instance tag NimbusStopDeadline (IMDSv2 instance tags) and arms a
#     poweroff at min(tag deadline, boot + 3h45). A missing, malformed or past
#     deadline fails closed with a poweroff 10 minutes after boot, so a stop/start
#     can never extend an approved session.
# Instance-initiated shutdown behaviour is "stop", so poweroff stops (not terminates).
set -euo pipefail
cat > /etc/systemd/system/nimbus-runtime-limit.service <<'EOF'
[Unit]
Description=Stop this EC2 instance before approved runtime expiry
After=multi-user.target
[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl poweroff
TimeoutStartSec=10
EOF
cat > /etc/systemd/system/nimbus-runtime-limit.timer <<'EOF'
[Unit]
Description=Independent bounded EC2 runtime safeguard
[Timer]
OnBootSec=3h45min
AccuracySec=1s
Unit=nimbus-runtime-limit.service
[Install]
WantedBy=timers.target
EOF
cat > /usr/local/sbin/nimbus-arm-deadline <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
now=$(date -u +%s)
limit=$(( $(cut -d. -f1 /proc/uptime) ))
boot_cap=$(( now - limit + 13500 ))
deadline=$(( now + 600 ))
token=$(curl -sf -m 3 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' || true)
if [ -n "$token" ]; then
  value=$(curl -sf -m 3 -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/tags/instance/NimbusStopDeadline || true)
  if [[ "$value" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
    tagged=$(date -u -d "$value" +%s 2>/dev/null || echo 0)
    if [ "$tagged" -gt $(( now + 60 )) ]; then
      deadline=$tagged
      [ "$deadline" -gt "$boot_cap" ] && deadline=$boot_cap
    fi
  fi
fi
when=$(date -u -d "@$deadline" '+%Y-%m-%d %H:%M:%S UTC')
systemctl stop nimbus-deadline-poweroff.timer 2>/dev/null || true
systemd-run --unit nimbus-deadline-poweroff --on-calendar="$when" --timer-property=AccuracySec=1s /usr/bin/systemctl poweroff
logger -t nimbusvault "Absolute approved deadline armed for $when"
echo "$when" > /run/nimbus-deadline
EOF
chmod 0755 /usr/local/sbin/nimbus-arm-deadline
cat > /etc/systemd/system/nimbus-deadline.service <<'EOF'
[Unit]
Description=Arm the absolute approved NimbusVault stop deadline
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/nimbus-arm-deadline
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now nimbus-runtime-limit.timer
systemctl enable nimbus-deadline.service
systemctl start nimbus-deadline.service
systemctl is-active --quiet nimbus-runtime-limit.timer
logger -t nimbusvault 'Boot runtime safeguards armed; waiting for approved SSM deployment'
