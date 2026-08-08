[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$StartNow,
    [switch]$RecoveryMeshOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
$taskName = 'Stephanos Battle Bridge Recovery Mesh'
$guardianTaskName = 'Stephanos Battle Bridge Recovery Mesh Guardian'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
$expectedRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
if ([System.IO.Path]::GetFullPath($repoRoot) -ne $expectedRepoRoot) { throw "Installer must run from $expectedRepoRoot" }
$launcherPath = (Resolve-Path (Join-Path $repoRoot 'scripts\windows\run-stephanos-scheduled-task-windowless.vbs')).Path
$guardianRunnerPath = (Resolve-Path (Join-Path $repoRoot 'scripts\windows\run-battle-bridge-recovery-mesh-guardian-hidden.ps1')).Path
$wscriptExe = 'C:\Windows\System32\wscript.exe'
if (-not (Test-Path -LiteralPath $wscriptExe -PathType Leaf)) { throw "Windowless host missing: $wscriptExe" }
if (-not (Test-Path -LiteralPath $guardianRunnerPath -PathType Leaf)) { throw "Guardian runner missing: $guardianRunnerPath" }
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$escapedLauncherPath = $launcherPath.Replace('"', '""')
$actionArguments = "//B //NoLogo `"$escapedLauncherPath`" recovery-mesh"
$action = New-ScheduledTaskAction -Execute $wscriptExe -Argument $actionArguments
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$intervalTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 3)

$registrationApplied = $false
$startApplied = $false
if ($PSCmdlet.ShouldProcess($taskName, 'Register one hidden canonical Battle Bridge recovery coordinator')) {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logonTrigger, $intervalTrigger) -Principal $principal -Settings $settings -Description 'Five authenticated recovery entrances feed one locked, fixed-task Battle Bridge recovery coordinator. No arbitrary shell, Git mutation, merge, PC restart or duplicate worker.' -Force | Out-Null
    $registrationApplied = $null -ne (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)
    if ($StartNow -and $registrationApplied) { Start-ScheduledTask -TaskName $taskName; $startApplied = $true }
}
$taskPresentAfter = $null -ne (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)

$guardianRegistrationApplied = $false
$guardianStartApplied = $false
$guardianTaskPresentAfter = $null -ne (Get-ScheduledTask -TaskName $guardianTaskName -ErrorAction SilentlyContinue)
if (-not $RecoveryMeshOnly) {
    $guardianActionArguments = "//B //NoLogo `"$escapedLauncherPath`" recovery-mesh-guardian"
    $guardianAction = New-ScheduledTaskAction -Execute $wscriptExe -Argument $guardianActionArguments
    $guardianLogonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
    $guardianIntervalTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
    $guardianSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)

    if ($PSCmdlet.ShouldProcess($guardianTaskName, 'Register one hidden wake-only Recovery Mesh guardian')) {
        Register-ScheduledTask -TaskName $guardianTaskName -Action $guardianAction -Trigger @($guardianLogonTrigger, $guardianIntervalTrigger) -Principal $principal -Settings $guardianSettings -Description 'Independent wake-only guardian for the canonical Battle Bridge Recovery Mesh. May only re-register/start that fixed task after source-integrity and stale-heartbeat checks.' -Force | Out-Null
        $guardianRegistrationApplied = $null -ne (Get-ScheduledTask -TaskName $guardianTaskName -ErrorAction SilentlyContinue)
        if ($StartNow -and $guardianRegistrationApplied) { Start-ScheduledTask -TaskName $guardianTaskName; $guardianStartApplied = $true }
    }
    $guardianTaskPresentAfter = $null -ne (Get-ScheduledTask -TaskName $guardianTaskName -ErrorAction SilentlyContinue)
}

[pscustomobject]@{
    schemaVersion = 'stephanos.battle-bridge-recovery-mesh-install.v2'
    taskName = $taskName
    installed = [bool]$registrationApplied
    startedNow = [bool]$startApplied
    taskPresentAfter = [bool]$taskPresentAfter
    guardianTaskName = $guardianTaskName
    guardianInstalled = [bool]$guardianRegistrationApplied
    guardianStartedNow = [bool]$guardianStartApplied
    guardianTaskPresentAfter = [bool]$guardianTaskPresentAfter
    recoveryMeshOnly = [bool]$RecoveryMeshOnly
    whatIf = [bool]$WhatIfPreference
    intervalMinutes = 1
    guardianIntervalMinutes = 5
    guardianStaleAfterMinutes = 4
    atLogon = $true
    hidden = $true
    runLevel = 'Limited'
    multipleInstances = 'IgnoreNew'
    maximumConcurrentExecutors = 1
    recoveryRoutes = @('LOCAL_WINDOWS_GUARDIAN','GITHUB_MAILBOX','TAILSCALE_CONTROL','OPENCLAW_WHATSAPP','AUTHENTICATED_BREAK_GLASS')
    guardianAuthority = 'REREGISTER_AND_START_CANONICAL_RECOVERY_MESH_ONLY'
    arbitraryShellAllowed = $false
    arbitraryTaskNameAllowed = $false
    sourceMutationAllowed = $false
    gitMutationAllowed = $false
    runtimeMutationAllowedByGuardian = $false
    mergeAuthority = $false
    pcRestartAllowed = $false
    visiblePowerShellRequired = $false
} | ConvertTo-Json -Depth 5
