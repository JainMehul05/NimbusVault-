$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
. "$PSScriptRoot/local-ai-paths.ps1"
Assert-LocalAIServer $root
try{$null=Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2;Write-Host 'Using the existing loopback Ollama runtime.';return}catch{}
if(Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue){throw 'Port 11434 is occupied by an unrecognized service.'}
$configuration=Join-Path $root '.runtime/local-ai.json'
if(-not(Test-Path $configuration)){throw 'Run scripts/setup-ai.ps1 to configure the free local runtime.'}
. "$PSScriptRoot/local-ai-paths.ps1"
$ai=Resolve-LocalAI $root
if(-not(Test-Path $ai.binary)){throw 'Configured Ollama binary is missing; run scripts/setup-ai.ps1.'}
$env:OLLAMA_HOST='127.0.0.1:11434';$env:OLLAMA_MODELS=$ai.models;$env:OLLAMA_NO_CLOUD='1';$env:OLLAMA_NUM_PARALLEL='1';$env:OLLAMA_MAX_LOADED_MODELS='1';$env:OLLAMA_KEEP_ALIVE='15m';$env:OLLAMA_CONTEXT_LENGTH='6144'
$process=Start-Process -FilePath $ai.binary -ArgumentList 'serve' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput "$root/.runtime/ollama.log" -RedirectStandardError "$root/.runtime/ollama-error.log" -PassThru
$state=Join-Path $root '.runtime/processes.json'
$entries=@()
if(Test-Path $state){foreach($entry in (Get-Content $state | ConvertFrom-Json)){$existing=Get-Process -Id $entry.pid -ErrorAction SilentlyContinue;if($existing -and $existing.StartTime.ToUniversalTime().Ticks -eq ([datetime]$entry.started).ToUniversalTime().Ticks){$entries+=$entry}}}
$entries+=@{pid=$process.Id;started=$process.StartTime.ToUniversalTime().ToString('o');name='ollama'}
ConvertTo-Json -InputObject @($entries) | Set-Content $state
for($attempt=0;$attempt -lt 40;$attempt++){try{$null=Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2;Write-Host 'Local Ollama ready.';return}catch{Start-Sleep -Milliseconds 500}}
throw 'Ollama did not become ready; inspect .runtime/ollama-error.log.'
