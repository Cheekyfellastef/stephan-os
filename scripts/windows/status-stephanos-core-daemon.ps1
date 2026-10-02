[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..\..'))
$coreScript = Join-Path $repoRoot 'scripts\stephanos-core-daemon.mjs'
$statusPath = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace\status\stephanos-core-daemon-current.json'
$corePattern = [regex]::Escape($coreScript)

$processes = @(
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -eq 'node.exe' -and
            [string]$_.CommandLine -match $corePattern
        }
)

$status = $null
if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
    try { $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json } catch {}
}
$heartbeatAgeSeconds = $null
if ($null -ne $status -and $status.PSObject.Properties['heartbeatAtUtc']) {
    try {
        $heartbeat = [DateTimeOffset]::Parse([string]$status.heartbeatAtUtc)
        $heartbeatAgeSeconds = [math]::Max(0, [int]([DateTimeOffset]::UtcNow - $heartbeat).TotalSeconds)
    } catch {}
}
$healthy = [bool](
    $processes.Count -ge 1 -and
    $null -ne $status -and
    $status.daemonHealthy -eq $true -and
    $null -ne $heartbeatAgeSeconds -and
    $heartbeatAgeSeconds -le 60
)

[pscustomobject]@{
    schemaVersion = 'stephanos.core-daemon-status.v1'
    ok = $healthy
    processCount = [int]$processes.Count
    daemonHealthy = if ($null -ne $status) { [bool]$status.daemonHealthy } else { $false }
    readiness = if ($null -ne $status) { [string]$status.readiness } else { 'UNKNOWN' }
    sourceHead = if ($null -ne $status) { [string]$status.sourceHead } else { '' }
    heartbeatAgeSeconds = $heartbeatAgeSeconds
    sovereignCommanderHealthy = if ($null -ne $status) { [bool]$status.sovereignCommanderHealthy } else { $false }
    backendHealthy = if ($null -ne $status) { [bool]$status.backendHealthy } else { $false }
    missionWorkerHealthy = if ($null -ne $status) { [bool]$status.missionWorkerHealthy } else { $false }
    gamingActive = if ($null -ne $status) { [bool]$status.gamingActive } else { $false }
    uiRequired = $false
    sourceMutationAllowed = $false
    schedulerAuthority = $false
    mergeAuthority = $false
    vendorMeterRequired = $false
    remoteCommanderRequired = $false
    finalVerdict = if ($healthy) { 'STEPHANOS_CORE_DAEMON_STATUS_PASS' } else { 'STEPHANOS_CORE_DAEMON_STATUS_NOT_READY' }
} | ConvertTo-Json -Depth 4
