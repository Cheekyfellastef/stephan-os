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
$coreHeartbeatFreshSeconds = 60
$coreBusyGraceSeconds = 300

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
$heartbeatFresh = $false
$flywheelCycleAgeSeconds = $null
$busyGraceActive = $false
if ($null -ne $status -and $status.PSObject.Properties['heartbeatAtUtc']) {
    try {
        $heartbeat = [DateTimeOffset]::Parse([string]$status.heartbeatAtUtc)
        $heartbeatAgeSeconds = [math]::Max(0, [int]([DateTimeOffset]::UtcNow - $heartbeat).TotalSeconds)
        $heartbeatFresh = [bool]($heartbeatAgeSeconds -le $coreHeartbeatFreshSeconds)
    } catch {}
}
if ($null -ne $status) {
    $flywheelCycleRunningProperty = $status.PSObject.Properties['flywheelCycleRunning']
    $flywheelCycleStartedProperty = $status.PSObject.Properties['flywheelLastCycleStartedAtUtc']
    $flywheelCycleRunning = [bool]($null -ne $flywheelCycleRunningProperty -and $flywheelCycleRunningProperty.Value -eq $true)
    if ($flywheelCycleRunning -and $null -ne $flywheelCycleStartedProperty -and $flywheelCycleStartedProperty.Value) {
        try {
            $flywheelCycleStarted = [DateTimeOffset]::Parse([string]$flywheelCycleStartedProperty.Value)
            $flywheelCycleAgeSeconds = [math]::Max(0, [int]([DateTimeOffset]::UtcNow - $flywheelCycleStarted).TotalSeconds)
        } catch {}
    }
    $busyGraceActive = [bool](
        $status.daemonHealthy -eq $true -and
        [string]$status.readiness -ne 'RELOAD_REQUIRED' -and
        $flywheelCycleRunning -and
        $null -ne $heartbeatAgeSeconds -and
        $null -ne $flywheelCycleAgeSeconds -and
        $heartbeatAgeSeconds -le $coreBusyGraceSeconds -and
        $flywheelCycleAgeSeconds -le $coreBusyGraceSeconds
    )
}
$healthy = [bool](
    $processes.Count -ge 1 -and
    $null -ne $status -and
    $status.daemonHealthy -eq $true -and
    [string]$status.readiness -ne 'RELOAD_REQUIRED' -and
    ($heartbeatFresh -or $busyGraceActive)
)

[pscustomobject]@{
    schemaVersion = 'stephanos.core-daemon-status.v1'
    ok = $healthy
    processCount = [int]$processes.Count
    daemonHealthy = if ($null -ne $status) { [bool]$status.daemonHealthy } else { $false }
    readiness = if ($null -ne $status) { [string]$status.readiness } else { 'UNKNOWN' }
    wakeState = if ($null -ne $status -and $status.PSObject.Properties['wakeState']) { [string]$status.wakeState } else { 'UNKNOWN' }
    awake = if ($null -ne $status -and $status.PSObject.Properties['awake']) { [bool]$status.awake } else { $false }
    repairRequired = if ($null -ne $status -and $status.PSObject.Properties['repairRequired']) { [bool]$status.repairRequired } else { $true }
    repairReason = if ($null -ne $status -and $status.PSObject.Properties['repairReason']) { [string]$status.repairReason } else { 'CONTROL_PLANE_STATUS_UNAVAILABLE' }
    controlPlaneFinalVerdict = if ($null -ne $status -and $status.PSObject.Properties['controlPlaneFinalVerdict']) { [string]$status.controlPlaneFinalVerdict } else { 'STEPHANOS_CONTROL_PLANE_UNKNOWN' }
    sourceHead = if ($null -ne $status) { [string]$status.sourceHead } else { '' }
    heartbeatAgeSeconds = $heartbeatAgeSeconds
    heartbeatFresh = [bool]$heartbeatFresh
    busyGraceActive = [bool]$busyGraceActive
    flywheelCycleAgeSeconds = $flywheelCycleAgeSeconds
    heartbeatFreshSeconds = [int]$coreHeartbeatFreshSeconds
    busyGraceSeconds = [int]$coreBusyGraceSeconds
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
