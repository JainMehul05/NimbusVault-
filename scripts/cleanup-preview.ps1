$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
& "$root/intelligence/.venv/Scripts/python.exe" "$root/scripts/cleanup-preview.py"
if($LASTEXITCODE -ne 0){throw 'Read-only cloud preservation preview failed.'}
