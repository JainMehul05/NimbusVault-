$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$line=Get-Content '.env' | Where-Object {$_ -match '^DATABASE_URL='}
$connection=($line -split '=',2)[1]
if($connection -notmatch '@127\.0\.0\.1:55432/nimbusvault\?'){throw 'Expected the isolated final PostgreSQL connection; refusing to guess a test target'}
$env:DATABASE_URL=$connection.Replace('/nimbusvault?','/nimbusvault_test?')
$env:INTELLIGENCE_ENABLED='false'
$env:S3_ENDPOINT='http://127.0.0.1:4567'
$env:AWS_ACCESS_KEY_ID='test'
$env:AWS_SECRET_ACCESS_KEY='test'
$env:AWS_S3_BUCKET='nimbusvault'
$env:LOG_LEVEL='error'
$image=& docker inspect --format '{{.Config.Image}}' nimbusvault-final-test-s3
if($LASTEXITCODE -ne 0 -or $image -notmatch '^localstack/localstack:'){throw 'Expected the isolated LocalStack test container; no cloud operation will be attempted'}
& docker start nimbusvault-final-test-s3 | Out-Null
for($attempt=0;$attempt -lt 30;$attempt++){
  try{$null=Invoke-WebRequest 'http://127.0.0.1:4567/_localstack/health' -UseBasicParsing -TimeoutSec 2;break}catch{Start-Sleep -Milliseconds 500}
}
# LocalStack can lose its disposable bucket across a restart. This is localhost,
# never the actual AWS bucket. No fixture assertions are skipped.
$null=Invoke-WebRequest 'http://127.0.0.1:4567/nimbusvault' -Method Put -UseBasicParsing -TimeoutSec 5
$exists=& docker exec nimbusvault-final-db psql -U nimbusvault -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='nimbusvault_test'"
if($LASTEXITCODE -ne 0){throw 'Test database check failed'}
if(-not $exists){& docker exec nimbusvault-final-db createdb -U nimbusvault nimbusvault_test;if($LASTEXITCODE -ne 0){throw 'Isolated test database creation failed'}}
& npm run prisma:deploy --workspace=backend
if($LASTEXITCODE -ne 0){throw 'Test migrations failed'}
& npm run test:backend
if($LASTEXITCODE -ne 0){throw 'Backend tests failed; inspect the actual test output'}
