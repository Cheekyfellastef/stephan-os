[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'Stephanos Mission Orchestrator Worker Watchdog'
$workspaceRoot = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'
$statusPath = Join-Path $workspaceRoot 'status\battle-bridge-worker-watchdog-current.json'
$launchStatusPath = Join-Path $workspaceRoot 'status\battle-bridge-worker-watchdog-launch-current.json'
$heartbeatPath = Join-Path $workspaceRoot 'status\mission-orchestrator-worker-heartbeat.json'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$taskInfo = if ($task) { Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue } else { $null }
$watchdogStatus = $null
$launchStatus = $null
$workerHeartbeat = $null
if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
    try { $watchdogStatus = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json } catch { $watchdogStatus = [pscustomobject]@{ readError = $_.Exception.Message } }
}
if (Test-Path -LiteralPath $launchStatusPath -PathType Leaf) {
    try { $launchStatus = Get-Content -LiteralPath $launchStatusPath -Raw | ConvertFrom-Json } catch { $launchStatus = [pscustomobject]@{ readError = $_.Exception.Message } }
}
if (Test-Path -LiteralPath $heartbeatPath -PathType Leaf) {
    try { $workerHeartbeat = Get-Content -LiteralPath $heartbeatPath -Raw | ConvertFrom-Json } catch { $workerHeartbeat = [pscustomobject]@{ readError = $_.Exception.Message } }
}

[pscustomobject]@{
    taskName = $taskName
    installed = [bool]$task
    taskState = if ($task) { [string]$task.State } else { 'Missing' }
    lastRunTime = if ($taskInfo) { $taskInfo.LastRunTime } else { $null }
    lastRunTimeUtc = if ($taskInfo) { $taskInfo.LastRunTime.ToUniversalTime().ToString('o') } else { '' }
    lastTaskResult = if ($taskInfo) { $taskInfo.LastTaskResult } else { $null }
    nextRunTime = if ($taskInfo) { $taskInfo.NextRunTime } else { $null }
    nextRunTimeUtc = if ($taskInfo) { $taskInfo.NextRunTime.ToUniversalTime().ToString('o') } else { '' }
    statusPath = $statusPath
    statusPresent = Test-Path -LiteralPath $statusPath -PathType Leaf
    watchdogStatus = $watchdogStatus
    launchStatusPath = $launchStatusPath
    launchStatusPresent = Test-Path -LiteralPath $launchStatusPath -PathType Leaf
    launchStatus = $launchStatus
    heartbeatPath = $heartbeatPath
    heartbeatPresent = Test-Path -LiteralPath $heartbeatPath -PathType Leaf
    workerHeartbeat = $workerHeartbeat
    readOnly = $true
    visiblePowerShellRequired = $false
} | ConvertTo-Json -Depth 12
