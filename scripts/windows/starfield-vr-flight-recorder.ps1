Set-StrictMode -Version Latest

function Get-StarfieldVrOptionalJson {
    param([string]$Path)
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch { return $null }
}

function Get-StarfieldVrSha256Text {
    param([string]$Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$Text)
        return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Get-StarfieldVrConfigurationFingerprint {
    param(
        [string]$Provider,
        [string]$ProfileSha256,
        [string]$SourceHead,
        [string]$GameRoot,
        $AppliedSettings
    )
    $activeOpenXrRuntime = ''
    try {
        $activeOpenXrRuntime = [string](Get-ItemProperty 'HKLM:\SOFTWARE\Khronos\OpenXR\1' -Name ActiveRuntime -ErrorAction Stop).ActiveRuntime
    } catch {}
    $gpu = $null
    try {
        $gpu = Get-CimInstance Win32_VideoController -ErrorAction Stop |
            Where-Object { $_.Name -match '(?i)NVIDIA|GeForce' } |
            Select-Object -First 1
    } catch {}
    $windows = $null
    try { $windows = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop | Select-Object -First 1 } catch {}

    $identity = [ordered]@{
        provider = [string]$Provider
        profileSha256 = ([string]$ProfileSha256).ToLowerInvariant()
        sourceHead = ([string]$SourceHead).ToLowerInvariant()
        activeOpenXrRuntime = $activeOpenXrRuntime
        gpuName = if ($gpu) { [string]$gpu.Name } else { '' }
        gpuDriverVersion = if ($gpu) { [string]$gpu.DriverVersion } else { '' }
        windowsBuild = if ($windows) { [string]$windows.BuildNumber } else { '' }
        gameDrive = try { [System.IO.Path]::GetPathRoot($GameRoot).TrimEnd('\') } catch { '' }
        appliedSettings = $AppliedSettings
    }
    $canonical = $identity | ConvertTo-Json -Depth 8 -Compress
    return [pscustomobject]@{
        schemaVersion = 'stephanos.starfield-vr-configuration-fingerprint.v1'
        sha256 = Get-StarfieldVrSha256Text -Text $canonical
        identity = $identity
    }
}

function Get-StarfieldVrRuntimeMetricSample {
    param(
        [string]$WorkspaceRoot,
        [string]$LaunchSessionId,
        [string]$Provider,
        [int]$MaxAgeSeconds = 15
    )
    $path = Join-Path $WorkspaceRoot 'vr\starfield-vr-runtime-metrics-current.json'
    $payload = Get-StarfieldVrOptionalJson -Path $path
    if (-not $payload) {
        return [pscustomobject]@{ available = $false; reason = 'RUNTIME_METRICS_SOURCE_MISSING'; path = $path }
    }
    $observedAt = $null
    try { $observedAt = [DateTime]::Parse([string]$payload.observedAtUtc).ToUniversalTime() } catch {}
    if (-not $observedAt -or (((Get-Date).ToUniversalTime() - $observedAt).TotalSeconds -gt [Math]::Max(1, $MaxAgeSeconds))) {
        return [pscustomobject]@{ available = $false; reason = 'RUNTIME_METRICS_SOURCE_STALE'; path = $path }
    }
    $payloadLaunch = [string]$payload.launchSessionId
    $payloadProvider = [string]$payload.provider
    if ($LaunchSessionId -and $payloadLaunch -and $payloadLaunch -ne $LaunchSessionId) {
        return [pscustomobject]@{ available = $false; reason = 'RUNTIME_METRICS_LAUNCH_IDENTITY_MISMATCH'; path = $path }
    }
    if ($Provider -and $payloadProvider -and $payloadProvider -ne $Provider) {
        return [pscustomobject]@{ available = $false; reason = 'RUNTIME_METRICS_PROVIDER_IDENTITY_MISMATCH'; path = $path }
    }
    return [pscustomobject]@{
        available = $true
        reason = 'RUNTIME_METRICS_SOURCE_CURRENT'
        path = $path
        observedAtUtc = [string]$payload.observedAtUtc
        applicationFrameTimeMs = $payload.applicationFrameTimeMs
        deliveredCadenceHz = $payload.deliveredCadenceHz
        headsetRefreshRateHz = $payload.headsetRefreshRateHz
        droppedFrames = $payload.droppedFrames
        reprojectionState = [string]$payload.reprojectionState
        aswState = [string]$payload.aswState
        encodeLatencyMs = $payload.encodeLatencyMs
        networkLatencyMs = $payload.networkLatencyMs
        decodeLatencyMs = $payload.decodeLatencyMs
        airLinkBitrateMbps = $payload.airLinkBitrateMbps
        packetLossPct = $payload.packetLossPct
        jitterMs = $payload.jitterMs
        openXrRenderWidth = $payload.openXrRenderWidth
        openXrRenderHeight = $payload.openXrRenderHeight
        renderScalePct = $payload.renderScalePct
        leftEyePresentMs = $payload.leftEyePresentMs
        rightEyePresentMs = $payload.rightEyePresentMs
        eyePresentationSkewMs = $payload.eyePresentationSkewMs
        poseAgeMs = $payload.poseAgeMs
        stereoMode = [string]$payload.stereoMode
    }
}

function Get-StarfieldVrControllerSample {
    param([int]$GameProcessId = 0)
    $devices = @()
    try {
        $devices = @(Get-CimInstance Win32_PnPEntity -ErrorAction Stop |
            Where-Object {
                ([string]$_.Name -match '(?i)xbox|controller|gamepad') -and
                ([string]$_.PNPClass -match '(?i)HIDClass|USB|XnaComposite|XboxComposite')
            })
    } catch {}
    $problem = @($devices | Where-Object { $null -ne $_.ConfigManagerErrorCode -and [int]$_.ConfigManagerErrorCode -ne 0 })
    $xinputLoaded = $false
    if ($GameProcessId -gt 0) {
        try {
            $process = Get-Process -Id $GameProcessId -ErrorAction Stop
            $xinputLoaded = $null -ne ($process.Modules | Where-Object {
                $_.ModuleName -match '(?i)^xinput.*\.dll$'
            } | Select-Object -First 1)
        } catch {}
    }
    return [pscustomobject]@{
        controllerDeviceCount = $devices.Count
        controllerProblemCount = $problem.Count
        controllerHealthy = [bool]($devices.Count -gt 0 -and $problem.Count -eq 0)
        xinputModuleLoaded = [bool]$xinputLoaded
    }
}

function Get-StarfieldVrCrashFingerprint {
    param([string]$Message)
    $flat = ([string]$Message -replace '\s+', ' ').Trim()
    $module = ''
    $code = ''
    $offset = ''
    $m = [regex]::Match($flat, '(?i)Faulting module name:\s*([^,]+)')
    if ($m.Success) { $module = $m.Groups[1].Value.Trim() }
    $m = [regex]::Match($flat, '(?i)Exception code:\s*([^, ]+)')
    if ($m.Success) { $code = $m.Groups[1].Value.Trim() }
    $m = [regex]::Match($flat, '(?i)Fault offset:\s*([^, ]+)')
    if ($m.Success) { $offset = $m.Groups[1].Value.Trim() }
    $key = ('Starfield.exe|{0}|{1}|{2}' -f $module.ToLowerInvariant(), $code.ToLowerInvariant(), $offset.ToLowerInvariant())
    return [pscustomobject]@{
        key = $key
        sha256 = Get-StarfieldVrSha256Text -Text $key
        module = $module
        exceptionCode = $code
        faultOffset = $offset
    }
}

function Get-StarfieldVrPercentile {
    param([double[]]$Values, [double]$Percentile)
    $items = @($Values | Sort-Object)
    if ($items.Count -eq 0) { return $null }
    $p = [Math]::Min(100.0, [Math]::Max(0.0, $Percentile))
    $index = [Math]::Ceiling(($p / 100.0) * $items.Count) - 1
    $index = [Math]::Min($items.Count - 1, [Math]::Max(0, [int]$index))
    return [math]::Round([double]$items[$index], 2)
}

function Get-StarfieldVrTelemetryCompleteness {
    param([object[]]$Samples, $Summary = $null)
    $rows = @($Samples)
    $has = {
        param([string]$Name)
        return $null -ne ($rows | Where-Object {
            $p = $_.PSObject.Properties[$Name]
            $p -and $null -ne $p.Value -and [string]$p.Value -ne ''
        } | Select-Object -First 1)
    }
    $result = [ordered]@{
        pcResource = [bool](& $has 'gpuUtilPct')
        storage = [bool](& $has 'gameDriveFreePct')
        frameTiming = [bool](& $has 'applicationFrameTimeMs')
        deliveredCadence = [bool](& $has 'deliveredCadenceHz')
        headsetRefresh = [bool](& $has 'headsetRefreshRateHz')
        reprojection = [bool](& $has 'reprojectionState')
        airLinkLatencyChain = [bool]((& $has 'encodeLatencyMs') -and (& $has 'networkLatencyMs') -and (& $has 'decodeLatencyMs'))
        airLinkNetworkQuality = [bool]((& $has 'airLinkBitrateMbps') -and (& $has 'packetLossPct') -and (& $has 'jitterMs'))
        stereoEyeTiming = [bool]((& $has 'leftEyePresentMs') -and (& $has 'rightEyePresentMs'))
        poseTiming = [bool](& $has 'poseAgeMs')
        controller = [bool](& $has 'controllerDeviceCount')
        audioLifecycle = [bool]($null -ne $Summary)
        configurationFingerprint = $false
        physicalAcceptance = $false
    }
    if ($Summary -and $Summary.PSObject.Properties['configurationFingerprint']) {
        $result.configurationFingerprint = [bool]([string]$Summary.configurationFingerprint.sha256)
    }
    $missing = @($result.Keys | Where-Object { $_ -ne 'physicalAcceptance' -and -not [bool]$result[$_] })
    return [pscustomobject]@{
        schemaVersion = 'stephanos.starfield-vr-telemetry-completeness.v1'
        captured = $result
        missing = @($missing)
        physicalAcceptance = 'REQUIRES_OPERATOR_HEADSET_EVIDENCE'
        completeForMachineDiagnosis = [bool]($missing.Count -eq 0)
    }
}
