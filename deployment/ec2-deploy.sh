#!/usr/bin/env bash
# Run once via SSM on the exact approved instance. Arguments come from the operator:
#   ec2-deploy.sh <s3-prefix-uri> <sha:images> <sha:models> <sha:source>
# Downloads only the sanitized bundle with the instance role, verifies SHA-256,
# loads images, generates host-only secrets and starts the stack.
set -euo pipefail
test "$(cat /sys/devices/virtual/dmi/id/sys_vendor)" = 'Amazon EC2'
test -f /opt/nimbusvault-private/authorized-instance.json
systemctl is-active --quiet nimbus-runtime-limit.timer
prefix="$1"; images_sha="$2"; models_sha="$3"; source_sha="$4"
stage=/var/lib/nimbusvault-bundle
mkdir -p "$stage" /opt/nimbusvault
chmod 700 "$stage"
for f in source.tar.gz models.tar images.tar.gz; do
  test -s "$stage/$f" || /usr/local/bin/aws s3 cp --only-show-errors "$prefix$f" "$stage/$f"
done
echo "$source_sha  $stage/source.tar.gz
$models_sha  $stage/models.tar
$images_sha  $stage/images.tar.gz" | sha256sum --check --strict
tar -xzf "$stage/source.tar.gz" -C /opt/nimbusvault --no-same-owner
tar -xf "$stage/models.tar" -C /opt/nimbusvault --no-same-owner
gunzip -c "$stage/images.tar.gz" | docker load
python3 /opt/nimbusvault/deployment/configure-host.py
install -m 0644 /opt/nimbusvault/deployment/nimbusvault.service /etc/systemd/system/
install -m 0644 /opt/nimbusvault/deployment/nimbus-credit-watchdog.service /etc/systemd/system/
install -m 0644 /opt/nimbusvault/deployment/nimbus-credit-watchdog.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now nimbus-credit-watchdog.timer
systemctl enable nimbusvault.service
systemctl start nimbusvault.service
docker compose --env-file /opt/nimbusvault-private/compose.env -f /opt/nimbusvault/deployment/compose.ec2.yml ps --format '{{.Service}} {{.State}} {{.Health}}'
df -h / | tail -1
printf 'Deployment complete; archives retained in %s until verified.\n' "$stage"
