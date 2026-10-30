[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$WorkspaceRoot,
    [Parameter(Mandatory)][string]$LaunchSessionId,
    [Parameter(Mandatory)][string]$Provider,
    [Parameter(Mandatory)][string]$SessionStartedAtUtc,
    [int]$GameProcessId = 0,
    [int]$PollSeconds = 5,
    [int]$NoGameGraceSeconds = 35,
    [int]$TailLines = 3500,
    [string]$PerfLogPath = '',
    [switch]$Once
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-JsonNoBom {
    param([string]$Path, $Value)
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    [IO.File]::WriteAllText(
        $Path,
        ($Value | ConvertTo-Json -Depth 8),
        (New-Object Text.UTF8Encoding($false))
    )
}

function Get-OptionalDouble {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) { return $null }
    $parsed = 0.0
    if ([double]::TryParse(
        [string]$property.Value,
        [Globalization.NumberStyles]::Float,
        [Globalization.CultureInfo]::InvariantCulture,
        [ref]$parsed
    )) {
        if (-not [double]::IsNaN($parsed) -and -not [double]::IsInfinity($parsed)) {
            return $parsed
        }
    }
    return $null
}

function Get-LatestPerfLogPath {
    if ($PerfLogPath) {
        if (Test-Path -LiteralPath $PerfLogPath -PathType Leaf) { return $PerfLogPath }
        return ''
    }
    $root = Join-Path $env:LOCALAPPDATA 'Oculus'
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { return '' }
    $file = Get-ChildItem -LiteralPath $root -Filter 'PerfLog_*.json' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if ($file) { return [string]$file.FullName }
    return ''
}

function Get-LatestXrsStatsEvent {
    param([Parameter(Mandatory)][string]$Path)

    $lines = @(Get-Content -LiteralPath $Path -Tail ([Math]::Max(500, $TailLines)) -ErrorAction Stop)
    if ($lines.Count -eq 0) { return $null }

    $eventIndex = -1
    for ($i = $lines.Count - 1; $i -ge 0; $i -= 1) {
        if ([string]$lines[$i] -match '"event"\s*:\s*"oculus_pc_xrs_stats_event"') {
            $eventIndex = $i
            break
        }
    }
    if ($eventIndex -lt 0) { return $null }

    $start = -1
    for ($i = $eventIndex; $i -ge 0; $i -= 1) {
        $trimmed = ([string]$lines[$i]).Trim()
        if ($trimmed -eq '},{' -or $trimmed -eq '[{' -or $trimmed -eq '{') {
            $start = $i
            break
        }
    }
    if ($start -lt 0) { return $null }

    $end = -1
    for ($i = $eventIndex + 1; $i -lt $lines.Count; $i += 1) {
        $trimmed = ([string]$lines[$i]).Trim()
        if ($trimmed -eq '},{' -or $trimmed -eq '}]' -or $trimmed -eq '}') {
            $end = $i
            break
        }
    }
    if ($end -lt 0) { return $null }

    $objectLines = New-Object System.Collections.Generic.List[string]
    $objectLines.Add('{')
    for ($i = $start + 1; $i -lt $end; $i += 1) {
        $objectLines.Add([string]$lines[$i])
    }
    $objectLines.Add('}')

    try {
        $payload = ($objectLines.ToArray() -join [Environment]::NewLine) | ConvertFrom-Json
        if ([string]$payload.event -ne 'oculus_pc_xrs_stats_event') { return $null }
        return $payload
    }
    catch {
        return $null
    }
}

function Get-EventUtc {
    param($Stats)
    $epoch = Get-OptionalDouble -Object $Stats -Name 'timestamp_epoch'
    if ($null -eq $epoch -or $epoch -le 0) { return $null }
    try {
        $milliseconds = [long][Math]::Round($epoch * 1000.0)
        return [DateTimeOffset]::FromUnixTimeMilliseconds($milliseconds).UtcDateTime
    }
    catch {
        return $null
    }
}

function Get-Rounded {
    param($Value, [int]$Digits = 2)
    if ($null -eq $Value) { return $null }
    return [Math]::Round([double]$Value, $Digits)
}

function Convert-XrsStatsToRuntimeMetrics {
    param($Stats, [DateTime]$EventUtc)

    $duration = Get-OptionalDouble -Object $Stats -Name 'collection_duration_seconds'
    if ($null -eq $duration -or $duration -le 0) {
        $duration = Get-OptionalDouble -Object $Stats -Name 'fixed_upload_interval_seconds'
    }
    if ($null -eq $duration -or $duration -le 0) { $duration = 60.0 }

    $presented = Get-OptionalDouble -Object $Stats -Name 'num_pc_presented_frames'
    $appNative = Get-OptionalDouble -Object $Stats -Name 'num_pc_app_nonreprojected_frames'
    $appEarlyReprojected = Get-OptionalDouble -Object $Stats -Name 'num_pc_app_early_reprojected_frames'
    if ($null -eq $appNative) { $appNative = 0.0 }
    if ($null -eq $appEarlyReprojected) { $appEarlyReprojected = 0.0 }
    $appFrames = $appNative + $appEarlyReprojected

    $appCounterCadenceHz = if ($appFrames -gt 0 -and $duration -gt 0) { $appFrames / $duration } else { $null }
    $deliveredCadenceHz = if ($null -ne $presented -and $presented -gt 0 -and $duration -gt 0) {
        $presented / $duration
    } else { $null }
    # Meta's app-frame counters can collapse while the OpenXR compositor continues
    # to present MutaR frames. Its render-duration percentile is the stable measure
    # that tracks the headset-visible low-FPS phase, so use that as frame time.
    $renderSecondsP50 = Get-OptionalDouble -Object $Stats -Name 'render_duration_seconds_p50'
    $renderSecondsP95 = Get-OptionalDouble -Object $Stats -Name 'render_duration_seconds_p95'
    $applicationFrameTimeMs = if ($null -ne $renderSecondsP50 -and $renderSecondsP50 -gt 0) {
        $renderSecondsP50 * 1000.0
    } else { $null }
    $renderCadenceEstimateHz = if ($null -ne $applicationFrameTimeMs -and $applicationFrameTimeMs -gt 0) {
        1000.0 / $applicationFrameTimeMs
    } else { $null }

    $encodeSeconds = Get-OptionalDouble -Object $Stats -Name 'encode_duration_seconds_p50'
    $decodeSeconds = Get-OptionalDouble -Object $Stats -Name 'decode_duration_seconds_p50'
    $networkRttMs = Get-OptionalDouble -Object $Stats -Name 'network_rtt_ms_p50'
    $networkJitterMs = Get-OptionalDouble -Object $Stats -Name 'network_rtt_ms_jitter'
    $goodputMbps = Get-OptionalDouble -Object $Stats -Name 'total_network_video_goodput_Mbps'
    $headsetHz = Get-OptionalDouble -Object $Stats -Name 'fps'
    $lostPresented = Get-OptionalDouble -Object $Stats -Name 'lost_pc_presented_frames'
    $reprojections = Get-OptionalDouble -Object $Stats -Name 'num_reprojections'
    $glitches = Get-OptionalDouble -Object $Stats -Name 'num_glitches'
    $renderWidth = Get-OptionalDouble -Object $Stats -Name 'app_render_width'
    $renderHeight = Get-OptionalDouble -Object $Stats -Name 'app_render_height'
    $presentLossPct = if ($null -ne $lostPresented -and $null -ne $presented -and ($lostPresented + $presented) -gt 0) {
        ($lostPresented / ($lostPresented + $presented)) * 100.0
    } else { $null }

    return [ordered]@{
        schemaVersion = 'stephanos.starfield-vr-runtime-metrics.v1'
        source = 'META_OCULUS_PERFLOG_XRS_STATS'
        observedAtUtc = $EventUtc.ToString('o')
        launchSessionId = $LaunchSessionId
        provider = $Provider
        applicationFrameTimeMs = Get-Rounded -Value $applicationFrameTimeMs
        deliveredCadenceHz = Get-Rounded -Value $deliveredCadenceHz
        headsetRefreshRateHz = Get-Rounded -Value $headsetHz
        droppedFrames = if ($null -ne $lostPresented) { [int][Math]::Round($lostPresented) } else { $null }
        reprojectionState = if ($null -ne $reprojections -and $reprojections -gt 0) { 'REPROJECTING' } else { 'NONE_OBSERVED' }
        aswState = ''
        encodeLatencyMs = if ($null -ne $encodeSeconds) { Get-Rounded -Value ($encodeSeconds * 1000.0) } else { $null }
        networkLatencyMs = Get-Rounded -Value $networkRttMs
        decodeLatencyMs = if ($null -ne $decodeSeconds) { Get-Rounded -Value ($decodeSeconds * 1000.0) } else { $null }
        airLinkBitrateMbps = Get-Rounded -Value $goodputMbps
        packetLossPct = $null
        jitterMs = Get-Rounded -Value $networkJitterMs
        openXrRenderWidth = if ($null -ne $renderWidth) { [int][Math]::Round($renderWidth) } else { $null }
        openXrRenderHeight = if ($null -ne $renderHeight) { [int][Math]::Round($renderHeight) } else { $null }
        renderScalePct = $null
        leftEyePresentMs = $null
        rightEyePresentMs = $null
        eyePresentationSkewMs = $null
        poseAgeMs = $null
        stereoMode = ''
        meta = [ordered]@{
            collectionDurationSeconds = Get-Rounded -Value $duration
            renderCadenceEstimateHz = Get-Rounded -Value $renderCadenceEstimateHz
            renderDurationP95Ms = if ($null -ne $renderSecondsP95) { Get-Rounded -Value ($renderSecondsP95 * 1000.0) } else { $null }
            appCounterCadenceHz = Get-Rounded -Value $appCounterCadenceHz
            presentedFrameCount = if ($null -ne $presented) { [int][Math]::Round($presented) } else { $null }
            nativeAppFrameCount = [int][Math]::Round($appNative)
            earlyReprojectedAppFrameCount = [int][Math]::Round($appEarlyReprojected)
            reprojectionCount = if ($null -ne $reprojections) { [int][Math]::Round($reprojections) } else { $null }
            glitchCount = if ($null -ne $glitches) { [int][Math]::Round($glitches) } else { $null }
            presentLossPct = Get-Rounded -Value $presentLossPct
            codec = if ($Stats.PSObject.Properties['codec']) { [string]$Stats.codec } else { '' }
            encodeWidth = Get-OptionalDouble -Object $Stats -Name 'encode_width'
            encodeHeight = Get-OptionalDouble -Object $Stats -Name 'encode_height'
            cpuLoadP50 = Get-OptionalDouble -Object $Stats -Name 'cpu_load_percent_p50'
            wifiTxLinkSpeedMbpsP50 = Get-OptionalDouble -Object $Stats -Name 'wifi_tx_link_speed_mbps_p50'
            wifiRxLinkSpeedMbpsP50 = Get-OptionalDouble -Object $Stats -Name 'wifi_rx_link_speed_mbps_p50'
        }
    }
}

$sessionStartUtc = [DateTime]::Parse($SessionStartedAtUtc).ToUniversalTime()
$outputPath = Join-Path $WorkspaceRoot 'vr\starfield-vr-runtime-metrics-current.json'
$lastEventStamp = ''
$gameMissingSince = $null

do {
    try {
        $path = Get-LatestPerfLogPath
        if ($path) {
            $stats = Get-LatestXrsStatsEvent -Path $path
            if ($stats) {
                $eventUtc = Get-EventUtc -Stats $stats
                if ($eventUtc -and $eventUtc -ge $sessionStartUtc.AddSeconds(-2)) {
                    $eventStamp = $eventUtc.ToString('o')
                    if ($eventStamp -ne $lastEventStamp -or -not (Test-Path -LiteralPath $outputPath -PathType Leaf)) {
                        $payload = Convert-XrsStatsToRuntimeMetrics -Stats $stats -EventUtc $eventUtc
                        $payload['sourcePath'] = $path
                        $payload['writtenAtUtc'] = (Get-Date).ToUniversalTime().ToString('o')
                        Write-JsonNoBom -Path $outputPath -Value $payload
                        $lastEventStamp = $eventStamp
                    }
                }
            }
        }
    }
    catch {
        # Missing or mid-write Meta telemetry must never take the game down.
    }

    if ($Once) { break }

    $starfield = @(Get-Process -Name 'Starfield' -ErrorAction SilentlyContinue)
    if ($starfield.Count -gt 0) {
        $gameMissingSince = $null
    }
    else {
        if (-not $gameMissingSince) { $gameMissingSince = Get-Date }
        if (((Get-Date) - $gameMissingSince).TotalSeconds -ge [Math]::Max(5, $NoGameGraceSeconds)) { break }
    }
    Start-Sleep -Seconds ([Math]::Max(1, $PollSeconds))
} while ($true)
