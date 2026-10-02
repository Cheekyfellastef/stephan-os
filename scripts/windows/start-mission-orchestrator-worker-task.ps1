[CmdletBinding()]
param(
    [ValidateRange(5, 60)]
    [int]$ProofTimeoutSeconds = 15,

    [ValidateRange(100, 2000)]
    [int]$PollIntervalMilliseconds = 500
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'Stephanos Mission Orchestrator Worker'
if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }

$heartbeatPath = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace\status\mission-orchestrator-worker-heartbeat.json'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -eq $task) {
    [pscustomobject]@{
        schemaVersion = 'stephanos.mission-orchestrator-worker-task-start.v1'
        taskName = $taskName
        taskPresent = $false
        startedNow = $false
        running = $false
        heartbeatPath = $heartbeatPath
        finalVerdict = 'MISSION_ORCHESTRATOR_WORKER_TASK_MISSING'
    } | ConvertTo-Json -Compress
    exit 1
}

$beforeState = [string]$task.State
$startedNow = $false
if ($beforeState -ne 'Running') {
    Start-ScheduledTask -TaskName $taskName
    $startedNow = $true
}

$deadline = (Get-Date).AddSeconds($ProofTimeoutSeconds)
$afterState = $beforeState
do {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    $afterState = if ($task) { [string]$task.State } else { 'Missing' }
    if ($afterState -eq 'Running') { break }
    Start-Sleep -Milliseconds $PollIntervalMilliseconds
} while ((Get-Date) -lt $deadline)

$heartbeatFresh = $false
$heartbeatTimestampUtc = ''
if (Test-Path -LiteralPath $heartbeatPath -PathType Leaf) {
    try {
        $heartbeat = Get-Content -LiteralPath $heartbeatPath -Raw | ConvertFrom-Json
        $observed = [datetime]::Parse([string]$heartbeat.timestampUtc).ToUniversalTime()
        $heartbeatTimestampUtc = $observed.ToString('o')
        $heartbeatFresh = $observed -ge [datetime]::UtcNow.AddMinutes(-2)
    }
    catch {
        $heartbeatFresh = $false
    }
}

$running = $afterState -eq 'Running'
$verdict = if ($running) {
    'MISSION_ORCHESTRATOR_WORKER_TASK_RUNNING'
} else {
    'MISSION_ORCHESTRATOR_WORKER_TASK_START_UNPROVEN'
}

[pscustomobject]@{
    schemaVersion = 'stephanos.mission-orchestrator-worker-task-start.v1'
    taskName = $taskName
    taskPresent = ($afterState -ne 'Missing')
    beforeState = $beforeState
    afterState = $afterState
    startedNow = $startedNow
    running = $running
    heartbeatFresh = $heartbeatFresh
    heartbeatTimestampUtc = $heartbeatTimestampUtc
    heartbeatPath = $heartbeatPath
    arbitraryShellAllowed = $false
    duplicateWorkerStartAllowed = $false
    finalVerdict = $verdict
} | ConvertTo-Json -Compress

if (-not $running) { exit 1 }
