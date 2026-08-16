[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$lifeboatRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$statePath = Join-Path $lifeboatRoot 'state\active-bank.json'
if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { throw 'Active lifeboat bank state is missing.' }

$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if ([string]$state.schemaVersion -ne 'stephanos.battle-bridge-lifeboat-active-bank.v1') { throw 'Active lifeboat bank schema is invalid.' }
$bankId = [string]$state.activeBank
if ($bankId -notin @('A', 'B')) { throw 'Active lifeboat bank identity is invalid.' }
if ([string]$state.selfTestVerdict -ne 'PASS') { throw 'Active lifeboat bank is not self-test proven.' }
if ([string]$state.manifestSha256 -notmatch '^[a-f0-9]{64}$') { throw 'Active lifeboat bank manifest identity is invalid.' }

$bankRoot = Join-Path $lifeboatRoot "banks\$bankId"
$runnerPath = Join-Path $bankRoot 'run-battle-bridge-recovery-lifeboat-bank-v1.ps1'
$manifestPath = Join-Path $bankRoot 'manifest.sha256'
if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) { throw 'Active lifeboat bank runner is missing.' }
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Active lifeboat bank manifest is missing.' }
$manifest = (Get-Content -LiteralPath $manifestPath -Raw).Trim().ToLowerInvariant()
if ($manifest -ne [string]$state.manifestSha256) { throw 'Active lifeboat bank manifest does not match active-bank metadata.' }

& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $runnerPath
exit $LASTEXITCODE
