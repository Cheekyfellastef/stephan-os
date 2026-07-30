[CmdletBinding()]
param(
    [string]$ProfilePath = '',
    [switch]$ReadinessOnly,
    [int]$AirLinkWaitSeconds = 60
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
            'Oculus\Support\oculus-client\OculusClient.exe',
            'Meta Horizon\Support\oculus-client\OculusClient.exe'
        )) {
            $candidate = Join-Path $root $relative
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                return (Resolve-Path -LiteralPath $candidate).Path
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
    $decision | ConvertTo-Json -Depth 8
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

$metaClientPath = Resolve-MetaClient
$airLinkActive = Test-AirLinkSessionActive
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
        proofProcess = if ($airLinkActive) { 'OculusDash' } else { '' }
    }
    activeOpenXrRuntimePath = $activeOpenXrRuntimePath
}

$observationsPath = Join-Path ([System.IO.Path]::GetTempPath()) "starfield-vr-observations-$([guid]::NewGuid().ToString('N')).json"
try {
    $observations | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $observationsPath -Encoding UTF8
    $decisionJson = & node $decisionScript --profile $ProfilePath --observations $observationsPath 2>&1 | Out-String
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
if ($decision.action -eq 'LAUNCH_VORPX') {
    $companionExecutable = (Resolve-Path -LiteralPath $companionExecutablePath).Path
    $companionProcess = Start-Process -FilePath $companionExecutable -PassThru
    $companionProcessId = $companionProcess.Id
    Start-Sleep -Seconds 3
}

$gameProcess = Start-Process -FilePath $launchExecutable -WorkingDirectory $workingDirectory -PassThru
$receiptPath = Write-LaunchReceipt `
    -Verdict 'STARFIELD_VR_LAUNCH_STARTED' `
    -Decision $decision `
    -Additional @{
        observations = $observations
        launchExecutable = $launchExecutable
        gameProcessId = $gameProcess.Id
        companionProcessId = $companionProcessId
    }

[ordered]@{
    verdict = 'STARFIELD_VR_LAUNCH_STARTED'
    selectedProvider = $decision.selectedProvider
    gameProcessId = $gameProcess.Id
    receiptPath = $receiptPath
} | ConvertTo-Json -Depth 6
