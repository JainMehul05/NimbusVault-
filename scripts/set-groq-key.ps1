# Store the Groq Cloud API key for NimbusVault without echoing it, putting it in shell history,
# command arguments, Git or chat. Writes .runtime/secrets/groq-api-key (Git-ignored) and restricts
# the file to the current Windows user. Re-run at any time to rotate the key.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dir = Join-Path $root '.runtime\secrets'
$file = Join-Path $dir 'groq-api-key'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Write-Host 'Paste your Groq API key (input is hidden), then press Enter.'
$secure = Read-Host -AsSecureString 'Groq API key'
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim() }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
if ($key -notmatch '^gsk_[A-Za-z0-9]{20,}$') { throw 'That does not look like a Groq API key (expected gsk_...). Nothing was saved.' }
[IO.File]::WriteAllText($file, $key, (New-Object Text.UTF8Encoding($false)))
$key = $null
# Owner-only access: remove inherited permissions, grant the current user read/write.
& icacls $file /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
Write-Host "Saved to $file (owner-only). The key was not displayed or logged."
