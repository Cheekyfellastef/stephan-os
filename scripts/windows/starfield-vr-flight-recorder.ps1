Set-StrictMode -Version Latest

function Get-StarfieldVrOptionalJson {
    param([string]$Path)
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch { return $null }
}

function Get-StarfieldVrOptionalProperty {
    param($Object, [string]$Name, $Default = $null)
    if ($null -eq $Object) { return $Default }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $Default }
    Write-Output -NoEnumerate $property.Value
}

function Test-StarfieldVrPrimitiveScalar {
    param($Value)
    if ($null -eq $Value) { return $false }
    if ($Value -is [string] -or $Value -is [char] -or $Value -is [bool]) { return $true }
    return $Value -is [byte] -or
        $Value -is [sbyte] -or
        $Value -is [int16] -or
        $Value -is [uint16] -or
        $Value -is [int32] -or
        $Value -is [uint32] -or
        $Value -is [int64] -or
        $Value -is [uint64] -or
        $Value -is [single] -or
        $Value -is [double] -or
        $Value -is [decimal]
}

function Get-StarfieldVrOptionalString {
    param($Object, [string]$Name)
    $raw = Get-StarfieldVrOptionalProperty -Object $Object -Name $Name
    if (-not (Test-StarfieldVrPrimitiveScalar -Value $raw) -or -not ($raw -is [string]) -or [string]::IsNullOrWhiteSpace($raw)) { return '' }
    return $raw
}

function Get-StarfieldVrOptionalNumber {
    param($Object, [string]$Name)
    $raw = Get-StarfieldVrOptionalProperty -Object $Object -Name $Name
    if (-not (Test-StarfieldVrPrimitiveScalar -Value $raw) -or [string]::IsNullOrWhiteSpace([string]$raw)) { return $null }
    $parsed = 0.0
    if ([double]::TryParse(
        [string]$raw,
        [System.Globalization.NumberStyles]::Float,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [ref]$parsed
    )) {
        if ([double]::IsNaN($parsed) -or [double]::IsInfinity($parsed)) { return $null }
        return $parsed
    }
    return $null
}

function Get-StarfieldVrBoundedNumber {
    param(
        $Object,
        [string]$Name,
        [double]$Minimum,
        [double]$Maximum
    )
    $value = Get-StarfieldVrOptionalNumber -Object $Object -Name $Name
    if ($null -eq $value) { return $null }
    if ($value -lt $Minimum -or $value -gt $Maximum) { return $null }
    return $value
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

    $gameDrive = ''
    try { $gameDrive = [System.IO.Path]::GetPathRoot($GameRoot).TrimEnd('\\') } catch {}
    $identity = [ordered]@{
        provider = [string]$Provider
        profileSha256 = ([string]$ProfileSha256).ToLowerInvariant()
        sourceHead = ([string]$SourceHead).ToLowerInvariant()
        activeOpenXrRuntime = $activeOpenXrRuntime
        gpuName = if ($gpu) { [string]$gpu.Name } else { '' }
        gpuDriverVersion = if ($gpu) { [string]$gpu.DriverVersion } else { '' }
        windowsBuild = if ($windows) { [string]$windows.BuildNumber } else { '' }
        gameDrive = $gameDrive
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
        [int]$MaxAgeSeconds = 15,
        [int]$MaxFutureSkewSeconds = 5
    )
    if ([string]::IsNullOrWhiteSpace($WorkspaceRoot)) {
        return [pscustomobject]@{ available = $false; reason = 'RUNTIME_METRICS_WORKSPACE_ROOT_MISSING'; path = '' }
    }
    $path = Join-Path $WorkspaceRoot 'vr\starfield-vr-runtime-metrics-current.json'
    if ([string]::IsNullOrWhiteSpace($LaunchSessionId) -or [string]::IsNullOrWhiteSpace($Provider)) {
        return [pscustomobject]@{ available = $false; reason = 'RUNTIME_METRICS_EXPECTED_IDENTITY_MISSING'; path = $path }
    }
    $payload = Get-StarfieldVrOptionalJson -Path $path
    if (-not $payload) {
        return [pscustomobject]@{ available = $false; reason = 'RUNTIME_METRICS_SOURCE_MISSING'; path = $path }
    }
    $observedAtRaw = Get-StarfieldVrOptionalString -Object $payload -Name 'observedAtUtc'
    $observedAt = $null
    try { $observedAt = [DateTime]::Parse([string]$observedAtRaw).ToUniversalTime() } catch {}
    if (-not $observedAt) {
        return [pscustomobject]@{ available = $false; reason = 'RUNTIME_METRICS_SOURCE_STALE'; path = $path }
    }
    $ageSeconds = ((Get-Date).ToUniversalTime() - $observedAt).TotalSeconds
    if ($ageSeconds -lt -[Math]::Max(0, $MaxFutureSkewSeconds)) {
        return [pscustomobject]@{ available = $false; reason = 'RUNTIME_METRICS_SOURCE_FUTURE'; path = $path }
    }
    if ($ageSeconds -gt [Math]::Max(1, $MaxAgeSeconds)) {
        return [pscustomobject]@{ available = $false; reason = 'RUNTIME_METRICS_SOURCE_STALE'; path = $path }
    }
    $payloadLaunch = Get-StarfieldVrOptionalString -Object $payload -Name 'launchSessionId'
    $payloadProvider = Get-StarfieldVrOptionalString -Object $payload -Name 'provider'
    if ([string]::IsNullOrWhiteSpace($payloadLaunch) -or [string]::IsNullOrWhiteSpace($payloadProvider)) {
        return [pscustomobject]@{ available = $false; reason = 'RUNTIME_METRICS_PAYLOAD_IDENTITY_MISSING'; path = $path }
    }
    if (-not [string]::Equals($payloadLaunch, $LaunchSessionId, [StringComparison]::Ordinal)) {
        return [pscustomobject]@{ available = $false; reason = 'RUNTIME_METRICS_LAUNCH_IDENTITY_MISMATCH'; path = $path }
    }
    if (-not [string]::Equals($payloadProvider, $Provider, [StringComparison]::Ordinal)) {
        return [pscustomobject]@{ available = $false; reason = 'RUNTIME_METRICS_PROVIDER_IDENTITY_MISMATCH'; path = $path }
    }
    return [pscustomobject]@{
        available = $true
        reason = 'RUNTIME_METRICS_SOURCE_CURRENT'
        path = $path
        observedAtUtc = Get-StarfieldVrOptionalString -Object $payload -Name 'observedAtUtc'
        applicationFrameTimeMs = Get-StarfieldVrBoundedNumber -Object $payload -Name 'applicationFrameTimeMs' -Minimum 0.01 -Maximum 60000
        deliveredCadenceHz = Get-StarfieldVrBoundedNumber -Object $payload -Name 'deliveredCadenceHz' -Minimum 0.01 -Maximum 1000
        headsetRefreshRateHz = Get-StarfieldVrBoundedNumber -Object $payload -Name 'headsetRefreshRateHz' -Minimum 0.01 -Maximum 1000
        droppedFrames = Get-StarfieldVrBoundedNumber -Object $payload -Name 'droppedFrames' -Minimum 0 -Maximum 1000000000
        reprojectionState = Get-StarfieldVrOptionalString -Object $payload -Name 'reprojectionState'
        aswState = Get-StarfieldVrOptionalString -Object $payload -Name 'aswState'
        encodeLatencyMs = Get-StarfieldVrBoundedNumber -Object $payload -Name 'encodeLatencyMs' -Minimum 0 -Maximum 60000
        networkLatencyMs = Get-StarfieldVrBoundedNumber -Object $payload -Name 'networkLatencyMs' -Minimum 0 -Maximum 60000
        decodeLatencyMs = Get-StarfieldVrBoundedNumber -Object $payload -Name 'decodeLatencyMs' -Minimum 0 -Maximum 60000
        airLinkBitrateMbps = Get-StarfieldVrBoundedNumber -Object $payload -Name 'airLinkBitrateMbps' -Minimum 0 -Maximum 100000
        packetLossPct = Get-StarfieldVrBoundedNumber -Object $payload -Name 'packetLossPct' -Minimum 0 -Maximum 100
        jitterMs = Get-StarfieldVrBoundedNumber -Object $payload -Name 'jitterMs' -Minimum 0 -Maximum 60000
        openXrRenderWidth = Get-StarfieldVrBoundedNumber -Object $payload -Name 'openXrRenderWidth' -Minimum 1 -Maximum 32768
        openXrRenderHeight = Get-StarfieldVrBoundedNumber -Object $payload -Name 'openXrRenderHeight' -Minimum 1 -Maximum 32768
        renderScalePct = Get-StarfieldVrBoundedNumber -Object $payload -Name 'renderScalePct' -Minimum 1 -Maximum 1000
        leftEyePresentMs = Get-StarfieldVrBoundedNumber -Object $payload -Name 'leftEyePresentMs' -Minimum 0 -Maximum 60000
        rightEyePresentMs = Get-StarfieldVrBoundedNumber -Object $payload -Name 'rightEyePresentMs' -Minimum 0 -Maximum 60000
        eyePresentationSkewMs = Get-StarfieldVrBoundedNumber -Object $payload -Name 'eyePresentationSkewMs' -Minimum 0 -Maximum 60000
        poseAgeMs = Get-StarfieldVrBoundedNumber -Object $payload -Name 'poseAgeMs' -Minimum 0 -Maximum 60000
        stereoMode = Get-StarfieldVrOptionalString -Object $payload -Name 'stereoMode'
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


# Fixed-name app-family CPU sampler. Keeps a per-PID start-time baseline in
# memory for this playtest only, reads no tab/URL/profile/command-line data,
# and never changes process priorities or termination state.
function Get-StarfieldVrCpuConsumerSample {
    param(
        [hashtable]$Previous,
        [int]$LogicalProcessorCount = 1
    )
    $families = [ordered]@{
        chatGpt = 'ChatGPT'
        edge = 'msedge'
        brave = 'brave'
        chrome = 'chrome'
        firefox = 'firefox'
        webView2 = 'msedgewebview2'
        steamWeb = 'steamwebhelper'
        metaVr = 'OVRServer_x64'
        node = 'node'
        powerShell = 'powershell'
        defender = 'MsMpEng'
        desktopWindowManager = 'dwm'
    }
    $now = (Get-Date).ToUniversalTime()
    $group = @{}
    $byName = @{}
    foreach ($key in $families.Keys) {
        $group[$key] = @{ count = 0; matched = 0; totalCpuPct = 0.0 }
        $byName[([string]$families[$key]).ToLowerInvariant()] = [string]$key
    }
    $processes = @()
    $inventoryAvailable = $true
    $processLookupErrors = @()
    try {
        # A missing optional app is normal. One inventory per sample avoids
        # repeating the entire Get-Process scan for every absent family.
        $processes = @(Get-Process -Name @($families.Values) -ErrorAction SilentlyContinue -ErrorVariable +processLookupErrors)
        foreach ($lookupError in @($processLookupErrors)) {
            # Only 'no process by this name' is evidence of an absent app.
            # Access denial or another inventory error cannot certify zero CPU.
            if ([string]$lookupError.FullyQualifiedErrorId -notlike 'NoProcessFoundForGivenName*') {
                $inventoryAvailable = $false
                break
            }
        }
    } catch {
        $inventoryAvailable = $false
    }
    $next = @{}
    foreach ($p in $processes) {
        $name = [string]$p.ProcessName
        $key = $byName[$name.ToLowerInvariant()]
        if (-not $key) { continue }
        $g = $group[$key]
        $g.count++
        $pidValue = [int]$p.Id
        try {
            $startTicks = $p.StartTime.ToUniversalTime().Ticks
            $seconds = [double]$p.TotalProcessorTime.TotalSeconds
            $before = $Previous[$pidValue]
            if ($before -and [long]$before.startTicks -eq $startTicks) {
                $duration = ($now - [DateTime]$before.observedAt).TotalSeconds
                $delta = $seconds - [double]$before.cpuSeconds
                if ($duration -gt 0 -and $duration -le 120 -and $delta -ge 0) {
                    $g.totalCpuPct += [Math]::Min(100, (($delta / $duration) / [Math]::Max(1, $LogicalProcessorCount)) * 100)
                    $g.matched++
                }
            }
            $next[$pidValue] = @{
                startTicks = $startTicks
                cpuSeconds = $seconds
                observedAt = $now
            }
        } catch {
            # No process CPU evidence is better than a fabricated 0% reading.
        }
    }
    $Previous.Clear()
    foreach ($id in $next.Keys) { $Previous[$id] = $next[$id] }
    $out = [ordered]@{
        available = $inventoryAvailable
        source = 'FIXED_APP_FAMILY_PROCESS_CPU_DELTAS'
        observedAtUtc = $now.ToString('o')
    }
    foreach ($key in $families.Keys) {
        $g = $group[$key]
        $out["${key}ProcessCount"] = [int]$g.count
        $out["${key}CpuPct"] = if (-not $inventoryAvailable) { $null }
            elseif ($g.count -eq 0) { 0.0 }
            elseif ($g.matched -eq $g.count) { [Math]::Round([Math]::Min(100, $g.totalCpuPct), 2) }
            else { $null }
    }
    return [pscustomobject]$out
}


# Read-only, bounded game-thread CPU evidence. A fully utilized *single*
# logical processor corresponds to roughly 100%, independently of the
# normalized whole-process CPU percentage. Do not label the busiest thread
# the main/render thread: thread function/role is not determined here.
function Get-StarfieldVrGameThreadCpuSample {
    param(
        [int]$GameProcessId,
        [hashtable]$Previous,
        [int]$MaximumThreadCount = 512
    )
    $sampledAt = (Get-Date).ToUniversalTime()
    $out = [ordered]@{
        source = 'STARFIELD_PROCESS_THREAD_CPU_DELTAS'
        available = $false
        reason = 'THREAD_SNAPSHOT_UNAVAILABLE'
        threadCount = $null
        matchedThreadCount = 0
        busiestThreadCpuPct = $null
    }
    if ($GameProcessId -le 0 -or $null -eq $Previous) {
        $out.reason = 'THREAD_IDENTITY_UNAVAILABLE'
        return [pscustomobject]$out
    }
    # Collect thread-level evidence at most every five seconds. Sampling
    # every frame or every adaptive 1s tick can itself create CPU overhead.
    if ($Previous.ContainsKey('collectedAtUtc') -and $Previous.ContainsKey('processId') -and
        $Previous.processId -eq $GameProcessId -and
        $Previous.collectedAtUtc -is [DateTime]) {
        # Never convert an untrusted/stale history timestamp outside the
        # protected sampling block. Invalid history must re-warm, not crash
        # the low-overhead playtest recorder or fabricate a measured delta.
        $since = ($sampledAt - $Previous.collectedAtUtc).TotalSeconds
        if ($since -ge 0 -and $since -lt 5) {
            $out.reason = 'THREAD_SAMPLE_THROTTLED'
            return [pscustomobject]$out
        }
    }
    try {
        $process = Get-Process -Id $GameProcessId -ErrorAction Stop
        $processStartedTicks = [long]$process.StartTime.ToUniversalTime().Ticks
        $threads = @($process.Threads)
        if ($threads.Count -gt $MaximumThreadCount) {
            $out.reason = 'THREAD_INVENTORY_LIMIT'
            $Previous.Clear()
            return [pscustomobject]$out
        }
        $out.available = $true
        $out.threadCount = $threads.Count
        $out.reason = 'THREAD_WARMUP'
        $prior = @{}
        if ($Previous.processId -eq $GameProcessId -and
            $Previous.processStartTicks -eq $processStartedTicks -and
            $Previous.ContainsKey('threadCpu')) {
            $prior = $Previous.threadCpu
        }
        $fresh = @{}
        $maxCorePercent = $null
        $matched = 0
        foreach ($thread in $threads) {
            try {
                $threadId = [int]$thread.Id
                $threadStartTicks = [long]$thread.StartTime.ToUniversalTime().Ticks
                $cpuSeconds = [double]$thread.TotalProcessorTime.TotalSeconds
                $old = $prior[$threadId]
                if ($old -and [long]$old.startTicks -eq $threadStartTicks) {
                    $secondsElapsed = ($sampledAt - [DateTime]$old.observedAtUtc).TotalSeconds
                    $usedSeconds = $cpuSeconds - [double]$old.cpuSeconds
                    if ($secondsElapsed -gt 0 -and $secondsElapsed -le 120 -and $usedSeconds -ge 0) {
                        $corePercent = [Math]::Min(100, ($usedSeconds / $secondsElapsed) * 100)
                        if ($null -eq $maxCorePercent -or $corePercent -gt $maxCorePercent) {
                            $maxCorePercent = $corePercent
                        }
                        $matched++
                    }
                }
                $fresh[$threadId] = @{
                    startTicks = $threadStartTicks
                    cpuSeconds = $cpuSeconds
                    observedAtUtc = $sampledAt
                }
            } catch {
                # Threads can exit while sampled; never manufacture a 0% CPU value.
            }
        }
        $Previous.Clear()
        $Previous.processId = $GameProcessId
        $Previous.processStartTicks = $processStartedTicks
        $Previous.threadCpu = $fresh
        $Previous.collectedAtUtc = $sampledAt
        $out.matchedThreadCount = $matched
        if ($matched -gt 0) {
            $out.busiestThreadCpuPct = [Math]::Round([double]$maxCorePercent, 2)
            $out.reason = 'THREAD_CPU_MEASURED'
        }
    } catch {
        $Previous.Clear()
        $out.reason = 'THREAD_SNAPSHOT_UNAVAILABLE'
    } finally {
        # Failed/oversized inventories are still inspection attempts. Retain the
        # 5-second cooldown during 1s adaptive VR sampling, but not stale deltas.
        $Previous.processId = $GameProcessId
        $Previous.collectedAtUtc = $sampledAt
    }
    return [pscustomobject]$out
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
