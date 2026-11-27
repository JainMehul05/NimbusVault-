#!/usr/bin/env bash
# EC2 user-data: no credentials, private files, downloads or application secrets.
# Arm the boot-scoped safeguard before any lengthy installation.
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
systemctl daemon-reload
systemctl enable --now nimbus-runtime-limit.timer
systemctl is-active --quiet nimbus-runtime-limit.timer
logger -t nimbusvault 'Boot runtime safeguard armed; waiting for approved SSM deployment'
