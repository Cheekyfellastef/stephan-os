[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$taskName = 'Stephanos Battle Bridge Recovery Mesh'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task -and $PSCmdlet.ShouldProcess($taskName, 'Remove only the Battle Bridge recovery mesh Scheduled Task')) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
[pscustomobject]@{
    taskName = $taskName
    removed = [bool]$task
    workerPreserved = $true
    mailboxPreserved = $true
    backendPreserved = $true
    openclawPreserved = $true
    sharedWorkspaceReceiptsPreserved = $true
    sourcePreserved = $true
} | ConvertTo-Json
