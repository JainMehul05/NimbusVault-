function Resolve-LocalAI([string]$ProjectRoot) {
  $ai=Get-Content (Join-Path $ProjectRoot '.runtime/local-ai.json') | ConvertFrom-Json
  $prefix=[IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
  foreach($key in 'binary','models') {
    $path=if([IO.Path]::IsPathRooted($ai.$key)){[IO.Path]::GetFullPath($ai.$key)}else{[IO.Path]::GetFullPath((Join-Path $ProjectRoot $ai.$key))}
    if(-not $path.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw "AI $key must be inside this project"}
    if(-not(Test-Path -LiteralPath $path)){throw "Project-local AI $key is missing"}
    $item=Get-Item -LiteralPath $path
    while($item -and $item.FullName.Length -ge $prefix.TrimEnd('\').Length){
      if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'AI paths cannot use symbolic links or junctions'}
      $item=if($item -is [IO.FileInfo]){$item.Directory}else{$item.Parent}
    }
    $ai.$key=$path
  }
  return $ai
}

function Assert-LocalAIServer([string]$ProjectRoot) {
  $ai=Resolve-LocalAI $ProjectRoot
  $listener=Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue
  foreach($connection in $listener){
    $server=Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)"
    if(-not $server.ExecutablePath -or $server.ExecutablePath -ne $ai.binary){throw 'Port 11434 must use this project runtime; stop the external service explicitly'}
    $state=Join-Path $ProjectRoot '.runtime/processes.json'
    if(-not(Test-Path $state)){throw 'The existing Ollama server is not recorded as project-owned'}
    $owned=@()
    foreach($entry in (Get-Content $state | ConvertFrom-Json)){
      if($entry.name -eq 'ollama' -and $entry.pid -eq $server.ProcessId){$owned+=$entry}
    }
    $running=Get-Process -Id $server.ProcessId
    if($owned.Count -ne 1 -or $running.StartTime.ToUniversalTime().Ticks -ne ([datetime]$owned[0].started).ToUniversalTime().Ticks){throw 'Ollama ownership identity is not verified'}
  }
}
