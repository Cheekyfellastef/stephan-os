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
    param([string]$HeartbeatPath)
    if (-not (Test-Path -LiteralPath $HeartbeatPath -PathType Leaf)) { return $null }
    try {
        $heartbeat = Get-Content -LiteralPath $HeartbeatPath -Raw | ConvertFrom-Json
        if ([string]$heartbeat.taskName -ne 'Stephanos Mission Orchestrator Worker') { return $null }
        $processId = [int]$heartbeat.pid
        if ($processId -le 0) { return $null }
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
        if (-not $process) { return $null }
        $commandLine = ([string]$process.CommandLine).Replace('\', '/').ToLowerInvariant()
        if (-not $commandLine.Contains('scripts/mission-orchestrator-worker-supervised.mjs')) { return $null }
        return [PSCustomObject]@{ ProcessId = $processId }
    }
    catch { return $null }
}

function Read-FreshWorkerHeartbeat {
    param(
        [string]$HeartbeatPath,
        [datetime]$StartedAfterUtc,
        [string]$ExpectedSourceHead
    )
    if (-not (Test-Path -LiteralPath $HeartbeatPath -PathType Leaf)) { return $null }
    try {
        $heartbeat = Get-Content -LiteralPath $HeartbeatPath -Raw | ConvertFrom-Json
        $timestamp = [datetime]::Parse([string]$heartbeat.timestampUtc).ToUniversalTime()
        if ($timestamp -le $StartedAfterUtc) { return $null }
        if ([string]$heartbeat.branch -ne 'main') { return $null }
        if ([string]$heartbeat.headSha -ne $ExpectedSourceHead) { return $null }
        if ([string]$heartbeat.taskName -ne 'Stephanos Mission Orchestrator Worker') { return $null }
        $processId = [int]$heartbeat.pid
        if ($processId -le 0) { return $null }
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
        if (-not $process) { return $null }
        $commandLine = ([string]$process.CommandLine).Replace('\', '/').ToLowerInvariant()
        if (-not $commandLine.Contains('scripts/mission-orchestrator-worker-supervised.mjs')) { return $null }
        return $heartbeat
    }
    catch { return $null }
}

try {
    if (-not $env:USERPROFILE) { Stop-WithBlocker 'USERPROFILE_REQUIRED' }
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $repoRoot = [System.IO.Path]::GetFullPath((Resolve-Path (Join-Path $scriptDir '..\..')).Path)
    $expectedRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
    if ($repoRoot -ne $expectedRepoRoot) { Stop-WithBlocker 'NON_CANONICAL_REPOSITORY_PATH' }

    $git = Get-Command git.exe -ErrorAction SilentlyContinue
    if (-not $git) { $git = Get-Command git -ErrorAction Stop }
    $branch = (& $git.Source -C $repoRoot branch --show-current).Trim()
    $head = (& $git.Source -C $repoRoot rev-parse HEAD).Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { Stop-WithBlocker 'CANONICAL_MAIN_REQUIRED' }
    if ($head -ne $ExpectedHead.ToLowerInvariant()) { Stop-WithBlocker 'EXPECTED_HEAD_MISMATCH' }
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
        $oldWorker = Get-VerifiedWorkerProcessFromHeartbeat -HeartbeatPath $heartbeatPath
        if ([string]$task.State -eq 'Running') {
            Stop-ScheduledTask -TaskName $plan.TaskName -TaskPath '\'
            if (-not (Wait-Until -Seconds 30 -Condition {
                $taskStopped = [string](Get-ScheduledTask -TaskName $plan.TaskName -TaskPath '\').State -ne 'Running'
                $oldProcessStopped = (-not $oldWorker) -or (-not (Get-CimInstance Win32_Process -Filter "ProcessId = $($oldWorker.ProcessId)" -ErrorAction SilentlyContinue))
                return $taskStopped -and $oldProcessStopped
            })) { Stop-WithBlocker 'MISSION_WORKER_TASK_OR_PROCESS_DID_NOT_STOP' }
        }
        elseif ($oldWorker) {
            Stop-WithBlocker 'MISSION_WORKER_PROCESS_OUTSIDE_RUNNING_TASK'
        }
        Start-ScheduledTask -TaskName $plan.TaskName -TaskPath '\'
        if (-not (Wait-Until -Seconds $TimeoutSeconds -Condition {
            $null -ne (Read-FreshWorkerHeartbeat -HeartbeatPath $heartbeatPath -StartedAfterUtc $startedAtUtc -ExpectedSourceHead $ExpectedHead)
        })) { Stop-WithBlocker 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT' }
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
