[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'Stephanos Battle Bridge Express Command Mailbox'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
$expectedRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
if ([System.IO.Path]::GetFullPath($repoRoot) -ne $expectedRepoRoot) {
    throw "Installer must run from canonical checkout: $expectedRepoRoot"
}

$launcherPath = (Resolve-Path (Join-Path $repoRoot 'scripts\windows\run-stephanos-scheduled-task-windowless.vbs')).Path
$runnerPath = (Resolve-Path (Join-Path $repoRoot 'scripts\windows\run-battle-bridge-express-command-mailbox-hidden.ps1')).Path
$wscriptExe = Join-Path $env:SystemRoot 'System32\wscript.exe'
if (-not (Test-Path -LiteralPath $wscriptExe -PathType Leaf)) {
    throw 'EXPRESS_MAILBOX_WSCRIPT_MISSING'
}
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$escapedLauncherPath = $launcherPath.Replace('"', '""')
$actionArguments = "//B //NoLogo `"$escapedLauncherPath`" express-command-mailbox"
$action = New-ScheduledTaskAction -Execute $wscriptExe -Argument $actionArguments
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$restartTrigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 1) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -Hidden `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Days 3650)
if ($PSCmdlet.ShouldProcess($taskName, 'Register event-driven additive express command mailbox')) {
    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger @($logonTrigger, $restartTrigger) `
        -Principal $principal `
        -Settings $settings `
        -Description 'Additive event-driven Remote Commander ingress into canonical Shared Workspace. Existing GitHub mailbox remains independent. Closed-world operations only; no raw shell, merge, destructive Git or authority widening.' `
        -Force | Out-Null

    if ($StartNow) {
        Start-ScheduledTask -TaskName $taskName
    }
}

[pscustomobject]@{
    schemaVersion = 'stephanos.battle-bridge-express-command-mailbox-install.v1'
    taskName = $taskName
    installed = $true
    startedNow = [bool]$StartNow
    eventDriven = $true
    fallbackRestartMinutes = 1
    atLogon = $true
    hidden = $true
    runLevel = 'Limited'
    multipleInstances = 'IgnoreNew'
    launcherPath = $launcherPath
    runnerPath = $runnerPath
    sourceTransport = 'REMOTE_COMMANDER'
    durableFallbackPreserved = $true
    rawCommandExecutionAllowed = $false
    mergeAuthority = $false
    destructiveGitAllowed = $false
    pcRestartAllowed = $false
    visiblePowerShellRequired = $false
} | ConvertTo-Json -Depth 4
