param(
  [Parameter(Mandatory=$true)][ValidateSet('start','stop','aws-start','aws-stop','status')][string]$Action,
  [switch]$NoBrowser
)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$lock=$null
function Docker-Ready {
  if(-not(Get-Command docker -ErrorAction SilentlyContinue)){return $false}
  try {
    & docker info --format '{{.OSType}}' 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } catch {return $false}
}
function Ensure-Docker {
  if(Docker-Ready){return}
  $candidates=@(
    (Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop/Docker Desktop.exe'),
    (Join-Path $env:ProgramFiles 'Docker/Docker/Docker Desktop.exe')
  )
  $desktop=$candidates | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
  if(-not $desktop){throw 'Docker Desktop is missing. Install it and complete its first-run setup.'}
  Write-Host 'Starting Docker Desktop; waiting up to 180 seconds...'
  Start-Process -FilePath $desktop -WindowStyle Hidden
  $end=(Get-Date).AddSeconds(180)
  do {Start-Sleep -Seconds 3;if(Docker-Ready){return}} while((Get-Date) -lt $end)
  throw 'Docker did not become ready. Open Docker Desktop and resolve any first-run/WSL prompt, then retry.'
}
function Local-Token {
  $line=Get-Content -LiteralPath (Join-Path $root '.env') | Where-Object {$_ -match '^INTERNAL_SERVICE_TOKEN='} | Select-Object -First 1
  if(-not $line){throw 'Private service configuration missing. Run npm run setup first.'}
  return ($line -split '=',2)[1].Trim().Trim('"').Trim("'")
}
function Check-Local {
  $state=Join-Path $root '.runtime/processes.json'
  if(-not(Test-Path -LiteralPath $state)){throw 'No recorded project-owned services.'}
  $entries=Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
  foreach($item in @(@{name='api';port=3100},@{name='intelligence';port=8101})){
    $entry=$entries | Where-Object {$_.name -eq $item.name} | Select-Object -First 1
    if(-not $entry){throw "Missing project ownership record for $($item.name)."}
    $process=Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
    $listener=Get-NetTCPConnection -LocalPort $item.port -State Listen -ErrorAction SilentlyContinue
    $ownerPids=@($entry.pid)
    # Windows venv python.exe can be a redirector; its interpreter is a direct child.
    if($item.name -eq 'intelligence'){
      $ownerPids+=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($entry.pid)" | Where-Object {
        $_.CreationDate.ToUniversalTime() -ge ([datetime]$entry.started).ToUniversalTime()
      } | ForEach-Object {$_.ProcessId})
    }
    if(-not $process -or $process.StartTime.ToUniversalTime().Ticks -ne ([datetime]$entry.started).ToUniversalTime().Ticks -or
      -not($listener | Where-Object {$_.OwningProcess -in $ownerPids})){throw "Project-owned $($item.name) is not listening."}
  }
  . "$PSScriptRoot/local-ai-paths.ps1"
  Assert-LocalAIServer $root
  $health=Invoke-RestMethod 'http://127.0.0.1:3100/api/v1/health' -TimeoutSec 5
  if($health.data.status -ne 'ok' -or $health.data.service -ne 'nimbusvault-backend'){throw 'Unexpected backend health response.'}
  $private=Invoke-RestMethod 'http://127.0.0.1:8101/health' -Headers @{'x-service-token'=(Local-Token)} -TimeoutSec 5
  if($private.status -ne 'ok'){throw 'Private intelligence is not ready.'}
  & docker compose --env-file .env -f compose.local.yml exec -T database pg_isready -q -U nimbusvault -d nimbusvault
  if($LASTEXITCODE -ne 0){throw 'PostgreSQL is not ready.'}
  # A real SQL operation through this backend, plus its configured storage health.
  $ready=Invoke-RestMethod 'http://127.0.0.1:3100/api/v1/health/ready' -TimeoutSec 30
  if($ready.data.checks.database -ne 'ok' -or $ready.data.status -ne 'ready'){throw 'Application database/storage readiness failed.'}
  $page=Invoke-WebRequest 'http://127.0.0.1:3100/' -UseBasicParsing -TimeoutSec 5
  if($page.StatusCode -ne 200 -or $page.Content -notmatch '<html'){throw 'The application frontend is not available.'}
  Write-Host '[OK] PostgreSQL, backend, private intelligence, storage and frontend.' -ForegroundColor Green
}
function Warm-Local {
  Write-Host 'Warming MiniLM and generating a Qwen readiness response (first load can take several minutes)...'
  $warm=Invoke-RestMethod 'http://127.0.0.1:8101/warmup' -Method Post -Headers @{'x-service-token'=(Local-Token)} -TimeoutSec 300
  if(-not $warm.available -or -not $warm.warmed){throw "MiniLM + $($warm.runtime) warmup did not complete: $($warm.reason)"}
  @{warmed_at=(Get-Date).ToUniversalTime().ToString('o');model=$warm.model} | ConvertTo-Json | Set-Content '.runtime/launcher-warmup.json'
  Write-Host '[OK] Fresh MiniLM embedding and genuine Qwen runtime generation completed.' -ForegroundColor Green
}
function Local-Status {
  Write-Host "`nLOCAL NIMBUSVAULT"
  try {Check-Local} catch {Write-Host "[NOT READY] $($_.Exception.Message)" -ForegroundColor Yellow}
  try {
    $control=Get-Content '.runtime/launcher-control/intelligence.json' -Raw | ConvertFrom-Json
    $ai=Invoke-RestMethod "http://127.0.0.1:$($control.port)/status" -Headers @{'x-launcher-token'=$control.token} -TimeoutSec 3
    Write-Host "MiniLM currently loaded: $($ai.embeddings_loaded); generation busy: $($ai.generation_busy)"
  } catch {Write-Host 'MiniLM live readiness: unavailable (older service or stopped).'}
  try {
    $loaded=Invoke-RestMethod 'http://127.0.0.1:11434/api/ps' -TimeoutSec 3
    $names=@($loaded.models | ForEach-Object {$_.name}) -join ', '
    Write-Host "AI currently loaded: $(if($names){$names}else{'none (use Start NimbusVault.bat to warm)'})"
    if(Test-Path '.runtime/launcher-warmup.json'){
      $last=Get-Content '.runtime/launcher-warmup.json' | ConvertFrom-Json
      Write-Host "Last verified MiniLM + Qwen warmup: $($last.warmed_at) (historical; models may unload after idle)."
    } else {Write-Host 'MiniLM + Qwen warmup: not yet verified by the launcher.'}
  } catch {Write-Host 'AI runtime: unavailable.'}
}
try {
  if($Action -ne 'status'){
    New-Item -ItemType Directory -Force '.runtime' | Out-Null
    $lockName=if($Action.StartsWith('aws-')){'launcher-aws.lock'}else{'launcher-local.lock'}
    try {$lock=[IO.File]::Open((Join-Path $root ".runtime/$lockName"),'OpenOrCreate','ReadWrite','None')}
    catch {throw 'Another NimbusVault launcher is working. Wait for it to finish and retry.'}
  }
  switch($Action){
    'start' {
      Ensure-Docker
      $running=$false
      try {Check-Local;$running=$true} catch {}
      if(-not $running){
        if(Test-Path '.runtime/processes.json'){
          Write-Host 'Recovering recorded NimbusVault services before starting...'
          & "$PSScriptRoot/stop.ps1"
        }
        & "$PSScriptRoot/start.ps1"
      } else {Write-Host 'Already running; verifying and warming without a restart.'}
      Check-Local
      Warm-Local
      Check-Local
      Write-Host "`nSUCCESS - NimbusVault is ready: http://127.0.0.1:3100" -ForegroundColor Green
      if(-not $NoBrowser){Start-Process 'http://127.0.0.1:3100'}
    }
    'stop' {& "$PSScriptRoot/stop.ps1";Write-Host 'SUCCESS - Local NimbusVault stopped; data preserved.' -ForegroundColor Green}
    'aws-start' {
      & "$root/intelligence/.venv/Scripts/python.exe" "$PSScriptRoot/launcher-aws.py" start
      if($LASTEXITCODE -ne 0){throw 'AWS startup did not complete. See the specific message above.'}
      $target=Get-Content '.runtime/aws-deployment/approved-instance.json' | ConvertFrom-Json
      if(-not $NoBrowser){Start-Process $target.public_url}
    }
    'aws-stop' {
      & "$root/intelligence/.venv/Scripts/python.exe" "$PSScriptRoot/launcher-aws.py" stop
      if($LASTEXITCODE -ne 0){throw 'AWS stopped state could not be verified. Check NimbusVault Status.bat.'}
    }
    'status' {
      Local-Status
      Write-Host "`nAWS NIMBUSVAULT (read-only checks)"
      & "$root/intelligence/.venv/Scripts/python.exe" "$PSScriptRoot/launcher-aws.py" status
      if($LASTEXITCODE -ne 0){throw 'AWS status could not be fully verified. See the message above.'}
    }
  }
  exit 0
} catch {
  Write-Host "`nFAILED - $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'No unrelated Docker projects were stopped. See .runtime logs for local diagnostics.'
  exit 1
} finally {if($lock){$lock.Dispose()}}
