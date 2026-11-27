$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$token=((Get-Content "$root/.env" | Where-Object {$_ -match '^INTERNAL_SERVICE_TOKEN='}) -split '=',2)[1]
Invoke-RestMethod -Uri 'http://127.0.0.1:8101/warmup' -Method Post -Headers @{'x-service-token'=$token} -TimeoutSec 180
