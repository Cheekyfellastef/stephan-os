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
$localStateRoot = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE 'AppData\Local' }
$coreLockPath = Join-Path $localStateRoot 'Stephanos\stephanos-core-daemon.lock.json'
$gitExe = 'C:\Program Files\Git\cmd\git.exe'
$coreHeartbeatFreshSeconds = 60
$coreBusyGraceSeconds = 300
. (Join-Path $scriptDir 'stephanos-core-process-observation.ps1')
$processObservation = Get-StephanosCoreProcessObservation -CoreScript $coreScript
$processes = @($processObservation.processes)

$status = $null
if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
    try { $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json } catch {}
}
# A matching process is not proof that it owns the canonical Core lock or
# produced the latest heartbeat. Do not expose process IDs in public status.
$writerPid = 0
if ($null -ne $status -and $status.PSObject.Properties['processId']) {
    [void][int]::TryParse([string]$status.processId, [ref]$writerPid)
}
$lockOwnerPid = 0
$lockRecord = $null
if (Test-Path -LiteralPath $coreLockPath -PathType Leaf) {
    try {
        $lockRecord = Get-Content -LiteralPath $coreLockPath -Raw | ConvertFrom-Json
        [void][int]::TryParse([string]$lockRecord.pid, [ref]$lockOwnerPid)
    } catch {}
}
$writerProcessObserved = [bool](
    $writerPid -gt 0 -and
    @($processes | Where-Object { [int]$_.ProcessId -eq $writerPid }).Count -eq 1
)
# The lock has four identity fields. PID equality by itself is not
# ownership proof: Windows can reuse a PID after the original process exits.
$lockOwnerMatchesWriter = $false
if ($null -ne $lockRecord -and $writerPid -gt 0 -and $lockOwnerPid -eq $writerPid -and
    [string]$lockRecord.schemaVersion -ceq 'stephanos.core-daemon-lock.v1' -and
    [string]$lockRecord.sourceHead -cmatch '^[0-9a-f]{40}$' -and
    [string]::Equals([string]$lockRecord.sourceHead, [string]$status.sourceHead, [System.StringComparison]::OrdinalIgnoreCase)) {
    try {
        $matchingWriter = @($processes | Where-Object { [int]$_.ProcessId -eq $writerPid })
        if ($matchingWriter.Count -eq 1 -and $null -ne $matchingWriter[0].CreationDate) {
            $lockStart = [DateTimeOffset]::Parse([string]$lockRecord.startedAtUtc)
            $writerCreated = [DateTimeOffset]::new([datetime]$matchingWriter[0].CreationDate)
            $heartbeatAt = [DateTimeOffset]::Parse([string]$status.heartbeatAtUtc)
            $startupLagSeconds = ($lockStart.ToUniversalTime() - $writerCreated.ToUniversalTime()).TotalSeconds
            $lockOwnerMatchesWriter = [bool](
                $lockStart.Offset -eq [TimeSpan]::Zero -and
                $startupLagSeconds -ge -3 -and $startupLagSeconds -le 90 -and
                $lockStart -le $heartbeatAt
            )
        }
    } catch {
        $lockOwnerMatchesWriter = $false
    }
}
$singleWriterProven = [bool](
    $processObservation.complete -and
    $processes.Count -eq 1 -and $writerProcessObserved -and $lockOwnerMatchesWriter
)
# A current source SHA alone cannot prove that a running Node process
# loaded the newly merged rescue module. Require its heartbeat fields.
$rescueGenerationPresent = $false
$rescueAttemptCount = $null
if ($null -ne $status -and
    $null -ne $status.PSObject.Properties['outerBridgeRunCount'] -and
    $null -ne $status.PSObject.Properties['outerBridgeLastStage']) {
    $parsedCount = 0
    $stage = [string]$status.outerBridgeLastStage
    # Count zero and NOT_OBSERVED are valid before first tick; malformed
    # fields are never proof that this process loaded the rescue module.
    if ([int]::TryParse([string]$status.outerBridgeRunCount, [ref]$parsedCount) -and
        $parsedCount -ge 0 -and
        $stage -cmatch '^[A-Z][A-Z0-9_]{0,79}$') {
        $rescueAttemptCount = $parsedCount
        $rescueGenerationPresent = $true
    }
}
$heartbeatAgeSeconds = $null
$heartbeatFresh = $false
$sourceHead = if ($null -ne $status) { [string]$status.sourceHead } else { '' }
$liveHead = ''
$sourceHeadMatchesLive = $false
if (Test-Path -LiteralPath $gitExe -PathType Leaf) {
    try {
        $liveHead = [string]((& $gitExe -C $repoRoot rev-parse HEAD 2>$null | Select-Object -First 1))
        $liveHead = $liveHead.Trim()
    } catch {}
}
$sourceHeadMatchesLive = [bool](
    $liveHead -match '^[0-9a-fA-F]{40}$' -and
    $sourceHead -match '^[0-9a-fA-F]{40}$' -and
    [string]::Equals($sourceHead, $liveHead, [System.StringComparison]::OrdinalIgnoreCase)
)
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
        $sourceHeadMatchesLive -and
        $flywheelCycleRunning -and
        $null -ne $heartbeatAgeSeconds -and
        $null -ne $flywheelCycleAgeSeconds -and
        $heartbeatAgeSeconds -le $coreBusyGraceSeconds -and
        $flywheelCycleAgeSeconds -le $coreBusyGraceSeconds
    )
}
$healthy = [bool](
    $singleWriterProven -and
    $rescueGenerationPresent -and
    $null -ne $status -and
    $status.daemonHealthy -eq $true -and
    [string]$status.readiness -ne 'RELOAD_REQUIRED' -and
    $sourceHeadMatchesLive -and
    ($heartbeatFresh -or $busyGraceActive)
)

[pscustomobject]@{
    schemaVersion = 'stephanos.core-daemon-status.v1'
    ok = $healthy
    processCount = $processObservation.processCount
    processInventoryComplete = [bool]$processObservation.complete
    processObservationBlocker = [string]$processObservation.blocker
    daemonHealthy = $healthy
    reportedDaemonHealthy = if ($null -ne $status) { [bool]$status.daemonHealthy } else { $false }
    singleWriterProven = $singleWriterProven
    writerProcessObserved = $writerProcessObserved
    lockOwnerMatchesWriter = $lockOwnerMatchesWriter
    rescueGenerationPresent = $rescueGenerationPresent
    rescueAttemptCount = $rescueAttemptCount
    readiness = if ($null -ne $status) { [string]$status.readiness } else { 'UNKNOWN' }
    wakeState = if ($null -ne $status -and $status.PSObject.Properties['wakeState']) { [string]$status.wakeState } else { 'UNKNOWN' }
    awake = if ($null -ne $status -and $status.PSObject.Properties['awake']) { [bool]$status.awake } else { $false }
    repairRequired = if ($null -ne $status -and $status.PSObject.Properties['repairRequired']) { [bool]$status.repairRequired } else { $true }
    repairReason = if ($null -ne $status -and $status.PSObject.Properties['repairReason']) { [string]$status.repairReason } else { 'CONTROL_PLANE_STATUS_UNAVAILABLE' }
    controlPlaneFinalVerdict = if ($null -ne $status -and $status.PSObject.Properties['controlPlaneFinalVerdict']) { [string]$status.controlPlaneFinalVerdict } else { 'STEPHANOS_CONTROL_PLANE_UNKNOWN' }
    sourceHead = $sourceHead
    sourceHeadMatchesLive = [bool]$sourceHeadMatchesLive
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
    finalVerdict = if ($healthy) {
        'STEPHANOS_CORE_DAEMON_STATUS_PASS'
    } elseif (-not $processObservation.complete) {
        'STEPHANOS_CORE_DAEMON_PROCESS_INVENTORY_UNPROVEN'
    } elseif (-not $singleWriterProven) {
        'STEPHANOS_CORE_DAEMON_OWNER_CUSTODY_UNPROVEN'
    } elseif (-not $rescueGenerationPresent) {
        'STEPHANOS_CORE_DAEMON_RESCUE_GENERATION_UNPROVEN'
    } else {
        'STEPHANOS_CORE_DAEMON_STATUS_NOT_READY'
    }
} | ConvertTo-Json -Depth 4
