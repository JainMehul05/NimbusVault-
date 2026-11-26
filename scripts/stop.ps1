param([switch]$KeepOllama)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$state=Join-Path $root '.runtime/processes.json'
if(Test-Path $state){
  $retained=@()
  foreach($entry in (Get-Content $state | ConvertFrom-Json)){
    if($KeepOllama -and $entry.name -eq 'ollama'){$retained+=$entry;continue}
    $process=Get-Process -Id $entry.pid -ErrorAction SilentlyContinue
    if($process -and $process.StartTime.ToUniversalTime().Ticks -eq ([datetime]$entry.started).ToUniversalTime().Ticks){Stop-Process -Id $process.Id}
  }
  if($retained.Count){$retained | ConvertTo-Json -AsArray | Set-Content $state}else{Remove-Item -LiteralPath $state}
}
if(-not $KeepOllama){& docker compose --env-file "$root/.env" -f "$root/compose.local.yml" stop database}
Write-Host 'Owned services stopped; all database volumes preserved.'
