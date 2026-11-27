param([switch]$KeepOllama)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$state=Join-Path $root '.runtime/processes.json'
function Owned-Process($entry){
  $p=Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
  if($p -and $p.StartTime.ToUniversalTime().Ticks -eq ([datetime]$entry.started).ToUniversalTime().Ticks){return $p}
  return $null
}
if(Test-Path -LiteralPath $state){
  $retained=@()
  $entries=Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
  foreach($name in 'api','intelligence','ollama'){
    foreach($entry in @($entries | Where-Object {$_.name -eq $name})){
      if($KeepOllama -and $name -eq 'ollama'){$retained+=$entry;continue}
      $process=Owned-Process $entry
      if(-not $process){continue}
      $controlFile=Join-Path $root ".runtime/launcher-control/$name.json"
      if($name -eq 'ollama'){
        try {
          $models=Invoke-RestMethod 'http://127.0.0.1:11434/api/ps' -TimeoutSec 3
          foreach($model in $models.models){
            $body=@{model=$model.name;keep_alive=0;stream=$false} | ConvertTo-Json
            $null=Invoke-RestMethod 'http://127.0.0.1:11434/api/generate' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 15
          }
        } catch {Write-Warning 'Model unload could not be confirmed; stopping only the recorded Ollama process.'}
        Stop-Process -Id $process.Id
        $null=$process.WaitForExit(10000)
      } elseif(Test-Path -LiteralPath $controlFile){
        $control=Get-Content -LiteralPath $controlFile | ConvertFrom-Json
        if($control.pid -ne $entry.pid){
          $child=Get-CimInstance Win32_Process -Filter "ProcessId=$($control.pid)"
          if($name -ne 'intelligence' -or -not $child -or $child.ParentProcessId -ne $entry.pid -or
             $child.CreationDate.ToUniversalTime() -lt ([datetime]$entry.started).ToUniversalTime()){
            throw "$name shutdown ownership mismatch. No process was terminated."
          }
        }
        $null=Invoke-RestMethod "http://127.0.0.1:$($control.port)/shutdown" -Method Post -Headers @{'x-launcher-token'=$control.token} -TimeoutSec 5
        if(-not $process.WaitForExit(35000)){throw "$name did not drain within 35 seconds. No force termination performed; retry Stop after active work completes."}
        Write-Host "[OK] $name drained and exited."
      } else {
        throw "$name has no verified graceful shutdown channel. It was not force-terminated. Stop that legacy session before using the new launcher."
      }
      if(Owned-Process $entry){throw "$name is still running; stopped state not verified."}
      if(Test-Path -LiteralPath $controlFile){Remove-Item -LiteralPath $controlFile}
    }
  }
  if($retained.Count){ConvertTo-Json -InputObject @($retained) | Set-Content -LiteralPath $state}
  else {Remove-Item -LiteralPath $state}
}
if(-not $KeepOllama){
  $dockerReady=$false
  try {& docker info --format '{{.OSType}}' 2>$null | Out-Null;$dockerReady=$LASTEXITCODE -eq 0} catch {}
  if($dockerReady){
    & docker compose --env-file "$root/.env" -f "$root/compose.local.yml" stop --timeout 35 database
    if($LASTEXITCODE -ne 0){throw 'Database stop failed.'}
    $ids=@(& docker compose --env-file "$root/.env" -f "$root/compose.local.yml" ps --status running -q database)
    if($LASTEXITCODE -ne 0 -or ($ids | Where-Object {$_})){throw 'Database is still running or its stopped state is unverified.'}
  } else {Write-Host 'Docker engine is stopped; its containers are not running.'}
}
foreach($port in 3100,8101){
  if(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue){throw "Port $port still has a listener; no unrelated process was stopped."}
}
$warm=Join-Path $root '.runtime/launcher-warmup.json'
if(Test-Path -LiteralPath $warm){Remove-Item -LiteralPath $warm}
Write-Host '[OK] Owned services stopped; database volumes, documents and conversations preserved.'
