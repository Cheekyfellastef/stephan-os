[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('backend', 'mission-worker')]
    [string]$Target,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$ExpectedHead,

    [ValidateRange(15, 180)]
    [int]$TimeoutSeconds = 90,

    [string]$DeadlineUtc = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

$canonicalGit = 'C:\Program Files\Git\cmd\git.exe'
$canonicalNode = 'C:\Program Files\nodejs\node.exe'
$publicRemote = 'https://github.com/Cheekyfellastef/stephan-os.git'
$cleanupAttempted = $false
$cleanupCompleted = $false
$startedWorkerPid = 0
$workerStartedAtUtc = ''
$postStartSourceProofOk = $false
$missionWorkerStopTimeoutSeconds = 15
$missionWorkerCleanupTimeoutSeconds = 10
$operationDeadlineUtc = [datetime]::MaxValue
$invocationId = ''
$invocationBound = $false
$canonicalWorkerCommandVerified = $false

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

function Assert-BeforeOperationDeadline {
    param([int]$RequiredReserveSeconds = 0)
    if ([datetime]::UtcNow.AddSeconds($RequiredReserveSeconds) -ge $script:operationDeadlineUtc) {
        Stop-WithBlocker 'MISSION_WORKER_RESTART_DEADLINE_EXHAUSTED'
    }
}

function Wait-UntilOperationDeadline {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Condition,
        [int]$ReserveSeconds = 0
    )
    do {
        if (& $Condition) { return $true }
        if ([datetime]::UtcNow.AddSeconds($ReserveSeconds) -ge $script:operationDeadlineUtc) { return $false }
        Start-Sleep -Milliseconds 250
    } while ($true)
}

function New-CryptographicInvocationId {
    $bytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Write-BoundedAtomicJson {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object]$Value
    )
    $json = $Value | ConvertTo-Json -Depth 6 -Compress
    if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 8192) { Stop-WithBlocker 'MISSION_WORKER_INVOCATION_RECORD_TOO_LARGE' }
    $parent = Split-Path -Parent $Path
    [System.IO.Directory]::CreateDirectory($parent) | Out-Null
    $temporaryPath = "$Path.$PID.$([guid]::NewGuid().ToString('N')).tmp"
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($temporaryPath, "$json`n", $encoding)
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
}

function ConvertFrom-WindowsCommandLine {
    param([string]$CommandLine)
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return @() }
    if (-not ('Stephanos.RuntimeRestartCommandLineNative' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace Stephanos {
    public static class RuntimeRestartCommandLineNative {
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
    $argvPointer = [Stephanos.RuntimeRestartCommandLineNative]::CommandLineToArgvW($CommandLine, [ref]$argumentCount)
    if ($argvPointer -eq [IntPtr]::Zero -or $argumentCount -le 0 -or $argumentCount -gt 8) { return @() }
    try {
        $arguments = New-Object string[] $argumentCount
        for ($index = 0; $index -lt $argumentCount; $index++) {
            $itemPointer = [Runtime.InteropServices.Marshal]::ReadIntPtr($argvPointer, $index * [IntPtr]::Size)
            $arguments[$index] = [Runtime.InteropServices.Marshal]::PtrToStringUni($itemPointer)
        }
        return $arguments
    }
    finally { [void][Stephanos.RuntimeRestartCommandLineNative]::LocalFree($argvPointer) }
}

function Test-ExactCanonicalWorkerProcess {
    param(
        [Parameter(Mandatory = $true)][object]$Process,
        [Parameter(Mandatory = $true)][string]$ExpectedRepoRoot
    )
    try {
        $resolvedExecutable = [System.IO.Path]::GetFullPath([string]$Process.ExecutablePath)
        if (-not [string]::Equals($resolvedExecutable, $canonicalNode, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
        $arguments = @(ConvertFrom-WindowsCommandLine -CommandLine ([string]$Process.CommandLine))
        if ($arguments.Count -ne 2) { return $false }
        $commandExecutable = [System.IO.Path]::GetFullPath([string]$arguments[0])
        $expectedWorkerPath = [System.IO.Path]::GetFullPath((Join-Path $ExpectedRepoRoot 'scripts\mission-orchestrator-worker-supervised.mjs'))
        $scriptArgument = [System.IO.Path]::GetFullPath([string]$arguments[1])
        return [string]::Equals($commandExecutable, $canonicalNode, [System.StringComparison]::OrdinalIgnoreCase) `
            -and [string]::Equals($scriptArgument, $expectedWorkerPath, [System.StringComparison]::OrdinalIgnoreCase)
    }
    catch { return $false }
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
        if (-not (Test-ExactCanonicalWorkerProcess -Process $process -ExpectedRepoRoot $ExpectedRepoRoot)) { return $null }
        return [PSCustomObject]@{
            ProcessId = $processId
            ProcessStartedAtUtc = ([datetime]$process.CreationDate).ToUniversalTime()
        }
    }
    catch { return $null }
}

function Get-VerifiedFreshWorkerInstance {
    param(
        [string]$HeartbeatPath,
        [datetime]$StartedAfterUtc,
        [string]$ExpectedSourceHead,
        [string]$ExpectedRepoRoot,
        [Parameter(Mandatory = $true)][string]$ExpectedInvocationId,
        [int]$ExpectedProcessId = 0,
        [datetime]$ExpectedProcessStartedAtUtc = [datetime]::MinValue
    )
    if (-not (Test-Path -LiteralPath $HeartbeatPath -PathType Leaf)) { return $null }
    try {
        if ($ExpectedInvocationId -notmatch '^[0-9a-f]{64}$') { return $null }
        $statusRoot = Split-Path -Parent $HeartbeatPath
        $launchReceiptPath = Join-Path $statusRoot "mission-orchestrator-worker-restart-receipt-$ExpectedInvocationId.json"
        $invocationHeartbeatPath = Join-Path $statusRoot "mission-orchestrator-worker-restart-heartbeat-$ExpectedInvocationId.json"
        if (-not (Test-Path -LiteralPath $launchReceiptPath -PathType Leaf)) { return $null }
        if (-not (Test-Path -LiteralPath $invocationHeartbeatPath -PathType Leaf)) { return $null }
        $launchReceipt = Get-Content -LiteralPath $launchReceiptPath -Raw | ConvertFrom-Json
        if ([string]$launchReceipt.schemaVersion -ne 'stephanos.mission-worker-restart-receipt.v1') { return $null }
        if ([string]$launchReceipt.invocationId -ne $ExpectedInvocationId) { return $null }
        if ([string]$launchReceipt.taskName -ne 'Stephanos Mission Orchestrator Worker') { return $null }
        if ([string]$launchReceipt.repositoryRoot -ne $ExpectedRepoRoot) { return $null }
        if ([string]$launchReceipt.headSha -ne $ExpectedSourceHead) { return $null }
        if (-not [string]::Equals([string]$launchReceipt.canonicalNode, $canonicalNode, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
        $expectedWorkerScript = [System.IO.Path]::GetFullPath((Join-Path $ExpectedRepoRoot 'scripts\mission-orchestrator-worker-supervised.mjs'))
        if (-not [string]::Equals([System.IO.Path]::GetFullPath([string]$launchReceipt.canonicalWorkerScript), $expectedWorkerScript, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
        if ([string]$launchReceipt.deadlineUtc -ne $script:operationDeadlineUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')) { return $null }
        $receiptProcessId = [int]$launchReceipt.workerPid
        if ($receiptProcessId -le 0) { return $null }
        $receiptProcessStartedAtUtc = [datetime]::Parse([string]$launchReceipt.workerStartedAtUtc).ToUniversalTime()
        if ($receiptProcessStartedAtUtc -le $StartedAfterUtc) { return $null }
        if ($ExpectedProcessId -gt 0 -and $receiptProcessId -ne $ExpectedProcessId) { return $null }
        if ($ExpectedProcessStartedAtUtc -ne [datetime]::MinValue `
            -and $receiptProcessStartedAtUtc.Ticks -ne $ExpectedProcessStartedAtUtc.ToUniversalTime().Ticks) { return $null }

        $heartbeat = Get-Content -LiteralPath $HeartbeatPath -Raw | ConvertFrom-Json
        $timestamp = [datetime]::Parse([string]$heartbeat.timestampUtc).ToUniversalTime()
        if ($timestamp -le $StartedAfterUtc) { return $null }
        if ([string]$heartbeat.branch -ne 'main') { return $null }
        if ([string]$heartbeat.headSha -ne $ExpectedSourceHead) { return $null }
        if ([string]$heartbeat.taskName -ne 'Stephanos Mission Orchestrator Worker') { return $null }
        if ([string]$heartbeat.repositoryRoot -ne $ExpectedRepoRoot) { return $null }
        $processId = [int]$heartbeat.pid
        if ($processId -le 0) { return $null }
        if ($processId -ne $receiptProcessId) { return $null }
        $invocationHeartbeat = Get-Content -LiteralPath $invocationHeartbeatPath -Raw | ConvertFrom-Json
        if ([string]$invocationHeartbeat.schemaVersion -ne 'stephanos.mission-worker-restart-heartbeat.v1') { return $null }
        if ([string]$invocationHeartbeat.invocationId -ne $ExpectedInvocationId) { return $null }
        if ([string]$invocationHeartbeat.taskName -ne 'Stephanos Mission Orchestrator Worker') { return $null }
        if ([string]$invocationHeartbeat.repositoryRoot -ne $ExpectedRepoRoot) { return $null }
        if ([string]$invocationHeartbeat.headSha -ne $ExpectedSourceHead) { return $null }
        if ([string]$invocationHeartbeat.deadlineUtc -ne $script:operationDeadlineUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')) { return $null }
        if ([int]$invocationHeartbeat.workerPid -ne $receiptProcessId) { return $null }
        $boundWorkerStartedAtUtc = [datetime]::Parse([string]$invocationHeartbeat.workerStartedAtUtc).ToUniversalTime()
        $boundHeartbeatTimestampUtc = [datetime]::Parse([string]$invocationHeartbeat.heartbeatTimestampUtc).ToUniversalTime()
        if ($boundWorkerStartedAtUtc.Ticks -ne $receiptProcessStartedAtUtc.Ticks) { return $null }
        if ($boundHeartbeatTimestampUtc.Ticks -ne $timestamp.Ticks -or $boundHeartbeatTimestampUtc -le $receiptProcessStartedAtUtc) { return $null }
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
        if (-not $process) { return $null }
        $processStartedAtUtc = ([datetime]$process.CreationDate).ToUniversalTime()
        if ($processStartedAtUtc.Ticks -ne $receiptProcessStartedAtUtc.Ticks) { return $null }
        if (-not (Test-ExactCanonicalWorkerProcess -Process $process -ExpectedRepoRoot $ExpectedRepoRoot)) { return $null }
        return [PSCustomObject]@{
            ProcessId = $processId
            ProcessStartedAtUtc = $processStartedAtUtc
            HeartbeatTimestampUtc = $timestamp
            Heartbeat = $heartbeat
            InvocationId = $ExpectedInvocationId
            LaunchReceipt = $launchReceipt
            CanonicalWorkerCommandVerified = $true
        }
    }
    catch { return $null }
}

function Get-VerifiedInvocationProcessFromLaunchReceipt {
    param(
        [Parameter(Mandatory = $true)][string]$HeartbeatPath,
        [Parameter(Mandatory = $true)][datetime]$StartedAfterUtc,
        [Parameter(Mandatory = $true)][string]$ExpectedSourceHead,
        [Parameter(Mandatory = $true)][string]$ExpectedRepoRoot,
        [Parameter(Mandatory = $true)][string]$ExpectedInvocationId
    )
    try {
        if ($ExpectedInvocationId -notmatch '^[0-9a-f]{64}$') { return $null }
        $receiptPath = Join-Path (Split-Path -Parent $HeartbeatPath) "mission-orchestrator-worker-restart-receipt-$ExpectedInvocationId.json"
        if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) { return $null }
        $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
        if ([string]$receipt.schemaVersion -ne 'stephanos.mission-worker-restart-receipt.v1') { return $null }
        if ([string]$receipt.invocationId -ne $ExpectedInvocationId) { return $null }
        if ([string]$receipt.taskName -ne 'Stephanos Mission Orchestrator Worker') { return $null }
        if ([string]$receipt.repositoryRoot -ne $ExpectedRepoRoot) { return $null }
        if ([string]$receipt.headSha -ne $ExpectedSourceHead) { return $null }
        if (-not [string]::Equals([string]$receipt.canonicalNode, $canonicalNode, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
        $expectedWorkerScript = [System.IO.Path]::GetFullPath((Join-Path $ExpectedRepoRoot 'scripts\mission-orchestrator-worker-supervised.mjs'))
        if (-not [string]::Equals([System.IO.Path]::GetFullPath([string]$receipt.canonicalWorkerScript), $expectedWorkerScript, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
        if ([string]$receipt.deadlineUtc -ne $script:operationDeadlineUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')) { return $null }
        $processId = [int]$receipt.workerPid
        $processStartedAtUtc = [datetime]::Parse([string]$receipt.workerStartedAtUtc).ToUniversalTime()
        if ($processId -le 0 -or $processStartedAtUtc -le $StartedAfterUtc) { return $null }
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
        if (-not $process) { return $null }
        $observedStartedAtUtc = ([datetime]$process.CreationDate).ToUniversalTime()
        if ($observedStartedAtUtc.Ticks -ne $processStartedAtUtc.Ticks) { return $null }
        if (-not (Test-ExactCanonicalWorkerProcess -Process $process -ExpectedRepoRoot $ExpectedRepoRoot)) { return $null }
        return [PSCustomObject]@{
            ProcessId = $processId
            ProcessStartedAtUtc = $processStartedAtUtc
            InvocationId = $ExpectedInvocationId
            CanonicalWorkerCommandVerified = $true
            LaunchReceipt = $receipt
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
        [Parameter(Mandatory = $true)][string]$ExpectedInvocationId,
        [int]$ExpectedProcessId = 0,
        [datetime]$ExpectedProcessStartedAtUtc = [datetime]::MinValue
    )

    if ([string]$Plan.TaskName -ne 'Stephanos Mission Orchestrator Worker') {
        Stop-WithBlocker 'MISSION_WORKER_CLEANUP_TASK_NOT_ALLOWLISTED'
    }
    $script:cleanupAttempted = $true
    if ($ExpectedInvocationId -notmatch '^[0-9a-f]{64}$') {
        Stop-WithBlocker 'MISSION_WORKER_CLEANUP_INVOCATION_ID_INVALID'
    }
    $statusRoot = Split-Path -Parent $HeartbeatPath
    $claimPath = Join-Path $statusRoot "mission-orchestrator-worker-restart-claim-$ExpectedInvocationId.json"
    $claim = $null
    if (-not (Wait-UntilOperationDeadline -ReserveSeconds 3 -Condition {
        if (-not (Test-Path -LiteralPath $claimPath -PathType Leaf)) { return $false }
        try {
            $candidateClaim = Get-Content -LiteralPath $claimPath -Raw | ConvertFrom-Json
            if ([string]$candidateClaim.schemaVersion -ne 'stephanos.mission-worker-restart-claim.v1') { return $false }
            if ([string]$candidateClaim.invocationId -ne $ExpectedInvocationId) { return $false }
            if ([string]$candidateClaim.taskName -ne 'Stephanos Mission Orchestrator Worker') { return $false }
            if ([string]$candidateClaim.repositoryRoot -ne $ExpectedRepoRoot) { return $false }
            if ([string]$candidateClaim.headSha -ne $ExpectedSourceHead) { return $false }
            if ([int]$candidateClaim.launcherPid -le 0) { return $false }
            $script:cleanupClaim = $candidateClaim
            return $true
        }
        catch { return $false }
    })) { Stop-WithBlocker 'MISSION_WORKER_CLEANUP_INVOCATION_CLAIM_NOT_PROVEN' }
    $claim = $script:cleanupClaim

    $verifiedInvocationProcess = Get-VerifiedInvocationProcessFromLaunchReceipt `
        -HeartbeatPath $HeartbeatPath `
        -StartedAfterUtc $StartedAfterUtc `
        -ExpectedSourceHead $ExpectedSourceHead `
        -ExpectedRepoRoot $ExpectedRepoRoot `
        -ExpectedInvocationId $ExpectedInvocationId
    if (-not $verifiedInvocationProcess) {
        Stop-WithBlocker 'MISSION_WORKER_CLEANUP_LAUNCH_RECEIPT_NOT_PROVEN'
    }
    if ($ExpectedProcessId -le 0) { $ExpectedProcessId = $verifiedInvocationProcess.ProcessId }
    if ($ExpectedProcessStartedAtUtc -eq [datetime]::MinValue) {
        $ExpectedProcessStartedAtUtc = $verifiedInvocationProcess.ProcessStartedAtUtc
    }
    if ($verifiedInvocationProcess.ProcessId -ne $ExpectedProcessId `
        -or $verifiedInvocationProcess.ProcessStartedAtUtc.Ticks -ne $ExpectedProcessStartedAtUtc.ToUniversalTime().Ticks) {
        Stop-WithBlocker 'MISSION_WORKER_CLEANUP_LAUNCH_RECEIPT_MISMATCH'
    }

    $verifiedWorker = $null
    if ($ExpectedProcessId -gt 0) {
        $verifiedWorker = Get-VerifiedFreshWorkerInstance `
            -HeartbeatPath $HeartbeatPath `
            -StartedAfterUtc $StartedAfterUtc `
            -ExpectedSourceHead $ExpectedSourceHead `
            -ExpectedRepoRoot $ExpectedRepoRoot `
            -ExpectedInvocationId $ExpectedInvocationId `
            -ExpectedProcessId $ExpectedProcessId `
            -ExpectedProcessStartedAtUtc $ExpectedProcessStartedAtUtc
        if (-not $verifiedWorker) {
            Stop-WithBlocker 'MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_NOT_PROVEN'
        }
    }

    if ($verifiedWorker) {
        $reverifiedWorker = Get-VerifiedFreshWorkerInstance `
            -HeartbeatPath $HeartbeatPath `
            -StartedAfterUtc $StartedAfterUtc `
            -ExpectedSourceHead $ExpectedSourceHead `
            -ExpectedRepoRoot $ExpectedRepoRoot `
            -ExpectedInvocationId $ExpectedInvocationId `
            -ExpectedProcessId $verifiedWorker.ProcessId `
            -ExpectedProcessStartedAtUtc $verifiedWorker.ProcessStartedAtUtc
        if (-not $reverifiedWorker `
            -or $reverifiedWorker.ProcessId -ne $verifiedWorker.ProcessId `
            -or $reverifiedWorker.ProcessStartedAtUtc.Ticks -ne $verifiedWorker.ProcessStartedAtUtc.Ticks) {
            Stop-WithBlocker 'MISSION_WORKER_CLEANUP_PROCESS_IDENTITY_CHANGED'
        }
    }

    Assert-BeforeOperationDeadline -RequiredReserveSeconds 2
    $cancelPath = Join-Path $statusRoot "mission-orchestrator-worker-restart-cancel-$ExpectedInvocationId.json"
    Write-BoundedAtomicJson -Path $cancelPath -Value ([PSCustomObject]@{
        schemaVersion = 'stephanos.mission-worker-restart-cancel.v1'
        invocationId = $ExpectedInvocationId
        taskName = $Plan.TaskName
        repositoryRoot = $ExpectedRepoRoot
        headSha = $ExpectedSourceHead
        requestedAtUtc = [datetime]::UtcNow.ToString('o')
        deadlineUtc = $script:operationDeadlineUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        workerPid = $ExpectedProcessId
        workerStartedAtUtc = $ExpectedProcessStartedAtUtc.ToUniversalTime().ToString('o')
    })

    if ($ExpectedProcessId -gt 0 -and -not (Wait-UntilOperationDeadline -ReserveSeconds 1 -Condition {
        -not (Get-CimInstance Win32_Process -Filter "ProcessId = $ExpectedProcessId" -ErrorAction SilentlyContinue)
    })) { Stop-WithBlocker 'MISSION_WORKER_CLEANUP_PROCESS_DID_NOT_STOP' }

    $cleanupTask = Get-ScheduledTask -TaskName $Plan.TaskName -TaskPath '\' -ErrorAction SilentlyContinue
    if (-not $cleanupTask) { Stop-WithBlocker 'MISSION_WORKER_CLEANUP_TASK_MISSING' }
    if (-not (Wait-UntilOperationDeadline -Condition {
        [string](Get-ScheduledTask -TaskName $Plan.TaskName -TaskPath '\').State -ne 'Running'
    })) { Stop-WithBlocker 'MISSION_WORKER_CLEANUP_TASK_DID_NOT_STOP' }
    $script:cleanupCompleted = $true
}

try {
    if (-not $env:USERPROFILE) { Stop-WithBlocker 'USERPROFILE_REQUIRED' }
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $repoRoot = [System.IO.Path]::GetFullPath((Resolve-Path (Join-Path $scriptDir '..\..')).Path)
    $expectedRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
    if ($repoRoot -ne $expectedRepoRoot) { Stop-WithBlocker 'NON_CANONICAL_REPOSITORY_PATH' }

    if ($Target -eq 'mission-worker') {
        $parsedDeadlineUtc = [datetime]::MinValue
        if (-not [datetime]::TryParse($DeadlineUtc, [ref]$parsedDeadlineUtc)) {
            Stop-WithBlocker 'MISSION_WORKER_RESTART_DEADLINE_REQUIRED'
        }
        $script:operationDeadlineUtc = $parsedDeadlineUtc.ToUniversalTime()
        if ($script:operationDeadlineUtc -le [datetime]::UtcNow `
            -or $script:operationDeadlineUtc -gt [datetime]::UtcNow.AddSeconds(95)) {
            Stop-WithBlocker 'MISSION_WORKER_RESTART_DEADLINE_INVALID'
        }
    }

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
    if (-not (Test-Path -LiteralPath $canonicalNode -PathType Leaf)) { Stop-WithBlocker 'CANONICAL_NODE_MISSING' }
    $canonicalNodeItem = Get-Item -LiteralPath $canonicalNode -Force
    if ($canonicalNodeItem.PSIsContainer `
        -or $canonicalNodeItem.LinkType `
        -or (($canonicalNodeItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
        Stop-WithBlocker 'CANONICAL_NODE_IDENTITY_INVALID'
    }
    $resolvedCanonicalNode = [System.IO.Path]::GetFullPath($canonicalNodeItem.FullName)
    if (-not [string]::Equals($resolvedCanonicalNode, $canonicalNode, [System.StringComparison]::OrdinalIgnoreCase)) {
        Stop-WithBlocker 'CANONICAL_NODE_PATH_MISMATCH'
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
            if (-not (Wait-UntilOperationDeadline -ReserveSeconds 12 -Condition {
                [string](Get-ScheduledTask -TaskName $plan.TaskName -TaskPath '\').State -ne 'Running'
            })) { Stop-WithBlocker 'MISSION_WORKER_TASK_DID_NOT_STOP' }
        }
        if ($oldWorker -and (Get-CimInstance Win32_Process -Filter "ProcessId = $($oldWorker.ProcessId)" -ErrorAction SilentlyContinue)) {
            $oldWorkerRecheck = Get-VerifiedWorkerProcessFromHeartbeat -HeartbeatPath $heartbeatPath -ExpectedRepoRoot $repoRoot
            if (-not $oldWorkerRecheck `
                -or $oldWorkerRecheck.ProcessId -ne $oldWorker.ProcessId `
                -or $oldWorkerRecheck.ProcessStartedAtUtc.Ticks -ne $oldWorker.ProcessStartedAtUtc.Ticks) {
                Stop-WithBlocker 'MISSION_WORKER_EXISTING_PROCESS_IDENTITY_CHANGED'
            }
            Stop-Process -Id $oldWorker.ProcessId -Force -ErrorAction Stop
            $terminatedVerifiedOwnedProcess = $true
            if (-not (Wait-UntilOperationDeadline -ReserveSeconds 12 -Condition {
                -not (Get-CimInstance Win32_Process -Filter "ProcessId = $($oldWorker.ProcessId)" -ErrorAction SilentlyContinue)
            })) { Stop-WithBlocker 'MISSION_WORKER_VERIFIED_PROCESS_DID_NOT_STOP' }
        }
        $preStartSourceProof = Read-CanonicalWorkerSourceProof `
            -RepositoryRoot $repoRoot `
            -GitExecutable $canonicalGit `
            -ExpectedSourceHead $ExpectedHead `
            -Phase 'PRE_START'

        Assert-BeforeOperationDeadline -RequiredReserveSeconds 12
        $script:invocationId = New-CryptographicInvocationId
        if ($script:invocationId -notmatch '^[0-9a-f]{64}$') { Stop-WithBlocker 'MISSION_WORKER_INVOCATION_ID_GENERATION_FAILED' }
        $statusRoot = Split-Path -Parent $heartbeatPath
        $restartRequestPath = Join-Path $statusRoot 'mission-orchestrator-worker-restart-request.json'
        if (Test-Path -LiteralPath $restartRequestPath) {
            Stop-WithBlocker 'MISSION_WORKER_RESTART_REQUEST_ALREADY_PRESENT'
        }
        Write-BoundedAtomicJson -Path $restartRequestPath -Value ([PSCustomObject]@{
            schemaVersion = 'stephanos.mission-worker-restart-request.v1'
            invocationId = $script:invocationId
            taskName = $plan.TaskName
            repositoryRoot = $repoRoot
            headSha = $ExpectedHead
            requestedAtUtc = [datetime]::UtcNow.ToString('o')
            deadlineUtc = $script:operationDeadlineUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        })

        $workerTaskStarted = $false
        $startupBlocker = ''
        $startedWorker = $null
        $postStartSourceProof = $null
        try {
            Start-ScheduledTask -TaskName $plan.TaskName -TaskPath '\'
            $workerTaskStarted = $true
            if (-not (Wait-UntilOperationDeadline -ReserveSeconds 8 -Condition {
                $candidateWorker = Get-VerifiedFreshWorkerInstance `
                    -HeartbeatPath $heartbeatPath `
                    -StartedAfterUtc $startedAtUtc `
                    -ExpectedSourceHead $ExpectedHead `
                    -ExpectedRepoRoot $repoRoot `
                    -ExpectedInvocationId $script:invocationId
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
                -ExpectedRepoRoot $repoRoot `
                -ExpectedInvocationId $script:invocationId
            if (-not $startedWorker) { throw 'MISSION_WORKER_FRESH_INSTANCE_NOT_PROVEN' }
            $script:startedWorkerPid = [int]$startedWorker.ProcessId
            $script:workerStartedAtUtc = $startedWorker.ProcessStartedAtUtc.ToString('o')
            $script:canonicalWorkerCommandVerified = [bool]$startedWorker.CanonicalWorkerCommandVerified
            $script:invocationBound = ([string]$startedWorker.InvocationId -eq $script:invocationId)
            if (-not $script:canonicalWorkerCommandVerified -or -not $script:invocationBound) {
                throw 'MISSION_WORKER_INVOCATION_IDENTITY_NOT_PROVEN'
            }

            $postStartSourceProof = Read-CanonicalWorkerSourceProof `
                -RepositoryRoot $repoRoot `
                -GitExecutable $canonicalGit `
                -ExpectedSourceHead $ExpectedHead `
                -Phase 'POST_START'
            $script:postStartSourceProofOk = $true
            Assert-BeforeOperationDeadline -RequiredReserveSeconds 2
            $confirmationPath = Join-Path $statusRoot "mission-orchestrator-worker-restart-confirm-$($script:invocationId).json"
            Write-BoundedAtomicJson -Path $confirmationPath -Value ([PSCustomObject]@{
                schemaVersion = 'stephanos.mission-worker-restart-confirmation.v1'
                invocationId = $script:invocationId
                taskName = $plan.TaskName
                repositoryRoot = $repoRoot
                headSha = $ExpectedHead
                workerPid = $startedWorker.ProcessId
                workerStartedAtUtc = $startedWorker.ProcessStartedAtUtc.ToUniversalTime().ToString('o')
                confirmedAtUtc = [datetime]::UtcNow.ToString('o')
                deadlineUtc = $script:operationDeadlineUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
            })
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
                        -ExpectedInvocationId $script:invocationId `
                        -ExpectedProcessId $startedWorkerPid `
                        -ExpectedProcessStartedAtUtc $(if ($startedWorker) { $startedWorker.ProcessStartedAtUtc } else { [datetime]::MinValue })
                }
                catch {
                    $cleanupBlocker = [string]$_.Exception.Message
                    if ($cleanupBlocker -notmatch '^[A-Z0-9_:-]{3,120}$') {
                        $cleanupBlocker = 'MISSION_WORKER_POST_START_CLEANUP_FAILED'
                    }
                    if (-not (Wait-UntilOperationDeadline -Condition {
                        [string](Get-ScheduledTask -TaskName $plan.TaskName -TaskPath '\').State -ne 'Running'
                    })) {
                        $cleanupBlocker = 'MISSION_WORKER_DEADLINE_SELF_CLEANUP_NOT_PROVEN'
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

    if ($Target -eq 'mission-worker') { Assert-BeforeOperationDeadline -RequiredReserveSeconds 1 }
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
        invocationId = if ($Target -eq 'mission-worker') { $invocationId } else { '' }
        deadlineUtc = if ($Target -eq 'mission-worker') { $operationDeadlineUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ') } else { '' }
        invocationBound = if ($Target -eq 'mission-worker') { $invocationBound } else { $false }
        canonicalWorkerCommandVerified = if ($Target -eq 'mission-worker') { $canonicalWorkerCommandVerified } else { $false }
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
        invocationId = $invocationId
        deadlineUtc = if ($Target -eq 'mission-worker' -and $operationDeadlineUtc -ne [datetime]::MaxValue) { $operationDeadlineUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ') } else { '' }
        invocationBound = $invocationBound
        canonicalWorkerCommandVerified = $canonicalWorkerCommandVerified
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
