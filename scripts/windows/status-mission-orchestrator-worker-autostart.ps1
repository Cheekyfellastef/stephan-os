[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$taskName = 'Stephanos Mission Orchestrator Worker'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -eq $task) {
    Write-Output "TASK_NAME=$taskName"
    Write-Output 'TASK_EXISTS=False'
    Write-Output 'FINAL_VERDICT=MISSION_ORCHESTRATOR_WORKER_AUTOSTART_MISSING'
    exit 1
}
$info = Get-ScheduledTaskInfo -TaskName $taskName
Write-Output "TASK_NAME=$taskName"
Write-Output 'TASK_EXISTS=True'
Write-Output "TASK_STATE=$($task.State)"
Write-Output "LAST_RUN_TIME=$($info.LastRunTime.ToUniversalTime().ToString('o'))"
Write-Output "LAST_TASK_RESULT=$($info.LastTaskResult)"
Write-Output "NEXT_RUN_TIME=$($info.NextRunTime.ToUniversalTime().ToString('o'))"
Write-Output 'FINAL_VERDICT=MISSION_ORCHESTRATOR_WORKER_AUTOSTART_STATUS_PASS'
