[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'Stephanos Battle Bridge GitHub Sync'
$workspaceRoot = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'
$statusPath = Join-Path $workspaceRoot 'status\battle-bridge-github-sync-current.json'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$taskInfo = if ($task) { Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue } else { $null }
$syncStatus = $null
if (Test-Path -LiteralPath $statusPath) {
    try { $syncStatus = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json } catch { $syncStatus = [pscustomobject]@{ readError = $_.Exception.Message } }
}

[pscustomobject]@{
    taskName = $taskName
    installed = [bool]$task
    taskState = if ($task) { [string]$task.State } else { 'Missing' }
    lastRunTime = if ($taskInfo) { $taskInfo.LastRunTime } else { $null }
    lastTaskResult = if ($taskInfo) { $taskInfo.LastTaskResult } else { $null }
    nextRunTime = if ($taskInfo) { $taskInfo.NextRunTime } else { $null }
    statusPath = $statusPath
    statusPresent = Test-Path -LiteralPath $statusPath
    syncStatus = $syncStatus
    liveOpenClawUpdateAllowed = $false
} | ConvertTo-Json -Depth 12
