$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
& "$root/intelligence/.venv/Scripts/python.exe" "$root/scripts/verify-aws.py"
if($LASTEXITCODE -ne 0){throw 'AWS read-only audit failed.'}
