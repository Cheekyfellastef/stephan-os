[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'Stephanos Battle Bridge Monitor Multiplexer'
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

$wscriptExe = Join-Path $env:SystemRoot 'System32\wscript.exe'
if (-not (Test-Path -LiteralPath $wscriptExe -PathType Leaf)) { throw "Windowless task host is missing: $wscriptExe" }
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$escapedLauncherPath = $launcherPath.Replace('"', '""')
$actionArguments = "//B //NoLogo `"$escapedLauncherPath`" monitor-multiplexer"
$action = New-ScheduledTaskAction -Execute $wscriptExe -Argument $actionArguments
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
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

if ($PSCmdlet.ShouldProcess($taskName, 'Register or update bounded Monitor Multiplexer runtime task')) {
    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger @($logonTrigger, $intervalTrigger) `
        -Principal $principal `
        -Settings $settings `
        -Description 'Runs the source-controlled Stephanos Monitor Multiplexer once per minute and emits bounded Shared Workspace controller/monitor pulses through one external notification surface.' `
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
    intervalMinutes = 1
    atLogon = $true
    hidden = $true
    runLevel = 'Limited'
    startedNow = [bool]$StartNow
    arbitraryShellAllowed = $false
    arbitraryPowerShellAllowed = $false
    sourceMutationAllowed = $false
    mergeAuthority = $false
    externalTaskSlotsRequired = 1
    maximumLogicalMonitors = 1000
    maximumConcurrentHandlers = 16
    headlessLauncher = $true
} | ConvertTo-Json -Depth 4
