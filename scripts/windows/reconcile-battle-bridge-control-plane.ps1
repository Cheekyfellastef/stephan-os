[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
$expectedRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
if ([System.IO.Path]::GetFullPath($repoRoot) -ne $expectedRepoRoot) {
    throw "Control-plane reconciler must run from the canonical checkout: $expectedRepoRoot"
}

$gitExe = 'C:\Program Files\Git\cmd\git.exe'
if (-not (Test-Path -LiteralPath $gitExe -PathType Leaf)) { throw 'CONTROL_PLANE_CANONICAL_GIT_MISSING' }
$branchRaw = & $gitExe -C $repoRoot branch --show-current 2>$null | Select-Object -First 1
$branch = ([string]$branchRaw).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { throw 'CONTROL_PLANE_SOURCE_BRANCH_NOT_MAIN' }
$sourceHeadRaw = & $gitExe -C $repoRoot rev-parse HEAD 2>$null | Select-Object -First 1
$sourceHead = ([string]$sourceHeadRaw).Trim().ToLowerInvariant()
if ($LASTEXITCODE -ne 0 -or $sourceHead -notmatch '^[0-9a-f]{40}$') { throw 'CONTROL_PLANE_SOURCE_HEAD_INVALID' }
$trackedStatus = @(& $gitExe -C $repoRoot status '--porcelain=v1' '--untracked-files=no' 2>$null)
if ($LASTEXITCODE -ne 0) { throw 'CONTROL_PLANE_TRACKED_SOURCE_STATUS_FAILED' }
if (@($trackedStatus | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }).Count -ne 0) {
    throw 'CONTROL_PLANE_TRACKED_SOURCE_DIRTY'
}

$launcherPath = (Resolve-Path (Join-Path $repoRoot 'scripts\windows\run-stephanos-scheduled-task-windowless.vbs')).Path
$wscriptExe = 'C:\Windows\System32\wscript.exe'
if (-not (Test-Path -LiteralPath $wscriptExe -PathType Leaf)) { throw 'CONTROL_PLANE_WINDOWLESS_HOST_MISSING' }
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$taskSpecs = @(
    [pscustomobject]@{
        Id = 'recoveryMesh'
        Name = 'Stephanos Battle Bridge Recovery Mesh'
        LauncherId = 'recovery-mesh'
        Installer = (Join-Path $repoRoot 'scripts\windows\install-battle-bridge-recovery-mesh.ps1')
    },
    [pscustomobject]@{
        Id = 'githubCommandMailbox'
        Name = 'Stephanos Battle Bridge GitHub Command Mailbox'
        LauncherId = 'github-command-mailbox'
        Installer = (Join-Path $repoRoot 'scripts\windows\install-battle-bridge-github-command-mailbox.ps1')
    }
)

function Test-CanonicalTask {
    param([object]$Task, [object]$Spec)
    try {
        if (-not $Task -or [string]$Task.TaskPath -ne '\' -or $Task.Actions.Count -ne 1) { return $false }
        if (-not $Task.Principal -or -not $Task.Settings) { return $false }
        $action = $Task.Actions[0]
        $execute = [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables([string]$action.Execute))
        $expectedArguments = "//B //NoLogo `"$launcherPath`" $($Spec.LauncherId)"
        return [string]::Equals($execute, $wscriptExe, [System.StringComparison]::OrdinalIgnoreCase) `
            -and [string]::Equals(([string]$action.Arguments).Trim(), $expectedArguments, [System.StringComparison]::OrdinalIgnoreCase) `
            -and [string]::Equals([string]$Task.Principal.UserId, $currentUser, [System.StringComparison]::OrdinalIgnoreCase) `
            -and [string]$Task.Principal.LogonType -eq 'Interactive' `
            -and [string]$Task.Principal.RunLevel -eq 'Limited' `
            -and [string]$Task.Settings.MultipleInstances -eq 'IgnoreNew' `
            -and $Task.Settings.Enabled -eq $true
    } catch { return $false }
}

function Invoke-FixedInstaller {
    param([object]$Spec)
    if (-not (Test-Path -LiteralPath $Spec.Installer -PathType Leaf)) { throw "CONTROL_PLANE_INSTALLER_MISSING:$($Spec.Id)" }
    $output = @(& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
        -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Spec.Installer -StartNow)
    if ($LASTEXITCODE -ne 0) { throw "CONTROL_PLANE_INSTALLER_FAILED:$($Spec.Id)" }
    $task = Get-ScheduledTask -TaskName $Spec.Name -ErrorAction SilentlyContinue
    if (-not (Test-CanonicalTask -Task $task -Spec $Spec)) { throw "CONTROL_PLANE_INSTALL_POSTCONDITION_FAILED:$($Spec.Id)" }
    return $output
}

$results = @()
foreach ($spec in $taskSpecs) {
    $taskBefore = Get-ScheduledTask -TaskName $spec.Name -ErrorAction SilentlyContinue
    $canonicalBefore = Test-CanonicalTask -Task $taskBefore -Spec $spec
    $reinstalled = $false
    if (-not $canonicalBefore) {
        [void](Invoke-FixedInstaller -Spec $spec)
        $reinstalled = $true
    } else {
        Start-ScheduledTask -TaskName $spec.Name
    }

    $taskAfter = Get-ScheduledTask -TaskName $spec.Name -ErrorAction SilentlyContinue
    $canonicalAfter = Test-CanonicalTask -Task $taskAfter -Spec $spec
    if (-not $canonicalAfter) { throw "CONTROL_PLANE_TASK_NOT_CANONICAL:$($spec.Id)" }
    $results += [pscustomobject]@{
        id = $spec.Id
        taskName = $spec.Name
        canonicalBefore = [bool]$canonicalBefore
        reinstalled = [bool]$reinstalled
        startRequested = $true
        canonicalAfter = [bool]$canonicalAfter
        stateAfter = [string]$taskAfter.State
    }
}

[pscustomobject]@{
    schemaVersion = 'stephanos.battle-bridge-control-plane-reconcile.v1'
    ok = $true
    repository = 'Cheekyfellastef/stephan-os'
    branch = $branch
    sourceHead = $sourceHead
    trackedSourceClean = $true
    taskCount = $results.Count
    tasks = $results
    canonicalTaskNames = @(
        'Stephanos Battle Bridge Recovery Mesh',
        'Stephanos Battle Bridge GitHub Command Mailbox'
    )
    arbitraryTaskNameAllowed = $false
    arbitraryExecutableAllowed = $false
    arbitraryShellAllowed = $false
    sourceMutationAllowed = $false
    gitMutationAllowed = $false
    pcRestartAllowed = $false
    publicExposureChanged = $false
    finalVerdict = 'BATTLE_BRIDGE_CONTROL_PLANE_RECONCILED'
} | ConvertTo-Json -Depth 6 -Compress
