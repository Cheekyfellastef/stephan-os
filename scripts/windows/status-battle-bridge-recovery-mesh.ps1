[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$taskName = 'Stephanos Battle Bridge Recovery Mesh'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$info = if ($task) { Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue } else { $null }
$workspaceRoot = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'
$statusPath = Join-Path $workspaceRoot 'status\battle-bridge-recovery-mesh-current.json'
$status = $null
if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
    try { $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json } catch { $status = [pscustomobject]@{ classification = 'RECOVERY_MESH_STATUS_INVALID' } }
}
[pscustomobject]@{
    schemaVersion = 'stephanos.battle-bridge-recovery-mesh-status.v1'
    taskName = $taskName
    installed = [bool]$task
    state = if ($task) { [string]$task.State } else { 'Missing' }
    lastTaskResult = if ($info) { [int64]$info.LastTaskResult } else { -1 }
    lastRunTimeUtc = if ($info -and $info.LastRunTime.Year -gt 2000) { $info.LastRunTime.ToUniversalTime().ToString('o') } else { '' }
    nextRunTimeUtc = if ($info -and $info.NextRunTime.Year -gt 2000) { $info.NextRunTime.ToUniversalTime().ToString('o') } else { '' }
    status = $status
    maximumConcurrentExecutors = 1
    arbitraryShellAllowed = $false
    sourceMutationAllowed = $false
} | ConvertTo-Json -Depth 10
