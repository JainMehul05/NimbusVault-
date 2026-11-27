#!/usr/bin/env bash
# Only run through approved SSM commands on the exact newly approved host.
set -euo pipefail
test "$(cat /sys/devices/virtual/dmi/id/sys_vendor)" = 'Amazon EC2'
test -f /opt/nimbusvault-private/authorized-instance.json
systemctl is-active --quiet nimbus-runtime-limit.timer
# The proposed SG permits HTTPS only. Ubuntu's default HTTP repositories must
# use HTTPS before installation; no inbound rule or port 80 egress is needed.
sed -i 's|http://|https://|g' /etc/apt/sources.list.d/ubuntu.sources
export DEBIAN_FRONTEND=noninteractive
apt-get update
# Ubuntu 24.04 no longer ships an `awscli` package, and the credit watchdog needs
# the Free plan API (freetier get-account-plan-state), so install the official
# AWS CLI v2 and verify its PGP signature against the pinned AWS CLI team key.
apt-get install -y --no-install-recommends docker.io docker-compose-v2 python3 ca-certificates curl unzip gnupg
systemctl enable --now docker
docker compose version
if ! /usr/local/bin/aws --version 2>/dev/null | grep -q '^aws-cli/2\.'; then
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  curl --fail --silent --show-error --proto '=https' --tlsv1.2 -o "$work/awscliv2.zip" https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip
  curl --fail --silent --show-error --proto '=https' --tlsv1.2 -o "$work/awscliv2.sig" https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip.sig
  export GNUPGHOME="$work/gnupg"
  mkdir -m 700 "$GNUPGHOME"
  gpg --batch --quiet --import /opt/nimbusvault/deployment/aws-cli-v2-public-key.asc
  # VALIDSIG carries the full primary fingerprint; a published key expiry date
  # must not silently allow a signature from any other key.
  gpg --batch --status-fd 1 --verify "$work/awscliv2.sig" "$work/awscliv2.zip" 2>/dev/null \
    | grep -Eq '^\[GNUPG:\] VALIDSIG .* FB5DB77FD5C118B80511ADA8A6310ACC4672475C$'
  unzip -q "$work/awscliv2.zip" -d "$work"
  "$work/aws/install" --update
fi
/usr/local/bin/aws --version
printf 'Host prerequisites installed; application artifacts/secrets have not been downloaded by this script.\n'
