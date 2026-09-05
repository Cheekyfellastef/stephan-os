[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'Stephanos Battle Bridge GitHub Command Mailbox'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
$launcherPath = (Resolve-Path (Join-Path $repoRoot 'scripts\windows\run-stephanos-scheduled-task-windowless.vbs')).Path
if (-not $env:USERPROFILE) {
    throw 'USERPROFILE is required to resolve the canonical Battle Bridge checkout.'
}
$expectedRepoRoot = Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'
if ([System.IO.Path]::GetFullPath($repoRoot) -ne [System.IO.Path]::GetFullPath($expectedRepoRoot)) {
    throw "Installer must run from the canonical checkout: $expectedRepoRoot"
}

$runnerPath = (Resolve-Path (Join-Path $repoRoot 'scripts\battle-bridge-github-command-mailbox-outbox-guard-v1.mjs')).Path
$childRunnerPath = (Resolve-Path (Join-Path $repoRoot 'scripts\battle-bridge-github-command-mailbox-with-receipt-index.mjs')).Path
$wscriptExe = Join-Path $env:SystemRoot 'System32\wscript.exe'
if (-not (Test-Path -LiteralPath $wscriptExe -PathType Leaf)) { throw "Windowless task host is missing: $wscriptExe" }
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$escapedLauncherPath = $launcherPath.Replace('"', '""')
$actionArguments = "//B //NoLogo `"$escapedLauncherPath`" github-command-mailbox"
$action = New-ScheduledTaskAction -Execute $wscriptExe -Argument $actionArguments
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$fastIntervalTrigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 1) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$compatibilityIntervalTrigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(5) `
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
        -Trigger @($logonTrigger, $fastIntervalTrigger, $compatibilityIntervalTrigger) `
        -Principal $principal `
        -Settings $settings `
        -Description 'Consumes only owner-authored, expiring, allowlisted Stephanos commands from issue 1507 and publishes a bounded Shared Workspace receipt index. One-minute polling is primary; the legacy five-minute trigger is retained as a compatibility fallback. No arbitrary shell, destructive Git, merge, push, or live OpenClaw update.' `
        -Force | Out-Null
    if ($StartNow) {
        Start-ScheduledTask -TaskName $taskName
    }
}

[pscustomobject]@{
    taskName = $taskName
    installed = $true
    currentUser = $currentUser
    executable = $wscriptExe
    launcherPath = $launcherPath
    runnerPath = $runnerPath
    childRunnerPath = $childRunnerPath
    outboxGuardEnabled = $true
    receiptIndexEnabled = $true
    intervalMinutes = 5
    effectivePollIntervalMinutes = 1
    compatibilityIntervalMinutes = 5
    pollStrategy = 'ONE_MINUTE_PRIMARY_FIVE_MINUTE_COMPATIBILITY_FALLBACK'
    multipleInstances = 'IgnoreNew'
    executionTimeLimitMinutes = 15
    atLogon = $true
    hidden = $true
    runLevel = 'Limited'
    startedNow = [bool]$StartNow
    arbitraryShellAllowed = $false
    destructiveGitAllowed = $false
    liveOpenClawUpdateAllowed = $false
    headlessLauncher = $true
} | ConvertTo-Json -Depth 4
