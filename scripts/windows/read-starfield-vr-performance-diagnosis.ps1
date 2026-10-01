[CmdletBinding()]
param(
    [string]$WorkspaceRoot = '',
    [int]$MaxSamples = 720
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $WorkspaceRoot) {
    $WorkspaceRoot = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'
}
$vrRoot = Join-Path $WorkspaceRoot 'vr'
$sessionRoot = Join-Path $vrRoot 'starfield-vr-performance-sessions'
$governorPath = Join-Path $vrRoot 'vr-resource-governor-current.json'
$providerSlotPath = Join-Path $vrRoot 'starfield-vr-provider-slot-current.json'
$launchPath = Join-Path $vrRoot 'starfield-vr-launch-current.json'
$vrModeStatePath = Join-Path $vrRoot 'vr-mode-state-current.json'

function Get-OptionalValue {
    param($Object, [string]$Name, $Default = $null)
    if ($null -eq $Object) { return $Default }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $Default }
    return $property.Value
}

function Read-OptionalJson {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch { return $null }
}

function Get-NumericValues {
    param([object[]]$Rows, [string]$Name)
    $values = New-Object System.Collections.Generic.List[double]
    foreach ($row in @($Rows)) {
        $raw = Get-OptionalValue -Object $row -Name $Name
        if ($null -eq $raw -or [string]::IsNullOrWhiteSpace([string]$raw)) { continue }
        $parsed = 0.0
        if ([double]::TryParse([string]$raw, [ref]$parsed)) { $values.Add($parsed) }
    }
    return @($values)
}

function Get-Average {
    param([double[]]$Values)
    if (@($Values).Count -eq 0) { return $null }
    return [math]::Round((@($Values) | Measure-Object -Average).Average, 1)
}

function Get-Maximum {
    param([double[]]$Values)
    if (@($Values).Count -eq 0) { return $null }
    return [math]::Round((@($Values) | Measure-Object -Maximum).Maximum, 1)
}

function Get-Minimum {
    param([double[]]$Values)
    if (@($Values).Count -eq 0) { return $null }
    return [math]::Round((@($Values) | Measure-Object -Minimum).Minimum, 1)
}

$governor = Read-OptionalJson -Path $governorPath
$providerSlot = Read-OptionalJson -Path $providerSlotPath
$launch = Read-OptionalJson -Path $launchPath
$vrModeState = Read-OptionalJson -Path $vrModeStatePath

$csvFile = $null
if (Test-Path -LiteralPath $sessionRoot -PathType Container) {
    $csvFile = Get-ChildItem -LiteralPath $sessionRoot -Filter 'starfield-vr-performance-*.csv' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
}

$rows = @()
$summaryPath = ''
$summary = $null
if ($csvFile) {
    $rows = @(Import-Csv -LiteralPath $csvFile.FullName | Select-Object -Last ([Math]::Max(1, $MaxSamples)))
    $summaryPath = [System.IO.Path]::ChangeExtension($csvFile.FullName, '.summary.json')
    $summary = Read-OptionalJson -Path $summaryPath
}

$gpu = Get-NumericValues -Rows $rows -Name 'gpuUtilPct'
$gpuMemory = Get-NumericValues -Rows $rows -Name 'gpuMemoryPct'
$encoder = Get-NumericValues -Rows $rows -Name 'gpuEncoderUtilPct'
$starfieldCpu = Get-NumericValues -Rows $rows -Name 'starfieldCpuPct'
$systemCpu = Get-NumericValues -Rows $rows -Name 'systemCpuPct'
$llama = Get-NumericValues -Rows $rows -Name 'llamaServerCount'
$metaWorkingSet = Get-NumericValues -Rows $rows -Name 'metaVrWorkingSetMiB'
$driveFreeGiB = Get-NumericValues -Rows $rows -Name 'gameDriveFreeGiB'
$driveFreePct = Get-NumericValues -Rows $rows -Name 'gameDriveFreePct'
$driveActivePct = Get-NumericValues -Rows $rows -Name 'gameDriveActivePct'
$driveReadMiBps = Get-NumericValues -Rows $rows -Name 'gameDriveReadMiBps'
$driveWriteMiBps = Get-NumericValues -Rows $rows -Name 'gameDriveWriteMiBps'
$driveLatencyMs = Get-NumericValues -Rows $rows -Name 'gameDriveAvgLatencyMs'
$driveQueueLength = Get-NumericValues -Rows $rows -Name 'gameDriveQueueLength'
$pagesPerSec = Get-NumericValues -Rows $rows -Name 'pagesPerSec'

$airLinkSamples = 0
foreach ($row in $rows) {
    if ([string](Get-OptionalValue -Object $row -Name 'airLinkRuntimeActive' -Default 'False') -eq 'True') {
        $airLinkSamples += 1
    }
}
$airLinkPct = if ($rows.Count) { [math]::Round(($airLinkSamples / $rows.Count) * 100, 1) } else { 0 }

$metrics = [ordered]@{
    sampleCount = $rows.Count
    avgGpuUtilPct = Get-Average -Values $gpu
    maxGpuUtilPct = Get-Maximum -Values $gpu
    maxGpuMemoryPct = Get-Maximum -Values $gpuMemory
    maxGpuEncoderUtilPct = Get-Maximum -Values $encoder
    avgStarfieldCpuPct = Get-Average -Values $starfieldCpu
    maxStarfieldCpuPct = Get-Maximum -Values $starfieldCpu
    avgSystemCpuPct = Get-Average -Values $systemCpu
    maxSystemCpuPct = Get-Maximum -Values $systemCpu
    maxLlamaServerCount = Get-Maximum -Values $llama
    maxMetaVrWorkingSetMiB = Get-Maximum -Values $metaWorkingSet
    minGameDriveFreeGiB = Get-Minimum -Values $driveFreeGiB
    minGameDriveFreePct = Get-Minimum -Values $driveFreePct
    avgGameDriveActivePct = Get-Average -Values $driveActivePct
    maxGameDriveActivePct = Get-Maximum -Values $driveActivePct
    avgGameDriveReadMiBps = Get-Average -Values $driveReadMiBps
    avgGameDriveWriteMiBps = Get-Average -Values $driveWriteMiBps
    maxGameDriveLatencyMs = Get-Maximum -Values $driveLatencyMs
    maxGameDriveQueueLength = Get-Maximum -Values $driveQueueLength
    maxPagesPerSec = Get-Maximum -Values $pagesPerSec
    storageTelemetryAvailable = @($driveFreePct).Count -gt 0
    frameTimeTelemetryAvailable = $false
}

$signals = New-Object System.Collections.Generic.List[string]
$vrModeError = [string](Get-OptionalValue -Object $vrModeState -Name 'error' -Default '')
if ($vrModeError) { $signals.Add('vr-prelaunch-error-observed') }
if ($null -ne $metrics.maxLlamaServerCount -and $metrics.maxLlamaServerCount -gt 0) { $signals.Add('ollama-contention-observed') }
if ($null -ne $metrics.maxGpuMemoryPct -and $metrics.maxGpuMemoryPct -ge 90) { $signals.Add('vram-pressure-high') }
if ($null -ne $metrics.avgGpuUtilPct -and $metrics.avgGpuUtilPct -ge 90) { $signals.Add('gpu-saturation-high') }
if ($null -ne $metrics.maxGpuEncoderUtilPct -and $metrics.maxGpuEncoderUtilPct -ge 80) { $signals.Add('gpu-encoder-load-high') }
if ($null -ne $metrics.avgSystemCpuPct -and $metrics.avgSystemCpuPct -ge 85) { $signals.Add('system-cpu-load-high') }
if (
    ($null -ne $metrics.minGameDriveFreePct -and $metrics.minGameDriveFreePct -le 10) -or
    ($null -ne $metrics.minGameDriveFreeGiB -and $metrics.minGameDriveFreeGiB -le 50)
) { $signals.Add('drive-space-pressure-high') }
if (
    ($null -ne $metrics.avgGameDriveActivePct -and $metrics.avgGameDriveActivePct -ge 90) -or
    ($null -ne $metrics.maxGameDriveLatencyMs -and $metrics.maxGameDriveLatencyMs -ge 50) -or
    ($null -ne $metrics.maxGameDriveQueueLength -and $metrics.maxGameDriveQueueLength -ge 4)
) { $signals.Add('storage-io-pressure-high') }
if ($rows.Count -gt 0 -and $airLinkPct -eq 0) { $signals.Add('air-link-runtime-not-observed') }
if (-not $metrics.storageTelemetryAvailable) { $signals.Add('storage-source-not-yet-captured') }
$signals.Add('frame-time-source-not-yet-captured')

$storagePressure = $signals.Contains('drive-space-pressure-high') -or $signals.Contains('storage-io-pressure-high')
$focus = if ($signals.Contains('vr-prelaunch-error-observed')) {
    'LAUNCH_FAILURE'
} elseif ($storagePressure -and $signals.Contains('vram-pressure-high')) {
    'MULTI_RESOURCE_PRESSURE'
} elseif ($storagePressure) {
    'STORAGE_PRESSURE'
} elseif ($signals.Contains('vram-pressure-high')) {
    'VRAM_PRESSURE'
} elseif ($signals.Contains('ollama-contention-observed')) {
    'AI_RESOURCE_CONTENTION'
} elseif ($signals.Contains('gpu-saturation-high')) {
    'GPU_RENDER_LOAD'
} elseif ($signals.Contains('system-cpu-load-high')) {
    'CPU_LOAD'
} else {
    'FRAME_TIME_PROOF'
}

$latestTimestamp = if ($rows.Count) { [string](Get-OptionalValue -Object $rows[-1] -Name 'timestampUtc' -Default '') } else { '' }
$governorHeavyAfter = @(Get-OptionalValue -Object $governor -Name 'heavyModelsAfter' -Default @())

[ordered]@{
    schemaVersion = 'stephanos.starfield-vr-performance-diagnosis.v1'
    verdict = 'STARFIELD_VR_PERFORMANCE_DIAGNOSIS_READY'
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    telemetryPath = if ($csvFile) { $csvFile.FullName } else { '' }
    summaryPath = if ($summaryPath -and (Test-Path -LiteralPath $summaryPath -PathType Leaf)) { $summaryPath } else { '' }
    latestSampleAtUtc = $latestTimestamp
    metrics = $metrics
    signals = @($signals)
    focus = $focus
    context = [ordered]@{
        provider = [string](Get-OptionalValue -Object $providerSlot -Name 'provider' -Default '')
        providerSlotVerdict = [string](Get-OptionalValue -Object $providerSlot -Name 'verdict' -Default '')
        launchVerdict = [string](Get-OptionalValue -Object $launch -Name 'verdict' -Default '')
        governorPhase = [string](Get-OptionalValue -Object $governor -Name 'phase' -Default '')
        governorActive = [bool](Get-OptionalValue -Object $governor -Name 'active' -Default $false)
        heavyModelAllowed = [bool](Get-OptionalValue -Object $governor -Name 'heavyModelAllowed' -Default $false)
        heavyModelsAfter = @($governorHeavyAfter)
        localModelAllowed = [bool](Get-OptionalValue -Object $governor -Name 'localModelAllowed' -Default $true)
        loadedModelsAfter = @((Get-OptionalValue -Object $governor -Name 'loadedModelsAfter' -Default @()))
        completedSummaryAvailable = $null -ne $summary
        vrModeStatus = [string](Get-OptionalValue -Object $vrModeState -Name 'status' -Default '')
        vrModeTrafficLight = [string](Get-OptionalValue -Object $vrModeState -Name 'trafficLight' -Default '')
        vrModeError = $vrModeError
    }
    boundaries = [ordered]@{
        readOnly = $true
        changesGraphicsSettings = $false
        launchesGame = $false
        killsProcesses = $false
        arbitraryShellAllowed = $false
        mutationAuthority = $false
    }
} | ConvertTo-Json -Depth 10
