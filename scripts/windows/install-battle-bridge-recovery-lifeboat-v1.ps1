[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is required.' }
$taskName = 'Stephanos Battle Bridge Recovery Lifeboat'
$candidateVersion = '1.0.0'
$sourceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$lifeboatRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Stephanos\BattleBridgeRecoveryLifeboat'))
$banksRoot = Join-Path $lifeboatRoot 'banks'
$stateRoot = Join-Path $lifeboatRoot 'state'
$statusRoot = Join-Path $lifeboatRoot 'status'
$stagingRoot = Join-Path $lifeboatRoot 'staging'
$activeStatePath = Join-Path $stateRoot 'active-bank.json'
$sourceLauncher = Join-Path $sourceRoot 'scripts\windows\run-battle-bridge-recovery-lifeboat-active-v1.ps1'
$sourceRunner = Join-Path $sourceRoot 'scripts\windows\run-battle-bridge-recovery-lifeboat-bank-v1.ps1'
$sourceAction = Join-Path $sourceRoot 'scripts\windows\battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1'
$installedLauncher = Join-Path $lifeboatRoot 'run-battle-bridge-recovery-lifeboat-active-v1.ps1'
$powershellExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'

foreach ($required in @($sourceLauncher, $sourceRunner, $sourceAction, $powershellExe)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required fixed lifeboat component is missing: $required" }
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Write-AtomicJson([string]$Path, [object]$Value) {
    $directory = Split-Path -Parent $Path
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    $temp = "$Path.tmp-$PID-$([Guid]::NewGuid().ToString('N'))"
    $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temp -Encoding UTF8
    Move-Item -LiteralPath $temp -Destination $Path -Force
}

function Read-ActiveState() {
    if (-not (Test-Path -LiteralPath $activeStatePath -PathType Leaf)) { return $null }
    $state = Get-Content -LiteralPath $activeStatePath -Raw | ConvertFrom-Json
    if ([string]$state.schemaVersion -ne 'stephanos.battle-bridge-lifeboat-active-bank.v1') { throw 'Existing lifeboat active-bank schema is invalid.' }
    if ([string]$state.activeBank -notin @('A', 'B')) { throw 'Existing lifeboat active bank is invalid.' }
    if ([string]$state.manifestSha256 -notmatch '^[a-f0-9]{64}$') { throw 'Existing lifeboat active manifest is invalid.' }
    if ([string]$state.selfTestVerdict -ne 'PASS') { throw 'Existing lifeboat active bank is not self-test proven.' }
    return $state
}

function Assert-ActiveHeartbeatFresh([object]$State) {
    if ($null -eq $State) { return }
    $heartbeatPath = Join-Path $statusRoot "bank-$([string]$State.activeBank)-heartbeat.json"
    if (-not (Test-Path -LiteralPath $heartbeatPath -PathType Leaf)) { throw 'Existing active lifeboat bank has no heartbeat.' }
    $heartbeat = Get-Content -LiteralPath $heartbeatPath -Raw | ConvertFrom-Json
    if (-not [bool]$heartbeat.healthy) { throw 'Existing active lifeboat heartbeat is not healthy.' }
    $completed = [DateTime]::Parse([string]$heartbeat.completedAtUtc).ToUniversalTime()
    if (([DateTime]::UtcNow - $completed).TotalMinutes -gt 10) { throw 'Existing active lifeboat heartbeat is stale.' }
}

[System.IO.Directory]::CreateDirectory($lifeboatRoot) | Out-Null
[System.IO.Directory]::CreateDirectory($banksRoot) | Out-Null
[System.IO.Directory]::CreateDirectory($stateRoot) | Out-Null
[System.IO.Directory]::CreateDirectory($statusRoot) | Out-Null
[System.IO.Directory]::CreateDirectory($stagingRoot) | Out-Null

if (Test-Path -LiteralPath $installedLauncher -PathType Leaf) {
    if ((Get-Sha256 $installedLauncher) -ne (Get-Sha256 $sourceLauncher)) {
        throw 'Installed immutable lifeboat launcher differs from reviewed source. Refusing silent launcher replacement.'
    }
} elseif ($PSCmdlet.ShouldProcess($installedLauncher, 'Install immutable lifeboat active-bank launcher')) {
    Copy-Item -LiteralPath $sourceLauncher -Destination $installedLauncher
}

$activeState = Read-ActiveState
Assert-ActiveHeartbeatFresh -State $activeState
$activeBank = if ($null -eq $activeState) { '' } else { [string]$activeState.activeBank }
$targetBank = if ($activeBank -eq 'A') { 'B' } else { 'A' }
if ($targetBank -eq $activeBank) { throw 'Lifeboat installer must never target the active bank.' }

$stageId = "stage-$targetBank-$([Guid]::NewGuid().ToString('N'))"
$stageRoot = Join-Path $stagingRoot $stageId
$stageActions = Join-Path $stageRoot 'actions'
[System.IO.Directory]::CreateDirectory($stageActions) | Out-Null
Copy-Item -LiteralPath $sourceRunner -Destination (Join-Path $stageRoot 'run-battle-bridge-recovery-lifeboat-bank-v1.ps1')
Copy-Item -LiteralPath $sourceAction -Destination (Join-Path $stageActions 'battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1')

$runnerHash = Get-Sha256 (Join-Path $stageRoot 'run-battle-bridge-recovery-lifeboat-bank-v1.ps1')
$actionHash = Get-Sha256 (Join-Path $stageActions 'battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1')
$manifestMaterial = "runner=$runnerHash`naction=$actionHash`nversion=$candidateVersion`n"
$manifestBytes = [System.Text.Encoding]::UTF8.GetBytes($manifestMaterial)
$sha = [System.Security.Cryptography.SHA256]::Create()
try { $manifestSha256 = ([BitConverter]::ToString($sha.ComputeHash($manifestBytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
Set-Content -LiteralPath (Join-Path $stageRoot 'manifest.sha256') -Value $manifestSha256 -Encoding ASCII

if ($null -ne $activeState -and $manifestSha256 -eq [string]$activeState.manifestSha256) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
    throw 'Candidate lifeboat bank is not distinct from the active known-good bank.'
}

$probeOutput = @(& $powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $stageActions 'battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1') -Action PROBE_BATTLE_BRIDGE 2>&1)
if ($LASTEXITCODE -ne 0) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
    throw "Candidate lifeboat self-test failed: $($probeOutput -join [Environment]::NewLine)"
}

$targetRoot = Join-Path $banksRoot $targetBank
$backupInactive = $null
if (Test-Path -LiteralPath $targetRoot -PathType Container) {
    $backupInactive = Join-Path $stagingRoot "retired-$targetBank-$([Guid]::NewGuid().ToString('N'))"
}

if ($PSCmdlet.ShouldProcess($targetRoot, "Stage candidate lifeboat into inactive bank $targetBank")) {
    if ($null -ne $backupInactive) { Move-Item -LiteralPath $targetRoot -Destination $backupInactive }
    Move-Item -LiteralPath $stageRoot -Destination $targetRoot

    $newState = [ordered]@{
        schemaVersion = 'stephanos.battle-bridge-lifeboat-active-bank.v1'
        activeBank = $targetBank
        rollbackBank = $activeBank
        version = $candidateVersion
        manifestSha256 = $manifestSha256
        selfTestVerdict = 'PASS'
        promotedAtUtc = [DateTime]::UtcNow.ToString('o')
        previousManifestSha256 = if ($null -eq $activeState) { '' } else { [string]$activeState.manifestSha256 }
        productionRedundancyReady = [bool]($activeBank -in @('A', 'B'))
    }
    Write-AtomicJson -Path $activeStatePath -Value $newState
}

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $powershellExe -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$installedLauncher`""
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$intervalTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)

if ($PSCmdlet.ShouldProcess($taskName, 'Register fixed independent Battle Bridge recovery lifeboat task')) {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logonTrigger, $intervalTrigger) -Principal $principal -Settings $settings -Description 'Independent A/B Battle Bridge recovery lifeboat outside the stephan-os checkout. Fixed probe/recovery adapters only; no arbitrary shell, Git mutation, merge, deployment or PC restart.' -Force | Out-Null
    if ($StartNow) { Start-ScheduledTask -TaskName $taskName }
}

[pscustomobject]@{
    schemaVersion = 'stephanos.battle-bridge-recovery-lifeboat-install.v1'
    taskName = $taskName
    lifeboatRoot = $lifeboatRoot
    activeBankBefore = $activeBank
    activeBankAfter = $targetBank
    rollbackBank = $activeBank
    candidateVersion = $candidateVersion
    candidateManifestSha256 = $manifestSha256
    productionRedundancyReady = [bool]($activeBank -in @('A', 'B'))
    immutableLauncher = $true
    repoCheckoutRequiredAfterInstall = $false
    openClawGatewayRequiredAfterInstall = $false
    intervalMinutes = 2
    atLogon = $true
    runLevel = 'Limited'
    startedNow = [bool]$StartNow
    activeBankOverwriteAllowed = $false
    dualBankOverwriteAllowed = $false
    arbitraryPathAllowed = $false
    arbitraryTaskNameAllowed = $false
    arbitraryExecutableAllowed = $false
    arbitraryShellAllowed = $false
    gitMutationAllowed = $false
    sourceMutationAllowed = $false
    pcRestartAllowed = $false
} | ConvertTo-Json -Depth 6
