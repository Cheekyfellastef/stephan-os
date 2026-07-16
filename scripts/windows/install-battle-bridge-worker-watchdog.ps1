[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'Stephanos Mission Orchestrator Worker Watchdog'
if (-not $env:USERPROFILE) {
    throw 'USERPROFILE is required to resolve the canonical Battle Bridge checkout.'
}
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
$expectedRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
if ([System.IO.Path]::GetFullPath($repoRoot) -ne $expectedRepoRoot) {
    throw "Worker watchdog installer must run from the canonical checkout: $expectedRepoRoot"
}
$runnerPath = (Resolve-Path (Join-Path $repoRoot 'scripts\battle-bridge-worker-watchdog-runner.mjs')).Path
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) { $nodeCommand = Get-Command node -ErrorAction Stop }
$nodeExe = $nodeCommand.Source
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$escapedRunnerPath = $runnerPath.Replace('"', '""')
$action = New-ScheduledTaskAction -Execute $nodeExe -Argument "`"$escapedRunnerPath`""
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$intervalTrigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 1) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -Hidden `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 2)

if ($PSCmdlet.ShouldProcess($taskName, 'Register or update hidden bounded Mission Orchestrator worker watchdog and Remote Codex visibility reconciler')) {
    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger @($logonTrigger, $intervalTrigger) `
        -Principal $principal `
        -Settings $settings `
        -Description 'Reconciles Remote Codex task visibility, then probes and starts only the fixed Stephanos Mission Orchestrator Worker task, with bounded recovery and Shared Workspace proof.' `
        -Force | Out-Null
    if ($StartNow) {
        Start-ScheduledTask -TaskName $taskName
    }
}

[pscustomobject]@{
    taskName = $taskName
    installed = $true
    currentUser = $currentUser
    executable = $nodeExe
    runnerPath = $runnerPath
    intervalMinutes = 1
    atLogon = $true
    hidden = $true
    runLevel = 'Limited'
    multipleInstances = 'IgnoreNew'
    startedNow = [bool]$StartNow
    remoteCodexVisibilityReconciler = $true
    arbitraryTaskNameAllowed = $false
    arbitraryShellAllowed = $false
    visiblePowerShellRequired = $false
} | ConvertTo-Json -Depth 4
