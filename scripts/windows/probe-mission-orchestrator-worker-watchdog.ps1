[CmdletBinding()]
param(
    [ValidateSet('Inspect', 'StartApprovedWorkerTask')]
    [string]$Mode = 'Inspect'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

$taskName = 'Stephanos Mission Orchestrator Worker'
if (-not $env:USERPROFILE) {
    throw 'USERPROFILE is required to resolve canonical worker watchdog paths.'
}
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
$workerPath = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot 'scripts\mission-orchestrator-worker-supervised.mjs'))
$workerLauncherPath = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot 'scripts\windows\start-mission-orchestrator-worker.ps1'))
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'))
$heartbeatPath = Join-Path $workspaceRoot 'status\mission-orchestrator-worker-heartbeat.json'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

function Test-CanonicalWorkerTaskAction {
    param([object]$ScheduledTask)

    if (-not $ScheduledTask) { return $false }
    if ([string]$ScheduledTask.TaskName -ne $taskName) { return $false }
    if ([string]$ScheduledTask.TaskPath -ne '\') { return $false }
    if (-not $ScheduledTask.Actions -or $ScheduledTask.Actions.Count -ne 1) { return $false }

    $action = $ScheduledTask.Actions[0]
    $execute = [string]$action.Execute
    $arguments = [string]$action.Arguments
    $executeLeaf = [System.IO.Path]::GetFileName($execute)
    if ($executeLeaf -notin @('powershell.exe', 'pwsh.exe')) { return $false }

    $escapedLauncher = [regex]::Escape($workerLauncherPath)
    $launcherPattern = '(?i)(?:^|\s)-File\s+(?:"' + $escapedLauncher + '"|' + $escapedLauncher + ')(?:\s|$)'
    if ($arguments -notmatch $launcherPattern) { return $false }
    if ($arguments -notmatch '(?i)(?:^|\s)-NoProfile(?:\s|$)') { return $false }
    if ($arguments -notmatch '(?i)(?:^|\s)-ExecutionPolicy\s+Bypass(?:\s|$)') { return $false }
    return $true
}

$taskActionMatchesCanonicalWorker = Test-CanonicalWorkerTaskAction -ScheduledTask $task

if ($Mode -eq 'StartApprovedWorkerTask') {
    if (-not $task -or [string]$task.TaskName -ne $taskName) {
        throw 'The fixed Mission Orchestrator worker task is not installed.'
    }
    if (-not $taskActionMatchesCanonicalWorker) {
        throw 'The fixed Mission Orchestrator worker task action is not canonical.'
    }
    Start-ScheduledTask -TaskName $taskName
    [pscustomobject]@{
        mode = $Mode
        taskName = $taskName
        taskActionMatchesCanonicalWorker = $true
        started = $true
        arbitraryTaskNameAllowed = $false
        arbitraryPowerShellAllowed = $false
        visiblePowerShellRequired = $false
    } | ConvertTo-Json -Depth 4
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
$commandLineMatchesCanonicalWorker = $false
if ($workerProcess -and -not [string]::IsNullOrWhiteSpace($commandLine)) {
    $commandLineMatchesCanonicalWorker = $commandLine.IndexOf($workerPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

[pscustomobject]@{
    scheduledTask = [pscustomobject]@{
        taskName = if ($task) { [string]$task.TaskName } else { '' }
        taskPath = if ($task) { [string]$task.TaskPath } else { '' }
        status = if ($task) { [string]$task.State } else { 'Missing' }
        actionMatchesCanonicalWorker = [bool]$taskActionMatchesCanonicalWorker
    }
    process = [pscustomobject]@{
        running = [bool]$workerProcess
        taskName = if ($commandLineMatchesCanonicalWorker) { $taskName } else { '' }
        pid = if ($workerProcess) { [int]$workerProcess.ProcessId } else { 0 }
        commandLineMatchesCanonicalWorker = [bool]$commandLineMatchesCanonicalWorker
    }
    heartbeat = if ($heartbeat) {
        [pscustomobject]@{
            timestampUtc = [string]$heartbeat.timestampUtc
            repositoryRoot = [string]$heartbeat.repositoryRoot
            branch = [string]$heartbeat.branch
            headSha = [string]$heartbeat.headSha
            taskName = [string]$heartbeat.taskName
            pid = [int]$heartbeat.pid
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
