[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'Stephanos Mission Orchestrator Worker Watchdog'
$workspaceRoot = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'
$statusPath = Join-Path $workspaceRoot 'status\battle-bridge-worker-watchdog-current.json'
$heartbeatPath = Join-Path $workspaceRoot 'status\mission-orchestrator-worker-heartbeat.json'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$taskInfo = if ($task) { Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue } else { $null }
$watchdogStatus = $null
$workerHeartbeat = $null
if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
    try { $watchdogStatus = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json } catch { $watchdogStatus = [pscustomobject]@{ readError = $_.Exception.Message } }
}
if (Test-Path -LiteralPath $heartbeatPath -PathType Leaf) {
    try { $workerHeartbeat = Get-Content -LiteralPath $heartbeatPath -Raw | ConvertFrom-Json } catch { $workerHeartbeat = [pscustomobject]@{ readError = $_.Exception.Message } }
}

[pscustomobject]@{
    taskName = $taskName
    installed = [bool]$task
    taskState = if ($task) { [string]$task.State } else { 'Missing' }
    lastRunTime = if ($taskInfo) { $taskInfo.LastRunTime } else { $null }
    lastTaskResult = if ($taskInfo) { $taskInfo.LastTaskResult } else { $null }
    nextRunTime = if ($taskInfo) { $taskInfo.NextRunTime } else { $null }
    statusPath = $statusPath
    statusPresent = Test-Path -LiteralPath $statusPath -PathType Leaf
    watchdogStatus = $watchdogStatus
    heartbeatPath = $heartbeatPath
    heartbeatPresent = Test-Path -LiteralPath $heartbeatPath -PathType Leaf
    workerHeartbeat = $workerHeartbeat
    readOnly = $true
    visiblePowerShellRequired = $false
} | ConvertTo-Json -Depth 12
