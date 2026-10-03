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
$resourceGovernorScript = Join-Path $repoRoot 'scripts\windows\run-vr-resource-governor.ps1'
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
function Set-MutarConfigValue([string]$Content, [string]$Name, [string]$Value) {
    $pattern = '(?m)^' + [regex]::Escape($Name) + '=.*$'
    $line = "$Name=$Value"
    if ([regex]::IsMatch($Content, $pattern)) {
        return [regex]::Replace($Content, $pattern, $line, 1)
    }
    return $Content.TrimEnd() + [Environment]::NewLine + $line + [Environment]::NewLine
}
function Repair-ComfortableAerConfig([string]$ConfigPath) {
    Require-File $ConfigPath 'MutaR config'
    $before = Get-Content -LiteralPath $ConfigPath -Raw
    $after = Set-MutarConfigValue $before 'VR_AsyncAER' 'false'
    $after = Set-MutarConfigValue $after 'DLSS_AER_Enabled' 'true'
    if ($after -match '(?m)^CreationEngine_MotionVectorFix=true\s*$') {
        $after = [regex]::Replace($after, '(?m)^CreationEngine_MotionVectorFix=true\s*$', 'CreationEngine_MotionVectorFix=false', 1)
    }
    if ($after -ne $before) {
        [IO.File]::WriteAllText($ConfigPath, $after, (New-Object Text.UTF8Encoding($false)))
    }
    return $after
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
    Require-File $resourceGovernorScript 'Gaming resource governor'

    if (Get-Process Starfield -ErrorAction SilentlyContinue) { throw 'Starfield is already running.' }

    $baselineHash = Get-Sha256 $liveDll
    $customHash = Get-Sha256 $customDll
    $loaderHash = Get-Sha256 $liveLoader

    if ($baselineHash -ne $expectedBaselineHash) { throw "Live MutaR DLL is not the pristine public baseline: $baselineHash" }
    if ($customHash -ne $expectedCustomHash) { throw "AER stabilizer DLL hash mismatch: $customHash" }
    if ($loaderHash -ne $expectedLoaderHash) { throw "OpenXR loader hash mismatch: $loaderHash" }

    $configPath = Join-Path $gameRoot 'vr_config.txt'
    $config = Repair-ComfortableAerConfig $configPath
    if ($config -notmatch '(?m)^VR_AsyncAER=false\s*$') { throw 'Expected comfortable baseline VR_AsyncAER=false is not active.' }
    if ($config -notmatch '(?m)^DLSS_AER_Enabled=true\s*$') { throw 'Expected comfortable baseline DLSS_AER_Enabled=true is not active.' }
    if ($config -match '(?m)^CreationEngine_MotionVectorFix=true\s*$') { throw 'Rejected CreationEngine_MotionVectorFix=true is active.' }

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

$routeIdentity = $readinessReceipt.routeIdentity
if (-not $routeIdentity -or [string]$routeIdentity.provider -ne 'mutar-openxr') {
    throw 'Canonical MutaR readiness receipt did not carry verified mutar-openxr route identity.'
}
$runtimeSourceHead = ''
try { $runtimeSourceHead = (& git -C $repoRoot rev-parse HEAD 2>$null | Select-Object -First 1).Trim().ToLowerInvariant() } catch { $runtimeSourceHead = '' }
if ($runtimeSourceHead.Length -ne 40 -or $runtimeSourceHead -notmatch '^[a-f0-9]{40}') {
    throw 'AER Observe cannot prove the current repository source head.'
}
$sourceHead = ([string]$routeIdentity.sourceHead).ToLowerInvariant()
if ($sourceHead.Length -ne 40 -or $sourceHead -notmatch '^[a-f0-9]{40}') {
    throw 'Canonical MutaR readiness receipt did not carry a valid source head.'
}
if ($sourceHead -ne $runtimeSourceHead) {
    throw "AER Observe blocked a stale readiness receipt: receipt=$sourceHead runtime=$runtimeSourceHead"
}
$launchSessionId = [guid]::NewGuid().ToString('N')
$profileSha256 = ([string]$routeIdentity.profileSha256).ToLowerInvariant()

$resourceText = & $powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $resourceGovernorScript -Action PrepareGaming -ProcessName 'Starfield' -ProfileName 'vr-maximum' 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw "VR gaming resource preflight failed. $($resourceText.Trim())" }
$resourceGuard = $resourceText.Trim() | ConvertFrom-Json
if ([string]$resourceGuard.phase -notin @('PREPARING','GAMING') -or
    $resourceGuard.active -ne $true -or
    $resourceGuard.localModelAllowed -ne $false -or
    $resourceGuard.evictionHealthy -ne $true -or
    @($resourceGuard.loadedModelsAfter).Count -gt 0) {
    throw 'VR gaming resource preflight did not fully park local AI.'
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
$game = $null
$perfGuardian = $null
try {
    Copy-Item -LiteralPath $customDll -Destination $liveDll -Force
    $swapped = $true
    if ((Get-Sha256 $liveDll) -ne $expectedCustomHash) { throw 'Experimental DLL swap verification failed.' }

    $perfText = & $powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $performanceScript -Action Enter -WorkspaceRoot $workspaceRoot -GameRoot $gameRoot -Provider 'mutar-openxr' -ProfilePath $profilePath -ProfileSha256 $profileSha256 -LaunchSessionId $launchSessionId -SourceHead $sourceHead 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Performance mode enter failed: $($perfText.Trim())" }
    $performanceMode = $perfText.Trim() | ConvertFrom-Json
    if (-not $performanceMode.mutarComfortProfile -or
        [string]$performanceMode.mutarComfortProfile.VR_AsyncAER -ne 'false' -or
        [string]$performanceMode.mutarComfortProfile.DLSS_AER_Enabled -ne 'true') {
        throw 'Performance mode did not prove the MutaR comfort baseline before launch.'
    }
    $motionVectorApplied = $performanceMode.mutarComfortProfile.PSObject.Properties['CreationEngine_MotionVectorFix']
    if ($motionVectorApplied -and [string]$motionVectorApplied.Value -ne 'false') {
        throw 'Performance mode left the rejected CreationEngine_MotionVectorFix enabled.'
    }

    $performanceSessionPath = [string]$performanceMode.sessionPath
    $telemetrySessionId = [string]$performanceMode.routeIdentity.telemetrySessionId
    if (-not $performanceSessionPath -or -not (Test-Path -LiteralPath $performanceSessionPath -PathType Leaf) -or -not $telemetrySessionId) {
        throw 'Fresh canonical telemetry session was not created before Starfield launch.'
    }
    try {
        $performanceSession = Get-Content -LiteralPath $performanceSessionPath -Raw | ConvertFrom-Json
    }
    catch {
        throw 'Fresh canonical telemetry session could not be read before Starfield launch.'
    }
    if ([string]$performanceSession.routeIdentity.provider -ne 'mutar-openxr' -or
        [string]$performanceSession.routeIdentity.launchSessionId -ne $launchSessionId -or
        ([string]$performanceSession.routeIdentity.sourceHead).ToLowerInvariant() -ne $sourceHead -or
        ([string]$performanceSession.routeIdentity.profileSha256).ToLowerInvariant() -ne $profileSha256 -or
        [string]$performanceSession.routeIdentity.telemetrySessionId -ne $telemetrySessionId) {
        throw 'Fresh canonical telemetry session identity does not match this exact launch.'
    }

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
        performanceSessionPath = $performanceSessionPath
        gameProcessId = $game.Id
        canonicalReadinessReceipt = [string]$readiness.receiptPath
        routeIdentity = [ordered]@{
            provider = 'mutar-openxr'
            profilePath = $profilePath
            profileSha256 = $profileSha256
            launchSessionId = $launchSessionId
            sourceHead = $sourceHead
            telemetrySessionId = $telemetrySessionId
        }
        resourceGovernor = $resourceGuard
    }
    Write-JsonNoBom $sessionPath $session

    $rollbackArgs = @(
        '-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass',
        '-File',('"{0}"' -f $guardianScript),
        '-SessionPath',('"{0}"' -f $sessionPath),
        '-GameProcessId',[string]$game.Id
    )
    $rollbackGuardian = Start-Process -FilePath $powershellExe -ArgumentList $rollbackArgs -WindowStyle Hidden -PassThru

    $perfGuardianJson = & $powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $performanceScript -Action StartGuard -SessionPath ([string]$performanceMode.sessionPath) -GameProcessId ([int]$game.Id) 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or -not $perfGuardianJson.Trim()) {
        throw "Performance telemetry guardian failed to start: $($perfGuardianJson.Trim())"
    }
    $perfGuardianStart = $perfGuardianJson.Trim() | ConvertFrom-Json
    if ($perfGuardianStart.ok -ne $true -or [int]$perfGuardianStart.sampleCount -lt 1 -or [string]$perfGuardianStart.proof -ne 'FIRST_SAMPLE_RECORDED') {
        throw 'Performance telemetry guardian did not prove the first sample.'
    }
    $perfGuardian = Get-Process -Id ([int]$perfGuardianStart.guardianProcessId) -ErrorAction Stop

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
        telemetryFirstSampleAtUtc = [string]$perfGuardianStart.firstSampleAtUtc
        mutarComfortProfile = $performanceMode.mutarComfortProfile
        rollbackGuardianProcessId = $rollbackGuardian.Id
        sessionPath = $sessionPath
        modeStatePath = $modeStatePath
        customDllHash = $expectedCustomHash
        rollbackBaselineHash = $expectedBaselineHash
        routeIdentity = $session.routeIdentity
        resourceGovernorPhase = [string]$resourceGuard.phase
    } | ConvertTo-Json -Depth 8
    exit 0
}
catch {
    $failure = $_
    if ($game) {
        try {
            $game.Refresh()
            if (-not $game.HasExited) { Stop-Process -Id $game.Id -Force -ErrorAction SilentlyContinue }
        } catch {}
    }
    if ($perfGuardian) {
        try {
            $perfGuardian.Refresh()
            if (-not $perfGuardian.HasExited) { $perfGuardian.Kill() }
            $perfGuardian.WaitForExit()
            $perfGuardian.Dispose()
            $perfGuardian = $null
        }
        catch {
            throw "Telemetry guardian could not be reaped before rollback; rollback was not started. $($_.Exception.Message)"
        }
    }
    if ($performanceMode -and $performanceMode.sessionPath) {
        try {
            & $powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $performanceScript -Action Restore -SessionPath ([string]$performanceMode.sessionPath) | Out-Null
        } catch {}
    }
    try {
        & $powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $resourceGovernorScript -Action CancelPrepare | Out-Null
    } catch {}
    if ($swapped -and (Test-Path -LiteralPath $baselineBackup -PathType Leaf)) {
        Copy-Item -LiteralPath $baselineBackup -Destination $liveDll -Force
    }
    Remove-Item -LiteralPath $protectFlag -Force -ErrorAction SilentlyContinue

    $state.status = 'PRELAUNCH_FAILED'
    $state.rollback = if ((Get-Sha256 $liveDll) -eq $expectedBaselineHash) { 'RESTORED' } else { 'FAILED' }
    $state.trafficLight = if ($state.rollback -eq 'RESTORED') { 'yellow' } else { 'red' }
    $state.error = $failure.Exception.Message
    $state.updatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    Write-JsonNoBom $modeStatePath $state
    throw $failure
}
