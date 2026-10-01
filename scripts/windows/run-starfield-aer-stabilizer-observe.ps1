[CmdletBinding()]
param(
    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$workspaceRoot = 'C:\Users\Stephan Callear\Documents\Stephanos-openclaw-workspace'
$repoRoot = 'C:\Users\Stephan Callear\Documents\GitHub\stephan-os'
$gameRoot = 'C:\Program Files (x86)\Steam\steamapps\common\Starfield'
$gameExe = Join-Path $gameRoot 'Starfield.exe'
$liveDll = Join-Path $gameRoot 'dxgi.dll'
$liveLoader = Join-Path $gameRoot 'openxr_loader.dll'
$liveLog = Join-Path $gameRoot 'starfield-aer-stabilizer.log'
$protectFlag = Join-Path $gameRoot 'starfield-aer-stabilizer-protect.flag'
$customDll = Join-Path $workspaceRoot 'vr\aer-stabilizer\builds\public-v2.0.1-observe\dxgi.dll'
$guardianScript = Join-Path $PSScriptRoot 'starfield-aer-stabilizer-guardian.ps1'
$profilePath = Join-Path $workspaceRoot 'vr\starfield-vr-launch-profile-mutar-openxr.json'
$modeStatePath = Join-Path $workspaceRoot 'vr\vr-mode-state-current.json'
$canonicalLauncher = Join-Path $repoRoot 'scripts\windows\launch-starfield-vr.ps1'
$performanceScript = Join-Path $repoRoot 'scripts\windows\starfield-vr-performance-mode.ps1'
$powershellExe = Join-Path $PSHOME 'powershell.exe'

$expectedBaselineHash = '63db15c370d3b8f15faa292a95d5c3abd4c6571cef0d35a45310d998adfeae41'
$expectedCustomHash = 'b0046baf0e4487c76d6a7c85c04b338e402f50f7557189e5e46a5b8c0932a76c'
$expectedLoaderHash = '663f021e6ace3a5624ce1d273d4a2714bf8e42bd595dee4481190ad2aea31f60'

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Write-JsonNoBom([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
}
function Require-File([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label missing: $Path" }
}
function Validate-LocalState {
    Require-File $gameExe 'Starfield executable'
    Require-File $liveDll 'Live MutaR injection DLL'
    Require-File $liveLoader 'OpenXR loader'
    Require-File $customDll 'AER stabilizer DLL'
    Require-File $guardianScript 'AER rollback guardian'
    Require-File $profilePath 'MutaR profile'
    Require-File $canonicalLauncher 'Canonical Starfield VR launcher'
    Require-File $performanceScript 'Starfield VR performance mode'

    if (Get-Process Starfield -ErrorAction SilentlyContinue) { throw 'Starfield is already running.' }

    $baselineHash = Get-Sha256 $liveDll
    $customHash = Get-Sha256 $customDll
    $loaderHash = Get-Sha256 $liveLoader

    if ($baselineHash -ne $expectedBaselineHash) { throw "Live MutaR DLL is not the pristine public baseline: $baselineHash" }
    if ($customHash -ne $expectedCustomHash) { throw "AER stabilizer DLL hash mismatch: $customHash" }
    if ($loaderHash -ne $expectedLoaderHash) { throw "OpenXR loader hash mismatch: $loaderHash" }

    $configPath = Join-Path $gameRoot 'vr_config.txt'
    Require-File $configPath 'MutaR config'
    $config = Get-Content -LiteralPath $configPath -Raw
    if ($config -notmatch '(?m)^VR_AsyncAER=false\s*$') { throw 'Expected comfortable baseline VR_AsyncAER=false is not active.' }
    if ($config -notmatch '(?m)^DLSS_AER_Enabled=true\s*$') { throw 'Expected comfortable baseline DLSS_AER_Enabled=true is not active.' }

    $protectFlagPresent = Test-Path -LiteralPath $protectFlag -PathType Leaf

    [pscustomobject]@{
        ok = $true
        baselineHash = $baselineHash
        customHash = $customHash
        loaderHash = $loaderHash
        configAsyncAer = 'false'
        configDlssAer = 'true'
        protectMode = if ($protectFlagPresent) { 'on' } else { 'off' }
        protectFlagPresent = $protectFlagPresent
    }
}

$validated = Validate-LocalState

if ($ValidateOnly) {
    [ordered]@{
        schemaVersion = 'stephanos.starfield-vr-aer-stabilizer-validation.v1'
        ready = -not [bool]$validated.protectFlagPresent
        mode = 'OBSERVE'
        rollbackArmed = $true
        validation = $validated
        validatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json -Depth 8
    if ([bool]$validated.protectFlagPresent) { exit 2 }
    exit 0
}

if ([bool]$validated.protectFlagPresent) {
    throw 'AER Observe is blocked because protect mode is explicitly armed. Validation did not change it.'
}

$readinessText = & $powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $canonicalLauncher -ReadinessOnly -ProfilePath $profilePath 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
    throw "Canonical MutaR readiness gate did not pass. Nothing was changed. $($readinessText.Trim())"
}
$readiness = $readinessText.Trim() | ConvertFrom-Json
if ([string]$readiness.verdict -ne 'STARFIELD_VR_LAUNCH_READY') {
    throw "Canonical MutaR readiness verdict is not ready. Nothing was changed."
}
if (-not $readiness.receiptPath -or -not (Test-Path -LiteralPath ([string]$readiness.receiptPath) -PathType Leaf)) {
    throw 'Canonical MutaR readiness receipt is missing. Nothing was changed.'
}
try {
    $readinessReceipt = Get-Content -LiteralPath ([string]$readiness.receiptPath) -Raw | ConvertFrom-Json
}
catch {
    throw 'Canonical MutaR readiness receipt is unreadable. Nothing was changed.'
}
if ($readinessReceipt.observations.airLinkSession.simulated -eq $true -or
    [string]$readinessReceipt.observations.airLinkSession.proofProcess -eq 'SIMULATED_READINESS_ONLY') {
    throw 'AER Observe requires a real Meta Air Link session; simulated readiness is test-only. Nothing was changed.'
}

$sessionRoot = Join-Path $workspaceRoot 'vr\aer-stabilizer\sessions'
New-Item -ItemType Directory -Force -Path $sessionRoot | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$sessionDir = Join-Path $sessionRoot ('observe-' + $stamp)
New-Item -ItemType Directory -Path $sessionDir -Force | Out-Null
$baselineBackup = Join-Path $sessionDir 'baseline-dxgi.dll'
$archiveLog = Join-Path $sessionDir 'starfield-aer-stabilizer.log'
$sessionPath = Join-Path $sessionDir 'session.json'

Copy-Item -LiteralPath $liveDll -Destination $baselineBackup -Force
if ((Get-Sha256 $baselineBackup) -ne $expectedBaselineHash) { throw 'Validated baseline backup hash mismatch before experimental swap.' }

Remove-Item -LiteralPath $liveLog -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $protectFlag -Force -ErrorAction SilentlyContinue

$state = [ordered]@{
    schemaVersion = 'stephanos.vr-mode-state.v1'
    game = 'Starfield'
    route = 'MutaR / OpenXR'
    aer = 'Async OFF / DLSS AER ON'
    stabilizerMode = 'OBSERVE'
    build = 'EXPERIMENTAL'
    rollback = 'ARMED'
    trafficLight = 'yellow'
    modeTraffic = [ordered]@{
        baseline = 'green'
        observe = 'green'
        protect = 'grey'
        adaptive = 'grey'
    }
    status = 'PREPARING'
    updatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    sessionPath = $sessionPath
}
Write-JsonNoBom $modeStatePath $state

$performanceMode = $null
$swapped = $false
try {
    Copy-Item -LiteralPath $customDll -Destination $liveDll -Force
    $swapped = $true
    if ((Get-Sha256 $liveDll) -ne $expectedCustomHash) { throw 'Experimental DLL swap verification failed.' }

    $perfText = & $powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $performanceScript -Action Enter -WorkspaceRoot $workspaceRoot -GameRoot $gameRoot 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Performance mode enter failed: $($perfText.Trim())" }
    $performanceMode = $perfText.Trim() | ConvertFrom-Json

    $game = Start-Process -FilePath $gameExe -WorkingDirectory $gameRoot -PassThru

    $session = [ordered]@{
        schemaVersion = 'stephanos.starfield-vr-aer-stabilizer-session.v1'
        enteredAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        mode = 'OBSERVE'
        expectedBaselineHash = $expectedBaselineHash
        expectedCustomHash = $expectedCustomHash
        liveDllPath = $liveDll
        baselineBackupPath = $baselineBackup
        liveLogPath = $liveLog
        archiveLogPath = $archiveLog
        protectFlagPath = $protectFlag
        modeStatePath = $modeStatePath
        sharedWorkspaceRoot = $workspaceRoot
        repoRoot = $repoRoot
        performanceSessionPath = [string]$performanceMode.sessionPath
        gameProcessId = $game.Id
        canonicalReadinessReceipt = [string]$readiness.receiptPath
    }
    Write-JsonNoBom $sessionPath $session

    $perfArgs = @(
        '-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass',
        '-File',('"{0}"' -f $performanceScript),
        '-Action','Guard',
        '-SessionPath',('"{0}"' -f [string]$performanceMode.sessionPath),
        '-GameProcessId',[string]$game.Id
    )
    $perfGuardian = Start-Process -FilePath $powershellExe -ArgumentList $perfArgs -WindowStyle Hidden -PassThru

    $rollbackArgs = @(
        '-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass',
        '-File',('"{0}"' -f $guardianScript),
        '-SessionPath',('"{0}"' -f $sessionPath),
        '-GameProcessId',[string]$game.Id
    )
    $rollbackGuardian = Start-Process -FilePath $powershellExe -ArgumentList $rollbackArgs -WindowStyle Hidden -PassThru

    $state.status = 'RUNNING'
    $state.rollback = 'ARMED'
    $state.trafficLight = 'yellow'
    $state.gameProcessId = $game.Id
    $state.performanceGuardianProcessId = $perfGuardian.Id
    $state.rollbackGuardianProcessId = $rollbackGuardian.Id
    $state.updatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    Write-JsonNoBom $modeStatePath $state

    [ordered]@{
        verdict = 'STARFIELD_AER_STABILIZER_OBSERVE_STARTED'
        gameProcessId = $game.Id
        performanceGuardianProcessId = $perfGuardian.Id
        rollbackGuardianProcessId = $rollbackGuardian.Id
        sessionPath = $sessionPath
        modeStatePath = $modeStatePath
        customDllHash = $expectedCustomHash
        rollbackBaselineHash = $expectedBaselineHash
    } | ConvertTo-Json -Depth 8
    exit 0
}
catch {
    if ($performanceMode -and $performanceMode.sessionPath) {
        try {
            & $powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $performanceScript -Action Restore -SessionPath ([string]$performanceMode.sessionPath) | Out-Null
        } catch {}
    }
    if ($swapped -and (Test-Path -LiteralPath $baselineBackup -PathType Leaf)) {
        Copy-Item -LiteralPath $baselineBackup -Destination $liveDll -Force
    }
    Remove-Item -LiteralPath $protectFlag -Force -ErrorAction SilentlyContinue

    $state.status = 'PRELAUNCH_FAILED'
    $state.rollback = if ((Get-Sha256 $liveDll) -eq $expectedBaselineHash) { 'RESTORED' } else { 'FAILED' }
    $state.trafficLight = if ($state.rollback -eq 'RESTORED') { 'yellow' } else { 'red' }
    $state.error = $_.Exception.Message
    $state.updatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    Write-JsonNoBom $modeStatePath $state
    throw
}
