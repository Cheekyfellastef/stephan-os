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
function Resolve-TaskPrincipalSid {
    param([string]$PrincipalUserId)

    if ([string]::IsNullOrWhiteSpace($PrincipalUserId)) { return '' }
    try {
        if ($PrincipalUserId -match '^S-\d-\d+(?:-\d+)+$') {
            return ([System.Security.Principal.SecurityIdentifier]::new($PrincipalUserId)).Value
        }
        return ([System.Security.Principal.NTAccount]::new($PrincipalUserId)).Translate([System.Security.Principal.SecurityIdentifier]).Value
    } catch {
        return ''
    }
}

function Test-TaskPrincipalMatchesCurrentUser {
    param([string]$PrincipalUserId)

    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $currentSid = if ($identity -and $identity.User) { [string]$identity.User.Value } else { '' }
    $principalSid = Resolve-TaskPrincipalSid -PrincipalUserId $PrincipalUserId
    return (-not [string]::IsNullOrWhiteSpace($currentSid) -and -not [string]::IsNullOrWhiteSpace($principalSid) -and [string]::Equals($principalSid, $currentSid, [System.StringComparison]::Ordinal))
}

function Test-CanonicalTaskDefinition {
    param(
        [object]$Task,
        [string]$ExpectedArguments,
        [string]$ExpectedExecutionTimeLimit,
        [string]$ExpectedRepetitionInterval
    )

    try {
        if (-not $Task -or [string]$Task.TaskPath -ne '\' -or @($Task.Actions).Count -ne 1 -or -not $Task.Principal -or -not $Task.Settings) { return $false }
        $taskAction = @($Task.Actions)[0]
        $taskExecute = [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables([string]$taskAction.Execute))
        if (-not [string]::Equals($taskExecute, $wscriptExe, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
        if (-not [string]::Equals(([string]$taskAction.Arguments).Trim(), $ExpectedArguments, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
        if (-not (Test-TaskPrincipalMatchesCurrentUser -PrincipalUserId ([string]$Task.Principal.UserId))) { return $false }
        if ([string]$Task.Principal.LogonType -ne 'S4U' -or [string]$Task.Principal.RunLevel -ne 'Limited') { return $false }
        if ([string]$Task.Settings.MultipleInstances -ne 'IgnoreNew' -or $Task.Settings.Enabled -ne $true -or $Task.Settings.Hidden -ne $true -or $Task.Settings.StartWhenAvailable -ne $true) { return $false }
        if ([string]$Task.Settings.ExecutionTimeLimit -ne $ExpectedExecutionTimeLimit) { return $false }

        $triggers = @($Task.Triggers)
        if ($triggers.Count -ne 3) { return $false }
        $startupTriggers = @($triggers | Where-Object { [string]$_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger' })
        $logonTriggers = @($triggers | Where-Object { [string]$_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' })
        $timeTriggers = @($triggers | Where-Object { [string]$_.CimClass.CimClassName -eq 'MSFT_TaskTimeTrigger' })
        if ($startupTriggers.Count -ne 1 -or $logonTriggers.Count -ne 1 -or $timeTriggers.Count -ne 1) { return $false }
        if (-not (Test-TaskPrincipalMatchesCurrentUser -PrincipalUserId ([string]$logonTriggers[0].UserId))) { return $false }
        if (-not $timeTriggers[0].Repetition -or [string]$timeTriggers[0].Repetition.Interval -ne $ExpectedRepetitionInterval) { return $false }
        return $true
    } catch {
        return $false
    }
}

$escapedLauncherPath = $launcherPath.Replace('"', '""')
$actionArguments = "//B //NoLogo `"$escapedLauncherPath`" recovery-mesh"
$action = New-ScheduledTaskAction -Execute $wscriptExe -Argument $actionArguments
$startupTrigger = New-ScheduledTaskTrigger -AtStartup
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$intervalTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 3) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

$existingRecoveryTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$existingRecoveryTaskCanonical = Test-CanonicalTaskDefinition -Task $existingRecoveryTask -ExpectedArguments $actionArguments -ExpectedExecutionTimeLimit 'PT3M' -ExpectedRepetitionInterval 'PT1M'
$registrationApplied = $false
$registrationMutated = $false
$startApplied = $false
if ($PSCmdlet.ShouldProcess($taskName, 'Prove or register one hidden canonical Battle Bridge recovery coordinator')) {
    if ($existingRecoveryTaskCanonical) {
        $registrationApplied = $true
    } else {
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($startupTrigger, $logonTrigger, $intervalTrigger) -Principal $principal -Settings $settings -Description 'Boot-safe recovery coordinator. Five authenticated recovery entrances feed one locked, fixed-task Battle Bridge recovery coordinator before or after interactive logon. No arbitrary shell, Git mutation, merge, PC restart or duplicate worker.' -Force | Out-Null
        $registrationMutated = $true
        $registeredRecoveryTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        $registrationApplied = Test-CanonicalTaskDefinition -Task $registeredRecoveryTask -ExpectedArguments $actionArguments -ExpectedExecutionTimeLimit 'PT3M' -ExpectedRepetitionInterval 'PT1M'
    }
    if ($StartNow -and $registrationApplied) { Start-ScheduledTask -TaskName $taskName; $startApplied = $true }
}
$taskPresentAfter = $null -ne (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)

$guardianRegistrationApplied = $false
$guardianRegistrationMutated = $false
$guardianReusedCanonicalTask = $false
$guardianStartApplied = $false
$guardianTaskPresentAfter = $null -ne (Get-ScheduledTask -TaskName $guardianTaskName -ErrorAction SilentlyContinue)
if (-not $RecoveryMeshOnly) {
    $guardianActionArguments = "//B //NoLogo `"$escapedLauncherPath`" recovery-mesh-guardian"
    $guardianAction = New-ScheduledTaskAction -Execute $wscriptExe -Argument $guardianActionArguments
    $guardianStartupTrigger = New-ScheduledTaskTrigger -AtStartup
    $guardianLogonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
    $guardianIntervalTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
    $guardianSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $existingGuardianTask = Get-ScheduledTask -TaskName $guardianTaskName -ErrorAction SilentlyContinue
    $existingGuardianTaskCanonical = Test-CanonicalTaskDefinition -Task $existingGuardianTask -ExpectedArguments $guardianActionArguments -ExpectedExecutionTimeLimit 'PT2M' -ExpectedRepetitionInterval 'PT5M'

    if ($PSCmdlet.ShouldProcess($guardianTaskName, 'Prove or register one hidden wake-only Recovery Mesh guardian')) {
        if ($existingGuardianTaskCanonical) {
            $guardianRegistrationApplied = $true
            $guardianReusedCanonicalTask = $true
        } else {
            Register-ScheduledTask -TaskName $guardianTaskName -Action $guardianAction -Trigger @($guardianStartupTrigger, $guardianLogonTrigger, $guardianIntervalTrigger) -Principal $principal -Settings $guardianSettings -Description 'Boot-safe independent wake-only guardian for the canonical Battle Bridge Recovery Mesh. May only re-register/start that fixed task after source-integrity and stale-heartbeat checks.' -Force | Out-Null
            $guardianRegistrationMutated = $true
            $registeredGuardianTask = Get-ScheduledTask -TaskName $guardianTaskName -ErrorAction SilentlyContinue
            $guardianRegistrationApplied = Test-CanonicalTaskDefinition -Task $registeredGuardianTask -ExpectedArguments $guardianActionArguments -ExpectedExecutionTimeLimit 'PT2M' -ExpectedRepetitionInterval 'PT5M'
        }
        if ($StartNow -and $guardianRegistrationApplied) { Start-ScheduledTask -TaskName $guardianTaskName; $guardianStartApplied = $true }
    }
    $guardianTaskPresentAfter = $null -ne (Get-ScheduledTask -TaskName $guardianTaskName -ErrorAction SilentlyContinue)
}

[pscustomobject]@{
    schemaVersion = 'stephanos.battle-bridge-recovery-mesh-install.v1'
    taskName = $taskName
    installed = [bool]$registrationApplied
    registrationMutated = [bool]$registrationMutated
    reusedCanonicalTask = [bool]($existingRecoveryTaskCanonical -and -not $registrationMutated)
    startedNow = [bool]$startApplied
    taskPresentAfter = [bool]$taskPresentAfter
    guardianTaskName = $guardianTaskName
    guardianInstalled = [bool]$guardianRegistrationApplied
    guardianRegistrationMutated = [bool]$guardianRegistrationMutated
    guardianReusedCanonicalTask = [bool]$guardianReusedCanonicalTask
    guardianStartedNow = [bool]$guardianStartApplied
    guardianTaskPresentAfter = [bool]$guardianTaskPresentAfter
    recoveryMeshOnly = [bool]$RecoveryMeshOnly
    whatIf = [bool]$WhatIfPreference
    intervalMinutes = 1
    guardianIntervalMinutes = 5
    guardianStaleAfterMinutes = 4
    atStartup = $true
    atLogon = $true
    requiresInteractiveLogon = $false
    logonType = 'S4U'
    restartCount = 3
    restartIntervalMinutes = 1
    hidden = $true
    runLevel = 'Limited'
    multipleInstances = 'IgnoreNew'
    maximumConcurrentExecutors = 1
    recoveryRoutes = @('LOCAL_WINDOWS_SUPERVISOR','GITHUB_MAILBOX','TAILSCALE_CONTROL','OPENCLAW_WHATSAPP','AUTHENTICATED_BREAK_GLASS')
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
