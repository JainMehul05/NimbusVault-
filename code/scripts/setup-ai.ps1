$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$runtime=Join-Path $root '.runtime'
New-Item -ItemType Directory -Force $runtime | Out-Null
$configuration=Join-Path $runtime 'local-ai.json'
if(Test-Path $configuration){$ai=Get-Content $configuration | ConvertFrom-Json}else{
  $binary=Join-Path $runtime 'standalone-ai/ollama/ollama.exe'
  if(-not(Test-Path $binary)){
    $drive=[System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($root))
    if($drive.AvailableFreeSpace -lt 8GB){throw 'At least 8 GiB free is required before installing the free runtime and model.'}
    $archive=Join-Path $runtime 'ollama-windows-amd64.zip'
    & curl.exe -L --fail --retry 2 --continue-at - 'https://github.com/ollama/ollama/releases/download/v0.40.18/ollama-windows-amd64.zip' --output $archive
    if($LASTEXITCODE -ne 0){throw 'Official portable Ollama download failed.'}
    if((Get-FileHash $archive -Algorithm SHA256).Hash.ToLower() -ne 'ca97292ac1e9acc77fcf473bb2741fa6acd12e3798f261b419680068b7cc4c16'){throw 'Official runtime checksum mismatch.'}
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $runtime 'standalone-ai/ollama') -Force
  }
  $modelPath=Join-Path $runtime 'standalone-ai/models'
  New-Item -ItemType Directory -Force $modelPath | Out-Null
  $ai=@{binary=$binary;models=$modelPath}
  $ai | ConvertTo-Json | Set-Content $configuration
}
. "$PSScriptRoot/local-ai-paths.ps1"
$ai=Resolve-LocalAI $root
& "$PSScriptRoot/start-ai.ps1"
$models=Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5
if(-not($models.models | Where-Object name -eq 'qwen2.5:3b')){
  Write-Host 'Installing the missing free Qwen2.5 3B model once (approximately 1.9 GB).'
  $env:OLLAMA_HOST='127.0.0.1:11434'
  $env:OLLAMA_MODELS=$ai.models
  & $ai.binary pull qwen2.5:3b
  if($LASTEXITCODE -ne 0){throw 'Model pull failed. Existing storage/search data was preserved.'}
}else{Write-Host 'Existing Qwen model reused; no model download.'}
$model=Invoke-RestMethod 'http://127.0.0.1:11434/api/show' -Method Post -ContentType 'application/json' -Body '{"model":"qwen2.5:3b"}' -TimeoutSec 10
if($model.details.quantization_level -ne 'Q4_K_M'){throw 'Installed model quantization differs from the approved Q4_K_M model.'}
$model.license | Set-Content (Join-Path $runtime 'qwen-model-license.txt')
Write-Host 'Local Qwen2.5 3B Q4_K_M verified. No hosted AI provider or paid API.'
