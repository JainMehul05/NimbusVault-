$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$stamp=(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')+'-'+([guid]::NewGuid().ToString('N').Substring(0,8))
$target=Join-Path $root ".private-backup/$stamp"
New-Item -ItemType Directory -Force $target | Out-Null
icacls $target /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
& docker exec nimbusvault-final-db pg_dump -U nimbusvault -d nimbusvault -Fc -f "/tmp/nimbus-$stamp.dump"
if($LASTEXITCODE -ne 0){throw 'PostgreSQL backup failed.'}
& docker cp "nimbusvault-final-db:/tmp/nimbus-$stamp.dump" "$target/application.dump"
if($LASTEXITCODE -ne 0){throw 'PostgreSQL backup transfer failed.'}
& docker exec nimbusvault-final-db pg_restore --list "/tmp/nimbus-$stamp.dump" | Out-Null
if($LASTEXITCODE -ne 0){throw 'PostgreSQL backup validation failed.'}
& "$root/intelligence/.venv/Scripts/python.exe" "$root/scripts/backup-local.py" --target $target
if($LASTEXITCODE -ne 0){throw 'SQLite backup failed.'}
Write-Host "Private database/configuration backup: $target"
