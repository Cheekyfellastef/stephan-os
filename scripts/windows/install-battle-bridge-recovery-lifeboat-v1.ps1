[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is required.' }
$taskName = 'Stephanos Battle Bridge Recovery Lifeboat'
$candidateVersion = '1.2.0'
$sourceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$lifeboatRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Stephanos\BattleBridgeRecoveryLifeboat'))
$banksRoot = Join-Path $lifeboatRoot 'banks'
$stateRoot = Join-Path $lifeboatRoot 'state'
$statusRoot = Join-Path $lifeboatRoot 'status'
$stagingRoot = Join-Path $lifeboatRoot 'staging'
$activeStatePath = Join-Path $stateRoot 'active-bank.json'
$sourceLauncher = Join-Path $sourceRoot 'scripts\windows\run-battle-bridge-recovery-lifeboat-active-v1.ps1'
$sourceWindowlessLauncher = Join-Path $sourceRoot 'scripts\windows\run-battle-bridge-recovery-lifeboat-windowless-v2.vbs'
$sourceRunner = Join-Path $sourceRoot 'scripts\windows\run-battle-bridge-recovery-lifeboat-bank-v1.ps1'
$sourceAction = Join-Path $sourceRoot 'scripts\windows\battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1'
$sourceClaimConsumer = Join-Path $sourceRoot 'scripts\windows\invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1'
$installedLauncher = Join-Path $lifeboatRoot 'run-battle-bridge-recovery-lifeboat-active-v1.ps1'
$installedWindowlessLauncher = Join-Path $lifeboatRoot 'run-battle-bridge-recovery-lifeboat-windowless-v2.vbs'
$powershellExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$wscriptExe = 'C:\Windows\System32\wscript.exe'

foreach ($required in @($sourceLauncher, $sourceWindowlessLauncher, $sourceRunner, $sourceAction, $sourceClaimConsumer, $powershellExe, $wscriptExe)) {
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

function Read-FreshHealthyHeartbeat([string]$BankId, [string]$ExpectedManifest = '') {
    $heartbeatPath = Join-Path $statusRoot "bank-$BankId-heartbeat.json"
    if (-not (Test-Path -LiteralPath $heartbeatPath -PathType Leaf)) { throw "Lifeboat bank $BankId has no heartbeat." }
    $heartbeat = Get-Content -LiteralPath $heartbeatPath -Raw | ConvertFrom-Json
    if ([string]$heartbeat.schemaVersion -ne 'stephanos.battle-bridge-recovery-lifeboat-heartbeat.v1') { throw "Lifeboat bank $BankId heartbeat schema is invalid." }
    if ([string]$heartbeat.bankId -ne $BankId) { throw "Lifeboat bank $BankId heartbeat identity is invalid." }
    if (-not [bool]$heartbeat.healthy -or -not [bool]$heartbeat.payloadVerified) { throw "Lifeboat bank $BankId heartbeat is not healthy and payload verified." }
    if ($ExpectedManifest -and [string]$heartbeat.manifestSha256 -ne $ExpectedManifest) { throw "Lifeboat bank $BankId heartbeat manifest mismatch." }
    $completed = [DateTime]::Parse([string]$heartbeat.completedAtUtc).ToUniversalTime()
    if (([DateTime]::UtcNow - $completed).TotalMinutes -gt 10) { throw "Lifeboat bank $BankId heartbeat is stale." }
    return $heartbeat
}

function Assert-ActivePayloadManifest([string]$BankId, [string]$ExpectedManifest) {
    $activeManifestPath = Join-Path (Join-Path $banksRoot $BankId) 'manifest.sha256'
    if (-not (Test-Path -LiteralPath $activeManifestPath -PathType Leaf)) { throw "Lifeboat bank $BankId active manifest file is missing." }
    $activeManifest = ([string](Get-Content -LiteralPath $activeManifestPath -Raw)).Trim().ToLowerInvariant()
    if ($activeManifest -notmatch '^[a-f0-9]{64}$') { throw "Lifeboat bank $BankId active manifest file is invalid." }
    if ($activeManifest -ne $ExpectedManifest) { throw "Lifeboat bank $BankId active manifest file does not match active state." }
    return $activeManifestPath
}

function Assert-CanonicalScheduledTask([string]$CurrentUser) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    $actions = @($task.Actions)
    if ($actions.Count -ne 1) { throw 'Existing lifeboat scheduled task action count is not canonical.' }
    $expectedArguments = "//B //Nologo `"$installedWindowlessLauncher`""
    if ([string]$actions[0].Execute -ne $wscriptExe) { throw 'Existing lifeboat scheduled task executable is not canonical.' }
    if ([string]$actions[0].Arguments -ne $expectedArguments) { throw 'Existing lifeboat scheduled task arguments are not canonical.' }
    if ([string]$task.Principal.UserId -ne $CurrentUser) { throw 'Existing lifeboat scheduled task principal is not canonical.' }
    if ([string]$task.Principal.LogonType -ne 'Interactive') { throw 'Existing lifeboat scheduled task logon type is not canonical.' }
    if ([string]$task.Principal.RunLevel -ne 'Limited') { throw 'Existing lifeboat scheduled task run level is not canonical.' }
    return $task
}

[System.IO.Directory]::CreateDirectory($lifeboatRoot) | Out-Null
[System.IO.Directory]::CreateDirectory($banksRoot) | Out-Null
[System.IO.Directory]::CreateDirectory($stateRoot) | Out-Null
[System.IO.Directory]::CreateDirectory($statusRoot) | Out-Null
[System.IO.Directory]::CreateDirectory($stagingRoot) | Out-Null

$activeState = Read-ActiveState

if (Test-Path -LiteralPath $installedLauncher -PathType Leaf) {
    if ((Get-Sha256 $installedLauncher) -ne (Get-Sha256 $sourceLauncher)) {
        throw 'Installed immutable lifeboat launcher differs from reviewed source. Refusing silent launcher replacement.'
    }
} elseif ($null -ne $activeState) {
    throw 'Existing lifeboat active state requires the immutable active-bank launcher to already be installed.'
} elseif ($PSCmdlet.ShouldProcess($installedLauncher, 'Install immutable lifeboat active-bank launcher')) {
    Copy-Item -LiteralPath $sourceLauncher -Destination $installedLauncher
}

if (Test-Path -LiteralPath $installedWindowlessLauncher -PathType Leaf) {
    if ((Get-Sha256 $installedWindowlessLauncher) -ne (Get-Sha256 $sourceWindowlessLauncher)) {
        throw 'Installed immutable windowless lifeboat launcher differs from reviewed source. Refusing silent launcher replacement.'
    }
} elseif ($null -ne $activeState) {
    throw 'Existing lifeboat active state requires the immutable windowless launcher to already be installed.'
} elseif ($PSCmdlet.ShouldProcess($installedWindowlessLauncher, 'Install immutable windowless lifeboat launcher')) {
    Copy-Item -LiteralPath $sourceWindowlessLauncher -Destination $installedWindowlessLauncher
}
$windowlessLauncherSha256 = Get-Sha256 $installedWindowlessLauncher

$activeBank = if ($null -eq $activeState) { '' } else { [string]$activeState.activeBank }
if ($activeBank) {
    $null = Read-FreshHealthyHeartbeat -BankId $activeBank -ExpectedManifest ([string]$activeState.manifestSha256)
    $null = Assert-ActivePayloadManifest -BankId $activeBank -ExpectedManifest ([string]$activeState.manifestSha256)
}
$targetBank = if ($activeBank -eq 'A') { 'B' } else { 'A' }
if ($targetBank -eq $activeBank) { throw 'Lifeboat installer must never target the active bank.' }

$stageId = "stage-$targetBank-$([Guid]::NewGuid().ToString('N'))"
$stageRoot = Join-Path $stagingRoot $stageId
$stageActions = Join-Path $stageRoot 'actions'
$stageGithub = Join-Path $stageRoot 'github'
[System.IO.Directory]::CreateDirectory($stageActions) | Out-Null
[System.IO.Directory]::CreateDirectory($stageGithub) | Out-Null
Copy-Item -LiteralPath $sourceRunner -Destination (Join-Path $stageRoot 'run-battle-bridge-recovery-lifeboat-bank-v1.ps1')
Copy-Item -LiteralPath $sourceAction -Destination (Join-Path $stageActions 'battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1')
Copy-Item -LiteralPath $sourceClaimConsumer -Destination (Join-Path $stageGithub 'invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1')
Set-Content -LiteralPath (Join-Path $stageRoot 'version.txt') -Value $candidateVersion -Encoding ASCII

$runnerHash = Get-Sha256 (Join-Path $stageRoot 'run-battle-bridge-recovery-lifeboat-bank-v1.ps1')
$actionHash = Get-Sha256 (Join-Path $stageActions 'battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1')
$claimHash = Get-Sha256 (Join-Path $stageGithub 'invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1')
$manifestMaterial = "runner=$runnerHash`naction=$actionHash`nclaim=$claimHash`nversion=$candidateVersion`n"
$manifestBytes = [System.Text.Encoding]::UTF8.GetBytes($manifestMaterial)
$sha = [System.Security.Cryptography.SHA256]::Create()
try { $manifestSha256 = ([BitConverter]::ToString($sha.ComputeHash($manifestBytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
Set-Content -LiteralPath (Join-Path $stageRoot 'manifest.sha256') -Value $manifestSha256 -Encoding ASCII

if ($null -ne $activeState -and $manifestSha256 -eq [string]$activeState.manifestSha256) {
    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $null = Assert-CanonicalScheduledTask -CurrentUser $currentUser
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
    $startedNow = $false
    if ($StartNow -and $PSCmdlet.ShouldProcess($taskName, 'Start existing canonical Battle Bridge recovery lifeboat task')) {
        Start-ScheduledTask -TaskName $taskName
        $startedNow = $true
    }
    $rollbackBank = if ($activeState.PSObject.Properties['rollbackBank']) { [string]$activeState.rollbackBank } else { '' }
    [pscustomobject]@{
        schemaVersion = 'stephanos.battle-bridge-recovery-lifeboat-install.v1'
        taskName = $taskName
        lifeboatRoot = $lifeboatRoot
        activeBankBefore = $activeBank
        activeBankAfter = $activeBank
        rollbackBank = $rollbackBank
        candidateVersion = $candidateVersion
        candidateManifestSha256 = $manifestSha256
        installDisposition = 'ALREADY_CURRENT_HEALTHY'
        changed = $false
        candidateHeartbeatRequiredBeforePromotion = $true
        payloadHashVerificationRequired = $true
        githubClaimConsumerIncluded = $true
        githubEndpointFixed = $true
        githubTokenRequired = $false
        productionRedundancyReady = [bool]($rollbackBank -in @('A', 'B'))
        immutableLauncher = $true
        windowlessLauncher = $true
        windowlessLauncherSha256 = $windowlessLauncherSha256
        scheduledTaskExecutable = $wscriptExe
        scheduledTaskIdentityReproved = $true
        directPowerShellTaskLaunch = $false
        repoCheckoutRequiredAfterInstall = $false
        openClawGatewayRequiredAfterInstall = $false
        intervalMinutes = 2
        atLogon = $true
        runLevel = 'Limited'
        startedNow = $startedNow
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
    return
}

$targetRoot = Join-Path $banksRoot $targetBank
$backupInactive = $null
if (Test-Path -LiteralPath $targetRoot -PathType Container) {
    $backupInactive = Join-Path $stagingRoot "retired-$targetBank-$([Guid]::NewGuid().ToString('N'))"
}

if ($PSCmdlet.ShouldProcess($targetRoot, "Stage and prove candidate lifeboat in inactive bank $targetBank")) {
    if ($null -ne $backupInactive) { Move-Item -LiteralPath $targetRoot -Destination $backupInactive }
    Move-Item -LiteralPath $stageRoot -Destination $targetRoot

    $candidateRunner = Join-Path $targetRoot 'run-battle-bridge-recovery-lifeboat-bank-v1.ps1'
    $candidateOutput = @(& $powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $candidateRunner -SelfTestOnly 2>&1)
    if ($LASTEXITCODE -ne 0) {
        Remove-Item -LiteralPath $targetRoot -Recurse -Force
        if ($null -ne $backupInactive) { Move-Item -LiteralPath $backupInactive -Destination $targetRoot }
        throw "Candidate lifeboat bank failed its installed-bank self-test: $($candidateOutput -join [Environment]::NewLine)"
    }
    $null = Read-FreshHealthyHeartbeat -BankId $targetBank -ExpectedManifest $manifestSha256

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
        githubClaimConsumerIncluded = $true
        windowlessLauncher = $true
        windowlessLauncherSha256 = $windowlessLauncherSha256
    }
    Write-AtomicJson -Path $activeStatePath -Value $newState
}

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $wscriptExe -Argument "//B //Nologo `"$installedWindowlessLauncher`""
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$intervalTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)

if ($PSCmdlet.ShouldProcess($taskName, 'Register fixed independent Battle Bridge recovery lifeboat task')) {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logonTrigger, $intervalTrigger) -Principal $principal -Settings $settings -Description 'Independent A/B Battle Bridge recovery lifeboat outside the stephan-os checkout. Fixed GitHub-attested probe/wake adapters only; no arbitrary shell, Git mutation, merge, deployment or PC restart.' -Force | Out-Null
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
    installDisposition = 'PROMOTED_CANDIDATE'
    changed = $true
    candidateHeartbeatRequiredBeforePromotion = $true
    payloadHashVerificationRequired = $true
    githubClaimConsumerIncluded = $true
    githubEndpointFixed = $true
    githubTokenRequired = $false
    productionRedundancyReady = [bool]($activeBank -in @('A', 'B'))
    immutableLauncher = $true
    windowlessLauncher = $true
    windowlessLauncherSha256 = $windowlessLauncherSha256
    scheduledTaskExecutable = $wscriptExe
    scheduledTaskIdentityReproved = $false
    directPowerShellTaskLaunch = $false
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