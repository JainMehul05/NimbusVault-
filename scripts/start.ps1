$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
if(-not(Test-Path '.env')){throw 'Run scripts/setup.ps1 first.'}
foreach($line in Get-Content '.env'){if($line -match '^([A-Z_][A-Z0-9_]*)=(.*)$'){[Environment]::SetEnvironmentVariable($Matches[1],$Matches[2],'Process')}}
New-Item -ItemType Directory -Force '.runtime' | Out-Null
$owned=@()
if(Test-Path '.runtime/processes.json'){
  foreach($entry in (Get-Content '.runtime/processes.json' | ConvertFrom-Json)){
    $existing=Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
    if($existing -and $existing.StartTime.ToUniversalTime().Ticks -eq ([datetime]$entry.started).ToUniversalTime().Ticks){
      if($entry.name -eq 'ollama'){$owned+=$entry}else{throw 'NimbusVault is already running; use scripts/stop.ps1 first.'}
    }
  }
}
foreach($port in 3100,8101){if(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue){throw "Port $port is occupied; no unrelated process was stopped."}}
& docker compose --env-file .env -f compose.local.yml up -d --wait
if($LASTEXITCODE -ne 0){throw 'PostgreSQL did not start.'}
function Launch($exe,$arguments,$directory,$name){
  $process=Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $directory -WindowStyle Hidden -RedirectStandardOutput "$root/.runtime/$name.log" -RedirectStandardError "$root/.runtime/$name-error.log" -PassThru
  $script:owned+=@{pid=$process.Id;started=$process.StartTime.ToUniversalTime().ToString('o');name=$name}
  ConvertTo-Json -InputObject @($script:owned) | Set-Content '.runtime/processes.json'
}
try {
  . "$PSScriptRoot/local-ai-paths.ps1"
  Assert-LocalAIServer $root
  try {$null=Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2} catch {
    if(Test-Path '.runtime/local-ai.json'){
      . "$PSScriptRoot/local-ai-paths.ps1"
      $ai=Resolve-LocalAI $root
      $env:OLLAMA_MODELS=$ai.models;$env:OLLAMA_HOST='127.0.0.1:11434';$env:OLLAMA_NO_CLOUD='1';$env:OLLAMA_NUM_PARALLEL='1';$env:OLLAMA_MAX_LOADED_MODELS='1'
      Launch $ai.binary @('serve') $root 'ollama'
    }else{Write-Warning 'Ollama unavailable; cited extractive fallback remains enabled.'}
  }
  Launch "$root/intelligence/.venv/Scripts/python.exe" @('-m','uvicorn','app.internal:app','--host','127.0.0.1','--port','8101','--no-access-log') "$root/intelligence" 'intelligence'
  Launch (Get-Command node).Source @('dist/main.js') "$root/backend" 'api'
  $ready=$false
  for($i=0;$i -lt 40;$i++){
    try{
      $null=Invoke-RestMethod 'http://127.0.0.1:3100/api/v1/health' -TimeoutSec 2
      $private=Invoke-RestMethod 'http://127.0.0.1:8101/health' -Headers @{'x-service-token'=$env:INTERNAL_SERVICE_TOKEN} -TimeoutSec 2
      if($private.status -eq 'ok'){$ready=$true;break}
    }catch{Start-Sleep -Milliseconds 500}
  }
  if(-not $ready){throw 'NimbusVault did not start; inspect .runtime logs.'}
  Write-Host 'NimbusVault: http://127.0.0.1:3100'
}catch{& "$PSScriptRoot/stop.ps1";throw}
