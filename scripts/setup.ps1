param([string]$EmbeddingCache,[string]$OllamaBinary,[string]$OllamaModels)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
function Checked($label) {if($LASTEXITCODE -ne 0){throw "$label failed ($LASTEXITCODE)"}}
if(-not(Test-Path 'intelligence/.venv/Scripts/python.exe')){
  & uv venv intelligence/.venv --python 3.13
  Checked 'Python environment'
}
$options=@()
if($EmbeddingCache){$options+=@('--embedding-cache',$EmbeddingCache)}
if($OllamaBinary){$options+=@('--ollama-binary',$OllamaBinary)}
if($OllamaModels){$options+=@('--ollama-models',$OllamaModels)}
& intelligence/.venv/Scripts/python.exe scripts/configure-local.py @options
Checked 'Configuration'
icacls '.env' /inheritance:r /grant:r "$($env:USERNAME):F" | Out-Null
& npm ci --no-audit --no-fund
Checked 'Node dependencies'
& uv pip sync --python intelligence/.venv/Scripts/python.exe intelligence/requirements.lock --torch-backend cpu
Checked 'Python dependencies'
& docker compose --env-file .env -f compose.local.yml up -d --wait
Checked 'PostgreSQL'
& npm run prisma:generate --workspace=backend
Checked 'Prisma generation'
& npm run prisma:deploy --workspace=backend
Checked 'Migrations'
& npm run build
Checked 'Build'
Write-Host 'Setup complete. Start with ./scripts/start.ps1'
