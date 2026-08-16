[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'Stephanos Battle Bridge GitHub Sync'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task -and $PSCmdlet.ShouldProcess($taskName, 'Unregister bounded unattended GitHub sync task')) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

[pscustomobject]@{
    taskName = $taskName
    removed = [bool]$task
    sourcePreserved = $true
    sharedWorkspaceReceiptsPreserved = $true
    runtimeServicesModified = $false
    liveOpenClawUpdatePerformed = $false
} | ConvertTo-Json -Depth 4
