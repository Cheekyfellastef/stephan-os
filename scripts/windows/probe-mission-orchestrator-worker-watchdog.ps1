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
$runtimeRestartPath = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot 'scripts\windows\restart-approved-stephanos-runtime.ps1'))
$windowlessLauncherPath = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot 'scripts\windows\run-stephanos-scheduled-task-windowless.vbs'))
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
    if ($arguments.Count -lt 2) { return $false }

    $executePath = if (-not [string]::IsNullOrWhiteSpace([string]$Process.ExecutablePath)) {
        [string]$Process.ExecutablePath
    } else {
        [string]$arguments[0]
    }
    $executeLeaf = [System.IO.Path]::GetFileName($executePath)
    if ($executeLeaf -notin @('node.exe', 'node')) { return $false }

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

$taskActionMatchesCanonicalWorker = Test-CanonicalWorkerTaskAction -ScheduledTask $task

$repositoryBranch = ''
$repositoryHead = ''
$repositoryHeadReadError = ''
try {
    $gitCommand = Get-Command git.exe -ErrorAction Stop
    $repositoryBranchOutput = @(& $gitCommand.Source -C $repositoryRoot symbolic-ref --quiet --short HEAD 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw ('git symbolic-ref failed: {0}' -f (($repositoryBranchOutput | ForEach-Object { [string]$_ }) -join ' '))
    }
    $repositoryBranch = ([string]$repositoryBranchOutput[0]).Trim()
    $repositoryHeadOutput = @(& $gitCommand.Source -C $repositoryRoot rev-parse --verify HEAD 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw ('git rev-parse failed: {0}' -f (($repositoryHeadOutput | ForEach-Object { [string]$_ }) -join ' '))
    }
    $repositoryHead = ([string]$repositoryHeadOutput[0]).Trim().ToLowerInvariant()
    if ($repositoryBranch -ne 'main' -or $repositoryHead -notmatch '^[0-9a-f]{40}$') {
        throw 'Canonical repository branch/head proof is invalid.'
    }
}
catch {
    $repositoryBranch = ''
    $repositoryHead = ''
    $repositoryHeadReadError = $_.Exception.Message
}

if ($Mode -eq 'StartApprovedWorkerTask') {
    if (-not $task -or [string]$task.TaskName -ne $taskName) {
        throw 'The fixed Mission Orchestrator worker task is not installed.'
    }
    if (-not $taskActionMatchesCanonicalWorker) {
        throw 'The fixed Mission Orchestrator worker task action is not canonical.'
    }
    if ($repositoryBranch -ne 'main' -or $repositoryHead -notmatch '^[0-9a-f]{40}$') {
        throw 'The canonical repository head is not proven for fixed worker restart.'
    }
    if (-not (Test-Path -LiteralPath $runtimeRestartPath -PathType Leaf)) {
        throw 'The approved runtime restart adapter is missing.'
    }
    $powerShellCommand = Get-Command powershell.exe -ErrorAction Stop
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
        '90'
    )
    $restartOutput = @(& $powerShellCommand.Source @restartArguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw 'The approved runtime restart adapter failed.'
    }
    $restartJson = ($restartOutput | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
    $restartReceipt = $restartJson | ConvertFrom-Json
    $restartReceiptValid = (
        $restartReceipt -and
        [string]$restartReceipt.schemaVersion -eq 'stephanos.approved-runtime-restart.v1' -and
        [string]$restartReceipt.target -eq 'mission-worker' -and
        [string]$restartReceipt.taskName -eq $taskName -and
        [string]$restartReceipt.expectedHead -eq $repositoryHead -and
        [string]$restartReceipt.sourceHead -eq $repositoryHead -and
        $restartReceipt.canonicalActionVerified -eq $true -and
        $restartReceipt.exactHeadProofOk -eq $true -and
        $restartReceipt.proofFresh -eq $true -and
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
        exactHeadProofOk = $true
        proofFresh = $true
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
        headProven = (-not [string]::IsNullOrWhiteSpace($repositoryHead))
        headReadError = $repositoryHeadReadError
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
