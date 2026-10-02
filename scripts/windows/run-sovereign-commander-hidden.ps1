[CmdletBinding()]
param(
    [string]$RequireCapabilityVersion = '2026-10-02-mailbox-rollover-v2'
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
$powershellExecutable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$vrGovernorScript = Join-Path $repoRoot 'scripts\windows\run-vr-resource-governor.ps1'
$port = 18791
$serverScriptPattern = [regex]::Escape($serverScript)
$vrGovernorScriptPattern = [regex]::Escape($vrGovernorScript)

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

$blocker = ''
$startRequested = $false
$startedPid = 0
$before = @(Get-SovereignCommanderProcesses)
$healthBefore = Get-SovereignCommanderHealth
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
$healthAfter = Get-SovereignCommanderHealth
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

$overallOk = [bool]($ok -and $vrGovernorOk -and $fleetGoalSupervisorOk)
$overallBlocker = if (-not $ok) {
    $blocker
} elseif (-not $vrGovernorOk) {
    if ($vrGovernorBlocker) { $vrGovernorBlocker } else { 'SOVEREIGN_COMMANDER_VR_RESOURCE_GOVERNOR_BLOCKED' }
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
    } elseif (-not $fleetGoalSupervisorOk) {
        'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISION_BLOCKED'
    } else {
        'SOVEREIGN_COMMANDER_WATCHDOG_HEALTHY'
    }
} | ConvertTo-Json -Depth 5

if (-not $ok) { exit 2 }
if (-not $vrGovernorOk) { exit 4 }
if (-not $fleetGoalSupervisorOk) { exit 3 }
