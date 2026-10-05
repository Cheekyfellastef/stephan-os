[CmdletBinding()]
param(
    [string]$RequireCapabilityVersion = '2026-10-04-self-repair-hardening-v2',
    [switch]$SkipCoreDaemonLifecycle
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..\..'))
$expectedRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
if (-not [string]::Equals($repoRoot, $expectedRepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Sovereign Commander runner must use canonical checkout: $expectedRepoRoot"
}

$serverScript = Join-Path $repoRoot 'scripts\sovereign-commander-http.mjs'
$fleetSupervisorScript = Join-Path $repoRoot 'scripts\sovereign-commander-fleet-goal-supervisor.mjs'
$fleetSupervisorMarker = 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_RESULT='
$tokenPath = Join-Path $env:USERPROFILE 'Documents\OpenClaw-Standalone\mission-runner\keys\sovereign-commander-token.txt'
$canonicalNode = 'C:\Program Files\nodejs\node.exe'
$gitExe = 'C:\Program Files\Git\cmd\git.exe'
$powershellExecutable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$vrGovernorScript = Join-Path $repoRoot 'scripts\windows\run-vr-resource-governor.ps1'
$coreDaemonScript = Join-Path $repoRoot 'scripts\stephanos-core-daemon.mjs'
$coreDaemonStatusPath = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace\status\stephanos-core-daemon-current.json'
$relayDaemonScript = Join-Path $repoRoot 'scripts\battle-bridge-sovereign-relay-daemon.mjs'
$relayDaemonStatusPath = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace\status\sovereign-relay-current.json'
$port = 18791
$serverScriptPattern = [regex]::Escape($serverScript)
$vrGovernorScriptPattern = [regex]::Escape($vrGovernorScript)
$coreDaemonScriptPattern = [regex]::Escape($coreDaemonScript)
$relayDaemonScriptPattern = [regex]::Escape($relayDaemonScript)
$coreHeartbeatFreshSeconds = 60
$coreBusyGraceSeconds = 300

function Get-StephanosCoreDaemonProcesses {
    return @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -eq 'node.exe' -and
                [string]$_.CommandLine -match $coreDaemonScriptPattern
            }
    )
}

function Get-StephanosCoreDaemonHealth {
    if (-not (Test-Path -LiteralPath $coreDaemonStatusPath -PathType Leaf)) {
        return [pscustomobject]@{
            healthy = $false
            heartbeatFresh = $false
            busyGraceActive = $false
            heartbeatAgeSeconds = $null
            flywheelCycleAgeSeconds = $null
            readiness = 'UNKNOWN'
            sourceHead = ''
        }
    }
    try {
        $status = Get-Content -LiteralPath $coreDaemonStatusPath -Raw | ConvertFrom-Json
        $heartbeat = [DateTimeOffset]::Parse([string]$status.heartbeatAtUtc)
        $age = [math]::Max(0, [int]([DateTimeOffset]::UtcNow - $heartbeat).TotalSeconds)
        $readiness = [string]$status.readiness
        $heartbeatFresh = [bool]($age -le $coreHeartbeatFreshSeconds)
        $sourceHead = [string]$status.sourceHead
        $liveHead = ''
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
        $flywheelCycleRunningProperty = $status.PSObject.Properties['flywheelCycleRunning']
        $flywheelCycleStartedProperty = $status.PSObject.Properties['flywheelLastCycleStartedAtUtc']
        $flywheelCycleRunning = [bool]($null -ne $flywheelCycleRunningProperty -and $flywheelCycleRunningProperty.Value -eq $true)
        $flywheelCycleAgeSeconds = $null
        if ($flywheelCycleRunning -and $null -ne $flywheelCycleStartedProperty -and $flywheelCycleStartedProperty.Value) {
            try {
                $flywheelCycleStarted = [DateTimeOffset]::Parse([string]$flywheelCycleStartedProperty.Value)
                $flywheelCycleAgeSeconds = [math]::Max(0, [int]([DateTimeOffset]::UtcNow - $flywheelCycleStarted).TotalSeconds)
            } catch {}
        }
        $busyGraceActive = [bool](
            $status.daemonHealthy -eq $true -and
            $readiness -ne 'RELOAD_REQUIRED' -and
            $sourceHeadMatchesLive -and
            $flywheelCycleRunning -and
            $null -ne $flywheelCycleAgeSeconds -and
            $flywheelCycleAgeSeconds -le $coreBusyGraceSeconds -and
            $age -le $coreBusyGraceSeconds
        )
        return [pscustomobject]@{
            healthy = [bool](
                $status.daemonHealthy -eq $true -and
                $readiness -ne 'RELOAD_REQUIRED' -and
                $sourceHeadMatchesLive -and
                ($heartbeatFresh -or $busyGraceActive)
            )
            heartbeatFresh = $heartbeatFresh
            busyGraceActive = $busyGraceActive
            heartbeatAgeSeconds = $age
            flywheelCycleAgeSeconds = $flywheelCycleAgeSeconds
            readiness = $readiness
            sourceHead = $sourceHead
        }
    } catch {
        return [pscustomobject]@{
            healthy = $false
            heartbeatFresh = $false
            busyGraceActive = $false
            heartbeatAgeSeconds = $null
            flywheelCycleAgeSeconds = $null
            readiness = 'UNKNOWN'
            sourceHead = ''
        }
    }
}

function Get-SovereignRelayDaemonProcesses {
    return @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -eq 'node.exe' -and
                [string]$_.CommandLine -match $relayDaemonScriptPattern
            }
    )
}

function Get-SovereignRelayDaemonHealth {
    if (-not (Test-Path -LiteralPath $relayDaemonStatusPath -PathType Leaf)) {
        return [pscustomobject]@{ healthy = $false; heartbeatAgeSeconds = $null; finalVerdict = 'UNKNOWN'; blocker = 'SOVEREIGN_RELAY_STATUS_MISSING' }
    }
    try {
        $status = Get-Content -LiteralPath $relayDaemonStatusPath -Raw | ConvertFrom-Json
        $heartbeat = [DateTimeOffset]::Parse([string]$status.heartbeatAtUtc)
        $age = [math]::Max(0, [int]([DateTimeOffset]::UtcNow - $heartbeat).TotalSeconds)
        return [pscustomobject]@{
            healthy = [bool]($status.daemonHealthy -eq $true -and $age -le 30)
            heartbeatAgeSeconds = $age
            finalVerdict = [string]$status.finalVerdict
            blocker = [string]$status.blocker
        }
    } catch {
        return [pscustomobject]@{ healthy = $false; heartbeatAgeSeconds = $null; finalVerdict = 'UNKNOWN'; blocker = 'SOVEREIGN_RELAY_STATUS_INVALID' }
    }
}

function Get-SovereignCommanderProcesses {
    return @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -eq 'node.exe' -and
                [string]$_.CommandLine -match $serverScriptPattern
            }
    )
}

function Get-VrResourceGovernorProcesses {
    return @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -eq 'powershell.exe' -and
                [string]$_.CommandLine -match $vrGovernorScriptPattern -and
                [string]$_.CommandLine -match '(?i)-Action\s+Watch'
            }
    )
}

function Get-SovereignCommanderHealth {
    try {
        $health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$port/health" -TimeoutSec 3
        $basicHealthy = ($health.ok -eq $true -and [string]$health.service -eq 'stephanos-sovereign-commander')
        $capabilityProperty = $health.PSObject.Properties['capabilityVersion']
        $capabilityVersion = if ($null -ne $capabilityProperty) { [string]$capabilityProperty.Value } else { '' }
        $capabilitySatisfied = (-not $RequireCapabilityVersion) -or ($capabilityVersion -eq $RequireCapabilityVersion)
        return [pscustomobject]@{
            healthy = [bool]($basicHealthy -and $capabilitySatisfied)
            basicHealthy = [bool]$basicHealthy
            capabilitySatisfied = [bool]$capabilitySatisfied
            capabilityVersion = $capabilityVersion
        }
    } catch {
        return [pscustomobject]@{
            healthy = $false
            basicHealthy = $false
            capabilitySatisfied = (-not $RequireCapabilityVersion)
            capabilityVersion = ''
        }
    }
}

function Wait-SovereignCommanderHealth {
    param([int]$Attempts = 20, [int]$DelayMilliseconds = 250)
    $last = Get-SovereignCommanderHealth
    for ($attempt = 1; $attempt -lt $Attempts -and -not [bool]$last.healthy; $attempt++) {
        Start-Sleep -Milliseconds $DelayMilliseconds
        $last = Get-SovereignCommanderHealth
    }
    return $last
}

function Wait-StephanosCoreDaemonHealth {
    param([int]$Attempts = 24, [int]$DelayMilliseconds = 500)
    $last = Get-StephanosCoreDaemonHealth
    for ($attempt = 1; $attempt -lt $Attempts -and -not [bool]$last.healthy; $attempt++) {
        Start-Sleep -Milliseconds $DelayMilliseconds
        $last = Get-StephanosCoreDaemonHealth
    }
    return $last
}

# A maintenance action executed by the authenticated Sovereign MCP blocks the
# parent Node event loop while its fixed child process runs. In that one closed
# path, probing the parent's own /health endpoint would deadlock and falsely
# report SOVEREIGN_COMMANDER_NOT_HEALTHY. These three variables are injected
# only by SovereignCommander's fixed-process route after MCP/session proof.
$authenticatedInBandParentProof = [bool](
    $env:STEPHANOS_SOVEREIGN_COMMANDER_COMMAND_PATH_PROVEN -eq '1' -and
    $env:STEPHANOS_SOVEREIGN_COMMANDER_AUTHENTICATED_MCP -eq '1' -and
    $env:STEPHANOS_SOVEREIGN_COMMANDER_MCP_SESSION_READY -eq '1'
)


$blocker = ''
$startRequested = $false
$startedPid = 0
$before = @(Get-SovereignCommanderProcesses)
$healthBefore = if ($authenticatedInBandParentProof -and $before.Count -ge 1) {
    [pscustomobject]@{
        healthy = $true
        basicHealthy = $true
        capabilitySatisfied = $true
        capabilityVersion = $RequireCapabilityVersion
    }
} else {
    Get-SovereignCommanderHealth
}
$healthyBefore = [bool]$healthBefore.healthy
$staleCapability = [bool]($healthBefore.basicHealthy -and -not $healthBefore.capabilitySatisfied)
$staleCapabilityRecycleRequested = $false
$stoppedPidCount = 0
$fleetGoalSupervisorRequested = $false
$fleetGoalSupervisorSkipped = $false
$fleetGoalSupervisorOk = $false
$fleetGoalSupervisorExitCode = $null
$fleetGoalSupervisorVerdict = ''
$fleetGoalSupervisorBlocker = ''
$vrGovernorStartRequested = $false
$vrGovernorStartedPid = 0
$vrGovernorProcessCount = 0
$vrGovernorOk = $false
$vrGovernorBlocker = ''
$coreDaemonStartRequested = $false
$coreDaemonRestartRequested = $false
$coreDaemonStartedPid = 0
$coreDaemonStoppedPidCount = 0
$coreDaemonProcessCount = 0
$coreDaemonOk = $false
$coreDaemonBlocker = ''
$coreDaemonHeartbeatAgeSeconds = $null
$coreDaemonHeartbeatFresh = $false
$coreDaemonBusyGraceActive = $false
$coreDaemonFlywheelCycleAgeSeconds = $null
$coreDaemonReadiness = 'UNKNOWN'
$coreDaemonSourceHead = ''
$relayDaemonStartRequested = $false
$relayDaemonRestartRequested = $false
$relayDaemonStartedPid = 0
$relayDaemonStoppedPidCount = 0
$relayDaemonProcessCount = 0
$relayDaemonHealthy = $false
$relayDaemonBlocker = ''
$relayDaemonHeartbeatAgeSeconds = $null
$relayDaemonVerdict = 'UNKNOWN'

if (-not (Test-Path -LiteralPath $serverScript -PathType Leaf)) {
    $blocker = 'SOVEREIGN_COMMANDER_SERVER_SCRIPT_MISSING'
} elseif (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) {
    $blocker = 'SOVEREIGN_COMMANDER_TOKEN_MISSING'
} elseif ($before.Count -eq 0 -or -not $healthyBefore) {
    if (-not (Test-Path -LiteralPath $canonicalNode -PathType Leaf)) {
        $blocker = 'SOVEREIGN_COMMANDER_CANONICAL_NODE_MISSING'
    } else {
        if ($staleCapability -and $before.Count -gt 0) {
            $staleCapabilityRecycleRequested = $true
            try {
                foreach ($process in $before) {
                    Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
                    $stoppedPidCount += 1
                }
                Start-Sleep -Milliseconds 500
            } catch {
                $blocker = 'SOVEREIGN_COMMANDER_STALE_CAPABILITY_RECYCLE_FAILED'
            }
        }
        if (-not $blocker) {
            $startRequested = $true
            try {
                $quotedServerScript = '"' + $serverScript.Replace('"', '\"') + '"'
                $started = Start-Process -FilePath $canonicalNode -ArgumentList @($quotedServerScript) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
                $startedPid = [int]$started.Id
                Start-Sleep -Seconds 2
            } catch {
                $blocker = 'SOVEREIGN_COMMANDER_START_FAILED'
            }
        }
    }
}

$after = @(Get-SovereignCommanderProcesses)
$healthAfter = if ($authenticatedInBandParentProof -and $after.Count -ge 1) {
    [pscustomobject]@{
        healthy = $true
        basicHealthy = $true
        capabilitySatisfied = $true
        capabilityVersion = $RequireCapabilityVersion
    }
} else {
    Wait-SovereignCommanderHealth
}
$healthyAfter = [bool]$healthAfter.healthy
$ok = ($after.Count -ge 1 -and $healthyAfter)
if (-not $ok -and -not $blocker) { $blocker = 'SOVEREIGN_COMMANDER_NOT_HEALTHY' }

# VR protection is intentionally independent of daemon health.
# A sick commander must never leave Air Link exposed to heavyweight Ollama residency.
if (-not (Test-Path -LiteralPath $vrGovernorScript -PathType Leaf)) {
    $vrGovernorBlocker = 'SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_SCRIPT_MISSING'
} elseif (-not (Test-Path -LiteralPath $powershellExecutable -PathType Leaf)) {
    $vrGovernorBlocker = 'SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_POWERSHELL_MISSING'
} else {
    $vrGovernorBefore = @(Get-VrResourceGovernorProcesses)
    if ($vrGovernorBefore.Count -eq 0) {
        $vrGovernorStartRequested = $true
        try {
            $quotedVrGovernorScript = '"' + $vrGovernorScript.Replace('"', '\"') + '"'
            $vrGovernorStarted = Start-Process -FilePath $powershellExecutable -ArgumentList @(
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy', 'Bypass',
                '-File', $quotedVrGovernorScript,
                '-Action', 'Watch'
            ) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
            $vrGovernorStartedPid = [int]$vrGovernorStarted.Id
            Start-Sleep -Milliseconds 500
        } catch {
            $vrGovernorBlocker = 'SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_START_FAILED'
        }
    }
    $vrGovernorAfter = @(Get-VrResourceGovernorProcesses)
    $vrGovernorProcessCount = $vrGovernorAfter.Count
    $vrGovernorOk = $vrGovernorProcessCount -ge 1
    if (-not $vrGovernorOk -and -not $vrGovernorBlocker) {
        $vrGovernorBlocker = 'SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_NOT_RUNNING'
    }
}

# Stephanos Core is persistent intelligence/state coordination, not a second scheduler.
# Sovereign Commander owns only process liveness for this fixed source-controlled child.
# When the Core Daemon itself is bootstrapping Commander, observe Core liveness only:
# never recycle the caller while it is establishing its first fresh heartbeat.
if ($SkipCoreDaemonLifecycle) {
    $coreObserved = @(Get-StephanosCoreDaemonProcesses)
    $coreObservedHealth = Get-StephanosCoreDaemonHealth
    $coreDaemonProcessCount = $coreObserved.Count
    $coreDaemonHeartbeatAgeSeconds = $coreObservedHealth.heartbeatAgeSeconds
    $coreDaemonHeartbeatFresh = [bool]$coreObservedHealth.heartbeatFresh
    $coreDaemonBusyGraceActive = [bool]$coreObservedHealth.busyGraceActive
    $coreDaemonFlywheelCycleAgeSeconds = $coreObservedHealth.flywheelCycleAgeSeconds
    $coreDaemonReadiness = [string]$coreObservedHealth.readiness
    $coreDaemonSourceHead = [string]$coreObservedHealth.sourceHead
    $coreDaemonOk = [bool]($coreObserved.Count -ge 1 -and $coreObservedHealth.healthy)
} elseif (-not (Test-Path -LiteralPath $coreDaemonScript -PathType Leaf)) {
    $coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_SCRIPT_MISSING'
} elseif (-not (Test-Path -LiteralPath $canonicalNode -PathType Leaf)) {
    $coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_NODE_MISSING'
} else {
    $coreBefore = @(Get-StephanosCoreDaemonProcesses)
    $coreHealthBefore = Get-StephanosCoreDaemonHealth
    if ($coreBefore.Count -eq 0 -or -not [bool]$coreHealthBefore.healthy) {
        if ($coreBefore.Count -gt 0) {
            $coreDaemonRestartRequested = $true
            try {
                foreach ($process in $coreBefore) {
                    Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
                    $coreDaemonStoppedPidCount += 1
                }
                Start-Sleep -Milliseconds 300
            } catch {
                $coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_STALE_RECYCLE_FAILED'
            }
        }
        if (-not $coreDaemonBlocker) {
            $coreDaemonStartRequested = $true
            $coreBootstrapMarkerName = 'STEPHANOS_CORE_BOOTSTRAP_SOVEREIGN_PARENT_PROVEN'
            $coreBootstrapMarkerPrevious = [Environment]::GetEnvironmentVariable($coreBootstrapMarkerName, 'Process')
            try {
                if ($authenticatedInBandParentProof) {
                    [Environment]::SetEnvironmentVariable($coreBootstrapMarkerName, '1', 'Process')
                }
                $quotedCoreDaemonScript = '"' + $coreDaemonScript.Replace('"', '\"') + '"'
                $coreStarted = Start-Process -FilePath $canonicalNode -ArgumentList @($quotedCoreDaemonScript) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
                $coreDaemonStartedPid = [int]$coreStarted.Id
                Start-Sleep -Milliseconds 500
            } catch {
                $coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_START_FAILED'
            } finally {
                if ($authenticatedInBandParentProof) {
                    [Environment]::SetEnvironmentVariable($coreBootstrapMarkerName, $coreBootstrapMarkerPrevious, 'Process')
                }
            }
        }
    }
    $coreAfter = @(Get-StephanosCoreDaemonProcesses)
    $coreHealthAfter = if ($coreDaemonStartRequested -or $coreDaemonRestartRequested) {
        Wait-StephanosCoreDaemonHealth
    } else {
        Get-StephanosCoreDaemonHealth
    }
    $coreDaemonProcessCount = $coreAfter.Count
    $coreDaemonHeartbeatAgeSeconds = $coreHealthAfter.heartbeatAgeSeconds
    $coreDaemonHeartbeatFresh = [bool]$coreHealthAfter.heartbeatFresh
    $coreDaemonBusyGraceActive = [bool]$coreHealthAfter.busyGraceActive
    $coreDaemonFlywheelCycleAgeSeconds = $coreHealthAfter.flywheelCycleAgeSeconds
    $coreDaemonReadiness = [string]$coreHealthAfter.readiness
    $coreDaemonSourceHead = [string]$coreHealthAfter.sourceHead
    $coreDaemonOk = [bool]($coreAfter.Count -ge 1 -and $coreHealthAfter.healthy)
    if (-not $coreDaemonOk -and -not $coreDaemonBlocker) {
        $coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_NOT_HEALTHY'
    }
}

# The Sovereign Relay accelerates cloud-chat transport but is not a Commander dependency.
# Scheduled GitHub polling, Tailnet access and optional third-party transports remain fallbacks.
if (-not (Test-Path -LiteralPath $relayDaemonScript -PathType Leaf)) {
    $relayDaemonBlocker = 'SOVEREIGN_RELAY_DAEMON_SCRIPT_MISSING'
} elseif (-not (Test-Path -LiteralPath $canonicalNode -PathType Leaf)) {
    $relayDaemonBlocker = 'SOVEREIGN_RELAY_DAEMON_NODE_MISSING'
} else {
    $relayBefore = @(Get-SovereignRelayDaemonProcesses)
    $relayHealthBefore = Get-SovereignRelayDaemonHealth
    if ($relayBefore.Count -eq 0 -or -not [bool]$relayHealthBefore.healthy) {
        if ($relayBefore.Count -gt 0) {
            $relayDaemonRestartRequested = $true
            try {
                foreach ($process in $relayBefore) {
                    Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
                    $relayDaemonStoppedPidCount += 1
                }
                Start-Sleep -Milliseconds 300
            } catch {
                $relayDaemonBlocker = 'SOVEREIGN_RELAY_DAEMON_STALE_RECYCLE_FAILED'
            }
        }
        if (-not $relayDaemonBlocker) {
            $relayDaemonStartRequested = $true
            try {
                $quotedRelayDaemonScript = '"' + $relayDaemonScript.Replace('"', '\"') + '"'
                $relayStarted = Start-Process -FilePath $canonicalNode -ArgumentList @($quotedRelayDaemonScript) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
                $relayDaemonStartedPid = [int]$relayStarted.Id
                Start-Sleep -Seconds 6
            } catch {
                $relayDaemonBlocker = 'SOVEREIGN_RELAY_DAEMON_START_FAILED'
            }
        }
    }
    $relayAfter = @(Get-SovereignRelayDaemonProcesses)
    $relayHealthAfter = Get-SovereignRelayDaemonHealth
    $relayDaemonProcessCount = $relayAfter.Count
    $relayDaemonHeartbeatAgeSeconds = $relayHealthAfter.heartbeatAgeSeconds
    $relayDaemonVerdict = [string]$relayHealthAfter.finalVerdict
    $relayDaemonHealthy = [bool]($relayAfter.Count -ge 1 -and $relayHealthAfter.healthy)
    if (-not $relayDaemonHealthy -and -not $relayDaemonBlocker) {
        $relayDaemonBlocker = if ($relayHealthAfter.blocker) { [string]$relayHealthAfter.blocker } else { 'SOVEREIGN_RELAY_DAEMON_NOT_HEALTHY' }
    }
}

if ($ok) {
    if ($RequireCapabilityVersion -or $startRequested) {
        $fleetGoalSupervisorSkipped = $true
        $fleetGoalSupervisorOk = $true
        $fleetGoalSupervisorVerdict = if ($RequireCapabilityVersion) {
            'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_SKIPPED_CAPABILITY_PROBE'
        } else {
            'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_SKIPPED_DAEMON_BOOTSTRAP'
        }
    } elseif (-not (Test-Path -LiteralPath $fleetSupervisorScript -PathType Leaf)) {
        $fleetGoalSupervisorBlocker = 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_SCRIPT_MISSING'
    } else {
        $fleetGoalSupervisorRequested = $true
        try {
            $fleetSupervisorOutput = @(
                & $canonicalNode $fleetSupervisorScript 2>&1 |
                    ForEach-Object { [string]$_ }
            )
            $fleetGoalSupervisorExitCode = [int]$LASTEXITCODE
            $fleetSupervisorLine = @(
                $fleetSupervisorOutput |
                    Where-Object { $_.StartsWith($fleetSupervisorMarker, [System.StringComparison]::Ordinal) }
            ) | Select-Object -Last 1
            if ($fleetSupervisorLine) {
                $fleetSupervisorJson = $fleetSupervisorLine.Substring($fleetSupervisorMarker.Length)
                $fleetSupervisorReceipt = $fleetSupervisorJson | ConvertFrom-Json
                $fleetGoalSupervisorVerdict = [string]$fleetSupervisorReceipt.finalVerdict
                $fleetGoalSupervisorBlocker = [string]$fleetSupervisorReceipt.blocker
                $fleetGoalSupervisorOk = [bool](
                    $fleetGoalSupervisorExitCode -eq 0 -and
                    $fleetSupervisorReceipt.ok -eq $true
                )
            } else {
                $fleetGoalSupervisorBlocker = 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_RECEIPT_MISSING'
            }
        } catch {
            $fleetGoalSupervisorBlocker = 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_EXECUTION_FAILED'
        }
    }
}

$overallOk = [bool]($ok -and $vrGovernorOk -and $coreDaemonOk -and $fleetGoalSupervisorOk)
$overallBlocker = if (-not $ok) {
    $blocker
} elseif (-not $vrGovernorOk) {
    if ($vrGovernorBlocker) { $vrGovernorBlocker } else { 'SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_BLOCKED' }
} elseif (-not $coreDaemonOk) {
    if ($coreDaemonBlocker) { $coreDaemonBlocker } else { 'SOVEREIGN_COMMANDER_CORE_DAEMON_BLOCKED' }
} elseif (-not $fleetGoalSupervisorOk) {
    if ($fleetGoalSupervisorBlocker) { $fleetGoalSupervisorBlocker } else { 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_FAILED' }
} else {
    ''
}

[pscustomobject]@{
    schemaVersion = 'stephanos.sovereign-commander-watchdog.v1'
    taskName = 'Stephanos Sovereign Commander'
    beforeProcessCount = $before.Count
    afterProcessCount = $after.Count
    healthyBefore = [bool]$healthyBefore
    healthyAfter = [bool]$healthyAfter
    requiredCapabilityVersion = $RequireCapabilityVersion
    capabilityVersionBefore = [string]$healthBefore.capabilityVersion
    capabilityVersionAfter = [string]$healthAfter.capabilityVersion
    staleCapabilityRecycleRequested = [bool]$staleCapabilityRecycleRequested
    authenticatedInBandParentProof = [bool]$authenticatedInBandParentProof
    stoppedPidCount = [int]$stoppedPidCount
    startRequested = $startRequested
    startedPid = $startedPid
    serverScript = $serverScript
    nodeExecutable = $canonicalNode
    tokenPath = $tokenPath
    port = $port
    daemonHealthy = [bool]$ok
    vrResourceGovernorHealthy = [bool]$vrGovernorOk
    vrResourceGovernorStartRequested = [bool]$vrGovernorStartRequested
    vrResourceGovernorStartedPid = [int]$vrGovernorStartedPid
    vrResourceGovernorProcessCount = [int]$vrGovernorProcessCount
    vrResourceGovernorBlocker = [string]$vrGovernorBlocker
    coreDaemonHealthy = [bool]$coreDaemonOk
    coreDaemonLifecycleSkipped = [bool]$SkipCoreDaemonLifecycle
    coreDaemonStartRequested = [bool]$coreDaemonStartRequested
    coreDaemonRestartRequested = [bool]$coreDaemonRestartRequested
    coreDaemonStartedPid = [int]$coreDaemonStartedPid
    coreDaemonStoppedPidCount = [int]$coreDaemonStoppedPidCount
    coreDaemonProcessCount = [int]$coreDaemonProcessCount
    coreDaemonHeartbeatAgeSeconds = $coreDaemonHeartbeatAgeSeconds
    coreDaemonHeartbeatFresh = [bool]$coreDaemonHeartbeatFresh
    coreDaemonBusyGraceActive = [bool]$coreDaemonBusyGraceActive
    coreDaemonFlywheelCycleAgeSeconds = $coreDaemonFlywheelCycleAgeSeconds
    coreDaemonHeartbeatFreshSeconds = [int]$coreHeartbeatFreshSeconds
    coreDaemonBusyGraceSeconds = [int]$coreBusyGraceSeconds
    coreDaemonReadiness = [string]$coreDaemonReadiness
    coreDaemonSourceHead = [string]$coreDaemonSourceHead
    relayDaemonHealthy = [bool]$relayDaemonHealthy
    relayDaemonStartRequested = [bool]$relayDaemonStartRequested
    relayDaemonRestartRequested = [bool]$relayDaemonRestartRequested
    relayDaemonStartedPid = [int]$relayDaemonStartedPid
    relayDaemonStoppedPidCount = [int]$relayDaemonStoppedPidCount
    relayDaemonProcessCount = [int]$relayDaemonProcessCount
    relayDaemonHeartbeatAgeSeconds = $relayDaemonHeartbeatAgeSeconds
    relayDaemonVerdict = [string]$relayDaemonVerdict
    relayDaemonBlocker = [string]$relayDaemonBlocker
    relayDaemonRequiredForCommanderHealth = $false
    fallbackTransportsRetained = @('scheduled-github-mailbox', 'tailscale-private', 'optional-provider-tunnel', 'legacy-break-glass-remote-control')
    healthy = [bool]$overallOk
    fleetGoalSupervisorRequested = [bool]$fleetGoalSupervisorRequested
    fleetGoalSupervisorSkipped = [bool]$fleetGoalSupervisorSkipped
    fleetGoalSupervisorOk = [bool]$fleetGoalSupervisorOk
    fleetGoalSupervisorExitCode = $fleetGoalSupervisorExitCode
    fleetGoalSupervisorVerdict = $fleetGoalSupervisorVerdict
    fleetGoalSupervisorBlocker = $fleetGoalSupervisorBlocker
    canonicalGoalFabricOnly = $true
    sourceMutationDelegatedToMissionWorker = $true
    duplicateSchedulerAllowed = $false
    duplicateLeaseAllowed = $false
    blocker = $overallBlocker
    vendorMeterRequired = $false
    externalSaasRelayRequired = $false
    networkInstallAllowed = $false
    packageMutationAllowed = $false
    arbitraryExecutableAllowed = $false
    arbitraryShellAllowed = $false
    unrelatedProcessRestartAllowed = $false
    pcRestartAllowed = $false
    visiblePowerShellRequired = $false
    finalVerdict = if (-not $ok) {
        'SOVEREIGN_COMMANDER_WATCHDOG_BLOCKED'
    } elseif (-not $vrGovernorOk) {
        'SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_BLOCKED'
    } elseif (-not $coreDaemonOk) {
        'SOVEREIGN_COMMANDER_CORE_DAEMON_BLOCKED'
    } elseif (-not $fleetGoalSupervisorOk) {
        'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISION_BLOCKED'
    } else {
        'SOVEREIGN_COMMANDER_WATCHDOG_HEALTHY'
    }
} | ConvertTo-Json -Depth 5

if (-not $ok) { exit 2 }
if (-not $vrGovernorOk) { exit 4 }
if (-not $coreDaemonOk -and -not $SkipCoreDaemonLifecycle) { exit 5 }
if (-not $fleetGoalSupervisorOk) { exit 3 }
