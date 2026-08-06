[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$taskName = 'Stephanos Battle Bridge Recovery Mesh'
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
    whatIf = [bool]$WhatIfPreference
    workerPreserved = $true
    mailboxPreserved = $true
    backendPreserved = $true
    openclawPreserved = $true
    sharedWorkspaceReceiptsPreserved = $true
    sourcePreserved = $true
} | ConvertTo-Json
