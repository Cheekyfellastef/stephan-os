[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$WorkspaceRoot,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9._-]{1,120}$')][string]$GameId,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9._-]{1,120}$')][string]$Provider,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9._-]{1,160}$')][string]$LaunchSessionId,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9._-]{1,160}$')][string]$TargetExecutable,
    [string]$SourceHead = '',
    [string[]]$ProviderSensors = @(),
    [string]$ProviderTelemetryPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$installProofPath = Join-Path $WorkspaceRoot 'vr\telemetry\openxr-layer\install-current.json'
if (-not (Test-Path -LiteralPath $installProofPath -PathType Leaf)) {
    throw 'VR OpenXR telemetry layer is not installed.'
}
try { $install = Get-Content -LiteralPath $installProofPath -Raw | ConvertFrom-Json }
catch { throw 'VR OpenXR telemetry install proof is unreadable.' }

if ([string]$install.finalVerdict -ne 'VR_OPENXR_TELEMETRY_LAYER_INSTALLED' -or
    [bool]$install.modifiesFrameData -ne $false) {
    throw 'VR OpenXR telemetry install proof is not a pass-through installed layer.'
}
$manifestPath = [string]$install.manifestPath
$dllPath = [string]$install.dllPath
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $dllPath -PathType Leaf)) {
    throw 'VR OpenXR telemetry installed files are missing.'
}
$dllHash = (Get-FileHash -LiteralPath $dllPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($dllHash -ne ([string]$install.dllSha256).ToLowerInvariant()) {
    throw 'VR OpenXR telemetry layer hash no longer matches its install proof.'
}

$sessionRoot = Join-Path $WorkspaceRoot ('vr\telemetry\sessions\' + $LaunchSessionId)
New-Item -ItemType Directory -Path $sessionRoot -Force | Out-Null
$tracePath = Join-Path $sessionRoot 'openxr-visual.jsonl'
$markerPath = Join-Path $sessionRoot 'operator-markers.jsonl'
if (Test-Path -LiteralPath $tracePath) {
    throw 'VR OpenXR telemetry trace already exists for this launch session.'
}

$sourceHeadNormalized = if ($SourceHead -match '^[0-9a-fA-F]{40}$') { $SourceHead.ToLowerInvariant() } else { '' }
$providerSensorValues = @($ProviderSensors |
    Where-Object { $_ -match '^[A-Za-z0-9._-]{1,160}$' } |
    Select-Object -Unique)

[ordered]@{
    schemaVersion = 'stephanos.vr-telemetry-sensor-contract.v1'
    ok = $true
    gameId = $GameId
    provider = $Provider
    launchSessionId = $LaunchSessionId
    sourceHead = $sourceHeadNormalized
    targetExecutable = $TargetExecutable
    layerName = 'XR_APILAYER_STEPHANOS_telemetry_v1'
    layerManifestPath = $manifestPath
    layerDirectory = Split-Path -Parent $manifestPath
    dllPath = $dllPath
    dllSha256 = $dllHash
    tracePath = $tracePath
    markerPath = $markerPath
    providerTelemetryPath = $ProviderTelemetryPath
    sensors = @(
        'openxr.frame-lifecycle',
        'openxr.projection-presence',
        'openxr.stereo-submission',
        'openxr.swapchain-release',
        'openxr.eye-skew',
        'openxr.pose-display-delta',
        'openxr.pose-fov',
        'openxr.submission-anomaly',
        'operator.visual-fault-marker'
    ) + $providerSensorValues
    capabilities = [ordered]@{
        modifiesFrameData = $false
        pixelContentSampling = $false
        pixelContentState = 'UNOBSERVED'
        frameLifecycle = $true
        stereoSubmission = $true
        eyeTiming = $true
        poseTiming = $true
        operatorFaultMarkers = $true
        providerSpecificSensors = [bool]($providerSensorValues.Count -gt 0)
    }
} | ConvertTo-Json -Depth 8 -Compress
