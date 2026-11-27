$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
& "$root/intelligence/.venv/Scripts/python.exe" "$root/scripts/aws-runtime.py" warmup
if($LASTEXITCODE -ne 0){throw 'Bounded AWS operation failed; review its diagnostic'}
