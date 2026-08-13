[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('backend', 'mission-worker')]
    [string]$Target,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$ExpectedHead,

    [ValidateRange(15, 180)]
    [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

$canonicalGit = 'C:\Program Files\Git\cmd\git.exe'
$publicRemote = 'https://github.com/Cheekyfellastef/stephan-os.git'
$cleanupAttempted = $false
$cleanupCompleted = $false
$startedWorkerPid = 0
$workerStartedAtUtc = ''
$postStartSourceProofOk = $false
$missionWorkerStopTimeoutSeconds = 15
$missionWorkerCleanupTimeoutSeconds = 10

function Stop-WithBlocker {
    param([Parameter(Mandatory = $true)][string]$Code)
    throw $Code
}

function Get-CanonicalTaskPlan {
    param([Parameter(Mandatory = $true)][string]$Id)
    switch ($Id) {
        'backend' {
            return [PSCustomObject]@{
                Target = 'backend'
                TaskName = 'Stephanos Battle Bridge Backend'
                Role = 'backend'
            }
        }
        'mission-worker' {
            return [PSCustomObject]@{
                Target = 'mission-worker'
                TaskName = 'Stephanos Mission Orchestrator Worker'
                Role = 'mission-worker'
            }
        }
        default { Stop-WithBlocker 'TARGET_NOT_ALLOWLISTED' }
    }
}

function Wait-Until {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Condition,
        [Parameter(Mandatory = $true)][int]$Seconds
    )
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        if (& $Condition) { return $true }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Read-PublicMainHead {
    param([Parameter(Mandatory = $true)][string]$GitExecutable)

    $output = @(& $GitExecutable 'ls-remote' '--exit-code' $publicRemote 'refs/heads/main' 2>&1)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { Stop-WithBlocker 'CANONICAL_PUBLIC_MAIN_READ_FAILED' }
    $matchingLines = @($output | Where-Object { [string]$_ -match '^[0-9a-fA-F]{40}\s+refs/heads/main$' })
    if ($matchingLines.Count -ne 1) { Stop-WithBlocker 'CANONICAL_PUBLIC_MAIN_RESPONSE_INVALID' }
    $fields = ([string]$matchingLines[0]).Trim() -split '\s+'
    if ($fields.Count -ne 2 -or $fields[1] -ne 'refs/heads/main' -or $fields[0] -notmatch '^[0-9a-fA-F]{40}$') {
        Stop-WithBlocker 'CANONICAL_PUBLIC_MAIN_RESPONSE_INVALID'
    }
    return $fields[0].ToLowerInvariant()
}

function Read-CanonicalWorkerSourceProof {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$GitExecutable,
        [Parameter(Mandatory = $true)][string]$ExpectedSourceHead,
        [Parameter(Mandatory = $true)][ValidateSet('PRE_START', 'POST_START')][string]$Phase
    )

    $branchOutput = @(& $GitExecutable -C $RepositoryRoot symbolic-ref --quiet --short HEAD 2>&1)
    $branchExitCode = $LASTEXITCODE
    if ($branchExitCode -ne 0 -or $branchOutput.Count -ne 1) {
        if ($Phase -eq 'POST_START') { Stop-WithBlocker 'CANONICAL_BRANCH_CHANGED_DURING_WORKER_START' }
        Stop-WithBlocker 'CANONICAL_MAIN_REQUIRED'
    }
    $branch = ([string]$branchOutput[0]).Trim()
    if ($branch -ne 'main') {
        if ($Phase -eq 'POST_START') { Stop-WithBlocker 'CANONICAL_BRANCH_CHANGED_DURING_WORKER_START' }
        Stop-WithBlocker 'CANONICAL_MAIN_REQUIRED'
    }

    $headOutput = @(& $GitExecutable -C $RepositoryRoot rev-parse --verify HEAD 2>&1)
    $headExitCode = $LASTEXITCODE
    if ($headExitCode -ne 0 -or $headOutput.Count -ne 1) {
        if ($Phase -eq 'POST_START') { Stop-WithBlocker 'CANONICAL_HEAD_CHANGED_DURING_WORKER_START' }
        Stop-WithBlocker 'EXPECTED_HEAD_MISMATCH'
    }
    $head = ([string]$headOutput[0]).Trim().ToLowerInvariant()
    if ($head -notmatch '^[0-9a-f]{40}$' -or $head -ne $ExpectedSourceHead) {
        if ($Phase -eq 'POST_START') { Stop-WithBlocker 'CANONICAL_HEAD_CHANGED_DURING_WORKER_START' }
        Stop-WithBlocker 'EXPECTED_HEAD_MISMATCH'
    }

    $trackedStatus = @(& $GitExecutable -C $RepositoryRoot status '--porcelain=v1' '--untracked-files=no' 2>&1)
    $trackedStatusExitCode = $LASTEXITCODE
    if ($trackedStatusExitCode -ne 0 -or $trackedStatus.Count -ne 0) {
        if ($Phase -eq 'POST_START') { Stop-WithBlocker 'CANONICAL_TRACKED_SOURCE_CHANGED_DURING_WORKER_START' }
        Stop-WithBlocker 'CANONICAL_TRACKED_SOURCE_DIRTY'
    }

    $publicMainHead = Read-PublicMainHead -GitExecutable $GitExecutable
    if ($publicMainHead -ne $ExpectedSourceHead) {
        if ($Phase -eq 'POST_START') { Stop-WithBlocker 'CANONICAL_PUBLIC_MAIN_CHANGED_DURING_WORKER_START' }
        Stop-WithBlocker 'EXPECTED_HEAD_NOT_PUBLIC_MAIN'
    }

    return [PSCustomObject]@{
        Branch = $branch
        Head = $head
        PublicMainHead = $publicMainHead
        TrackedClean = $true
    }
}

function Test-BackendHealth {
    try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8787/api/health' -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -ne 200) { return $null }
        $payload = $response.Content | ConvertFrom-Json
        if ($payload.service -ne 'stephanos-server') { return $null }
        return $payload
    }
    catch { return $null }
}

function Get-VerifiedBackendListener {
    $connections = @(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)
    $processIds = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($processIds.Count -eq 0) { return $null }
    if ($processIds.Count -ne 1) { Stop-WithBlocker 'BACKEND_LISTENER_IDENTITY_AMBIGUOUS' }
    $processId = [int]$processIds[0]
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    if (-not $process) { Stop-WithBlocker 'BACKEND_LISTENER_PROCESS_MISSING' }
    $name = ([string]$process.Name).ToLowerInvariant()
    $commandLine = ([string]$process.CommandLine).Replace('\', '/').ToLowerInvariant()
    if ($name -notin @('node.exe', 'node')) { Stop-WithBlocker 'BACKEND_LISTENER_NOT_NODE' }
    if (-not $commandLine.Contains('stephanos-server/server.js')) { Stop-WithBlocker 'BACKEND_LISTENER_COMMAND_NOT_ALLOWLISTED' }
    return [PSCustomObject]@{ ProcessId = $processId }
}

function Read-FreshBackendReceipt {
    param(
        [string]$ReceiptPath,
        [datetime]$StartedAfterUtc,
        [string]$ExpectedSourceHead
    )
    if (-not (Test-Path -LiteralPath $ReceiptPath -PathType Leaf)) { return $null }
    try {
        $receipt = Get-Content -LiteralPath $ReceiptPath -Raw | ConvertFrom-Json
        $timestamp = [datetime]::Parse([string]$receipt.timestampUtc).ToUniversalTime()
        if ($timestamp -le $StartedAfterUtc) { return $null }
        if ([string]$receipt.branch -ne 'main') { return $null }
        if ([string]$receipt.headSha -ne $ExpectedSourceHead) { return $null }
        if ([string]$receipt.taskName -ne 'Stephanos Battle Bridge Backend') { return $null }
        $processId = [int]$receipt.pid
        if ($processId -le 0) { return $null }
        $listener = Get-VerifiedBackendListener
        if (-not $listener -or $listener.ProcessId -ne $processId) { return $null }
        return $receipt
    }
    catch { return $null }
}

function Get-VerifiedWorkerProcessFromHeartbeat {
    param(
        [string]$HeartbeatPath,
        [string]$ExpectedRepoRoot
    )
    if (-not (Test-Path -LiteralPath $HeartbeatPath -PathType Leaf)) { return $null }
    try {
        $heartbeat = Get-Content -LiteralPath $HeartbeatPath -Raw | ConvertFrom-Json
        if ([string]$heartbeat.taskName -ne 'Stephanos Mission Orchestrator Worker') { return $null }
        if ([string]$heartbeat.repositoryRoot -ne $ExpectedRepoRoot) { return $null }
        $processId = [int]$heartbeat.pid
        if ($processId -le 0) { return $null }
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
        if (-not $process) { return $null }
        $name = ([string]$process.Name).ToLowerInvariant()
        $commandLine = ([string]$process.CommandLine).Replace('\', '/').ToLowerInvariant()
        $expectedWorkerPath = ([System.IO.Path]::GetFullPath((Join-Path $ExpectedRepoRoot 'scripts\mission-orchestrator-worker-supervised.mjs'))).Replace('\', '/').ToLowerInvariant()
        if ($name -notin @('node.exe', 'node') -or -not $commandLine.Contains($expectedWorkerPath)) { return $null }
        return [PSCustomObject]@{ ProcessId = $processId }
    }
    catch { return $null }
}

function Get-VerifiedFreshWorkerInstance {
    param(
        [string]$HeartbeatPath,
        [datetime]$StartedAfterUtc,
        [string]$ExpectedSourceHead,
        [string]$ExpectedRepoRoot
    )
    if (-not (Test-Path -LiteralPath $HeartbeatPath -PathType Leaf)) { return $null }
    try {
        $heartbeat = Get-Content -LiteralPath $HeartbeatPath -Raw | ConvertFrom-Json
        $timestamp = [datetime]::Parse([string]$heartbeat.timestampUtc).ToUniversalTime()
        if ($timestamp -le $StartedAfterUtc) { return $null }
        if ([string]$heartbeat.branch -ne 'main') { return $null }
        if ([string]$heartbeat.headSha -ne $ExpectedSourceHead) { return $null }
        if ([string]$heartbeat.taskName -ne 'Stephanos Mission Orchestrator Worker') { return $null }
        if ([string]$heartbeat.repositoryRoot -ne $ExpectedRepoRoot) { return $null }
        $processId = [int]$heartbeat.pid
        if ($processId -le 0) { return $null }
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
        if (-not $process) { return $null }
        $processStartedAtUtc = ([datetime]$process.CreationDate).ToUniversalTime()
        if ($processStartedAtUtc -le $StartedAfterUtc) { return $null }
        $name = ([string]$process.Name).ToLowerInvariant()
        $commandLine = ([string]$process.CommandLine).Replace('\', '/').ToLowerInvariant()
        $expectedWorkerPath = ([System.IO.Path]::GetFullPath((Join-Path $ExpectedRepoRoot 'scripts\mission-orchestrator-worker-supervised.mjs'))).Replace('\', '/').ToLowerInvariant()
        if ($name -notin @('node.exe', 'node') -or -not $commandLine.Contains($expectedWorkerPath)) { return $null }
        return [PSCustomObject]@{
            ProcessId = $processId
            ProcessStartedAtUtc = $processStartedAtUtc
            HeartbeatTimestampUtc = $timestamp
            Heartbeat = $heartbeat
        }
    }
    catch { return $null }
}

function Stop-NewlyStartedOwnedWorker {
    param(
        [Parameter(Mandatory = $true)][object]$Plan,
        [Parameter(Mandatory = $true)][string]$HeartbeatPath,
        [Parameter(Mandatory = $true)][datetime]$StartedAfterUtc,
        [Parameter(Mandatory = $true)][string]$ExpectedSourceHead,
        [Parameter(Mandatory = $true)][string]$ExpectedRepoRoot,
        [int]$ExpectedProcessId = 0
    )

    if ([string]$Plan.TaskName -ne 'Stephanos Mission Orchestrator Worker') {
        Stop-WithBlocker 'MISSION_WORKER_CLEANUP_TASK_NOT_ALLOWLISTED'
    }
    $script:cleanupAttempted = $true
    $verifiedWorker = $null
    $cleanupProcessBlocker = ''
    if ($ExpectedProcessId -gt 0) {
        $observedProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $ExpectedProcessId" -ErrorAction SilentlyContinue
        if ($observedProcess) {
            $verifiedWorker = Get-VerifiedFreshWorkerInstance `
                -HeartbeatPath $HeartbeatPath `
                -StartedAfterUtc $StartedAfterUtc `
                -ExpectedSourceHead $ExpectedSourceHead `
                -ExpectedRepoRoot $ExpectedRepoRoot
            if (-not $verifiedWorker -or $verifiedWorker.ProcessId -ne $ExpectedProcessId) {
                $verifiedWorker = $null
                $cleanupProcessBlocker = 'MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_NOT_PROVEN'
            }
        }
    }
    $cleanupTask = Get-ScheduledTask -TaskName $Plan.TaskName -TaskPath '\' -ErrorAction SilentlyContinue
    if (-not $cleanupTask) { Stop-WithBlocker 'MISSION_WORKER_CLEANUP_TASK_MISSING' }
    if ([string]$cleanupTask.State -eq 'Running') {
        Stop-ScheduledTask -TaskName $Plan.TaskName -TaskPath '\' -ErrorAction Stop
        if (-not (Wait-Until -Seconds $missionWorkerCleanupTimeoutSeconds -Condition {
            [string](Get-ScheduledTask -TaskName $Plan.TaskName -TaskPath '\').State -ne 'Running'
        })) { Stop-WithBlocker 'MISSION_WORKER_CLEANUP_TASK_DID_NOT_STOP' }
    }
    if ($cleanupProcessBlocker) { Stop-WithBlocker $cleanupProcessBlocker }

    if ($verifiedWorker) {
        $stillRunning = Get-CimInstance Win32_Process -Filter "ProcessId = $($verifiedWorker.ProcessId)" -ErrorAction SilentlyContinue
        if ($stillRunning) {
            $reverifiedWorker = Get-VerifiedFreshWorkerInstance `
                -HeartbeatPath $HeartbeatPath `
                -StartedAfterUtc $StartedAfterUtc `
                -ExpectedSourceHead $ExpectedSourceHead `
                -ExpectedRepoRoot $ExpectedRepoRoot
            if (-not $reverifiedWorker -or $reverifiedWorker.ProcessId -ne $verifiedWorker.ProcessId) {
                Stop-WithBlocker 'MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_CHANGED'
            }
            Stop-Process -Id $verifiedWorker.ProcessId -Force -ErrorAction Stop
            if (-not (Wait-Until -Seconds $missionWorkerCleanupTimeoutSeconds -Condition {
                -not (Get-CimInstance Win32_Process -Filter "ProcessId = $($verifiedWorker.ProcessId)" -ErrorAction SilentlyContinue)
            })) { Stop-WithBlocker 'MISSION_WORKER_CLEANUP_PROCESS_DID_NOT_STOP' }
        }
    }
    $script:cleanupCompleted = $true
}

try {
    if (-not $env:USERPROFILE) { Stop-WithBlocker 'USERPROFILE_REQUIRED' }
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $repoRoot = [System.IO.Path]::GetFullPath((Resolve-Path (Join-Path $scriptDir '..\..')).Path)
    $expectedRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
    if ($repoRoot -ne $expectedRepoRoot) { Stop-WithBlocker 'NON_CANONICAL_REPOSITORY_PATH' }

    if (-not (Test-Path -LiteralPath $canonicalGit -PathType Leaf)) { Stop-WithBlocker 'CANONICAL_GIT_MISSING' }
    $canonicalGitItem = Get-Item -LiteralPath $canonicalGit -Force
    if ($canonicalGitItem.PSIsContainer `
        -or $canonicalGitItem.LinkType `
        -or (($canonicalGitItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
        Stop-WithBlocker 'CANONICAL_GIT_IDENTITY_INVALID'
    }
    $resolvedCanonicalGit = [System.IO.Path]::GetFullPath($canonicalGitItem.FullName)
    if (-not [string]::Equals($resolvedCanonicalGit, $canonicalGit, [System.StringComparison]::OrdinalIgnoreCase)) {
        Stop-WithBlocker 'CANONICAL_GIT_PATH_MISMATCH'
    }
    $branchOutput = @(& $canonicalGit -C $repoRoot symbolic-ref --quiet --short HEAD 2>&1)
    $branchExitCode = $LASTEXITCODE
    if ($branchExitCode -ne 0 -or $branchOutput.Count -ne 1) { Stop-WithBlocker 'CANONICAL_MAIN_REQUIRED' }
    $branch = ([string]$branchOutput[0]).Trim()
    $headOutput = @(& $canonicalGit -C $repoRoot rev-parse --verify HEAD 2>&1)
    $headExitCode = $LASTEXITCODE
    if ($headExitCode -ne 0 -or $headOutput.Count -ne 1) { Stop-WithBlocker 'EXPECTED_HEAD_MISMATCH' }
    $head = ([string]$headOutput[0]).Trim().ToLowerInvariant()
    if ($branch -ne 'main') { Stop-WithBlocker 'CANONICAL_MAIN_REQUIRED' }
    if ($head -notmatch '^[0-9a-f]{40}$' -or $head -ne $ExpectedHead.ToLowerInvariant()) { Stop-WithBlocker 'EXPECTED_HEAD_MISMATCH' }
    $ExpectedHead = $head

    $plan = Get-CanonicalTaskPlan -Id $Target
    $launcherPath = [System.IO.Path]::GetFullPath((Resolve-Path (Join-Path $scriptDir 'run-stephanos-scheduled-task-windowless.vbs')).Path)
    $wscriptExe = [System.IO.Path]::GetFullPath((Join-Path $env:SystemRoot 'System32\wscript.exe'))
    $task = Get-ScheduledTask -TaskName $plan.TaskName -TaskPath '\' -ErrorAction SilentlyContinue
    if (-not $task) { Stop-WithBlocker 'APPROVED_TASK_MISSING' }
    if ([string]$task.State -eq 'Disabled') { Stop-WithBlocker 'APPROVED_TASK_DISABLED' }
    if (@($task.Actions).Count -ne 1) { Stop-WithBlocker 'APPROVED_TASK_ACTION_COUNT_INVALID' }
    $action = @($task.Actions)[0]
    $actualExecute = [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables([string]$action.Execute))
    $expectedArguments = "//B //NoLogo `"$launcherPath`" $($plan.Role)"
    if ($actualExecute -ne $wscriptExe) { Stop-WithBlocker 'APPROVED_TASK_EXECUTABLE_MISMATCH' }
    if ([string]$action.Arguments -ne $expectedArguments) { Stop-WithBlocker 'APPROVED_TASK_ARGUMENTS_MISMATCH' }

    $beforeState = [string]$task.State
    $startedAtUtc = [datetime]::UtcNow
    $terminatedVerifiedOwnedProcess = $false

    if ($Target -eq 'backend') {
        if ([string]$task.State -eq 'Running') {
            Stop-ScheduledTask -TaskName $plan.TaskName -TaskPath '\'
            if (-not (Wait-Until -Seconds 30 -Condition {
                [string](Get-ScheduledTask -TaskName $plan.TaskName -TaskPath '\').State -ne 'Running'
            })) { Stop-WithBlocker 'BACKEND_TASK_DID_NOT_STOP' }
        }
        $listener = Get-VerifiedBackendListener
        if ($listener) {
            Stop-Process -Id $listener.ProcessId -Force -ErrorAction Stop
            $terminatedVerifiedOwnedProcess = $true
            if (-not (Wait-Until -Seconds 30 -Condition { @(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue).Count -eq 0 })) {
                Stop-WithBlocker 'BACKEND_LISTENER_DID_NOT_STOP'
            }
        }
        Start-ScheduledTask -TaskName $plan.TaskName -TaskPath '\'
        if (-not (Wait-Until -Seconds $TimeoutSeconds -Condition { $null -ne (Test-BackendHealth) })) {
            Stop-WithBlocker 'BACKEND_HEALTH_TIMEOUT'
        }
        $backendReceiptPath = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace\status\stephanos-backend-runtime.json'
        if (-not (Wait-Until -Seconds $TimeoutSeconds -Condition {
            $null -ne (Read-FreshBackendReceipt -ReceiptPath $backendReceiptPath -StartedAfterUtc $startedAtUtc -ExpectedSourceHead $ExpectedHead)
        })) { Stop-WithBlocker 'BACKEND_EXACT_HEAD_RECEIPT_TIMEOUT' }
        $proofKind = 'backend-health-and-runtime-receipt'
        $proofFresh = $true
    }
    else {
        $heartbeatPath = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace\status\mission-orchestrator-worker-heartbeat.json'
        $oldWorker = Get-VerifiedWorkerProcessFromHeartbeat -HeartbeatPath $heartbeatPath -ExpectedRepoRoot $repoRoot
        if ([string]$task.State -eq 'Running') {
            Stop-ScheduledTask -TaskName $plan.TaskName -TaskPath '\'
            if (-not (Wait-Until -Seconds $missionWorkerStopTimeoutSeconds -Condition {
                [string](Get-ScheduledTask -TaskName $plan.TaskName -TaskPath '\').State -ne 'Running'
            })) { Stop-WithBlocker 'MISSION_WORKER_TASK_DID_NOT_STOP' }
        }
        if ($oldWorker -and (Get-CimInstance Win32_Process -Filter "ProcessId = $($oldWorker.ProcessId)" -ErrorAction SilentlyContinue)) {
            Stop-Process -Id $oldWorker.ProcessId -Force -ErrorAction Stop
            $terminatedVerifiedOwnedProcess = $true
            if (-not (Wait-Until -Seconds $missionWorkerStopTimeoutSeconds -Condition {
                -not (Get-CimInstance Win32_Process -Filter "ProcessId = $($oldWorker.ProcessId)" -ErrorAction SilentlyContinue)
            })) { Stop-WithBlocker 'MISSION_WORKER_VERIFIED_PROCESS_DID_NOT_STOP' }
        }
        $preStartSourceProof = Read-CanonicalWorkerSourceProof `
            -RepositoryRoot $repoRoot `
            -GitExecutable $canonicalGit `
            -ExpectedSourceHead $ExpectedHead `
            -Phase 'PRE_START'

        $workerTaskStarted = $false
        $startupBlocker = ''
        $startedWorker = $null
        $postStartSourceProof = $null
        try {
            Start-ScheduledTask -TaskName $plan.TaskName -TaskPath '\'
            $workerTaskStarted = $true
            if (-not (Wait-Until -Seconds $TimeoutSeconds -Condition {
                $candidateWorker = Get-VerifiedFreshWorkerInstance `
                    -HeartbeatPath $heartbeatPath `
                    -StartedAfterUtc $startedAtUtc `
                    -ExpectedSourceHead $ExpectedHead `
                    -ExpectedRepoRoot $repoRoot
                if ($candidateWorker) {
                    $script:startedWorkerPid = [int]$candidateWorker.ProcessId
                    $script:workerStartedAtUtc = $candidateWorker.ProcessStartedAtUtc.ToString('o')
                    return $true
                }
                return $false
            })) { throw 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT' }

            $startedWorker = Get-VerifiedFreshWorkerInstance `
                -HeartbeatPath $heartbeatPath `
                -StartedAfterUtc $startedAtUtc `
                -ExpectedSourceHead $ExpectedHead `
                -ExpectedRepoRoot $repoRoot
            if (-not $startedWorker) { throw 'MISSION_WORKER_FRESH_INSTANCE_NOT_PROVEN' }
            $script:startedWorkerPid = [int]$startedWorker.ProcessId
            $script:workerStartedAtUtc = $startedWorker.ProcessStartedAtUtc.ToString('o')

            $postStartSourceProof = Read-CanonicalWorkerSourceProof `
                -RepositoryRoot $repoRoot `
                -GitExecutable $canonicalGit `
                -ExpectedSourceHead $ExpectedHead `
                -Phase 'POST_START'
            $script:postStartSourceProofOk = $true
        }
        catch {
            $startupBlocker = [string]$_.Exception.Message
            if ($startupBlocker -notmatch '^[A-Z0-9_:-]{3,120}$') {
                $startupBlocker = 'MISSION_WORKER_POST_START_PROOF_FAILED'
            }
        }

        if ($startupBlocker) {
            if ($workerTaskStarted) {
                try {
                    Stop-NewlyStartedOwnedWorker `
                        -Plan $plan `
                        -HeartbeatPath $heartbeatPath `
                        -StartedAfterUtc $startedAtUtc `
                        -ExpectedSourceHead $ExpectedHead `
                        -ExpectedRepoRoot $repoRoot `
                        -ExpectedProcessId $startedWorkerPid
                }
                catch {
                    $cleanupBlocker = [string]$_.Exception.Message
                    if ($cleanupBlocker -notmatch '^[A-Z0-9_:-]{3,120}$') {
                        $cleanupBlocker = 'MISSION_WORKER_POST_START_CLEANUP_FAILED'
                    }
                    Stop-WithBlocker $cleanupBlocker
                }
            }
            Stop-WithBlocker $startupBlocker
        }
        $sourceTrackedClean = [bool]($preStartSourceProof.TrackedClean -and $postStartSourceProof.TrackedClean)
        $publicMainHead = [string]$postStartSourceProof.PublicMainHead
        $proofKind = 'mission-worker-heartbeat'
        $proofFresh = $true
    }

    $afterTask = Get-ScheduledTask -TaskName $plan.TaskName -TaskPath '\'
    [PSCustomObject]@{
        schemaVersion = 'stephanos.approved-runtime-restart.v1'
        target = $Target
        taskName = $plan.TaskName
        beforeState = $beforeState
        afterState = [string]$afterTask.State
        canonicalActionVerified = $true
        expectedHead = $ExpectedHead
        sourceHead = $ExpectedHead
        exactHeadProofOk = $true
        proofKind = $proofKind
        proofFresh = $proofFresh
        sourceTrackedClean = if ($Target -eq 'mission-worker') { $sourceTrackedClean } else { $false }
        publicMainHead = if ($Target -eq 'mission-worker') { $publicMainHead } else { '' }
        postStartSourceProofOk = if ($Target -eq 'mission-worker') { $postStartSourceProofOk } else { $false }
        startedWorkerPid = if ($Target -eq 'mission-worker') { $startedWorkerPid } else { 0 }
        workerStartedAtUtc = if ($Target -eq 'mission-worker') { $workerStartedAtUtc } else { '' }
        cleanupAttempted = $cleanupAttempted
        cleanupCompleted = $cleanupCompleted
        terminatedVerifiedOwnedProcess = $terminatedVerifiedOwnedProcess
        unrelatedTasksChanged = $false
        arbitraryTaskTargetAllowed = $false
        arbitraryProcessKillAllowed = $false
        verifiedOwnedProcessTerminationOnly = $true
        liveOpenClawUpdatePerformed = $false
        ok = $true
        finalVerdict = 'APPROVED_RUNTIME_RESTART_PASS'
    } | ConvertTo-Json -Depth 5 -Compress
    exit 0
}
catch {
    $blocker = [string]$_.Exception.Message
    if ($blocker -notmatch '^[A-Z0-9_:-]{3,120}$') { $blocker = 'APPROVED_RUNTIME_RESTART_FAILED' }
    [PSCustomObject]@{
        schemaVersion = 'stephanos.approved-runtime-restart.v1'
        target = $Target
        expectedHead = $ExpectedHead.ToLowerInvariant()
        exactHeadProofOk = $false
        postStartSourceProofOk = $false
        startedWorkerPid = $startedWorkerPid
        workerStartedAtUtc = $workerStartedAtUtc
        cleanupAttempted = $cleanupAttempted
        cleanupCompleted = $cleanupCompleted
        unrelatedTasksChanged = $false
        arbitraryTaskTargetAllowed = $false
        arbitraryProcessKillAllowed = $false
        verifiedOwnedProcessTerminationOnly = $true
        liveOpenClawUpdatePerformed = $false
        ok = $false
        blocker = $blocker
        finalVerdict = 'APPROVED_RUNTIME_RESTART_BLOCKED'
    } | ConvertTo-Json -Depth 4 -Compress
    exit 1
}
