[CmdletBinding()]
param(
    [ValidateSet('Inspect', 'StartApprovedWorkerTask')]
    [string]$Mode = 'Inspect',

    [string]$DeadlineUtc = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

function Get-CanonicalTrackedSourceAssessment {
    param([string]$GitExecutable, [string]$RepositoryRoot)
    $runtimeMemoryPath = 'stephanos-server/data/memory/durable-memory.json'
    $runtimeUiDistPrefix = 'apps/stephanos/dist/'
    $trackedStatus = @(& $GitExecutable -C $RepositoryRoot status '--porcelain=v1' '--untracked-files=no' 2>$null)
    if ($LASTEXITCODE -ne 0) { throw 'Canonical tracked source inspection failed.' }
    $sourceDirt = @()
    foreach ($raw in @($trackedStatus)) {
        $line = [string]$raw
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        if ($line.Length -lt 4) {
            $sourceDirt += $line
            continue
        }
        $status = $line.Substring(0, 2)
        $pathSegment = $line.Substring(3).Trim()
        if ($pathSegment.Contains(' -> ')) {
            $sourceDirt += $line
            continue
        }
        $path = $pathSegment.Trim('"').Replace('\', '/')
        if ($status -eq ' M' -and $path -eq $runtimeMemoryPath) { continue }
        if (($status -eq ' M' -or $status -eq ' D') -and $path.StartsWith($runtimeUiDistPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
        $sourceDirt += $line
    }
    return [pscustomobject]@{
        SourceDirt = @($sourceDirt)
        SourceClean = ($sourceDirt.Count -eq 0)
    }
}

$taskName = 'Stephanos Mission Orchestrator Worker'
if (-not $env:USERPROFILE) {
    throw 'USERPROFILE is required to resolve canonical worker watchdog paths.'
}
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
$workerPath = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot 'scripts\mission-orchestrator-worker-supervised.mjs'))
$workerLauncherPath = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot 'scripts\windows\start-mission-orchestrator-worker.ps1'))
$runtimeRestartPath = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot 'scripts\windows\restart-approved-stephanos-runtime.ps1'))
$windowlessLauncherPath = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot 'scripts\windows\run-stephanos-scheduled-task-windowless.vbs'))
$canonicalGit = 'C:\Program Files\Git\cmd\git.exe'
$canonicalNode = 'C:\Program Files\nodejs\node.exe'
$canonicalPowerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$publicRemote = 'https://github.com/Cheekyfellastef/stephan-os.git'
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'))
$heartbeatPath = Join-Path $workspaceRoot 'status\mission-orchestrator-worker-heartbeat.json'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($Mode -eq 'Inspect' -and -not [string]::IsNullOrWhiteSpace($DeadlineUtc)) {
    throw 'Inspect mode cannot receive restart authority.'
}

function Test-CanonicalWorkerTaskAction {
    param([object]$ScheduledTask)

    if (-not $ScheduledTask) { return $false }
    if ([string]$ScheduledTask.TaskName -ne $taskName) { return $false }
    if ([string]$ScheduledTask.TaskPath -ne '\') { return $false }
    if (-not $ScheduledTask.Actions -or $ScheduledTask.Actions.Count -ne 1) { return $false }

    $action = $ScheduledTask.Actions[0]
    $execute = [string]$action.Execute
    $commandLine = [string]$action.Arguments
    $executeLeaf = [System.IO.Path]::GetFileName($execute)
    if ($executeLeaf -ne 'wscript.exe') { return $false }

    $arguments = @(ConvertFrom-WindowsCommandLine -CommandLine $commandLine)
    if ($arguments.Count -ne 4) { return $false }
    if ([string]$arguments[0] -ne '//B') { return $false }
    if ([string]$arguments[1] -ne '//NoLogo') { return $false }
    try {
        $observedLauncherPath = [System.IO.Path]::GetFullPath([string]$arguments[2])
    }
    catch {
        return $false
    }
    if (-not [string]::Equals($observedLauncherPath, $windowlessLauncherPath, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
    return [string]$arguments[3] -eq 'mission-worker'
}

function ConvertFrom-WindowsCommandLine {
    param([string]$CommandLine)

    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return @() }
    if (-not ('Stephanos.CommandLineNative' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Stephanos {
    public static class CommandLineNative {
        [DllImport("shell32.dll", SetLastError = true)]
        public static extern IntPtr CommandLineToArgvW(
            [MarshalAs(UnmanagedType.LPWStr)] string commandLine,
            out int argumentCount);
        [DllImport("kernel32.dll")]
        public static extern IntPtr LocalFree(IntPtr memory);
    }
}
'@
    }

    $argumentCount = 0
    $argvPointer = [Stephanos.CommandLineNative]::CommandLineToArgvW($CommandLine, [ref]$argumentCount)
    if ($argvPointer -eq [IntPtr]::Zero -or $argumentCount -le 0) { return @() }

    try {
        $arguments = New-Object string[] $argumentCount
        for ($index = 0; $index -lt $argumentCount; $index++) {
            $itemPointer = [Runtime.InteropServices.Marshal]::ReadIntPtr(
                $argvPointer,
                $index * [IntPtr]::Size
            )
            $arguments[$index] = [Runtime.InteropServices.Marshal]::PtrToStringUni($itemPointer)
        }
        return $arguments
    }
    finally {
        [void][Stephanos.CommandLineNative]::LocalFree($argvPointer)
    }
}

function Test-CanonicalWorkerProcessCommandLine {
    param(
        [object]$Process,
        [string]$CommandLine
    )

    if (-not $Process -or [string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
    $arguments = @(ConvertFrom-WindowsCommandLine -CommandLine $CommandLine)
    if ($arguments.Count -ne 2) { return $false }

    if ([string]::IsNullOrWhiteSpace([string]$Process.ExecutablePath)) { return $false }
    try {
        $resolvedExecutePath = [System.IO.Path]::GetFullPath([string]$Process.ExecutablePath)
        $commandExecutable = [System.IO.Path]::GetFullPath([string]$arguments[0])
    }
    catch {
        return $false
    }
    if (-not [string]::Equals($resolvedExecutePath, $canonicalNode, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
    if (-not [string]::Equals($commandExecutable, $canonicalNode, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }

    try {
        $scriptArgument = [System.IO.Path]::GetFullPath([string]$arguments[1])
    }
    catch {
        return $false
    }

    return [string]::Equals(
        $scriptArgument,
        $workerPath,
        [System.StringComparison]::OrdinalIgnoreCase
    )
}

function Read-PublicMainHead {
    param([string]$GitExecutable)

    $output = @(& $GitExecutable 'ls-remote' '--exit-code' $publicRemote 'refs/heads/main' 2>$null)
    if ($LASTEXITCODE -ne 0) {
        throw ('git ls-remote failed: {0}' -f (($output | ForEach-Object { [string]$_ }) -join ' '))
    }
    $matchingLines = @($output | Where-Object { [string]$_ -match '^[0-9a-fA-F]{40}\s+refs/heads/main$' })
    if ($matchingLines.Count -ne 1) {
        throw 'The public main reference did not resolve to exactly one commit.'
    }
    $fields = ([string]$matchingLines[0]).Trim() -split '\s+'
    if ($fields.Count -ne 2 -or $fields[1] -ne 'refs/heads/main' -or $fields[0] -notmatch '^[0-9a-fA-F]{40}$') {
        throw 'The public main reference response is malformed.'
    }
    return $fields[0].ToLowerInvariant()
}

function Test-ExactJsonPropertyEstate {
    param(
        [Parameter(Mandatory = $true)][object]$Record,
        [Parameter(Mandatory = $true)][string[]]$ExpectedProperties
    )
    if (-not $Record -or -not $Record.PSObject) { return $false }
    $actualProperties = @($Record.PSObject.Properties.Name)
    if ($actualProperties.Count -ne $ExpectedProperties.Count) { return $false }
    for ($index = 0; $index -lt $ExpectedProperties.Count; $index += 1) {
        if ([string]$actualProperties[$index] -ne [string]$ExpectedProperties[$index]) { return $false }
    }
    return $true
}

$missionWorkerRestartFailureProperties = @(
    'schemaVersion', 'target', 'expectedHead', 'exactHeadProofOk', 'postStartSourceProofOk',
    'startedWorkerPid', 'workerStartedAtUtc', 'invocationId', 'deadlineUtc', 'invocationBound',
    'canonicalWorkerCommandVerified', 'cleanupAttempted', 'cleanupCompleted', 'unrelatedTasksChanged',
    'arbitraryTaskTargetAllowed', 'arbitraryProcessKillAllowed', 'verifiedOwnedProcessTerminationOnly',
    'liveOpenClawUpdatePerformed', 'ok', 'blocker', 'finalVerdict'
)
$missionWorkerRestartFailureBlockers = @(
    'MISSION_WORKER_RESTART_DEADLINE_EXHAUSTED',
    'MISSION_WORKER_INVOCATION_RECORD_TOO_LARGE',
    'MISSION_WORKER_RESTART_REQUEST_INVALID',
    'MISSION_WORKER_RESTART_REQUEST_ALREADY_PRESENT',
    'MISSION_WORKER_RESTART_REQUEST_CHANGED_BEFORE_RECLAIM',
    'MISSION_WORKER_RESTART_REQUEST_RECLAIM_FAILED',
    'MISSION_WORKER_RESTART_REQUEST_CLEANUP_IDENTITY_CHANGED',
    'MISSION_WORKER_RESTART_REQUEST_CLEANUP_FAILED',
    'MISSION_WORKER_CLEANUP_TASK_NOT_ALLOWLISTED',
    'MISSION_WORKER_CLEANUP_INVOCATION_ID_INVALID',
    'MISSION_WORKER_CLEANUP_INVOCATION_CLAIM_NOT_PROVEN',
    'MISSION_WORKER_CLEANUP_LAUNCH_RECEIPT_NOT_PROVEN',
    'MISSION_WORKER_CLEANUP_LAUNCH_RECEIPT_MISMATCH',
    'MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_NOT_PROVEN',
    'MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_CHANGED',
    'MISSION_WORKER_CLEANUP_PROCESS_DID_NOT_STOP',
    'MISSION_WORKER_CLEANUP_TASK_MISSING',
    'MISSION_WORKER_CLEANUP_TASK_DID_NOT_STOP',
    'MISSION_WORKER_RESTART_DEADLINE_REQUIRED',
    'MISSION_WORKER_RESTART_DEADLINE_INVALID',
    'MISSION_WORKER_TASK_DID_NOT_STOP',
    'MISSION_WORKER_EXISTING_PROCESS_IDENTITY_CHANGED',
    'MISSION_WORKER_EXISTING_PROCESS_CAPABILITY_CHANGED',
    'MISSION_WORKER_VERIFIED_PROCESS_DID_NOT_STOP',
    'MISSION_WORKER_CANONICAL_PROCESS_QUERY_FAILED',
    'MISSION_WORKER_CANONICAL_PROCESS_IDENTITY_AMBIGUOUS',
    'MISSION_WORKER_ORPHAN_PROCESS_IDENTITY_CHANGED',
    'MISSION_WORKER_ORPHAN_PROCESS_CAPABILITY_CHANGED',
    'MISSION_WORKER_ORPHAN_PROCESS_DID_NOT_STOP',
    'MISSION_WORKER_INVOCATION_ID_GENERATION_FAILED',
    'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT',
    'MISSION_WORKER_FRESH_INSTANCE_NOT_PROVEN',
    'MISSION_WORKER_INVOCATION_IDENTITY_NOT_PROVEN',
    'MISSION_WORKER_TASK_NOT_RUNNING_AFTER_START',
    'MISSION_WORKER_POST_START_PROOF_FAILED',
    'MISSION_WORKER_POST_START_CLEANUP_FAILED',
    'MISSION_WORKER_DEADLINE_SELF_CLEANUP_NOT_PROVEN'
)

function Read-ValidatedMissionWorkerRestartFailureBlocker {
    param(
        [Parameter(Mandatory = $true)][object[]]$Output,
        [Parameter(Mandatory = $true)][string]$ExpectedHead,
        [Parameter(Mandatory = $true)][string]$ExpectedDeadlineUtc
    )

    $restartJson = ($Output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
    $restartBytes = [Text.Encoding]::UTF8.GetByteCount($restartJson)
    if ($restartBytes -le 0 -or $restartBytes -gt 8192) { return '' }
    try { $receipt = $restartJson | ConvertFrom-Json }
    catch { return '' }

    if (-not (Test-ExactJsonPropertyEstate -Record $receipt -ExpectedProperties $missionWorkerRestartFailureProperties)) { return '' }
    if ([string]$receipt.schemaVersion -ne 'stephanos.approved-runtime-restart.v1' `
        -or [string]$receipt.target -ne 'mission-worker' `
        -or [string]$receipt.expectedHead -ne $ExpectedHead `
        -or [string]$receipt.deadlineUtc -ne $ExpectedDeadlineUtc `
        -or -not ($receipt.exactHeadProofOk -is [bool]) -or $receipt.exactHeadProofOk -ne $false `
        -or -not ($receipt.postStartSourceProofOk -is [bool]) -or $receipt.postStartSourceProofOk -ne $false `
        -or -not ($receipt.invocationBound -is [bool]) `
        -or -not ($receipt.canonicalWorkerCommandVerified -is [bool]) `
        -or -not ($receipt.cleanupAttempted -is [bool]) `
        -or -not ($receipt.cleanupCompleted -is [bool]) `
        -or -not ($receipt.unrelatedTasksChanged -is [bool]) -or $receipt.unrelatedTasksChanged -ne $false `
        -or -not ($receipt.arbitraryTaskTargetAllowed -is [bool]) -or $receipt.arbitraryTaskTargetAllowed -ne $false `
        -or -not ($receipt.arbitraryProcessKillAllowed -is [bool]) -or $receipt.arbitraryProcessKillAllowed -ne $false `
        -or -not ($receipt.verifiedOwnedProcessTerminationOnly -is [bool]) -or $receipt.verifiedOwnedProcessTerminationOnly -ne $true `
        -or -not ($receipt.liveOpenClawUpdatePerformed -is [bool]) -or $receipt.liveOpenClawUpdatePerformed -ne $false `
        -or -not ($receipt.ok -is [bool]) -or $receipt.ok -ne $false `
        -or [string]$receipt.finalVerdict -ne 'APPROVED_RUNTIME_RESTART_BLOCKED') {
        return ''
    }

    $failurePid = 0
    if (-not [int]::TryParse([string]$receipt.startedWorkerPid, [ref]$failurePid) -or $failurePid -lt 0) { return '' }
    $failureInvocationId = [string]$receipt.invocationId
    if ($failureInvocationId -and $failureInvocationId -notmatch '^[0-9a-f]{64}$') { return '' }
    $failureStartedAtUtc = [string]$receipt.workerStartedAtUtc
    if ($failureStartedAtUtc) {
        $parsedFailureStartedAtUtc = [datetime]::MinValue
        if (-not [datetime]::TryParse($failureStartedAtUtc, [ref]$parsedFailureStartedAtUtc)) { return '' }
    }

    $blocker = [string]$receipt.blocker
    if ($missionWorkerRestartFailureBlockers -notcontains $blocker) { return '' }
    return $blocker
}

function Get-VerifiedWorkerLaunchIdentity {
    param(
        [object]$Heartbeat,
        [object]$Process,
        [bool]$CommandLineMatchesCanonicalWorker
    )

    if (-not $Heartbeat -or -not $Process -or -not $CommandLineMatchesCanonicalWorker) { return $null }
    try {
        $launchIdentityId = [string]$Heartbeat.launchIdentityId
        if ($launchIdentityId -notmatch '^[0-9a-f]{64}$') { return $null }
        $heartbeatTimestampUtc = [datetime]::Parse([string]$Heartbeat.timestampUtc).ToUniversalTime()
        $heartbeatWorkerStartedAtUtc = [datetime]::Parse([string]$Heartbeat.workerStartedAtUtc).ToUniversalTime()
        $processStartedAtUtc = ([datetime]$Process.CreationDate).ToUniversalTime()
        if ($heartbeatWorkerStartedAtUtc.Ticks -ne $processStartedAtUtc.Ticks `
            -or $heartbeatTimestampUtc -le $processStartedAtUtc `
            -or $heartbeatTimestampUtc -gt [datetime]::UtcNow) { return $null }

        $launchReceiptPath = Join-Path (Split-Path -Parent $heartbeatPath) "mission-orchestrator-worker-launch-identity-$launchIdentityId.json"
        if (-not (Test-Path -LiteralPath $launchReceiptPath -PathType Leaf)) { return $null }
        $launchReceiptItem = Get-Item -LiteralPath $launchReceiptPath -Force
        if ($launchReceiptItem.PSIsContainer `
            -or $launchReceiptItem.LinkType `
            -or (($launchReceiptItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) `
            -or $launchReceiptItem.Length -le 0 `
            -or $launchReceiptItem.Length -gt 8192) { return $null }
        $launchReceiptRaw = Get-Content -LiteralPath $launchReceiptPath -Raw
        if ([Text.Encoding]::UTF8.GetByteCount($launchReceiptRaw) -gt 8192) { return $null }
        $launchReceipt = $launchReceiptRaw | ConvertFrom-Json
        $expectedLaunchReceiptProperties = @(
            'schemaVersion', 'launchIdentityId', 'launchKind', 'restartInvocationId', 'taskName',
            'repositoryRoot', 'branch', 'headSha', 'workerPid', 'workerStartedAtUtc',
            'canonicalNode', 'canonicalWorkerScript', 'createdAtUtc'
        )
        if (-not (Test-ExactJsonPropertyEstate -Record $launchReceipt -ExpectedProperties $expectedLaunchReceiptProperties)) { return $null }
        if ([string]$launchReceipt.schemaVersion -ne 'stephanos.mission-worker-launch-identity.v1' `
            -or [string]$launchReceipt.launchIdentityId -ne $launchIdentityId `
            -or [string]$launchReceipt.taskName -ne $taskName `
            -or [string]$launchReceipt.repositoryRoot -ne $repositoryRoot `
            -or [string]$launchReceipt.branch -ne 'main' `
            -or [string]$launchReceipt.headSha -ne [string]$Heartbeat.headSha `
            -or [int]$launchReceipt.workerPid -ne [int]$Process.ProcessId `
            -or -not [string]::Equals([string]$launchReceipt.canonicalNode, $canonicalNode, [System.StringComparison]::OrdinalIgnoreCase) `
            -or -not [string]::Equals([System.IO.Path]::GetFullPath([string]$launchReceipt.canonicalWorkerScript), $workerPath, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $null
        }
        if ([string]$launchReceipt.launchKind -eq 'guarded-restart') {
            if ([string]$launchReceipt.restartInvocationId -ne $launchIdentityId) { return $null }
        }
        elseif ([string]$launchReceipt.launchKind -eq 'ordinary') {
            if (-not [string]::IsNullOrEmpty([string]$launchReceipt.restartInvocationId)) { return $null }
        }
        else { return $null }

        $receiptWorkerStartedAtUtc = [datetime]::Parse([string]$launchReceipt.workerStartedAtUtc).ToUniversalTime()
        $receiptCreatedAtUtc = [datetime]::Parse([string]$launchReceipt.createdAtUtc).ToUniversalTime()
        if ($receiptWorkerStartedAtUtc.Ticks -ne $processStartedAtUtc.Ticks `
            -or $receiptCreatedAtUtc -lt $processStartedAtUtc `
            -or $receiptCreatedAtUtc -gt $heartbeatTimestampUtc) { return $null }
        return [PSCustomObject]@{
            LaunchIdentityId = $launchIdentityId
            WorkerStartedAtUtc = $processStartedAtUtc
            LaunchReceiptPath = $launchReceiptPath
            Verified = $true
        }
    }
    catch { return $null }
}

$taskActionMatchesCanonicalWorker = Test-CanonicalWorkerTaskAction -ScheduledTask $task

$repositoryBranch = ''
$repositoryHead = ''
$repositoryTrackedClean = $false
$repositoryHeadReadError = ''
$remoteMainHead = ''
$remoteMainHeadReadError = ''
$gitAvailable = $false
try {
    foreach ($requiredExecutable in @($canonicalGit, $canonicalNode, $canonicalPowerShell)) {
        if (-not (Test-Path -LiteralPath $requiredExecutable -PathType Leaf)) {
            throw ('Required canonical executable is missing: {0}' -f $requiredExecutable)
        }
    }
    $gitAvailable = $true
    $repositoryBranchOutput = @(& $canonicalGit -C $repositoryRoot symbolic-ref --quiet --short HEAD 2>$null)
    if ($LASTEXITCODE -ne 0) {
        throw ('git symbolic-ref failed: {0}' -f (($repositoryBranchOutput | ForEach-Object { [string]$_ }) -join ' '))
    }
    $repositoryBranch = ([string]$repositoryBranchOutput[0]).Trim()
    $repositoryHeadOutput = @(& $canonicalGit -C $repositoryRoot rev-parse --verify HEAD 2>$null)
    if ($LASTEXITCODE -ne 0) {
        throw ('git rev-parse failed: {0}' -f (($repositoryHeadOutput | ForEach-Object { [string]$_ }) -join ' '))
    }
    $repositoryHead = ([string]$repositoryHeadOutput[0]).Trim().ToLowerInvariant()
    if ($repositoryBranch -ne 'main' -or $repositoryHead -notmatch '^[0-9a-f]{40}$') {
        throw 'Canonical repository branch/head proof is invalid.'
    }
    $sourceAssessment = Get-CanonicalTrackedSourceAssessment -GitExecutable $canonicalGit -RepositoryRoot $repositoryRoot
    if (-not $sourceAssessment.SourceClean) {
        throw 'Canonical repository tracked source is dirty.'
    }
    $repositoryTrackedClean = $true
}
catch {
    $repositoryBranch = ''
    $repositoryHead = ''
    $repositoryTrackedClean = $false
    $repositoryHeadReadError = $_.Exception.Message
}
if ($gitAvailable) {
    try {
        $remoteMainHead = Read-PublicMainHead -GitExecutable $canonicalGit
    }
    catch {
        $remoteMainHead = ''
        $remoteMainHeadReadError = $_.Exception.Message
    }
}

if ($Mode -eq 'StartApprovedWorkerTask') {
    $parsedDeadlineUtc = [datetime]::MinValue
    if (-not [datetime]::TryParse($DeadlineUtc, [ref]$parsedDeadlineUtc)) {
        throw 'The worker restart deadline is missing or malformed.'
    }
    $parsedDeadlineUtc = $parsedDeadlineUtc.ToUniversalTime()
    if ($parsedDeadlineUtc -le [datetime]::UtcNow -or $parsedDeadlineUtc -gt [datetime]::UtcNow.AddSeconds(95)) {
        throw 'The worker restart deadline is outside the bounded watchdog window.'
    }
    $canonicalDeadlineUtc = $parsedDeadlineUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    if (-not $task -or [string]$task.TaskName -ne $taskName) {
        throw 'The fixed Mission Orchestrator worker task is not installed.'
    }
    if (-not $taskActionMatchesCanonicalWorker) {
        throw 'The fixed Mission Orchestrator worker task action is not canonical.'
    }
    if ($repositoryBranch -ne 'main' -or $repositoryHead -notmatch '^[0-9a-f]{40}$' `
        -or -not $repositoryTrackedClean `
        -or $remoteMainHead -notmatch '^[0-9a-f]{40}$' -or $repositoryHead -ne $remoteMainHead) {
        throw 'The canonical repository head is not proven as exact current public main for fixed worker restart.'
    }
    if (-not (Test-Path -LiteralPath $runtimeRestartPath -PathType Leaf)) {
        throw 'The approved runtime restart adapter is missing.'
    }
    $restartArguments = @(
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        $runtimeRestartPath,
        '-Target',
        'mission-worker',
        '-ExpectedHead',
        $repositoryHead,
        '-TimeoutSeconds',
        '30',
        '-DeadlineUtc',
        $canonicalDeadlineUtc
    )
    $restartStartedAtUtc = [datetime]::UtcNow
    $restartOutput = @(& $canonicalPowerShell @restartArguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        $typedRestartBlocker = Read-ValidatedMissionWorkerRestartFailureBlocker `
            -Output $restartOutput `
            -ExpectedHead $repositoryHead `
            -ExpectedDeadlineUtc $canonicalDeadlineUtc
        if ($typedRestartBlocker) { throw $typedRestartBlocker }
        throw 'The approved runtime restart adapter failed.'
    }
    $restartJson = ($restartOutput | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
    $restartReceipt = $restartJson | ConvertFrom-Json
    $restartStartedWorkerPid = 0
    $restartWorkerStartedAtUtc = [datetime]::MinValue
    $restartWorkerPidValid = [int]::TryParse([string]$restartReceipt.startedWorkerPid, [ref]$restartStartedWorkerPid)
    $restartWorkerStartedAtValid = [datetime]::TryParse([string]$restartReceipt.workerStartedAtUtc, [ref]$restartWorkerStartedAtUtc)
    $restartReceiptValid = (
        $restartReceipt -and
        [string]$restartReceipt.schemaVersion -eq 'stephanos.approved-runtime-restart.v1' -and
        [string]$restartReceipt.target -eq 'mission-worker' -and
        [string]$restartReceipt.taskName -eq $taskName -and
        [string]$restartReceipt.expectedHead -eq $repositoryHead -and
        [string]$restartReceipt.sourceHead -eq $repositoryHead -and
        [string]$restartReceipt.publicMainHead -eq $repositoryHead -and
        [string]$restartReceipt.deadlineUtc -eq $canonicalDeadlineUtc -and
        [string]$restartReceipt.invocationId -match '^[0-9a-f]{64}$' -and
        $restartReceipt.invocationBound -eq $true -and
        $restartReceipt.canonicalWorkerCommandVerified -eq $true -and
        $restartReceipt.canonicalActionVerified -eq $true -and
        $restartReceipt.exactHeadProofOk -eq $true -and
        $restartReceipt.postStartSourceProofOk -eq $true -and
        $restartReceipt.sourceTrackedClean -eq $true -and
        $restartReceipt.proofFresh -eq $true -and
        $restartWorkerPidValid -and
        $restartStartedWorkerPid -gt 0 -and
        $restartWorkerStartedAtValid -and
        $restartWorkerStartedAtUtc.ToUniversalTime() -ge $restartStartedAtUtc -and
        $restartReceipt.cleanupAttempted -eq $false -and
        $restartReceipt.cleanupCompleted -eq $false -and
        $restartReceipt.ok -eq $true -and
        [string]$restartReceipt.finalVerdict -eq 'APPROVED_RUNTIME_RESTART_PASS'
    )
    if (-not $restartReceiptValid) {
        throw 'The approved runtime restart receipt is invalid.'
    }
    [pscustomobject]@{
        mode = $Mode
        taskName = $taskName
        taskActionMatchesCanonicalWorker = $true
        started = $true
        restarted = $true
        sourceHead = $repositoryHead
        remoteMainHead = [string]$restartReceipt.publicMainHead
        exactHeadProofOk = $true
        sourceTrackedClean = $true
        proofFresh = $true
        startedWorkerPid = $restartStartedWorkerPid
        workerStartedAtUtc = $restartWorkerStartedAtUtc.ToUniversalTime().ToString('o')
        invocationId = [string]$restartReceipt.invocationId
        deadlineUtc = [string]$restartReceipt.deadlineUtc
        invocationBound = $true
        canonicalWorkerCommandVerified = $true
        postStartSourceProofOk = $true
        cleanupAttempted = $false
        cleanupCompleted = $false
        terminatedVerifiedOwnedProcess = [bool]$restartReceipt.terminatedVerifiedOwnedProcess
        verifiedOwnedProcessTerminationOnly = $true
        restartVerdict = [string]$restartReceipt.finalVerdict
        arbitraryTaskNameAllowed = $false
        arbitraryProcessKillAllowed = $false
        arbitraryPowerShellAllowed = $false
        visiblePowerShellRequired = $false
    } | ConvertTo-Json -Depth 5
    exit 0
}

$heartbeat = $null
$heartbeatReadError = ''
if (Test-Path -LiteralPath $heartbeatPath -PathType Leaf) {
    try {
        $heartbeat = Get-Content -LiteralPath $heartbeatPath -Raw | ConvertFrom-Json
    }
    catch {
        $heartbeatReadError = $_.Exception.Message
    }
}

$heartbeatPid = 0
if ($heartbeat -and $null -ne $heartbeat.pid) {
    [void][int]::TryParse([string]$heartbeat.pid, [ref]$heartbeatPid)
}
$workerProcess = $null
if ($heartbeatPid -gt 0) {
    $workerProcess = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $heartbeatPid) -ErrorAction SilentlyContinue
}
$commandLine = if ($workerProcess) { [string]$workerProcess.CommandLine } else { '' }
$commandLineMatchesCanonicalWorker = Test-CanonicalWorkerProcessCommandLine `
    -Process $workerProcess `
    -CommandLine $commandLine
$launchIdentity = Get-VerifiedWorkerLaunchIdentity `
    -Heartbeat $heartbeat `
    -Process $workerProcess `
    -CommandLineMatchesCanonicalWorker $commandLineMatchesCanonicalWorker
$workerProcessStartedAtUtc = ''
if ($workerProcess) {
    try { $workerProcessStartedAtUtc = ([datetime]$workerProcess.CreationDate).ToUniversalTime().ToString('o') }
    catch { $workerProcessStartedAtUtc = '' }
}

[pscustomobject]@{
    scheduledTask = [pscustomobject]@{
        taskName = if ($task) { [string]$task.TaskName } else { '' }
        taskPath = if ($task) { [string]$task.TaskPath } else { '' }
        status = if ($task) { [string]$task.State } else { 'Missing' }
        actionMatchesCanonicalWorker = [bool]$taskActionMatchesCanonicalWorker
    }
    repository = [pscustomobject]@{
        repositoryRoot = $repositoryRoot
        branch = $repositoryBranch
        headSha = $repositoryHead
        remoteMainHeadSha = $remoteMainHead
        trackedClean = [bool]$repositoryTrackedClean
        headMatchesRemoteMain = (
            $repositoryHead -match '^[0-9a-f]{40}$' -and
            $remoteMainHead -match '^[0-9a-f]{40}$' -and
            $repositoryHead -eq $remoteMainHead
        )
        headProven = (-not [string]::IsNullOrWhiteSpace($repositoryHead))
        headReadError = $repositoryHeadReadError
        remoteMainHeadReadError = $remoteMainHeadReadError
    }
    process = [pscustomobject]@{
        running = [bool]$workerProcess
        taskName = if ($commandLineMatchesCanonicalWorker) { $taskName } else { '' }
        pid = if ($workerProcess) { [int]$workerProcess.ProcessId } else { 0 }
        commandLineMatchesCanonicalWorker = [bool]$commandLineMatchesCanonicalWorker
        startedAtUtc = $workerProcessStartedAtUtc
        launchIdentityId = if ($launchIdentity) { [string]$launchIdentity.LaunchIdentityId } else { '' }
        launchIdentityVerified = [bool]$launchIdentity
    }
    heartbeat = if ($heartbeat) {
        [pscustomobject]@{
            timestampUtc = [string]$heartbeat.timestampUtc
            repositoryRoot = [string]$heartbeat.repositoryRoot
            branch = [string]$heartbeat.branch
            headSha = [string]$heartbeat.headSha
            taskName = [string]$heartbeat.taskName
            pid = [int]$heartbeat.pid
            launchIdentityId = if ($heartbeat.PSObject.Properties['launchIdentityId']) { [string]$heartbeat.launchIdentityId } else { '' }
            workerStartedAtUtc = if ($heartbeat.PSObject.Properties['workerStartedAtUtc']) { [string]$heartbeat.workerStartedAtUtc } else { '' }
            lastTickVerdict = [string]$heartbeat.lastTickVerdict
        }
    } else {
        [pscustomobject]@{
            timestampUtc = ''
            repositoryRoot = ''
            branch = ''
            headSha = ''
            taskName = ''
            pid = 0
            launchIdentityId = ''
            workerStartedAtUtc = ''
            lastTickVerdict = ''
        }
    }
    heartbeatPath = $heartbeatPath
    heartbeatPresent = Test-Path -LiteralPath $heartbeatPath -PathType Leaf
    heartbeatReadError = $heartbeatReadError
    arbitraryTaskNameAllowed = $false
    arbitraryPowerShellAllowed = $false
    visiblePowerShellRequired = $false
} | ConvertTo-Json -Depth 8