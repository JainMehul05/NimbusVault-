$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$saved=@{}
foreach($path in '.env','backend/.env','intelligence/.env'){$saved[$path]=[IO.File]::ReadAllBytes((Join-Path $root $path))}
try{
  & "$PSScriptRoot/stop.ps1" -KeepOllama
  foreach($path in $saved.Keys){$text=[Text.Encoding]::UTF8.GetString($saved[$path]);$text=$text -replace '(?m)^AWS_OPERATIONS_ENABLED=.*$','AWS_OPERATIONS_ENABLED=false';[IO.File]::WriteAllText((Join-Path $root $path),$text)}
  & "$PSScriptRoot/start.ps1"
  node scripts/verify-degraded.cjs cloud-paused
  if($LASTEXITCODE -ne 0){throw 'Cloud-paused verification failed'}
  $entries=Get-Content '.runtime/processes.json' | ConvertFrom-Json
  $model=@($entries | Where-Object {$_.name -eq 'ollama'})
  if($model.Count -ne 1){throw 'No uniquely owned Ollama process; refusing to stop an external runtime'}
  $process=Get-Process -Id $model[0].pid -ErrorAction Stop
  if($process.StartTime.ToUniversalTime().Ticks -ne ([datetime]$model[0].started).ToUniversalTime().Ticks){throw 'Ollama PID identity changed'}
  Stop-Process -Id $process.Id
  Start-Sleep -Seconds 1
  node scripts/verify-degraded.cjs model-stopped
  if($LASTEXITCODE -ne 0){throw 'Model-unavailable verification failed'}
}finally{
  & "$PSScriptRoot/stop.ps1" -KeepOllama
  foreach($path in $saved.Keys){[IO.File]::WriteAllBytes((Join-Path $root $path),$saved[$path])}
  & "$PSScriptRoot/start-ai.ps1"
  & "$PSScriptRoot/start.ps1"
  & "$PSScriptRoot/warmup.ps1"
}
