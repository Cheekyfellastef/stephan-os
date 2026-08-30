[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$taskName = 'Stephanos Battle Bridge Recovery Mesh'
$guardianTaskName = 'Stephanos Battle Bridge Recovery Mesh Guardian'

$guardianTask = Get-ScheduledTask -TaskName $guardianTaskName -ErrorAction SilentlyContinue
$guardianUnregisterApplied = $false
if ($guardianTask -and $PSCmdlet.ShouldProcess($guardianTaskName, 'Remove the wake-only Recovery Mesh guardian before its parent task')) {
    Unregister-ScheduledTask -TaskName $guardianTaskName -Confirm:$false
    $guardianUnregisterApplied = $true
}
$guardianTaskPresentAfter = $null -ne (Get-ScheduledTask -TaskName $guardianTaskName -ErrorAction SilentlyContinue)
if ($guardianTaskPresentAfter) {
    throw 'RECOVERY_MESH_GUARDIAN_UNINSTALL_FAILED'
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$unregisterApplied = $false
if ($task -and $PSCmdlet.ShouldProcess($taskName, 'Remove only the Battle Bridge recovery mesh Scheduled Task')) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    $unregisterApplied = $true
}
$taskPresentAfter = $null -ne (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)
[pscustomobject]@{
    taskName = $taskName
    removed = [bool]($unregisterApplied -and -not $taskPresentAfter)
    unregisterApplied = [bool]$unregisterApplied
    taskPresentAfter = [bool]$taskPresentAfter
    guardianTaskName = $guardianTaskName
    guardianRemoved = [bool]($guardianUnregisterApplied -and -not $guardianTaskPresentAfter)
    guardianUnregisterApplied = [bool]$guardianUnregisterApplied
    guardianTaskPresentAfter = [bool]$guardianTaskPresentAfter
    guardianRemovedBeforeRecoveryMesh = $true
    whatIf = [bool]$WhatIfPreference
    workerPreserved = $true
    mailboxPreserved = $true
    backendPreserved = $true
    openclawPreserved = $true
    sharedWorkspaceReceiptsPreserved = $true
    sourcePreserved = $true
} | ConvertTo-Json
