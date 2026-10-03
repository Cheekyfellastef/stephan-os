[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required to resolve the canonical Battle Bridge checkout.' }
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
$expectedRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
if ([System.IO.Path]::GetFullPath($repoRoot) -ne $expectedRepoRoot) {
    throw "Wake ignition recovery must run from the canonical checkout: $expectedRepoRoot"
}

$sharedWorkspace = if ($env:STEPHANOS_SHARED_WORKSPACE -and $env:STEPHANOS_SHARED_WORKSPACE.Trim()) {
    $env:STEPHANOS_SHARED_WORKSPACE.Trim()
} elseif ($env:STEPHANOS_OPENCLAW_WORKSPACE -and $env:STEPHANOS_OPENCLAW_WORKSPACE.Trim()) {
    $env:STEPHANOS_OPENCLAW_WORKSPACE.Trim()
} else {
    Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Stephanos-openclaw-workspace'
}
$statusPath = Join-Path $sharedWorkspace 'status\battle-bridge-ignition-supervisor-current.json'
$statePath = Join-Path $sharedWorkspace 'status\wake-ignition-recovery-state.json'
$retryWindowSeconds = 90

function Get-CurrentHead {
    $git = Get-Command git.exe -ErrorAction SilentlyContinue
    if (-not $git) { $git = Get-Command git -ErrorAction SilentlyContinue }
    if (-not $git) { return '' }
    $head = @(& $git.Source -C $repoRoot rev-parse HEAD 2>$null)
    if ($LASTEXITCODE -ne 0 -or $head.Count -lt 1) { return '' }
    $value = ([string]$head[-1]).Trim().ToLowerInvariant()
    return $(if ($value -match '^[0-9a-f]{40}$') { $value } else { '' })
}

function Get-CanonicalSupervisorProof([string]$ExpectedHead) {
    if (-not $ExpectedHead -or -not (Test-Path -LiteralPath $statusPath -PathType Leaf)) {
        return [pscustomobject]@{ ready = $false; reason = 'CANONICAL_SUPERVISOR_PROOF_MISSING' }
    }
    try {
        $record = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $served = $record.services.stephanosUi4173.servedRuntimeProof
        $ready = (
            $record.currentPhase -eq 'ready' -and
            $record.trafficLight -eq 'green' -and
            $record.services.backend8787.ready -eq $true -and
            $record.services.openClaw18789.ready -eq $true -and
            $record.services.stephanosUi4173.ready -eq $true -and
            $served.ready -eq $true -and
            [string]$served.currentHead -eq $ExpectedHead
        )
        return [pscustomobject]@{
            ready = [bool]$ready
            reason = if ($ready) { '' } else { 'CANONICAL_SUPERVISOR_NOT_GREEN_EXACT_HEAD' }
            currentPhase = [string]$record.currentPhase
            trafficLight = [string]$record.trafficLight
            servedRuntimeReady = [bool]$served.ready
            servedRuntimeHead = [string]$served.currentHead
        }
    } catch {
        return [pscustomobject]@{ ready = $false; reason = 'CANONICAL_SUPERVISOR_PROOF_UNREADABLE' }
    }
}

function Get-RecentDispatchAgeSeconds {
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { return [double]::PositiveInfinity }
    try {
        $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
        $last = [DateTimeOffset]::MinValue
        if (-not $state.dispatchedAtUtc -or -not [DateTimeOffset]::TryParse([string]$state.dispatchedAtUtc, [ref]$last)) {
            return [double]::PositiveInfinity
        }
        return [Math]::Max(0, ((Get-Date).ToUniversalTime() - $last.UtcDateTime).TotalSeconds)
    } catch {
        return [double]::PositiveInfinity
    }
}

$currentHead = Get-CurrentHead
$proof = Get-CanonicalSupervisorProof -ExpectedHead $currentHead
$healthyBefore = [bool]$proof.ready
$dispatchAgeSeconds = Get-RecentDispatchAgeSeconds
$retryDeferred = (-not $healthyBefore -and $dispatchAgeSeconds -lt $retryWindowSeconds)
$spawned = $false
$startedPid = 0
$blocker = ''
$logRoot = ''
$stdoutLog = ''
$stderrLog = ''

if (-not $healthyBefore -and -not $retryDeferred) {
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) {
        $blocker = 'STEPHANOS_WAKE_IGNITION_NPM_NOT_FOUND'
    } elseif (-not $currentHead) {
        $blocker = 'STEPHANOS_WAKE_IGNITION_HEAD_UNPROVEN'
    } else {
        $logRoot = Join-Path $sharedWorkspace 'logs\wake-ignition-recovery'
        New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $statePath) | Out-Null
        $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
        $stdoutLog = Join-Path $logRoot "$stamp.stdout.log"
        $stderrLog = Join-Path $logRoot "$stamp.stderr.log"
        $cmdExe = Join-Path $env:SystemRoot 'System32\cmd.exe'
        $fixedCommand = ('"{0}" run stephanos:ignite' -f $npm.Source)

        $approvalName = 'STEPHANOS_APPROVE_OPENCLAW_CONTROL_PANEL_STARTGATEWAY'
        $previousApproval = [Environment]::GetEnvironmentVariable($approvalName, 'Process')
        try {
            [Environment]::SetEnvironmentVariable($approvalName, '1', 'Process')
            $started = Start-Process -FilePath $cmdExe -ArgumentList @('/d', '/s', '/c', $fixedCommand) -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
            $spawned = $true
            $startedPid = [int]$started.Id
            [pscustomobject]@{
                schemaVersion = 'stephanos.wake-ignition-recovery-state.v1'
                dispatchedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
                expectedHead = $currentHead
                pid = $startedPid
            } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $statePath -Encoding UTF8
        } catch {
            $blocker = 'STEPHANOS_WAKE_IGNITION_START_FAILED'
        } finally {
            [Environment]::SetEnvironmentVariable($approvalName, $previousApproval, 'Process')
        }
    }
}

[pscustomobject]@{
    schemaVersion = 'stephanos.wake-ignition-recovery.v1'
    canonicalRepoRoot = $repoRoot
    currentHead = $currentHead
    canonicalSupervisorReady = $healthyBefore
    canonicalSupervisorProof = $proof
    retryWindowSeconds = $retryWindowSeconds
    lastDispatchAgeSeconds = if ([double]::IsPositiveInfinity($dispatchAgeSeconds)) { -1 } else { [int][Math]::Round($dispatchAgeSeconds) }
    retryDeferred = [bool]$retryDeferred
    ignitionSpawned = $spawned
    startedPid = $startedPid
    blocker = $blocker
    statusPath = $statusPath
    statePath = $statePath
    logRoot = $logRoot
    stdoutLog = $stdoutLog
    stderrLog = $stderrLog
    fixedIgnitionCommand = 'npm run stephanos:ignite'
    openClawStartGatewayApprovalOnly = $true
    sourceMutationAuthorityGranted = $false
    arbitraryShellAllowed = $false
    arbitraryExecutableAllowed = $false
    arbitraryArgumentsAllowed = $false
    packageInstallAllowed = $false
    mergeAuthority = $false
    pcRestartAllowed = $false
    finalVerdict = if ($healthyBefore) {
        'STEPHANOS_ALREADY_HEALTHY_EXACT_HEAD'
    } elseif ($retryDeferred) {
        'STEPHANOS_WAKE_IGNITION_RETRY_DEFERRED'
    } elseif ($spawned) {
        'STEPHANOS_WAKE_IGNITION_DISPATCHED'
    } else {
        'STEPHANOS_WAKE_IGNITION_BLOCKED'
    }
} | ConvertTo-Json -Depth 6

if (-not $healthyBefore -and -not $retryDeferred -and -not $spawned) { exit 2 }
