[CmdletBinding()]
param(
    [string]$RequireCapabilityVersion = '2026-10-18-island-action-contract-v6',
    [switch]$SkipCoreDaemonLifecycle,
    [switch]$SkipDesktopCommanderCrossHeal
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

# S4U/LeastPrivilege metadata did not exclude an enabled administrator token on
# the installed machine. Observe this process before any lifecycle mutation.
# Read-only adapter. Task configuration is never actual token proof, and this
# preflight grants no runtime/helper, custody, source, lease or restart authority.
function Resolve-SovereignCommanderOperatorContextV1 {
    param([object]$UserSid, [object]$AdministratorRole)
    if ($UserSid -isnot [string] -or $UserSid -cnotmatch '^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$' -or
        $AdministratorRole -isnot [bool]) {
        return [pscustomobject]@{ normalOperatorObserved = $false; blocker = 'SOVEREIGN_COMMANDER_OPERATOR_CONTEXT_UNPROVEN' }
    }
    if ($AdministratorRole) {
        return [pscustomobject]@{ normalOperatorObserved = $false; blocker = 'SOVEREIGN_COMMANDER_NORMAL_OPERATOR_REQUIRED' }
    }
    [pscustomobject]@{ normalOperatorObserved = $true; blocker = '' }
}

function Get-SovereignCommanderOperatorContextV1 {
    $identity = $null
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = New-Object Security.Principal.WindowsPrincipal($identity)
        Resolve-SovereignCommanderOperatorContextV1 -UserSid $identity.User.Value -AdministratorRole ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
    } catch {
        [pscustomobject]@{ normalOperatorObserved = $false; blocker = 'SOVEREIGN_COMMANDER_OPERATOR_CONTEXT_UNPROVEN' }
    } finally {
        if ($null -ne $identity) { $identity.Dispose() }
    }
}
$operatorContext = Get-SovereignCommanderOperatorContextV1
if ($null -eq $operatorContext -or $operatorContext.normalOperatorObserved -isnot [bool] -or $operatorContext.normalOperatorObserved -ne $true) {
    [pscustomobject]@{
        schemaVersion = 'stephanos.sovereign-commander-watchdog.v1'
        healthy = $false
        blocker = $operatorContext.blocker
        normalOperatorObserved = $false
        runtimeActivationGranted = $false
        sourceMutationAllowed = $false
        arbitraryShellAllowed = $false
        pcRestartAllowed = $false
        finalVerdict = 'SOVEREIGN_COMMANDER_WATCHDOG_BLOCKED'
    } | ConvertTo-Json -Compress
    exit 2
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
$coreDaemonLockPath = Join-Path $(if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE 'AppData\Local' }) 'Stephanos\stephanos-core-daemon.lock.json'
$relayDaemonScript = Join-Path $repoRoot 'scripts\battle-bridge-sovereign-relay-daemon.mjs'
$relayDaemonStatusPath = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace\status\sovereign-relay-current.json'
$desktopCommanderTaskName = 'Stephanos Commander Watchdog'
$port = 18791
$serverScriptPattern = [regex]::Escape($serverScript)
$vrGovernorScriptPattern = [regex]::Escape($vrGovernorScript)
$coreDaemonScriptPattern = [regex]::Escape($coreDaemonScript)
$relayDaemonScriptPattern = [regex]::Escape($relayDaemonScript)
$coreHeartbeatFreshSeconds = 60
$coreBusyGraceSeconds = 300
. (Join-Path $scriptDir 'stephanos-core-process-observation.ps1')
$script:coreProcessObservation = $null

function Get-StephanosCoreDaemonProcesses {
    $script:coreProcessObservation = Get-StephanosCoreProcessObservation -CoreScript $coreDaemonScript
    return @($script:coreProcessObservation.processes)
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
        $writerPid = 0
        if ($status.PSObject.Properties['processId']) {
            [void][int]::TryParse([string]$status.processId, [ref]$writerPid)
        }
        $lockOwnerPid = 0
        $lock = $null
        if (Test-Path -LiteralPath $coreDaemonLockPath -PathType Leaf) {
            try {
                $lock = Get-Content -LiteralPath $coreDaemonLockPath -Raw | ConvertFrom-Json
                [void][int]::TryParse([string]$lock.pid, [ref]$lockOwnerPid)
            } catch {}
        }
        $coreProcesses = @(Get-StephanosCoreDaemonProcesses)
        $writerCustodyProven = $false
        if ($script:coreProcessObservation.complete -and
            $coreProcesses.Count -eq 1 -and $writerPid -gt 0 -and
            $lockOwnerPid -eq $writerPid -and $null -ne $lock -and
            [string]$lock.schemaVersion -ceq 'stephanos.core-daemon-lock.v1' -and
            [string]$lock.sourceHead -cmatch '^[0-9a-f]{40}$' -and
            [string]::Equals([string]$lock.sourceHead, [string]$status.sourceHead, [System.StringComparison]::OrdinalIgnoreCase)) {
            try {
                $writerProcess = @($coreProcesses | Where-Object { [int]$_.ProcessId -eq $writerPid })
                if ($writerProcess.Count -eq 1 -and $null -ne $writerProcess[0].CreationDate) {
                    $lockStart = [DateTimeOffset]::Parse([string]$lock.startedAtUtc)
                    $writerCreated = [DateTimeOffset]::new([datetime]$writerProcess[0].CreationDate)
                    $heartbeatAt = [DateTimeOffset]::Parse([string]$status.heartbeatAtUtc)
                    $startupLagSeconds = ($lockStart.ToUniversalTime() - $writerCreated.ToUniversalTime()).TotalSeconds
                    $writerCustodyProven = [bool](
                        $lockStart.Offset -eq [TimeSpan]::Zero -and
                        $startupLagSeconds -ge -3 -and $startupLagSeconds -le 90 -and
                        $lockStart -le $heartbeatAt
                    )
                }
            } catch { $writerCustodyProven = $false }
        }
        $rescueCount = 0
        $rescueStage = if ($status.PSObject.Properties['outerBridgeLastStage']) {
            [string]$status.outerBridgeLastStage
        } else { '' }
        $rescueGenerationProven = [bool](
            $status.PSObject.Properties['outerBridgeRunCount'] -and
            [int]::TryParse([string]$status.outerBridgeRunCount, [ref]$rescueCount) -and
            $rescueCount -ge 0 -and $rescueStage -cmatch '^[A-Z][A-Z0-9_]{0,79}$'
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
            $writerCustodyProven -and $rescueGenerationProven -and
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
                $writerCustodyProven -and $rescueGenerationProven -and
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
        return [pscustomobject]@{
            healthy = $false
            heartbeatAgeSeconds = $null
            sourceHead = ''
            sourceHeadMatchesLive = $false
            finalVerdict = 'UNKNOWN'
            blocker = 'SOVEREIGN_RELAY_STATUS_MISSING'
        }
    }
    try {
        $status = Get-Content -LiteralPath $relayDaemonStatusPath -Raw | ConvertFrom-Json
        $heartbeat = [DateTimeOffset]::Parse([string]$status.heartbeatAtUtc)
        $age = [math]::Max(0, [int]([DateTimeOffset]::UtcNow - $heartbeat).TotalSeconds)
        $sourceHead = ([string]$status.sourceHead).Trim().ToLowerInvariant()
        $liveHead = ''
        if (Test-Path -LiteralPath $gitExe -PathType Leaf) {
            try {
                $liveHead = [string]((& $gitExe -C $repoRoot rev-parse HEAD 2>$null | Select-Object -First 1))
                $liveHead = $liveHead.Trim().ToLowerInvariant()
            } catch {}
        }
        $sourceHeadValid = [bool]($sourceHead -match '^[0-9a-f]{40}$')
        $liveHeadValid = [bool]($liveHead -match '^[0-9a-f]{40}$')
        $sourceHeadMatchesLive = [bool](
            $sourceHeadValid -and
            $liveHeadValid -and
            [string]::Equals($sourceHead, $liveHead, [System.StringComparison]::OrdinalIgnoreCase)
        )
        $blocker = if (-not $sourceHeadValid) {
            'SOVEREIGN_RELAY_SOURCE_HEAD_MISSING'
        } elseif (-not $liveHeadValid) {
            'SOVEREIGN_RELAY_LIVE_HEAD_UNPROVEN'
        } elseif (-not $sourceHeadMatchesLive) {
            'SOVEREIGN_RELAY_SOURCE_HEAD_STALE'
        } else {
            [string]$status.blocker
        }
        return [pscustomobject]@{
            healthy = [bool](
                $status.daemonHealthy -eq $true -and
                $age -le 30 -and
                $sourceHeadMatchesLive
            )
            heartbeatAgeSeconds = $age
            sourceHead = $sourceHead
            sourceHeadMatchesLive = $sourceHeadMatchesLive
            finalVerdict = [string]$status.finalVerdict
            blocker = $blocker
        }
    } catch {
        return [pscustomobject]@{
            healthy = $false
            heartbeatAgeSeconds = $null
            sourceHead = ''
            sourceHeadMatchesLive = $false
            finalVerdict = 'UNKNOWN'
            blocker = 'SOVEREIGN_RELAY_STATUS_INVALID'
        }
    }
}

function Wait-SovereignRelayDaemonReady {
    param(
        [int]$Attempts = 40,
        [int]$DelayMilliseconds = 500
    )
    $lastProcesses = @()
    $lastHealth = $null
    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        $lastProcesses = @(Get-SovereignRelayDaemonProcesses)
        $lastHealth = Get-SovereignRelayDaemonHealth
        if ($lastProcesses.Count -eq 1 -and [bool]$lastHealth.healthy) {
            return [pscustomobject]@{
                ready = $true
                processes = $lastProcesses
                health = $lastHealth
            }
        }
        Start-Sleep -Milliseconds $DelayMilliseconds
    }
    return [pscustomobject]@{
        ready = $false
        processes = $lastProcesses
        health = $lastHealth
    }
}

function Get-SovereignCommanderProcesses {
    $processes = @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -eq 'node.exe' -and
                [string]$_.CommandLine -match $serverScriptPattern
            }
    )

    # S4U / elevated scheduled-task processes can expose a null CommandLine to
    # the interactive watchdog even while the loopback HTTP daemon is healthy.
    # Treat the owner of Sovereign's fixed loopback listener as a process
    # candidate as well. Health/capability checks below still decide whether it
    # is trusted, healthy, or eligible for a stale-contract recycle.
    $knownProcessIds = @{}
    foreach ($process in $processes) {
        $knownProcessIds[[int]$process.ProcessId] = $true
    }
    try {
        $listenerProcessIds = @(
            Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $port -State Listen -ErrorAction Stop |
                Where-Object { [int]$_.OwningProcess -gt 0 } |
                Select-Object -ExpandProperty OwningProcess -Unique
        )
        foreach ($listenerProcessIdValue in $listenerProcessIds) {
            $listenerProcessId = [int]$listenerProcessIdValue
            if ($knownProcessIds.ContainsKey($listenerProcessId)) { continue }
            $listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerProcessId" -ErrorAction SilentlyContinue
            if ($null -ne $listenerProcess) {
                $processes += $listenerProcess
                $knownProcessIds[$listenerProcessId] = $true
            }
        }
    } catch {}

    return @($processes)
}

function Get-DesktopCommanderRemoteProcesses {
    return @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -eq 'node.exe' -and
                [string]$_.CommandLine -match 'desktop-commander' -and
                [string]$_.CommandLine -match 'dist[\\/]index\.js' -and
                [string]$_.CommandLine -match '(?:^|\s)remote(?:\s|$)'
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

function Test-VrResourceGovernorProcessCurrent {
    param($Process)

    if ($null -eq $Process -or -not (Test-Path -LiteralPath $vrGovernorScript -PathType Leaf)) {
        return $false
    }
    try {
        $scriptWriteUtc = (Get-Item -LiteralPath $vrGovernorScript -ErrorAction Stop).LastWriteTimeUtc
        $created = [DateTime]$Process.CreationDate
        return $created.ToUniversalTime() -ge $scriptWriteUtc.AddSeconds(-2)
    }
    catch {
        return $false
    }
}

function Get-SovereignCommanderHealth {
    try {
        $health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$port/health" -TimeoutSec 3
        $basicHealthy = ($health.ok -eq $true -and [string]$health.service -eq 'stephanos-sovereign-commander')
        $capabilityProperty = $health.PSObject.Properties['capabilityVersion']
        $capabilityVersion = if ($null -ne $capabilityProperty) { [string]$capabilityProperty.Value } else { '' }
        $capabilitySatisfied = (-not $RequireCapabilityVersion) -or ($capabilityVersion -eq $RequireCapabilityVersion)
        $continuousRepairProperty = $health.PSObject.Properties['continuousRepairGuardian']
        $continuousRepairEnabled = $false
        $continuousRepairRunning = $false
        $continuousRepairScheduled = $false
        $timeoutCustodyHeld = $false
        $maintenanceInFlight = $false
        if ($null -ne $continuousRepairProperty -and $null -ne $continuousRepairProperty.Value) {
            $continuousRepair = $continuousRepairProperty.Value
            $enabledProperty = $continuousRepair.PSObject.Properties['enabled']
            $runningProperty = $continuousRepair.PSObject.Properties['running']
            $scheduledProperty = $continuousRepair.PSObject.Properties['scheduled']
            $custodyProperty = $continuousRepair.PSObject.Properties['timeoutCustodyHeld']
            $maintenanceProperty = $continuousRepair.PSObject.Properties['maintenanceInFlight']
            $timeoutCustodyHeld = [bool]($null -ne $custodyProperty -and $custodyProperty.Value -eq $true)
            $maintenanceInFlight = [bool]($null -ne $maintenanceProperty -and $maintenanceProperty.Value -eq $true)
            $continuousRepairEnabled = [bool]($null -ne $enabledProperty -and $enabledProperty.Value -eq $true)
            $continuousRepairRunning = [bool]($null -ne $runningProperty -and $runningProperty.Value -eq $true)
            $continuousRepairScheduled = [bool]($null -ne $scheduledProperty -and $scheduledProperty.Value -eq $true)
        }
        # "enabled" alone is not proof of liveness. A healthy guardian must either
        # be executing a repair cycle or have the next cycle genuinely scheduled.
        $continuousRepairSatisfied = [bool](
            $continuousRepairEnabled -and
            ($continuousRepairRunning -or $continuousRepairScheduled)
        )
        return [pscustomobject]@{
            healthy = [bool]($basicHealthy -and $capabilitySatisfied -and $continuousRepairSatisfied)
            basicHealthy = [bool]$basicHealthy
            capabilitySatisfied = [bool]$capabilitySatisfied
            continuousRepairSatisfied = [bool]$continuousRepairSatisfied
            continuousRepairEnabled = [bool]$continuousRepairEnabled
            continuousRepairRunning = [bool]$continuousRepairRunning
            continuousRepairScheduled = [bool]$continuousRepairScheduled
            capabilityVersion = $capabilityVersion
            timeoutCustodyHeld = $timeoutCustodyHeld
            maintenanceInFlight = $maintenanceInFlight
        }
    } catch {
        return [pscustomobject]@{
            healthy = $false
            basicHealthy = $false
            capabilitySatisfied = (-not $RequireCapabilityVersion)
            continuousRepairSatisfied = $false
            continuousRepairEnabled = $false
            continuousRepairRunning = $false
            continuousRepairScheduled = $false
            capabilityVersion = ''
            timeoutCustodyHeld = $false
            maintenanceInFlight = $false
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
        continuousRepairSatisfied = $true
        continuousRepairEnabled = $true
        continuousRepairRunning = $true
        continuousRepairScheduled = $false
        capabilityVersion = $RequireCapabilityVersion
        timeoutCustodyHeld = $false
        maintenanceInFlight = $false
    }
} else {
    Get-SovereignCommanderHealth
}
$healthyBefore = [bool]$healthBefore.healthy
$staleCapability = [bool]($healthBefore.basicHealthy -and -not $healthBefore.capabilitySatisfied)
$staleContinuousRepair = [bool]($healthBefore.basicHealthy -and -not $healthBefore.continuousRepairSatisfied)
$staleDaemonContract = [bool]($staleCapability -or $staleContinuousRepair)
$staleCapabilityRecycleRequested = $false
$staleContinuousRepairRecycleRequested = $false
$stoppedPidCount = 0
$fleetGoalSupervisorRequested = $false
$fleetGoalSupervisorSkipped = $false
$fleetGoalSupervisorOk = $false
$fleetGoalSupervisorExitCode = $null
$fleetGoalSupervisorVerdict = ''
$fleetGoalSupervisorBlocker = ''
$vrGovernorStartRequested = $false
$vrGovernorRestartRequested = $false
$vrGovernorStoppedPidCount = 0
$vrGovernorStartedPid = 0
$vrGovernorProcessCount = 0
$vrGovernorOk = $false
$vrGovernorBlocker = ''
$coreDaemonStartRequested = $false
$coreDaemonRestartRequested = $false
$coreDaemonStartedPid = 0
$coreDaemonStoppedPidCount = 0
$coreDaemonProcessCount = $null
$coreDaemonProcessInventoryComplete = $false
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
$relayDaemonSourceHead = ''
$relayDaemonSourceHeadMatchesLive = $false
$relayDaemonVerdict = 'UNKNOWN'
$desktopCommanderCrossHealRequested = $false
$desktopCommanderCrossHealOk = $false
$desktopCommanderCrossHealBlocker = ''
$desktopCommanderRemoteProcessCount = 0

if ($healthBefore.timeoutCustodyHeld -eq $true) {
    # A held process is the current custody owner, even when its capability
    # version is stale. Recycling it would erase the guardian's timeout fence.
    # Keep the original owner and report HOLD; do not pretend it is healthy.
    $blocker = 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN'
} elseif ($healthBefore.maintenanceInFlight -eq $true) {
    $blocker = 'SOVEREIGN_MAINTENANCE_OWNER_BUSY'
} elseif (($before.Count -gt 0 -or $healthBefore.basicHealthy) -and -not $healthyBefore -and -not $authenticatedInBandParentProof) {
    # A health snapshot is not an atomic maintenance drain/reservation. Legacy
    # daemons also omit custody fields. Never kill an existing owner to refresh
    # its contract until a separate admitted handoff proves terminal custody.
    $blocker = 'SOVEREIGN_COMMANDER_MAINTENANCE_QUIESCENCE_UNPROVEN'
} elseif (-not (Test-Path -LiteralPath $serverScript -PathType Leaf)) {
    $blocker = 'SOVEREIGN_COMMANDER_SERVER_SCRIPT_MISSING'
} elseif (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) {
    $blocker = 'SOVEREIGN_COMMANDER_TOKEN_MISSING'
} elseif ($before.Count -eq 0 -or -not $healthyBefore) {
    if (-not (Test-Path -LiteralPath $canonicalNode -PathType Leaf)) {
        $blocker = 'SOVEREIGN_COMMANDER_CANONICAL_NODE_MISSING'
    } else {
        if ($staleDaemonContract -and $before.Count -gt 0) {
            $staleCapabilityRecycleRequested = [bool]$staleCapability
            $staleContinuousRepairRecycleRequested = [bool]$staleContinuousRepair
            try {
                foreach ($process in $before) {
                    Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
                    $stoppedPidCount += 1
                }
                Start-Sleep -Milliseconds 500
            } catch {
                $blocker = 'SOVEREIGN_COMMANDER_STALE_CONTRACT_RECYCLE_FAILED'
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
        continuousRepairSatisfied = $true
        capabilityVersion = $RequireCapabilityVersion
        timeoutCustodyHeld = $false
        maintenanceInFlight = $false
    }
} else {
    Wait-SovereignCommanderHealth
}
$healthyAfter = [bool]$healthAfter.healthy
$ok = ($after.Count -ge 1 -and $healthyAfter)
if (-not $ok -and -not $blocker) { $blocker = 'SOVEREIGN_COMMANDER_NOT_HEALTHY' }

# Remote Desktop Commander is an optional peer, not a Sovereign health dependency.
# Repair it only when absent. Route recovery through the canonical scheduled task
# so MultipleInstances=IgnoreNew serializes cold-boot and peer-heal races.
$desktopCommanderBefore = @(Get-DesktopCommanderRemoteProcesses)
if (-not $SkipDesktopCommanderCrossHeal -and $desktopCommanderBefore.Count -eq 0) {
    $desktopCommanderCrossHealRequested = $true
    $desktopCommanderTask = Get-ScheduledTask -TaskName $desktopCommanderTaskName -ErrorAction SilentlyContinue
    if ($null -eq $desktopCommanderTask) {
        $desktopCommanderCrossHealBlocker = 'DESKTOP_COMMANDER_TASK_MISSING'
    } else {
        try {
            if ([string]$desktopCommanderTask.State -ne 'Running') {
                Start-ScheduledTask -TaskName $desktopCommanderTaskName
            }
            for ($attempt = 0; $attempt -lt 12 -and @(Get-DesktopCommanderRemoteProcesses).Count -eq 0; $attempt++) {
                Start-Sleep -Milliseconds 500
            }
        } catch {
            $desktopCommanderCrossHealBlocker = 'DESKTOP_COMMANDER_CROSS_HEAL_FAILED'
        }
    }
}
$desktopCommanderAfter = @(Get-DesktopCommanderRemoteProcesses)
$desktopCommanderRemoteProcessCount = $desktopCommanderAfter.Count
$desktopCommanderCrossHealOk = $desktopCommanderRemoteProcessCount -ge 1
if (-not $desktopCommanderCrossHealOk -and -not $desktopCommanderCrossHealBlocker) {
    $desktopCommanderCrossHealBlocker = 'DESKTOP_COMMANDER_REMOTE_PROCESS_NOT_HEALTHY'
}

# VR protection is intentionally independent of daemon health.
# A sick commander must never leave Air Link exposed to heavyweight Ollama residency.
if (-not (Test-Path -LiteralPath $vrGovernorScript -PathType Leaf)) {
    $vrGovernorBlocker = 'SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_SCRIPT_MISSING'
} elseif (-not (Test-Path -LiteralPath $powershellExecutable -PathType Leaf)) {
    $vrGovernorBlocker = 'SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_POWERSHELL_MISSING'
} else {
    $vrGovernorBefore = @(Get-VrResourceGovernorProcesses)
    $vrGovernorSourceStale = [bool](
        $vrGovernorBefore.Count -gt 0 -and
        $null -ne ($vrGovernorBefore | Where-Object { -not (Test-VrResourceGovernorProcessCurrent -Process $_) } | Select-Object -First 1)
    )

    # PowerShell loads the governor script into memory. A process can therefore
    # remain alive for days while running stale protection logic after a merge.
    # Recycle it whenever the canonical governor source is newer than the watcher.
    if ($vrGovernorSourceStale) {
        $vrGovernorRestartRequested = $true
        try {
            foreach ($process in $vrGovernorBefore) {
                Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
                $vrGovernorStoppedPidCount += 1
            }
            Start-Sleep -Milliseconds 250
            $vrGovernorBefore = @()
        }
        catch {
            $vrGovernorBlocker = 'SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_STALE_RECYCLE_FAILED'
        }
    }

    if (-not $vrGovernorBlocker -and $vrGovernorBefore.Count -eq 0) {
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
    $coreObservedComplete = [bool]$script:coreProcessObservation.complete
    $coreObservedHealth = Get-StephanosCoreDaemonHealth
    $coreDaemonProcessInventoryComplete = [bool]($coreObservedComplete -and $script:coreProcessObservation.complete)
    $coreDaemonProcessCount = if ($coreDaemonProcessInventoryComplete) { $coreObserved.Count } else { $null }
    $coreDaemonHeartbeatAgeSeconds = $coreObservedHealth.heartbeatAgeSeconds
    $coreDaemonHeartbeatFresh = [bool]$coreObservedHealth.heartbeatFresh
    $coreDaemonBusyGraceActive = [bool]$coreObservedHealth.busyGraceActive
    $coreDaemonFlywheelCycleAgeSeconds = $coreObservedHealth.flywheelCycleAgeSeconds
    $coreDaemonReadiness = [string]$coreObservedHealth.readiness
    $coreDaemonSourceHead = [string]$coreObservedHealth.sourceHead
    if (-not $coreDaemonProcessInventoryComplete) {
        $coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_PROCESS_INVENTORY_UNPROVEN'
    } elseif ($coreObserved.Count -gt 1) {
        $coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_CUSTODY_AMBIGUOUS'
    }
    $coreDaemonOk = [bool]($coreObserved.Count -eq 1 -and $coreObservedHealth.healthy -and -not $coreDaemonBlocker)
} elseif (-not (Test-Path -LiteralPath $coreDaemonScript -PathType Leaf)) {
    $coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_SCRIPT_MISSING'
} elseif (-not (Test-Path -LiteralPath $canonicalNode -PathType Leaf)) {
    $coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_NODE_MISSING'
} else {
    $coreBefore = @(Get-StephanosCoreDaemonProcesses)
    $coreBeforeComplete = [bool]$script:coreProcessObservation.complete
    $coreHealthBefore = Get-StephanosCoreDaemonHealth
    # Multiple matching processes require independent lock/heartbeat custody
    # proof. Never force-terminate all matches and create another writer.
    if (-not $coreBeforeComplete -or -not $script:coreProcessObservation.complete) {
        $coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_PROCESS_INVENTORY_UNPROVEN'
    } elseif ($coreBefore.Count -gt 1) {
        $coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_CUSTODY_AMBIGUOUS'
    } elseif ($coreBefore.Count -eq 1 -and -not [bool]$coreHealthBefore.healthy) {
        # The sole matching process can be the original lock owner. A stale
        # heartbeat is not a terminal custody receipt or kill authorisation.
        # Keep it fenced for an independently proven owner repair.
        $coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_SINGLE_WRITER_UNVERIFIED'
    } elseif ($coreBefore.Count -eq 0) {
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
    $coreAfterComplete = [bool]$script:coreProcessObservation.complete
    $coreHealthAfter = if ($coreDaemonStartRequested -or $coreDaemonRestartRequested) {
        Wait-StephanosCoreDaemonHealth
    } else {
        Get-StephanosCoreDaemonHealth
    }
    $coreDaemonProcessInventoryComplete = [bool]($coreAfterComplete -and $script:coreProcessObservation.complete)
    $coreDaemonProcessCount = if ($coreDaemonProcessInventoryComplete) { $coreAfter.Count } else { $null }
    $coreDaemonHeartbeatAgeSeconds = $coreHealthAfter.heartbeatAgeSeconds
    $coreDaemonHeartbeatFresh = [bool]$coreHealthAfter.heartbeatFresh
    $coreDaemonBusyGraceActive = [bool]$coreHealthAfter.busyGraceActive
    $coreDaemonFlywheelCycleAgeSeconds = $coreHealthAfter.flywheelCycleAgeSeconds
    $coreDaemonReadiness = [string]$coreHealthAfter.readiness
    $coreDaemonSourceHead = [string]$coreHealthAfter.sourceHead
    $coreDaemonOk = [bool]($coreAfter.Count -eq 1 -and $coreHealthAfter.healthy -and -not $coreDaemonBlocker)
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
    if ($relayBefore.Count -ne 1 -or -not [bool]$relayHealthBefore.healthy) {
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
            } catch {
                $relayDaemonBlocker = 'SOVEREIGN_RELAY_DAEMON_START_FAILED'
            }
        }
    }
    $relayReady = if ($relayDaemonBlocker) {
        [pscustomobject]@{ ready = $false; processes = @(Get-SovereignRelayDaemonProcesses); health = Get-SovereignRelayDaemonHealth }
    } else {
        Wait-SovereignRelayDaemonReady
    }
    $relayAfter = @($relayReady.processes)
    $relayHealthAfter = $relayReady.health
    $relayDaemonProcessCount = $relayAfter.Count
    $relayDaemonHeartbeatAgeSeconds = $relayHealthAfter.heartbeatAgeSeconds
    $relayDaemonSourceHead = [string]$relayHealthAfter.sourceHead
    $relayDaemonSourceHeadMatchesLive = [bool]$relayHealthAfter.sourceHeadMatchesLive
    $relayDaemonVerdict = [string]$relayHealthAfter.finalVerdict
    $relayDaemonHealthy = [bool]($relayReady.ready -and $relayAfter.Count -eq 1 -and $relayHealthAfter.healthy)
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
    continuousRepairSatisfiedBefore = [bool]$healthBefore.continuousRepairSatisfied
    continuousRepairSatisfiedAfter = [bool]$healthAfter.continuousRepairSatisfied
    staleCapabilityRecycleRequested = [bool]$staleCapabilityRecycleRequested
    staleContinuousRepairRecycleRequested = [bool]$staleContinuousRepairRecycleRequested
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
    vrResourceGovernorRestartRequested = [bool]$vrGovernorRestartRequested
    vrResourceGovernorStoppedPidCount = [int]$vrGovernorStoppedPidCount
    vrResourceGovernorStartedPid = [int]$vrGovernorStartedPid
    vrResourceGovernorProcessCount = [int]$vrGovernorProcessCount
    vrResourceGovernorBlocker = [string]$vrGovernorBlocker
    coreDaemonHealthy = [bool]$coreDaemonOk
    coreDaemonLifecycleSkipped = [bool]$SkipCoreDaemonLifecycle
    coreDaemonStartRequested = [bool]$coreDaemonStartRequested
    coreDaemonRestartRequested = [bool]$coreDaemonRestartRequested
    coreDaemonStartedPid = [int]$coreDaemonStartedPid
    coreDaemonStoppedPidCount = [int]$coreDaemonStoppedPidCount
    coreDaemonProcessCount = $coreDaemonProcessCount
    coreDaemonProcessInventoryComplete = [bool]$coreDaemonProcessInventoryComplete
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
    relayDaemonSourceHead = [string]$relayDaemonSourceHead
    relayDaemonSourceHeadMatchesLive = [bool]$relayDaemonSourceHeadMatchesLive
    relayDaemonVerdict = [string]$relayDaemonVerdict
    relayDaemonBlocker = [string]$relayDaemonBlocker
    desktopCommanderCrossHealSkipped = [bool]$SkipDesktopCommanderCrossHeal
    desktopCommanderCrossHealRequested = [bool]$desktopCommanderCrossHealRequested
    desktopCommanderCrossHealOk = [bool]$desktopCommanderCrossHealOk
    desktopCommanderCrossHealBlocker = [string]$desktopCommanderCrossHealBlocker
    desktopCommanderRemoteProcessCount = [int]$desktopCommanderRemoteProcessCount
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
