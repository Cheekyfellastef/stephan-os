[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'Stephanos Commander Watchdog'
$requiredVersion = '0.2.51'
if (-not $env:USERPROFILE) { throw 'USERPROFILE is required to resolve the canonical Battle Bridge checkout.' }
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
$expectedRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
if ([System.IO.Path]::GetFullPath($repoRoot) -ne $expectedRepoRoot) {
    throw "Commander watchdog installer must run from the canonical checkout: $expectedRepoRoot"
}

$launcherPath = (Resolve-Path (Join-Path $repoRoot 'scripts\windows\run-stephanos-scheduled-task-windowless.vbs')).Path
$runnerPath = (Resolve-Path (Join-Path $repoRoot 'scripts\windows\run-desktop-commander-watchdog-hidden.ps1')).Path
$wscriptExe = Join-Path $env:SystemRoot 'System32\wscript.exe'
if (-not (Test-Path -LiteralPath $wscriptExe -PathType Leaf)) { throw "Windowless task host is missing: $wscriptExe" }
if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) { throw "Commander watchdog runner is missing: $runnerPath" }

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$escapedLauncherPath = $launcherPath.Replace('"', '""')
$actionArguments = "//B //NoLogo `"$escapedLauncherPath`" desktop-commander-watchdog"
$action = New-ScheduledTaskAction -Execute $wscriptExe -Argument $actionArguments
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$intervalTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)

if ($PSCmdlet.ShouldProcess($taskName, 'Register or update hidden bounded Desktop Commander self-heal watchdog')) {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logonTrigger, $intervalTrigger) -Principal $principal -Settings $settings -Description 'Restarts only the already-qualified local Desktop Commander Remote Device when absent. No network install, package mutation, arbitrary shell, unrelated process restart, or PC restart.' -Force | Out-Null
    if ($StartNow) { Start-ScheduledTask -TaskName $taskName }
}

[pscustomobject]@{
    schemaVersion = 'stephanos.desktop-commander-watchdog-install.v1'
    taskName = $taskName
    installed = $true
    currentUser = $currentUser
    executable = $wscriptExe
    launcherPath = $launcherPath
    runnerPath = $runnerPath
    requiredVersion = $requiredVersion
    intervalMinutes = 1
    atLogon = $true
    hidden = $true
    runLevel = 'Limited'
    multipleInstances = 'IgnoreNew'
    startedNow = [bool]$StartNow
    networkInstallAllowed = $false
    packageMutationAllowed = $false
    arbitraryExecutableAllowed = $false
    arbitraryShellAllowed = $false
    unrelatedProcessRestartAllowed = $false
    pcRestartAllowed = $false
    visiblePowerShellRequired = $false
    headlessLauncher = $true
} | ConvertTo-Json -Depth 4
