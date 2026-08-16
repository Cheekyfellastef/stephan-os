[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$bankRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$bankId = Split-Path -Leaf $bankRoot
if ($bankId -notin @('A', 'B')) { throw 'Lifeboat bank runner must execute from fixed bank A or B.' }
$lifeboatRoot = [System.IO.Path]::GetFullPath((Join-Path $bankRoot '..\..'))
$actionPath = Join-Path $bankRoot 'actions\battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1'
$statusRoot = Join-Path $lifeboatRoot 'status'
$heartbeatPath = Join-Path $statusRoot "bank-$bankId-heartbeat.json"

if (-not (Test-Path -LiteralPath $actionPath -PathType Leaf)) { throw 'Fixed Battle Bridge action adapter is missing from the active lifeboat bank.' }
[System.IO.Directory]::CreateDirectory($statusRoot) | Out-Null

$startedAt = [DateTime]::UtcNow
$probeOutput = @(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $actionPath -Action PROBE_BATTLE_BRIDGE 2>&1)
$probeExitCode = $LASTEXITCODE
$probeText = $probeOutput -join [Environment]::NewLine
$probe = $null
try { $probe = $probeText | ConvertFrom-Json } catch { }

$ok = $probeExitCode -eq 0 -and $null -ne $probe -and [bool]$probe.ok
$heartbeat = [ordered]@{
    schemaVersion = 'stephanos.battle-bridge-recovery-lifeboat-heartbeat.v1'
    bankId = $bankId
    lifeboatRoot = $lifeboatRoot
    repoCheckoutRequired = $false
    openClawGatewayRequired = $false
    startedAtUtc = $startedAt.ToString('o')
    completedAtUtc = [DateTime]::UtcNow.ToString('o')
    probeVerdict = if ($null -ne $probe) { [string]$probe.finalVerdict } else { 'PROBE_RESPONSE_INVALID' }
    healthy = [bool]$ok
    arbitraryShellAllowed = $false
    gitMutationAllowed = $false
    sourceMutationAllowed = $false
    pcRestartAllowed = $false
}

$temp = "$heartbeatPath.tmp-$PID-$([Guid]::NewGuid().ToString('N'))"
$heartbeat | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $temp -Encoding UTF8
Move-Item -LiteralPath $temp -Destination $heartbeatPath -Force
$heartbeat | ConvertTo-Json -Depth 6
if (-not $ok) { exit 1 }
