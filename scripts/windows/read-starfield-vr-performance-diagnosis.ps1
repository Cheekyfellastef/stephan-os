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

if (-not (Test-Path -LiteralPath $sessionRoot -PathType Container)) {
    [ordered]@{
        schemaVersion = 'stephanos.starfield-vr-performance-diagnosis.v1'
        verdict = 'STARFIELD_VR_PERFORMANCE_TELEMETRY_NOT_FOUND'
        workspaceRoot = $WorkspaceRoot
        readOnly = $true
        mutationAuthority = $false
    } | ConvertTo-Json -Depth 6
    exit 0
}

$csvFile = Get-ChildItem -LiteralPath $sessionRoot -Filter 'starfield-vr-performance-*.csv' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1

if (-not $csvFile) {
    [ordered]@{
        schemaVersion = 'stephanos.starfield-vr-performance-diagnosis.v1'
        verdict = 'STARFIELD_VR_PERFORMANCE_TELEMETRY_NOT_FOUND'
        workspaceRoot = $WorkspaceRoot
        readOnly = $true
        mutationAuthority = $false
    } | ConvertTo-Json -Depth 6
    exit 0
}

$rows = @(Import-Csv -LiteralPath $csvFile.FullName | Select-Object -Last ([Math]::Max(1, $MaxSamples)))
$summaryPath = [System.IO.Path]::ChangeExtension($csvFile.FullName, '.summary.json')
$summary = Read-OptionalJson -Path $summaryPath
$governor = Read-OptionalJson -Path (Join-Path $vrRoot 'vr-resource-governor-current.json')
$providerSlot = Read-OptionalJson -Path (Join-Path $vrRoot 'starfield-vr-provider-slot-current.json')
$launch = Read-OptionalJson -Path (Join-Path $vrRoot 'starfield-vr-launch-current.json')

$gpu = Get-NumericValues -Rows $rows -Name 'gpuUtilPct'
$gpuMemory = Get-NumericValues -Rows $rows -Name 'gpuMemoryPct'
$encoder = Get-NumericValues -Rows $rows -Name 'gpuEncoderUtilPct'
$starfieldCpu = Get-NumericValues -Rows $rows -Name 'starfieldCpuPct'
$systemCpu = Get-NumericValues -Rows $rows -Name 'systemCpuPct'
$llama = Get-NumericValues -Rows $rows -Name 'llamaServerCount'
$metaWorkingSet = Get-NumericValues -Rows $rows -Name 'metaVrWorkingSetMiB'

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
    airLinkRuntimeSamplePct = $airLinkPct
    frameTimeTelemetryAvailable = $false
}

$signals = New-Object System.Collections.Generic.List[string]
if ($null -ne $metrics.maxLlamaServerCount -and $metrics.maxLlamaServerCount -gt 0) { $signals.Add('ollama-contention-observed') }
if ($null -ne $metrics.maxGpuMemoryPct -and $metrics.maxGpuMemoryPct -ge 90) { $signals.Add('vram-pressure-high') }
if ($null -ne $metrics.avgGpuUtilPct -and $metrics.avgGpuUtilPct -ge 90) { $signals.Add('gpu-saturation-high') }
if ($null -ne $metrics.maxGpuEncoderUtilPct -and $metrics.maxGpuEncoderUtilPct -ge 80) { $signals.Add('gpu-encoder-load-high') }
if ($null -ne $metrics.avgSystemCpuPct -and $metrics.avgSystemCpuPct -ge 85) { $signals.Add('system-cpu-load-high') }
if ($rows.Count -gt 0 -and $airLinkPct -eq 0) { $signals.Add('air-link-runtime-not-observed') }
$signals.Add('frame-time-source-not-yet-captured')

$focus = if ($signals.Contains('ollama-contention-observed')) {
    'AI_RESOURCE_CONTENTION'
} elseif ($signals.Contains('vram-pressure-high')) {
    'VRAM_PRESSURE'
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
    telemetryPath = $csvFile.FullName
    summaryPath = if (Test-Path -LiteralPath $summaryPath -PathType Leaf) { $summaryPath } else { '' }
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
        completedSummaryAvailable = $null -ne $summary
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
