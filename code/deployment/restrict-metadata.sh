#!/usr/bin/env bash
# Apply only on the new, explicitly approved EC2 host, never Docker Desktop.
set -euo pipefail
test "$(cat /sys/devices/virtual/dmi/id/sys_vendor)" = 'Amazon EC2'
test -f /opt/nimbusvault-private/authorized-instance.json
egress="$(docker network inspect nimbusvault-ec2_aws-egress --format '{{(index .IPAM.Config 0).Subnet}}')"
access_id="$(docker network inspect nimbusvault-ec2_access --format '{{.Id}}')"
access_bridge="br-${access_id:0:12}"
[[ "$egress" =~ ^[0-9./]+$ && "$access_bridge" =~ ^br-[a-f0-9]{12}$ ]]
iptables -N NIMBUS-METADATA 2>/dev/null || true
iptables -C DOCKER-USER -j NIMBUS-METADATA 2>/dev/null || iptables -I DOCKER-USER 1 -j NIMBUS-METADATA
iptables -C NIMBUS-METADATA -s "$egress" -d 169.254.169.254 -j RETURN 2>/dev/null || iptables -A NIMBUS-METADATA -s "$egress" -d 169.254.169.254 -j RETURN
iptables -C NIMBUS-METADATA -d 169.254.169.254 -j REJECT 2>/dev/null || iptables -A NIMBUS-METADATA -d 169.254.169.254 -j REJECT
iptables -C NIMBUS-METADATA -i "$access_bridge" -m conntrack --ctstate NEW -j REJECT 2>/dev/null || iptables -A NIMBUS-METADATA -i "$access_bridge" -m conntrack --ctstate NEW -j REJECT
printf 'Restricted Docker metadata and API outbound access on approved EC2 host.\n'
