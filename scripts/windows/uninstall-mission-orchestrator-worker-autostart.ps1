[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'
$taskName = 'Stephanos Mission Orchestrator Worker'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -ne $task -and $PSCmdlet.ShouldProcess($taskName, 'Unregister scheduled task')) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Write-Output "TASK_NAME=$taskName"
Write-Output "TASK_EXISTS_AFTER=$([bool](Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue))"
Write-Output 'FINAL_VERDICT=MISSION_ORCHESTRATOR_WORKER_AUTOSTART_REMOVED'
