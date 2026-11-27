# Switch the local Windows app between private local Qwen (ollama) and fast cloud AI (groq).
# Edits only LLM_PROVIDER in the private .env; restart with Stop/Start NimbusVault to apply.
param([Parameter(Mandatory=$true)][ValidateSet('groq','ollama')][string]$Provider)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$env_file=Join-Path $root '.env'
if(-not (Test-Path $env_file)){throw 'Run npm run setup first (.env missing).'}
if($Provider -eq 'groq' -and -not (Test-Path (Join-Path $root '.runtime\secrets\groq-api-key'))){throw 'Store the Groq key first: npm run ai:set-groq-key'}
$lines=@(Get-Content $env_file | Where-Object {$_ -notmatch '^LLM_PROVIDER='})
$lines+="LLM_PROVIDER=$Provider"
Set-Content -Path $env_file -Value $lines -Encoding utf8
Write-Host "Local AI provider set to $Provider. Restart NimbusVault (Stop then Start) to apply."
