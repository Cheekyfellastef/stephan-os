[CmdletBinding()]
param(
    [string]$ProfilePath = '',
    [switch]$ReadinessOnly,
    [int]$AirLinkWaitSeconds = 60,
    [string]$NodeExecutablePath = '',
    [switch]$SimulateAirLinkForReadiness
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$workspaceRoot = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'
if (-not $ProfilePath) {
    $ProfilePath = Join-Path $workspaceRoot 'vr\starfield-vr-launch-profile.json'
}
$receiptRoot = Join-Path $workspaceRoot 'vr\starfield-vr-launch-receipts'
$latestReceiptPath = Join-Path $workspaceRoot 'vr\starfield-vr-launch-current.json'
$decisionScript = Join-Path $repositoryRoot 'scripts\starfield-vr-launch-decision.mjs'
$performanceModeScript = Join-Path $repositoryRoot 'scripts\windows\starfield-vr-performance-mode.ps1'
$powershellExecutable = Join-Path $PSHOME 'powershell.exe'
if (-not $NodeExecutablePath) {
    $nodeCommand = Get-Command -Name 'node.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($nodeCommand) {
        $NodeExecutablePath = [string]$nodeCommand.Source
    }
}

function Write-LaunchReceipt {
    param(
        [Parameter(Mandatory)][string]$Verdict,
        [Parameter(Mandatory)]$Decision,
        [hashtable]$Additional = @{}
    )

    New-Item -ItemType Directory -Path $receiptRoot -Force | Out-Null
    $receipt = [ordered]@{
        schemaVersion = 'stephanos.starfield-vr-launch-receipt.v1'
        writtenAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        goal = 1591
        workerGoal = 1595
        verdict = $Verdict
        profilePath = $ProfilePath
        decision = $Decision
    }
    foreach ($key in $Additional.Keys) {
        $receipt[$key] = $Additional[$key]
    }
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $receiptPath = Join-Path $receiptRoot "starfield-vr-launch-$timestamp.json"
    $json = $receipt | ConvertTo-Json -Depth 12
    $json | Set-Content -LiteralPath $receiptPath -Encoding UTF8
    $json | Set-Content -LiteralPath $latestReceiptPath -Encoding UTF8
    return $receiptPath
}

function Show-BlockedMessage {
    param([string[]]$Blockers, [string]$ReceiptPath)

    $message = @"
Starfield VR did not launch because the verified path is not ready.

$($Blockers -join "`r`n")

Nothing was changed and flat Starfield was not started.
Proof: $ReceiptPath
"@
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show(
            $message,
            'Starfield VR readiness',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
    }
    catch {
        Write-Host $message
    }
}

function Get-FileObservation {
    param([string]$Path)

    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [ordered]@{ path = $Path; exists = $false; sha256 = '' }
    }
    return [ordered]@{
        path = (Resolve-Path -LiteralPath $Path).Path
        exists = $true
        sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

function Get-OptionalProperty {
    param(
        $Object,
        [Parameter(Mandatory)][string]$Name
    )

    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Resolve-MetaClient {
    $roots = @($env:ProgramW6432, $env:ProgramFiles, ${env:ProgramFiles(x86)}) |
        Where-Object { $_ } |
        Select-Object -Unique
    foreach ($root in $roots) {
        foreach ($relative in @(
            'Oculus\Support\oculus-client\Client.exe',
            'Meta Horizon\Support\oculus-client\Client.exe',
            'Oculus\Support\oculus-client\OculusClient.exe',
            'Meta Horizon\Support\oculus-client\OculusClient.exe'
        )) {
            $candidate = Join-Path $root $relative
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                $item = Get-Item -LiteralPath $candidate
                if ($item.Length -gt 0) {
                    return (Resolve-Path -LiteralPath $candidate).Path
                }
            }
        }
    }
    return ''
}

function Get-ActiveOpenXrRuntimePath {
    try {
        return [string](Get-ItemPropertyValue -LiteralPath 'HKLM:\SOFTWARE\Khronos\OpenXR\1' -Name 'ActiveRuntime')
    }
    catch {
        return ''
    }
}

function Test-AirLinkSessionActive {
    return $null -ne (Get-Process -Name 'OculusDash' -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Start-OrReuseVerifiedVorpXCompanion {
    param([Parameter(Mandatory)][string]$CompanionExecutable)

    $expectedPath = (Resolve-Path -LiteralPath $CompanionExecutable).Path
    $expectedItem = Get-Item -LiteralPath $expectedPath
    $running = Get-CimInstance Win32_Process -Filter "Name='vorpControl.exe'" -ErrorAction SilentlyContinue
    foreach ($candidate in @($running)) {
        $candidatePath = [string]$candidate.ExecutablePath
        if (-not $candidatePath -or -not [string]::Equals(
            $candidatePath,
            $expectedPath,
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
            continue
        }

        $candidateStartedUtc = [System.Management.ManagementDateTimeConverter]::ToDateTime(
            [string]$candidate.CreationDate
        ).ToUniversalTime()
        if ($candidateStartedUtc -lt $expectedItem.LastWriteTimeUtc) {
            return [pscustomobject]@{
                Id = [int]$candidate.ProcessId
                Reused = $false
                Blocker = 'vorpx-running-process-predates-verified-binary'
            }
        }

        return [pscustomobject]@{
            Id = [int]$candidate.ProcessId
            Reused = $true
            Blocker = ''
        }
    }

    $companionExecutable = $expectedPath
    $companionProcess = Start-Process -FilePath $companionExecutable -PassThru
    Start-Sleep -Seconds 3
    return [pscustomobject]@{
        Id = [int]$companionProcess.Id
        Reused = $false
        Blocker = ''
    }
}

function Complete-BlockedLaunch {
    param([string[]]$Blockers, [string]$ErrorText = '')

    $decision = [ordered]@{
        ok = $false
        action = 'BLOCKED'
        blockers = @($Blockers)
        warnings = @()
    }
    if ($ErrorText) { $decision.error = $ErrorText }
    $receiptPath = Write-LaunchReceipt -Verdict 'STARFIELD_VR_LAUNCH_BLOCKED' -Decision $decision
    if ($ReadinessOnly) {
        [ordered]@{
            verdict = 'STARFIELD_VR_LAUNCH_BLOCKED'
            decision = $decision
            receiptPath = $receiptPath
        } | ConvertTo-Json -Depth 8
    }
    else {
        $decision | ConvertTo-Json -Depth 8
    }
    if (-not $ReadinessOnly) {
        Show-BlockedMessage -Blockers $Blockers -ReceiptPath $receiptPath
    }
    exit 2
}

if (-not (Test-Path -LiteralPath $decisionScript -PathType Leaf)) {
    Complete-BlockedLaunch -Blockers @('canonical-launch-decision-script-missing')
}
if (-not (Test-Path -LiteralPath $ProfilePath -PathType Leaf)) {
    Complete-BlockedLaunch -Blockers @('verified-launch-profile-missing')
}

try {
    $profile = Get-Content -LiteralPath $ProfilePath -Raw | ConvertFrom-Json
}
catch {
    Complete-BlockedLaunch -Blockers @('verified-launch-profile-unreadable') -ErrorText $_.Exception.Message
}

$profileBlockers = @()
if ((Get-OptionalProperty -Object $profile -Name 'schemaVersion') -ne 'stephanos.starfield-vr-launch-profile.v1') {
    $profileBlockers += 'profile-schema-unsupported'
}
if ((Get-OptionalProperty -Object $profile -Name 'status') -ne 'ready') {
    $profileBlockers += 'profile-not-ready'
}
if ((Get-OptionalProperty -Object $profile -Name 'transport') -ne 'meta-air-link') {
    $profileBlockers += 'transport-not-meta-air-link'
}
$selectedProvider = [string](Get-OptionalProperty -Object $profile -Name 'selectedProvider')
if ($selectedProvider -notin @('mutar-openxr', 'vorpx')) {
    $profileBlockers += 'provider-not-allowlisted'
}
$gameProfile = Get-OptionalProperty -Object $profile -Name 'game'
$providerProfile = Get-OptionalProperty -Object $profile -Name 'provider'
$gameLaunchPath = [string](Get-OptionalProperty -Object $gameProfile -Name 'launchExecutablePath')
$gameInstallationRoot = [string](Get-OptionalProperty -Object $gameProfile -Name 'installationRoot')
$companionExecutablePath = [string](Get-OptionalProperty -Object $providerProfile -Name 'companionExecutablePath')
if ($profileBlockers.Count -gt 0) {
    Complete-BlockedLaunch -Blockers $profileBlockers
}

if (-not $NodeExecutablePath -or -not (Test-Path -LiteralPath $NodeExecutablePath -PathType Leaf)) {
    Complete-BlockedLaunch -Blockers @('canonical-node-executable-missing')
}
$NodeExecutablePath = (Resolve-Path -LiteralPath $NodeExecutablePath).Path
if ([System.IO.Path]::GetFileName($NodeExecutablePath) -ine 'node.exe') {
    Complete-BlockedLaunch -Blockers @('canonical-node-executable-invalid')
}

$simulationStatePath = Join-Path $workspaceRoot 'vr\starfield-vr-sim-air-link.json'
if ($ReadinessOnly -and -not $SimulateAirLinkForReadiness -and (Test-Path -LiteralPath $simulationStatePath -PathType Leaf)) {
    try {
        $simulationState = Get-Content -LiteralPath $simulationStatePath -Raw | ConvertFrom-Json
        if ($simulationState.schemaVersion -eq 'stephanos.starfield-vr-sim-air-link.v1' -and $simulationState.enabled -eq $true -and $simulationState.purpose -eq 'readiness-only') {
            $SimulateAirLinkForReadiness = $true
        }
    } catch {
        $SimulateAirLinkForReadiness = $false
    }
}
$metaClientPath = Resolve-MetaClient
if ($SimulateAirLinkForReadiness -and -not $ReadinessOnly) {
    Complete-BlockedLaunch -Blockers @('simulated-air-link-is-readiness-only')
}
$airLinkSimulated = [bool]($SimulateAirLinkForReadiness -and $ReadinessOnly)
$airLinkActive = if ($airLinkSimulated) { $true } else { Test-AirLinkSessionActive }
if (-not $ReadinessOnly -and -not $airLinkActive -and $metaClientPath) {
    Start-Process -FilePath $metaClientPath | Out-Null
    $deadline = (Get-Date).AddSeconds([Math]::Max(1, $AirLinkWaitSeconds))
    while ((Get-Date) -lt $deadline -and -not $airLinkActive) {
        Start-Sleep -Milliseconds 500
        $airLinkActive = Test-AirLinkSessionActive
    }
}

$providerFiles = @()
$declaredProviderFiles = Get-OptionalProperty -Object $providerProfile -Name 'files'
if ($declaredProviderFiles) {
    foreach ($file in @($declaredProviderFiles)) {
        $providerFiles += Get-FileObservation -Path ([string]$file.path)
    }
}

$gameLauncherObservation = Get-FileObservation -Path $gameLaunchPath
$companionObservation = Get-FileObservation -Path $companionExecutablePath
$activeOpenXrRuntimePath = Get-ActiveOpenXrRuntimePath
$observations = [ordered]@{
    platform = 'win32'
    observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    gameLauncher = $gameLauncherObservation
    providerFiles = @($providerFiles)
    companionExecutable = $companionObservation
    metaClient = [ordered]@{
        path = $metaClientPath
        exists = [bool]($metaClientPath)
    }
    airLinkSession = [ordered]@{
        active = [bool]$airLinkActive
        simulated = [bool]$airLinkSimulated
        proofProcess = if ($airLinkSimulated) { 'SIMULATED_READINESS_ONLY' } elseif ($airLinkActive) { 'OculusDash' } else { '' }
    }
    activeOpenXrRuntimePath = $activeOpenXrRuntimePath
}

$observationsPath = Join-Path ([System.IO.Path]::GetTempPath()) "starfield-vr-observations-$([guid]::NewGuid().ToString('N')).json"
try {
    $observationsJson = $observations | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText(
        $observationsPath,
        $observationsJson,
        (New-Object System.Text.UTF8Encoding($false))
    )
    $decisionJson = & $NodeExecutablePath $decisionScript --profile $ProfilePath --observations $observationsPath 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        Complete-BlockedLaunch -Blockers @('canonical-launch-decision-failed') -ErrorText $decisionJson.Trim()
    }
    $decision = $decisionJson.Trim() | ConvertFrom-Json
}
catch {
    Complete-BlockedLaunch -Blockers @('canonical-launch-decision-unreadable') -ErrorText $_.Exception.Message
}
finally {
    Remove-Item -LiteralPath $observationsPath -Force -ErrorAction SilentlyContinue
}

if ($ReadinessOnly) {
    $verdict = if ($decision.ok) { 'STARFIELD_VR_LAUNCH_READY' } else { 'STARFIELD_VR_LAUNCH_BLOCKED' }
    $receiptPath = Write-LaunchReceipt -Verdict $verdict -Decision $decision -Additional @{ observations = $observations }
    [ordered]@{
        verdict = $verdict
        decision = $decision
        receiptPath = $receiptPath
    } | ConvertTo-Json -Depth 12
    if (-not $decision.ok) { exit 2 }
    exit 0
}

if (-not $decision.ok) {
    $receiptPath = Write-LaunchReceipt -Verdict 'STARFIELD_VR_LAUNCH_BLOCKED' -Decision $decision -Additional @{ observations = $observations }
    Show-BlockedMessage -Blockers @($decision.blockers) -ReceiptPath $receiptPath
    exit 2
}

$launchExecutable = (Resolve-Path -LiteralPath $gameLaunchPath).Path
$workingDirectory = (Resolve-Path -LiteralPath $gameInstallationRoot).Path
$companionProcessId = $null
$companionReused = $false
$performanceMode = $null
$performanceGuardianProcessId = $null
if ($decision.action -eq 'LAUNCH_MUTAR_OPENXR') {
    if (-not (Test-Path -LiteralPath $performanceModeScript -PathType Leaf)) {
        Complete-BlockedLaunch -Blockers @('starfield-vr-performance-mode-missing')
    }
    try {
        $performanceJson = & $powershellExecutable -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $performanceModeScript -Action Enter -WorkspaceRoot $workspaceRoot -GameRoot $workingDirectory 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { throw $performanceJson.Trim() }
        $performanceMode = $performanceJson.Trim() | ConvertFrom-Json
    }
    catch {
        Complete-BlockedLaunch -Blockers @('starfield-vr-performance-mode-enter-failed') -ErrorText $_.Exception.Message
    }
}

if ($decision.action -eq 'LAUNCH_VORPX') {
    $companionExecutable = (Resolve-Path -LiteralPath $companionExecutablePath).Path
    $companionSession = Start-OrReuseVerifiedVorpXCompanion -CompanionExecutable $companionExecutable
    if ([string]$companionSession.Blocker) {
        Complete-BlockedLaunch -Blockers @([string]$companionSession.Blocker)
    }
    $companionProcessId = [int]$companionSession.Id
    $companionReused = [bool]$companionSession.Reused
}

try {
    $gameProcess = Start-Process -FilePath $launchExecutable -WorkingDirectory $workingDirectory -PassThru
}
catch {
    if ($performanceMode -and $performanceMode.sessionPath) {
        & $powershellExecutable -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $performanceModeScript -Action Restore -SessionPath ([string]$performanceMode.sessionPath) | Out-Null
    }
    Complete-BlockedLaunch -Blockers @('starfield-vr-game-launch-failed') -ErrorText $_.Exception.Message
}

if ($performanceMode -and $performanceMode.sessionPath) {
    $guardianArguments = @(
        '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
        '-File', ('"{0}"' -f $performanceModeScript), '-Action', 'Guard',
        '-SessionPath', ('"{0}"' -f [string]$performanceMode.sessionPath),
        '-GameProcessId', [string]$gameProcess.Id
    )
    $performanceGuardian = Start-Process -FilePath $powershellExecutable -ArgumentList $guardianArguments -WindowStyle Hidden -PassThru
    $performanceGuardianProcessId = $performanceGuardian.Id
}

$receiptPath = Write-LaunchReceipt `
    -Verdict 'STARFIELD_VR_LAUNCH_STARTED' `
    -Decision $decision `
    -Additional @{
        observations = $observations
        launchExecutable = $launchExecutable
        gameProcessId = $gameProcess.Id
        companionProcessId = $companionProcessId
        companionReused = $companionReused
        performanceMode = $performanceMode
        performanceGuardianProcessId = $performanceGuardianProcessId
    }

[ordered]@{
    verdict = 'STARFIELD_VR_LAUNCH_STARTED'
    selectedProvider = $decision.selectedProvider
    gameProcessId = $gameProcess.Id
    performanceMode = $performanceMode
    performanceGuardianProcessId = $performanceGuardianProcessId
    receiptPath = $receiptPath
} | ConvertTo-Json -Depth 6
