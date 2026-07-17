[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'Stephanos Battle Bridge GitHub Command Mailbox'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
if (-not $env:USERPROFILE) {
    throw 'USERPROFILE is required to resolve the canonical Battle Bridge checkout.'
}
$expectedRepoRoot = Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'
if ([System.IO.Path]::GetFullPath($repoRoot) -ne [System.IO.Path]::GetFullPath($expectedRepoRoot)) {
    throw "Installer must run from the canonical checkout: $expectedRepoRoot"
}

$runnerPath = (Resolve-Path (Join-Path $repoRoot 'scripts\battle-bridge-github-command-mailbox-with-receipt-index.mjs')).Path
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    $nodeCommand = Get-Command node -ErrorAction Stop
}
$nodeExe = $nodeCommand.Source
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$escapedRunnerPath = $runnerPath.Replace('"', '""')
$action = New-ScheduledTaskAction -Execute $nodeExe -Argument "`"$escapedRunnerPath`""
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$intervalTrigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -Hidden `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

if ($PSCmdlet.ShouldProcess($taskName, 'Register or update bounded GitHub command mailbox task with Shared Workspace receipt index')) {
    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger @($logonTrigger, $intervalTrigger) `
        -Principal $principal `
        -Settings $settings `
        -Description 'Consumes only owner-authored, expiring, allowlisted Stephanos commands from issue 1507 and publishes a bounded Shared Workspace receipt index. No arbitrary shell, destructive Git, merge, push, or live OpenClaw update.' `
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
    receiptIndexEnabled = $true
    intervalMinutes = 5
    atLogon = $true
    hidden = $true
    runLevel = 'Limited'
    startedNow = [bool]$StartNow
    arbitraryShellAllowed = $false
    destructiveGitAllowed = $false
    liveOpenClawUpdateAllowed = $false
} | ConvertTo-Json -Depth 4
