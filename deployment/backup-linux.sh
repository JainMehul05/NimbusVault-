#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/nimbusvault
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="/opt/nimbusvault-private/backups/$stamp"
mkdir -p "$target"
compose=(docker compose --env-file /opt/nimbusvault-private/compose.env -f deployment/compose.ec2.yml)
"${compose[@]}" exec -T postgres pg_dump -U nimbusvault -d nimbusvault -Fc > "$target/application.dump"
"${compose[@]}" exec -T postgres pg_restore --list < "$target/application.dump" > "$target/postgres-contents.txt"
"${compose[@]}" exec -T intelligence python -c "import sqlite3; a=sqlite3.connect('file:/app/data/cloudvault.db?mode=ro',uri=True); b=sqlite3.connect('/tmp/nimbus-backup.db'); a.backup(b); assert b.execute('pragma integrity_check').fetchone()[0]=='ok'; b.close(); a.close()"
"${compose[@]}" exec -T intelligence cat /tmp/nimbus-backup.db > "$target/evidence.db"
cp /opt/nimbusvault-private/container.env "$target/container.env.private"
cp /opt/nimbusvault-private/intelligence.env "$target/intelligence.env.private"
cp /opt/nimbusvault-private/compose.env "$target/compose.env.private"
cp deployment/compose.ec2.yml "$target/compose.ec2.yml"
if test -f SOURCE_CHECKPOINT; then cp SOURCE_CHECKPOINT "$target/source-checkpoint.txt"; else git rev-parse HEAD > "$target/source-checkpoint.txt"; fi
(cd "$target" && find . -maxdepth 1 -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum) > "$target/SHA256SUMS"
(cd "$target" && sha256sum --check SHA256SUMS)
printf 'Private host backup validated: %s\n' "$stamp"
printf 'This contains secrets. No S3 upload, sharing or private-data export was performed.\n'
