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
    [string]$ProviderTelemetryPath = '',
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

function Get-LatestOpenXrVisualEvent {
    $tracePath = Join-Path $WorkspaceRoot ('vr\telemetry\sessions\' + $LaunchSessionId + '\openxr-visual.jsonl')
    if (-not (Test-Path -LiteralPath $tracePath -PathType Leaf)) { return $null }
    try {
        $lines = @(Get-Content -LiteralPath $tracePath -Tail 500 -ErrorAction Stop)
        for ($i = $lines.Count - 1; $i -ge 0; $i -= 1) {
            $line = [string]$lines[$i]
            if ($line -notmatch '"event"\s*:\s*"end_frame"') { continue }
            try {
                $event = $line | ConvertFrom-Json
                if ([string]$event.launchSessionId -ne $LaunchSessionId) { continue }
                $event | Add-Member -NotePropertyName tracePath -NotePropertyValue $tracePath -Force
                $event | Add-Member -NotePropertyName fileObservedAtUtc -NotePropertyValue ((Get-Item -LiteralPath $tracePath).LastWriteTimeUtc.ToString('o')) -Force
                return $event
            } catch {}
        }
    } catch {}
    return $null
}

function Get-OperatorMarkerState {
    $markerPath = Join-Path $WorkspaceRoot ('vr\telemetry\sessions\' + $LaunchSessionId + '\operator-markers.jsonl')
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
        return [pscustomobject]@{ count = 0; lastRecordedAtUtc = ''; lastSource = ''; path = $markerPath }
    }
    try {
        $lines = @(Get-Content -LiteralPath $markerPath -ErrorAction Stop | Where-Object { $_.Trim() })
        $last = $null
        if ($lines.Count -gt 0) { try { $last = $lines[-1] | ConvertFrom-Json } catch {} }
        return [pscustomobject]@{
            count = $lines.Count
            lastRecordedAtUtc = if ($last) { [string]$last.recordedAtUtc } else { '' }
            lastSource = if ($last) { [string]$last.source } else { '' }
            path = $markerPath
        }
    } catch {
        return [pscustomobject]@{ count = 0; lastRecordedAtUtc = ''; lastSource = ''; path = $markerPath }
    }
}

function Get-ProviderTelemetryState {
    if (-not $ProviderTelemetryPath -or -not (Test-Path -LiteralPath $ProviderTelemetryPath -PathType Leaf)) {
        return [pscustomobject]@{
            available = $false
            event = ''
            sequenceFaultCount = 0
            prev = $null
            current = $null
            delta = $null
            prevParity = $null
            currentParity = $null
            engine = $null
            render = $null
            presenter = $null
            renderLoop = $null
        }
    }
    try {
        $lines = @(Get-Content -LiteralPath $ProviderTelemetryPath -Tail 5000 -ErrorAction Stop)
        $faults = @($lines | Where-Object { [string]$_ -like 'SEQUENCE_FAULT,*' })
        $candidate = if ($faults.Count -gt 0) { [string]$faults[-1] } else {
            [string]($lines | Where-Object { [string]$_ -like 'ACTIVE,*' } | Select-Object -Last 1)
        }
        if (-not $candidate) {
            return [pscustomobject]@{ available = $false; event = ''; sequenceFaultCount = 0 }
        }
        $parts = @($candidate -split ',')
        $values = @{}
        foreach ($part in $parts | Select-Object -Skip 1) {
            $pair = @($part -split '=', 2)
            if ($pair.Count -eq 2) { $values[$pair[0]] = $pair[1] }
        }
        $number = {
            param([string]$Name)
            if (-not $values.ContainsKey($Name)) { return $null }
            $parsed = 0.0
            if ([double]::TryParse([string]$values[$Name], [ref]$parsed)) { return $parsed }
            return $null
        }
        $sequenceFaultCount = $faults.Count
        if ($values.ContainsKey('fault')) {
            $parsedFault = 0
            if ([int]::TryParse([string]$values['fault'], [ref]$parsedFault) -and $parsedFault -ge 0) {
                $sequenceFaultCount = [Math]::Max($sequenceFaultCount, $parsedFault)
            }
        }
        return [pscustomobject]@{
            available = $true
            event = [string]$parts[0]
            sequenceFaultCount = $sequenceFaultCount
            prev = & $number 'prev'
            current = & $number 'current'
            delta = & $number 'delta'
            prevParity = & $number 'prevParity'
            currentParity = & $number 'currentParity'
            engine = & $number 'engine'
            render = & $number 'render'
            presenter = & $number 'presenter'
            renderLoop = & $number 'renderLoop'
        }
    } catch {
        return [pscustomobject]@{ available = $false; event = ''; sequenceFaultCount = 0 }
    }
}

function Add-ProviderTelemetryToRuntimeMetrics {
    param($Payload, $ProviderState)
    $Payload['providerTelemetryAvailable'] = [bool]$ProviderState.available
    $Payload['aerTelemetryEvent'] = [string]$ProviderState.event
    $Payload['aerSequenceFaultCount'] = [int]$ProviderState.sequenceFaultCount
    $Payload['aerPrevPresenterFrame'] = $ProviderState.prev
    $Payload['aerCurrentPresenterFrame'] = $ProviderState.current
    $Payload['aerPresenterDelta'] = $ProviderState.delta
    $Payload['aerPrevParity'] = $ProviderState.prevParity
    $Payload['aerCurrentParity'] = $ProviderState.currentParity
    $Payload['aerEngineFrame'] = $ProviderState.engine
    $Payload['aerRenderFrame'] = $ProviderState.render
    $Payload['aerPresenterFrame'] = $ProviderState.presenter
    $Payload['aerRenderLoopFrame'] = $ProviderState.renderLoop
}

function Add-VisualTelemetryToRuntimeMetrics {
    param($Payload, $Visual, $Marker)
    if (-not $Visual) {
        $Payload['visualTelemetryAvailable'] = $false
        $Payload['operatorMarkerCount'] = [int]$Marker.count
        $Payload['lastOperatorMarkerAtUtc'] = [string]$Marker.lastRecordedAtUtc
        $Payload['lastOperatorMarkerSource'] = [string]$Marker.lastSource
        return
    }

    $eyes = @($Visual.eyes)
    $left = if ($eyes.Count -ge 1) { $eyes[0] } else { $null }
    $right = if ($eyes.Count -ge 2) { $eyes[1] } else { $null }
    $leftPresent = Get-OptionalDouble -Object $left -Name 'releaseToEndMs'
    $rightPresent = Get-OptionalDouble -Object $right -Name 'releaseToEndMs'
    $eyeSkew = Get-OptionalDouble -Object $Visual -Name 'eyePresentationSkewMs'
    $poseDelta = Get-OptionalDouble -Object $Visual -Name 'poseDisplayDeltaMs'
    $predictionDelta = Get-OptionalDouble -Object $Visual -Name 'predictionDeltaMs'

    if ($null -ne $leftPresent -and $leftPresent -ge 0) { $Payload['leftEyePresentMs'] = Get-Rounded $leftPresent 4 }
    if ($null -ne $rightPresent -and $rightPresent -ge 0) { $Payload['rightEyePresentMs'] = Get-Rounded $rightPresent 4 }
    if ($null -ne $eyeSkew -and $eyeSkew -ge 0) { $Payload['eyePresentationSkewMs'] = Get-Rounded $eyeSkew 4 }
    if ($null -ne $poseDelta) { $Payload['poseAgeMs'] = Get-Rounded ([Math]::Abs($poseDelta)) 4 }
    $Payload['stereoMode'] = if ([int]$Visual.projectionViews -ge 2) { 'OPENXR_PRIMARY_STEREO' } else { 'OPENXR_STEREO_INCOMPLETE' }
    $Payload['visualTelemetryAvailable'] = $true
    $Payload['visualFrameSerial'] = [long]$Visual.frame
    $Payload['visualFrameState'] = [string]$Visual.visualFrameState
    $Payload['visualProjectionLayers'] = [int]$Visual.projectionLayers
    $Payload['visualProjectionViews'] = [int]$Visual.projectionViews
    $Payload['visualLocatedViews'] = [int]$Visual.locatedViews
    $Payload['visualShouldRender'] = [bool]$Visual.shouldRender
    $Payload['visualReleaseMissing'] = [bool]$Visual.releaseMissing
    $Payload['visualReleaseReused'] = [bool]$Visual.releaseReused
    $Payload['visualEndFrameResult'] = [int]$Visual.result
    $Payload['visualPredictionDeltaMs'] = if ($null -ne $predictionDelta) { Get-Rounded $predictionDelta 4 } else { $null }
    $Payload['visualPoseDisplayDeltaMs'] = if ($null -ne $poseDelta) { Get-Rounded $poseDelta 4 } else { $null }
    $Payload['visualPixelContentState'] = [string]$Visual.pixelContentState
    $Payload['visualTracePath'] = [string]$Visual.tracePath
    $Payload['visualObservedAtUtc'] = [string]$Visual.fileObservedAtUtc
    $Payload['operatorMarkerCount'] = [int]$Marker.count
    $Payload['lastOperatorMarkerAtUtc'] = [string]$Marker.lastRecordedAtUtc
    $Payload['lastOperatorMarkerSource'] = [string]$Marker.lastSource
}

function New-VisualOnlyRuntimeMetrics {
    param([DateTime]$ObservedAtUtc)
    return [ordered]@{
        schemaVersion = 'stephanos.starfield-vr-runtime-metrics.v1'
        source = 'STEPHANOS_OPENXR_VISUAL_TELEMETRY'
        observedAtUtc = $ObservedAtUtc.ToString('o')
        launchSessionId = $LaunchSessionId
        provider = $Provider
        applicationFrameTimeMs = $null
        deliveredCadenceHz = $null
        headsetRefreshRateHz = $null
        droppedFrames = $null
        reprojectionState = ''
        aswState = ''
        encodeLatencyMs = $null
        networkLatencyMs = $null
        decodeLatencyMs = $null
        airLinkBitrateMbps = $null
        packetLossPct = $null
        jitterMs = $null
        openXrRenderWidth = $null
        openXrRenderHeight = $null
        renderScalePct = $null
        leftEyePresentMs = $null
        rightEyePresentMs = $null
        eyePresentationSkewMs = $null
        poseAgeMs = $null
        stereoMode = ''
        meta = [ordered]@{}
    }
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
$lastMetaEventStamp = ''
$lastVisualFrameSerial = -1
$gameMissingSince = $null

do {
    try {
        $path = Get-LatestPerfLogPath
        $stats = if ($path) { Get-LatestXrsStatsEvent -Path $path } else { $null }
        $eventUtc = if ($stats) { Get-EventUtc -Stats $stats } else { $null }
        if ($eventUtc -and $eventUtc -lt $sessionStartUtc.AddSeconds(-2)) {
            $stats = $null
            $eventUtc = $null
        }

        $visual = Get-LatestOpenXrVisualEvent
        $marker = Get-OperatorMarkerState
        $providerState = Get-ProviderTelemetryState
        $visualFrameSerial = if ($visual) { [long]$visual.frame } else { -1 }
        $metaEventStamp = if ($eventUtc) { $eventUtc.ToString('o') } else { '' }
        $metaChanged = [bool]($metaEventStamp -and $metaEventStamp -ne $lastMetaEventStamp)
        $visualChanged = [bool]($visualFrameSerial -ge 0 -and $visualFrameSerial -ne $lastVisualFrameSerial)

        if ($metaChanged -or $visualChanged -or -not (Test-Path -LiteralPath $outputPath -PathType Leaf)) {
            $observedNow = (Get-Date).ToUniversalTime()
            $payload = if ($stats -and $eventUtc) {
                Convert-XrsStatsToRuntimeMetrics -Stats $stats -EventUtc $observedNow
            } else {
                New-VisualOnlyRuntimeMetrics -ObservedAtUtc $observedNow
            }
            $payload['metaSourceObservedAtUtc'] = $metaEventStamp
            $payload['sourcePath'] = if ($path) { $path } else { '' }
            Add-VisualTelemetryToRuntimeMetrics -Payload $payload -Visual $visual -Marker $marker
            Add-ProviderTelemetryToRuntimeMetrics -Payload $payload -ProviderState $providerState
            $payload['writtenAtUtc'] = $observedNow.ToString('o')
            Write-JsonNoBom -Path $outputPath -Value $payload
            if ($metaChanged) { $lastMetaEventStamp = $metaEventStamp }
            if ($visualChanged) { $lastVisualFrameSerial = $visualFrameSerial }
        }
    }
    catch {
        # Missing, mid-write or unavailable telemetry must never take the game down.
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
