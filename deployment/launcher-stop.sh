#!/usr/bin/env bash
set -euo pipefail
# Uses the existing systemd ExecStop/Compose grace periods; no volume removal.
systemctl stop nimbusvault.service
state=$(systemctl show nimbusvault.service -p ActiveState --value)
[ "$state" = inactive ] || { echo 'FAIL application service still active'; exit 1; }
echo 'OK application stack drained; normal EC2 OS shutdown follows'
