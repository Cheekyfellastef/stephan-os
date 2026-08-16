[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'Stephanos Mission Orchestrator Worker Watchdog'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task -and $PSCmdlet.ShouldProcess($taskName, 'Unregister bounded Mission Orchestrator worker watchdog')) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

[pscustomobject]@{
    taskName = $taskName
    removed = [bool]$task
    workerTaskPreserved = $true
    sourcePreserved = $true
    sharedWorkspaceReceiptsPreserved = $true
    workerProcessModified = $false
    pcRestartPerformed = $false
} | ConvertTo-Json -Depth 4
