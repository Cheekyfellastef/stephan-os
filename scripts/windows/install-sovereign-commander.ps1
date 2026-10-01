[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Set-CurrentUserOnlyFileDacl {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$UserSid
    )

    $file = Get-Item -LiteralPath $Path -ErrorAction Stop
    $acl = $file.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($existingRule in @($acl.Access)) {
        [void]$acl.RemoveAccessRuleSpecific($existingRule)
    }

    $sid = New-Object System.Security.Principal.SecurityIdentifier($UserSid)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $sid,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.AddAccessRule($rule)
    $file.SetAccessControl($acl)

    $verify = $file.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
    $rules = @($verify.Access)
    if ($rules.Count -ne 1) { throw 'SOVEREIGN_COMMANDER_TOKEN_ACL_NOT_EXCLUSIVE' }
    $verifiedRule = $rules[0]
    $verifiedSid = $verifiedRule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    if ($verifiedSid -ne $UserSid
        -or $verifiedRule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow
        -or (($verifiedRule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne [System.Security.AccessControl.FileSystemRights]::FullControl)
        -or $verifiedRule.IsInherited) {
        throw 'SOVEREIGN_COMMANDER_TOKEN_ACL_VERIFY_FAILED'
    }
}

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
$taskName = 'Stephanos Sovereign Commander'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..\..'))
$expectedRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
if (-not [string]::Equals($repoRoot, $expectedRepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Sovereign Commander installer must run from canonical checkout: $expectedRepoRoot"
}

$launcherPath = (Resolve-Path (Join-Path $repoRoot 'scripts\windows\run-stephanos-scheduled-task-windowless.vbs')).Path
$runnerPath = (Resolve-Path (Join-Path $repoRoot 'scripts\windows\run-sovereign-commander-hidden.ps1')).Path
$serverPath = (Resolve-Path (Join-Path $repoRoot 'scripts\sovereign-commander-http.mjs')).Path
$fleetSupervisorPath = (Resolve-Path (Join-Path $repoRoot 'scripts\sovereign-commander-fleet-goal-supervisor.mjs')).Path
$vrGovernorPath = (Resolve-Path (Join-Path $repoRoot 'scripts\windows\run-vr-resource-governor.ps1')).Path
$tokenDir = Join-Path $env:USERPROFILE 'Documents\OpenClaw-Standalone\mission-runner\keys'
$tokenPath = Join-Path $tokenDir 'sovereign-commander-token.txt'
$wscriptExe = Join-Path $env:SystemRoot 'System32\wscript.exe'

foreach ($required in @($launcherPath, $runnerPath, $serverPath, $fleetSupervisorPath, $vrGovernorPath, $wscriptExe)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required Sovereign Commander dependency missing: $required" }
}

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$currentUser = $currentIdentity.Name
$currentUserSid = [string]$currentIdentity.User.Value
if (-not $currentUserSid) { throw 'SOVEREIGN_COMMANDER_CURRENT_USER_SID_REQUIRED' }

$shouldApply = $PSCmdlet.ShouldProcess(
    $taskName,
    'Create/harden the local bearer token and register or update the hidden Sovereign Commander self-heal task'
)
if (-not $shouldApply) {
    $installed = $null -ne (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)
    [pscustomobject]@{
        schemaVersion = 'stephanos.sovereign-commander-install.v1'
        taskName = $taskName
        installed = $installed
        installActionPerformed = $false
        currentUser = $currentUser
        currentUserSid = $currentUserSid
        executable = $wscriptExe
        launcherPath = $launcherPath
        runnerPath = $runnerPath
        serverPath = $serverPath
        fleetSupervisorPath = $fleetSupervisorPath
    vrResourceGovernorPath = $vrGovernorPath
    vrResourceGovernorEnabled = $true
        vrResourceGovernorPath = $vrGovernorPath
        vrResourceGovernorEnabled = $true
        tokenPath = $tokenPath
        fleetGoalSupervisionEnabled = $true
        canonicalGoalFabricOnly = $true
    sourceMutationDelegatedToMissionWorker = $true
        duplicateSchedulerAllowed = $false
        duplicateLeaseAllowed = $false
        tokenAclHardened = $false
        tokenAclMethod = 'exclusive-current-user-dacl'
        intervalMinutes = 1
        atStartup = $true
        atLogon = $true
        requiresInteractiveLogon = $false
        logonType = 'S4U'
        restartCount = 3
        restartIntervalMinutes = 1
        hidden = $true
        runLevel = 'Limited'
        multipleInstances = 'IgnoreNew'
        startedNow = $false
        mutationPerformed = $false
        vendorMeterRequired = $false
        externalSaasRelayRequired = $false
        networkInstallAllowed = $false
        packageMutationAllowed = $false
        arbitraryShellAllowed = $false
        pcRestartAllowed = $false
        visiblePowerShellRequired = $false
        finalVerdict = 'SOVEREIGN_COMMANDER_INSTALL_SKIPPED'
    } | ConvertTo-Json -Depth 5
    return
}

if (-not (Test-Path -LiteralPath $tokenDir -PathType Container)) {
    New-Item -ItemType Directory -Path $tokenDir -Force | Out-Null
}

$tokenNeedsWrite = $true
if (Test-Path -LiteralPath $tokenPath -PathType Leaf) {
    try {
        $existingToken = [System.IO.File]::ReadAllText($tokenPath, [System.Text.Encoding]::ASCII).Trim()
        if ($existingToken.Length -ge 32) { $tokenNeedsWrite = $false }
    } catch {
        $tokenNeedsWrite = $true
    }
}
if ($tokenNeedsWrite) {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $token = [Convert]::ToBase64String($bytes)
    [System.IO.File]::WriteAllText($tokenPath, $token, [System.Text.Encoding]::ASCII)
}
Set-CurrentUserOnlyFileDacl -Path $tokenPath -UserSid $currentUserSid

$escapedLauncherPath = $launcherPath.Replace('"', '""')
$actionArguments = "//B //NoLogo `"$escapedLauncherPath`" sovereign-commander-watchdog"
$action = New-ScheduledTaskAction -Execute $wscriptExe -Argument $actionArguments
$startupTrigger = New-ScheduledTaskTrigger -AtStartup
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$intervalTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($startupTrigger, $logonTrigger, $intervalTrigger) -Principal $principal -Settings $settings -Description 'Boot-safe hidden Sovereign Commander daemon watchdog. Starts before interactive logon, self-recovers, and wakes the canonical fleet/goal conveyor once per minute; source mutation remains with the Mission Worker.' -Force | Out-Null
$startedNow = $false
if ($StartNow) {
    Start-ScheduledTask -TaskName $taskName
    $startedNow = $true
}
$installed = $null -ne (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)
$finalVerdict = if ($installed) { 'SOVEREIGN_COMMANDER_TASK_INSTALLED' } else { 'SOVEREIGN_COMMANDER_INSTALL_FAILED' }

[pscustomobject]@{
    schemaVersion = 'stephanos.sovereign-commander-install.v1'
    taskName = $taskName
    installed = $installed
    installActionPerformed = $true
    currentUser = $currentUser
    currentUserSid = $currentUserSid
    executable = $wscriptExe
    launcherPath = $launcherPath
    runnerPath = $runnerPath
    serverPath = $serverPath
    fleetSupervisorPath = $fleetSupervisorPath
    tokenPath = $tokenPath
    fleetGoalSupervisionEnabled = $true
    canonicalGoalFabricOnly = $true
        sourceMutationDelegatedToMissionWorker = $true
    duplicateSchedulerAllowed = $false
    duplicateLeaseAllowed = $false
    tokenAclHardened = $true
    tokenAclMethod = 'exclusive-current-user-dacl'
    intervalMinutes = 1
    atStartup = $true
    atLogon = $true
    requiresInteractiveLogon = $false
    logonType = 'S4U'
    restartCount = 3
    restartIntervalMinutes = 1
    hidden = $true
    runLevel = 'Limited'
    multipleInstances = 'IgnoreNew'
    startedNow = $startedNow
    mutationPerformed = $true
    vendorMeterRequired = $false
    externalSaasRelayRequired = $false
    networkInstallAllowed = $false
    packageMutationAllowed = $false
    arbitraryShellAllowed = $false
    pcRestartAllowed = $false
    visiblePowerShellRequired = $false
    finalVerdict = $finalVerdict
} | ConvertTo-Json -Depth 5
