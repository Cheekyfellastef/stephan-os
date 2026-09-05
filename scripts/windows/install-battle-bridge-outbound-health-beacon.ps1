[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$taskName = 'Stephanos Battle Bridge Outbound Health Beacon'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
$expectedRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
if ([System.IO.Path]::GetFullPath($repoRoot) -ne $expectedRepoRoot) { throw "Installer must run from canonical checkout: $expectedRepoRoot" }

$launcherPath = (Resolve-Path (Join-Path $repoRoot 'scripts\windows\run-stephanos-scheduled-task-windowless.vbs')).Path
$runnerPath = (Resolve-Path (Join-Path $repoRoot 'scripts\windows\run-battle-bridge-outbound-health-beacon-hidden.ps1')).Path
$wscriptExe = 'C:\Windows\System32\wscript.exe'
if (-not (Test-Path -LiteralPath $wscriptExe -PathType Leaf)) { throw 'OUTBOUND_BEACON_WSCRIPT_MISSING' }

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$escapedLauncherPath = $launcherPath.Replace('"', '""')
$actionArguments = "//B //NoLogo `"$escapedLauncherPath`" outbound-health-beacon"
$action = New-ScheduledTaskAction -Execute $wscriptExe -Argument $actionArguments
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$intervalTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)

if ($PSCmdlet.ShouldProcess($taskName, 'Register bounded outbound Battle Bridge health beacon')) {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logonTrigger, $intervalTrigger) -Principal $principal -Settings $settings -Description 'Publishes bounded read-only Battle Bridge exact-head/health truth to fixed GitHub issue #1889. No source mutation, task mutation, restart, destructive Git or OpenClaw mutation.' -Force | Out-Null
    if ($StartNow) { Start-ScheduledTask -TaskName $taskName }
}

[pscustomobject]@{
    schemaVersion = 'stephanos.battle-bridge-outbound-health-beacon-install.v1'
    taskName = $taskName
    installed = $true
    startedNow = [bool]$StartNow
    intervalMinutes = 1
    atLogon = $true
    hidden = $true
    runLevel = 'Limited'
    multipleInstances = 'IgnoreNew'
    launcherPath = $launcherPath
    runnerPath = $runnerPath
    repository = 'Cheekyfellastef/stephan-os'
    issueNumber = 1889
    arbitraryShellAllowed = $false
    sourceMutationAllowed = $false
    taskMutationBeyondSelfAllowed = $false
    processRestartAllowed = $false
    destructiveGitAllowed = $false
    liveOpenClawUpdateAllowed = $false
    pcRestartAllowed = $false
    visiblePowerShellRequired = $false
} | ConvertTo-Json -Depth 4
