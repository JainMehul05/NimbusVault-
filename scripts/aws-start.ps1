$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
& "$root/intelligence/.venv/Scripts/python.exe" "$root/scripts/aws-runtime.py" start @args
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
