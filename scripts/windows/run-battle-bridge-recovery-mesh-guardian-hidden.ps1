[CmdletBinding()]
param(
    [ValidateRange(2, 15)]
    [int]$StaleAfterMinutes = 4
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

$taskName = 'Stephanos Battle Bridge Recovery Mesh'
$guardianId = 'stephanos-battle-bridge-recovery-mesh-guardian-v1'
$gitExe = 'C:\Program Files\Git\cmd\git.exe'
$fixedPowerShellExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$scheduledTaskMutationScope = 'REREGISTER_AND_START_CANONICAL_RECOVERY_MESH_ONLY'

function Stop-Guardian {
    param(
        [Parameter(Mandatory = $true)][string]$Blocker,
        [string]$Detail = ''
    )

    [pscustomobject]@{
        schemaVersion = 'stephanos.battle-bridge-recovery-mesh-guardian.v1'
        guardianId = $guardianId
        taskName = $taskName
        status = 'BLOCKED'
        repairAttempted = $false
        blocker = $Blocker
        detail = $Detail
        scheduledTaskMutationScope = $scheduledTaskMutationScope
        arbitraryShellAllowed = $false
        sourceMutationAllowed = $false
        gitMutationAllowed = $false
        arbitraryRuntimeMutationAllowed = $false
        mergeAuthority = $false
        finalVerdict = 'BATTLE_BRIDGE_RECOVERY_MESH_GUARDIAN_BLOCKED'
        observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json -Depth 5
    exit 2
}

if (-not $env:USERPROFILE) { Stop-Guardian -Blocker 'USERPROFILE_REQUIRED' }
if (-not (Test-Path -LiteralPath $gitExe -PathType Leaf)) { Stop-Guardian -Blocker 'FIXED_GIT_EXECUTABLE_MISSING' }
if (-not (Test-Path -LiteralPath $fixedPowerShellExe -PathType Leaf)) { Stop-Guardian -Blocker 'FIXED_POWERSHELL_EXECUTABLE_MISSING' }

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
$installerPath = Join-Path $repoRoot 'scripts\windows\install-battle-bridge-recovery-mesh.ps1'
$runnerPath = Join-Path $repoRoot 'scripts\windows\run-battle-bridge-recovery-mesh-hidden.ps1'

if (-not (Test-Path -LiteralPath $repoRoot -PathType Container)) { Stop-Guardian -Blocker 'CANONICAL_REPOSITORY_MISSING' }
foreach ($path in @($installerPath, $runnerPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Stop-Guardian -Blocker 'FIXED_RECOVERY_SOURCE_MISSING' -Detail $path }
    $item = Get-Item -LiteralPath $path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Stop-Guardian -Blocker 'FIXED_RECOVERY_SOURCE_REPARSE_POINT' -Detail $path }
}

$branch = (& $gitExe -C $repoRoot branch --show-current | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { Stop-Guardian -Blocker 'CANONICAL_MAIN_BRANCH_REQUIRED' -Detail $branch }

$origin = (& $gitExe -C $repoRoot remote get-url origin | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $origin -notmatch '^(https:\/\/github\.com\/Cheekyfellastef\/stephan-os(?:\.git)?\/?|git@github\.com:Cheekyfellastef\/stephan-os(?:\.git)?|ssh:\/\/git@github\.com\/Cheekyfellastef\/stephan-os(?:\.git)?\/?)$') {
    Stop-Guardian -Blocker 'CANONICAL_ORIGIN_REQUIRED'
}

& $gitExe -C $repoRoot diff --quiet -- 'scripts/windows/install-battle-bridge-recovery-mesh.ps1' 'scripts/windows/run-battle-bridge-recovery-mesh-hidden.ps1'
if ($LASTEXITCODE -ne 0) { Stop-Guardian -Blocker 'RECOVERY_SOURCE_DIRTY' }
& $gitExe -C $repoRoot diff --cached --quiet -- 'scripts/windows/install-battle-bridge-recovery-mesh.ps1' 'scripts/windows/run-battle-bridge-recovery-mesh-hidden.ps1'
if ($LASTEXITCODE -ne 0) { Stop-Guardian -Blocker 'RECOVERY_SOURCE_STAGED_DIRTY' }

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$info = if ($task) { Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue } else { $null }
$now = Get-Date
$lastRun = if ($info) { $info.LastRunTime } else { $null }
$lastRunAgeMinutes = if ($lastRun -and $lastRun -gt [datetime]::MinValue) { ($now - $lastRun).TotalMinutes } else { $null }
$lastTaskResult = if ($info) { [int]$info.LastTaskResult } else { $null }
$healthy = $null -ne $task -and $null -ne $info -and $lastTaskResult -eq 0 -and $null -ne $lastRunAgeMinutes -and $lastRunAgeMinutes -le $StaleAfterMinutes

if ($healthy) {
    [pscustomobject]@{
        schemaVersion = 'stephanos.battle-bridge-recovery-mesh-guardian.v1'
        guardianId = $guardianId
        taskName = $taskName
        status = 'HEALTHY'
        taskPresent = $true
        taskState = [string]$task.State
        lastTaskResult = $lastTaskResult
        lastRunAgeMinutes = [math]::Round($lastRunAgeMinutes, 2)
        staleAfterMinutes = $StaleAfterMinutes
        repairAttempted = $false
        repairApplied = $false
        scheduledTaskMutationScope = $scheduledTaskMutationScope
        arbitraryShellAllowed = $false
        sourceMutationAllowed = $false
        gitMutationAllowed = $false
        arbitraryRuntimeMutationAllowed = $false
        mergeAuthority = $false
        finalVerdict = 'BATTLE_BRIDGE_RECOVERY_MESH_GUARDIAN_HEALTHY'
        observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json -Depth 5
    exit 0
}

$reason = if (-not $task) { 'TASK_MISSING' } elseif (-not $info) { 'TASK_INFO_MISSING' } elseif ($lastTaskResult -ne 0) { 'TASK_LAST_RESULT_FAILED' } else { 'TASK_HEARTBEAT_STALE' }
$raw = (& $fixedPowerShellExe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $installerPath -StartNow -RecoveryMeshOnly 2>&1 | Out-String).Trim()
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0 -or -not $raw) { Stop-Guardian -Blocker 'RECOVERY_MESH_REPAIR_INSTALLER_FAILED' -Detail $reason }

try { $receipt = $raw | ConvertFrom-Json }
catch { Stop-Guardian -Blocker 'RECOVERY_MESH_REPAIR_RECEIPT_INVALID' -Detail $reason }

if ([string]$receipt.taskName -ne $taskName -or $receipt.taskPresentAfter -ne $true -or $receipt.startedNow -ne $true) {
    Stop-Guardian -Blocker 'RECOVERY_MESH_REPAIR_RECEIPT_REJECTED' -Detail $reason
}

[pscustomobject]@{
    schemaVersion = 'stephanos.battle-bridge-recovery-mesh-guardian.v1'
    guardianId = $guardianId
    taskName = $taskName
    status = 'REPAIRED'
    repairReason = $reason
    taskPresentBefore = [bool]($null -ne $task)
    lastTaskResultBefore = $lastTaskResult
    lastRunAgeMinutesBefore = if ($null -ne $lastRunAgeMinutes) { [math]::Round($lastRunAgeMinutes, 2) } else { $null }
    staleAfterMinutes = $StaleAfterMinutes
    repairAttempted = $true
    repairApplied = $true
    repairReceipt = $receipt
    scheduledTaskMutationScope = $scheduledTaskMutationScope
    arbitraryShellAllowed = $false
    sourceMutationAllowed = $false
    gitMutationAllowed = $false
    arbitraryRuntimeMutationAllowed = $false
    mergeAuthority = $false
    finalVerdict = 'BATTLE_BRIDGE_RECOVERY_MESH_GUARDIAN_REPAIRED'
    observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json -Depth 7
