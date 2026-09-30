[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

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
$tokenDir = Join-Path $env:USERPROFILE 'Documents\OpenClaw-Standalone\mission-runner\keys'
$tokenPath = Join-Path $tokenDir 'sovereign-commander-token.txt'
$wscriptExe = Join-Path $env:SystemRoot 'System32\wscript.exe'
$icaclsExe = Join-Path $env:SystemRoot 'System32\icacls.exe'

foreach ($required in @($launcherPath, $runnerPath, $serverPath, $wscriptExe, $icaclsExe)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required Sovereign Commander dependency missing: $required" }
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

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$currentUser = $currentIdentity.Name
$currentUserSid = [string]$currentIdentity.User.Value
if (-not $currentUserSid) { throw 'SOVEREIGN_COMMANDER_CURRENT_USER_SID_REQUIRED' }
$grant = "*${currentUserSid}:(F)"
& $icaclsExe $tokenPath '/inheritance:r' '/grant:r' $grant | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "SOVEREIGN_COMMANDER_TOKEN_ACL_HARDEN_FAILED:$LASTEXITCODE"
}

$escapedLauncherPath = $launcherPath.Replace('"', '""')
$actionArguments = "//B //NoLogo `"$escapedLauncherPath`" sovereign-commander-watchdog"
$action = New-ScheduledTaskAction -Execute $wscriptExe -Argument $actionArguments
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$intervalTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)

$installActionPerformed = $false
$startedNow = $false
$shouldApply = $PSCmdlet.ShouldProcess($taskName, 'Register or update hidden Sovereign Commander self-heal task')
if ($shouldApply) {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logonTrigger, $intervalTrigger) -Principal $principal -Settings $settings -Description 'Keeps the local authenticated Stephanos Sovereign Commander HTTP/MCP daemon healthy. No vendor relay, package install, arbitrary shell, merge, or PC restart authority.' -Force | Out-Null
    $installActionPerformed = $true
    if ($StartNow) {
        Start-ScheduledTask -TaskName $taskName
        $startedNow = $true
    }
}
$installed = $null -ne (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)
$finalVerdict = if (-not $shouldApply) { 'SOVEREIGN_COMMANDER_INSTALL_SKIPPED' } elseif ($installed) { 'SOVEREIGN_COMMANDER_TASK_INSTALLED' } else { 'SOVEREIGN_COMMANDER_INSTALL_FAILED' }

[pscustomobject]@{
    schemaVersion = 'stephanos.sovereign-commander-install.v1'
    taskName = $taskName
    installed = $installed
    installActionPerformed = $installActionPerformed
    currentUser = $currentUser
    currentUserSid = $currentUserSid
    executable = $wscriptExe
    launcherPath = $launcherPath
    runnerPath = $runnerPath
    serverPath = $serverPath
    tokenPath = $tokenPath
    tokenAclHardened = $true
    tokenAclMethod = 'icacls-current-user-sid'
    intervalMinutes = 1
    atLogon = $true
    hidden = $true
    runLevel = 'Limited'
    multipleInstances = 'IgnoreNew'
    startedNow = $startedNow
    vendorMeterRequired = $false
    externalSaasRelayRequired = $false
    networkInstallAllowed = $false
    packageMutationAllowed = $false
    arbitraryShellAllowed = $false
    pcRestartAllowed = $false
    visiblePowerShellRequired = $false
    finalVerdict = $finalVerdict
} | ConvertTo-Json -Depth 5
