# Isolate the orchestration function: never stop a real Docker engine for this test.
$ErrorActionPreference='Stop'
$errors=$null;$tokens=$null
$root=Split-Path $PSScriptRoot -Parent
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'scripts/launcher.ps1'),[ref]$tokens,[ref]$errors)
if($errors){throw 'Launcher syntax invalid'}
$ensure=$ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Ensure-Docker'},$true)[0]
. ([scriptblock]::Create($ensure.Extent.Text))
$script:probes=0;$script:starts=0
function Docker-Ready {$script:probes++;return $script:probes -ge 3}
function Test-Path {param($LiteralPath) return $LiteralPath -like '*Docker Desktop.exe'}
function Start-Process {
  param($FilePath,$WindowStyle)
  if($FilePath -notlike '*Docker Desktop.exe' -or $WindowStyle -ne 'Hidden'){throw 'Unsafe Docker start arguments'}
  $script:starts++
}
function Start-Sleep {param($Seconds)}
Ensure-Docker
if($script:starts -ne 1 -or $script:probes -ne 3){throw 'Docker readiness retry test failed'}
Write-Host 'PASS: Docker Desktop starts once, hidden; readiness is retried.'
function Docker-Ready {return $false}
$script:clock=0
function Get-Date {$script:clock++;return ([datetime]'2026-11-27T00:00:00').AddSeconds(200*($script:clock-1))}
try {Ensure-Docker;throw 'Timeout was not enforced'} catch {
  if($_.Exception.Message -notlike 'Docker did not become ready*'){throw}
}
Write-Host 'PASS: Docker timeout fails clearly. These tests do not touch real Docker projects.'
