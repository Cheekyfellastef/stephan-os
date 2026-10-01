[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Enter','Guard','Restore')][string]$Action,
    [string]$WorkspaceRoot = '',
    [string]$GameRoot = '',
    [string]$SessionPath = '',
    [int]$GameProcessId = 0,
    [int]$SampleSeconds = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$audioEndpointScript = Join-Path $PSScriptRoot 'starfield-vr-audio-endpoint.ps1'
$telemetryReportScript = Join-Path (Split-Path -Parent $PSScriptRoot) 'report-starfield-vr-telemetry.mjs'
$powershellExecutable = Join-Path $PSHOME 'powershell.exe'

function Get-IniScalar {
    param([string]$Raw, [string]$Key)
    $match = [regex]::Match($Raw, "(?m)^\s*$([regex]::Escape($Key))\s*=\s*(.*?)\s*$")
    if (-not $match.Success) { throw "Missing required Starfield setting: $Key" }
    return $match.Groups[1].Value
}

function Set-IniScalar {
    param([string]$Raw, [string]$Key, [string]$Value)
    $pattern = "(?m)^\s*$([regex]::Escape($Key))\s*=.*$"
    if (-not [regex]::IsMatch($Raw, $pattern)) { throw "Missing required Starfield setting: $Key" }
    return [regex]::Replace($Raw, $pattern, "$Key=$Value", 1)
}
function Write-JsonNoBom {
    param([string]$Path, $Value)
    $json = $Value | ConvertTo-Json -Depth 12
    [System.IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Stop-ProcessIds {
    param([int[]]$Ids)
    foreach ($id in @($Ids)) {
        try { Stop-Process -Id $id -Force -ErrorAction Stop } catch {}
    }
}

function Restore-AudioState {
    param(
        $Session,
        [int]$TimeoutSeconds = 15
    )

    $result = [ordered]@{
        restored = $false
        attempts = 0
        stableConfirmations = 0
        finalEndpointId = ''
        finalEndpoints = $null
        error = ''
    }

    if (-not (Test-Path -LiteralPath $audioEndpointScript -PathType Leaf)) {
        $result.error = 'Starfield VR audio endpoint helper is missing.'
        return [pscustomobject]$result
    }

    $audio = $Session.audio
    $originalEndpointsProperty = $audio.PSObject.Properties['originalEndpoints']
    $hasExactEndpoints = $originalEndpointsProperty -and $null -ne $originalEndpointsProperty.Value
    $legacyEndpointProperty = $audio.PSObject.Properties['originalEndpointId']
    $legacyEndpointId = if ($legacyEndpointProperty) { [string]$legacyEndpointProperty.Value } else { '' }

    if (-not $hasExactEndpoints -and -not $legacyEndpointId) {
        $result.error = 'No pre-VR audio endpoint state was recorded.'
        return [pscustomobject]$result
    }

    $deadline = (Get-Date).AddSeconds([Math]::Max(2, $TimeoutSeconds))
    while ((Get-Date) -lt $deadline) {
        $result.attempts += 1
        try {
            if ($hasExactEndpoints) {
                $original = $originalEndpointsProperty.Value
                $restoreJson = & $powershellExecutable -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $audioEndpointScript -Action RestoreDefaults -ConsoleEndpointId ([string]$original.consoleEndpointId) -MultimediaEndpointId ([string]$original.multimediaEndpointId) -CommunicationsEndpointId ([string]$original.communicationsEndpointId) 2>&1 | Out-String
            }
            else {
                $restoreJson = & $powershellExecutable -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $audioEndpointScript -Action SetDefault -EndpointId $legacyEndpointId 2>&1 | Out-String
            }

            if ($LASTEXITCODE -ne 0 -or -not $restoreJson.Trim()) {
                throw "Audio restore command failed: $($restoreJson.Trim())"
            }

            Start-Sleep -Milliseconds 600
            $verifyJson = & $powershellExecutable -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $audioEndpointScript -Action GetDefaults 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0 -or -not $verifyJson.Trim()) {
                throw "Audio restore verification failed: $($verifyJson.Trim())"
            }

            $verify = $verifyJson.Trim() | ConvertFrom-Json
            $result.finalEndpointId = [string]$verify.endpointId
            $result.finalEndpoints = $verify.endpoints
            $matches = if ($hasExactEndpoints) {
                $original = $originalEndpointsProperty.Value
                [string]::Equals([string]$verify.endpoints.consoleEndpointId, [string]$original.consoleEndpointId, [System.StringComparison]::OrdinalIgnoreCase) -and
                [string]::Equals([string]$verify.endpoints.multimediaEndpointId, [string]$original.multimediaEndpointId, [System.StringComparison]::OrdinalIgnoreCase) -and
                [string]::Equals([string]$verify.endpoints.communicationsEndpointId, [string]$original.communicationsEndpointId, [System.StringComparison]::OrdinalIgnoreCase)
            }
            else {
                [string]::Equals([string]$verify.endpointId, $legacyEndpointId, [System.StringComparison]::OrdinalIgnoreCase)
            }

            if ($matches) {
                $result.stableConfirmations += 1
                if ($result.stableConfirmations -ge 2) {
                    $result.restored = $true
                    $result.error = ''
                    return [pscustomobject]$result
                }
            }
            else {
                $result.stableConfirmations = 0
                $result.error = 'Audio endpoint changed again after restore.'
            }
        }
        catch {
            $result.stableConfirmations = 0
            $result.error = $_.Exception.Message
        }
        Start-Sleep -Milliseconds 600
    }

    return [pscustomobject]$result
}

function Restore-Session {
    param($Session)
    $restoredPrefs = $false
    try {
        if ($Session.prefsPath -and (Test-Path -LiteralPath $Session.prefsPath -PathType Leaf)) {
            $raw = Get-Content -LiteralPath $Session.prefsPath -Raw
            foreach ($entry in $Session.originalSettings.PSObject.Properties) {
                $raw = Set-IniScalar -Raw $raw -Key $entry.Name -Value ([string]$entry.Value)
            }
            [System.IO.File]::WriteAllText($Session.prefsPath, $raw, (New-Object System.Text.UTF8Encoding($false)))
            $restoredPrefs = $true
        }
    } catch {}

    $audioRestore = Restore-AudioState -Session $Session

    if ($Session.ollama.appWasRunning -and $Session.ollama.appPath -and (Test-Path -LiteralPath $Session.ollama.appPath)) {
        if (-not (Get-Process -Name 'ollama app' -ErrorAction SilentlyContinue)) {
            Start-Process -FilePath $Session.ollama.appPath | Out-Null
        }
    }
    elseif ($Session.ollama.serveWasRunning -and $Session.ollama.servePath -and (Test-Path -LiteralPath $Session.ollama.servePath)) {
        if (-not (Get-Process -Name 'ollama' -ErrorAction SilentlyContinue)) {
            Start-Process -FilePath $Session.ollama.servePath -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
        }
    }
    return [pscustomobject]@{
        prefsRestored = $restoredPrefs
        audioRestored = [bool]$audioRestore.restored
        audioRestoreAttempts = [int]$audioRestore.attempts
        audioStableConfirmations = [int]$audioRestore.stableConfirmations
        audioFinalEndpointId = [string]$audioRestore.finalEndpointId
        audioFinalEndpoints = $audioRestore.finalEndpoints
        audioRestoreError = [string]$audioRestore.error
    }
}

function Get-GameDriveSample {
    param([string]$Root)
    try {
        $driveRoot = [System.IO.Path]::GetPathRoot($Root)
        if ([string]::IsNullOrWhiteSpace($driveRoot)) { return $null }
        $driveName = $driveRoot.TrimEnd('\\')
        $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$driveName'" -ErrorAction Stop | Select-Object -First 1
        if (-not $disk -or [double]$disk.Size -le 0) { return $null }

        $perf = Get-CimInstance Win32_PerfFormattedData_PerfDisk_LogicalDisk -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -eq $driveName } |
            Select-Object -First 1
        $memoryPerf = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory -ErrorAction SilentlyContinue |
            Select-Object -First 1

        $latencies = New-Object System.Collections.Generic.List[double]
        if ($perf) {
            foreach ($value in @($perf.AvgDisksecPerRead, $perf.AvgDisksecPerWrite)) {
                if ($null -ne $value) { $latencies.Add(([double]$value) * 1000.0) }
            }
        }
        $avgLatencyMs = if ($latencies.Count) {
            [math]::Round((@($latencies) | Measure-Object -Average).Average, 2)
        } else { $null }

        return [pscustomobject]@{
            gameDrive = $driveName
            gameDriveSizeGiB = [math]::Round(([double]$disk.Size / 1GB), 1)
            gameDriveFreeGiB = [math]::Round(([double]$disk.FreeSpace / 1GB), 1)
            gameDriveFreePct = [math]::Round((([double]$disk.FreeSpace / [double]$disk.Size) * 100), 1)
            gameDriveActivePct = if ($perf) { [double]$perf.PercentDiskTime } else { $null }
            gameDriveReadMiBps = if ($perf) { [math]::Round(([double]$perf.DiskReadBytesPersec / 1MB), 2) } else { $null }
            gameDriveWriteMiBps = if ($perf) { [math]::Round(([double]$perf.DiskWriteBytesPersec / 1MB), 2) } else { $null }
            gameDriveAvgLatencyMs = $avgLatencyMs
            gameDriveQueueLength = if ($perf) { [double]$perf.CurrentDiskQueueLength } else { $null }
            pagesPerSec = if ($memoryPerf) { [double]$memoryPerf.PagesPersec } else { $null }
        }
    } catch {
        return $null
    }
}

function Get-NvidiaSample {
    $nvidia = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $nvidia) { return $null }
    $line = & $nvidia.Source --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits 2>$null | Select-Object -First 1
    if (-not $line) { return $null }
    $parts = @($line -split ',') | ForEach-Object { $_.Trim() }
    if ($parts.Count -lt 5) { return $null }

    $encoderUtilPct = $null
    $decoderUtilPct = $null
    try {
        $videoLine = & $nvidia.Source --query-gpu=utilization.encoder,utilization.decoder --format=csv,noheader,nounits 2>$null | Select-Object -First 1
        $videoParts = @(([string]$videoLine) -split ',') | ForEach-Object { $_.Trim() }
        if ($videoParts.Count -ge 2) {
            if ($videoParts[0] -match '^\d+(?:\.\d+)?$') { $encoderUtilPct = [double]$videoParts[0] }
            if ($videoParts[1] -match '^\d+(?:\.\d+)?$') { $decoderUtilPct = [double]$videoParts[1] }
        }
    } catch {}

    return [pscustomobject]@{
        gpuUtilPct = [double]$parts[0]
        gpuEncoderUtilPct = $encoderUtilPct
        gpuDecoderUtilPct = $decoderUtilPct
        gpuMemoryUsedMiB = [double]$parts[1]
        gpuMemoryTotalMiB = [double]$parts[2]
        gpuTemperatureC = [double]$parts[3]
        gpuPowerW = [double]$parts[4]
    }
}

if ($Action -eq 'Enter') {
    if (-not $WorkspaceRoot -or -not $GameRoot) { throw 'Enter requires WorkspaceRoot and GameRoot.' }
    $prefsPath = Join-Path $env:USERPROFILE 'Documents\My Games\Starfield\StarfieldPrefs.ini'
    if (-not (Test-Path -LiteralPath $prefsPath -PathType Leaf)) { throw 'StarfieldPrefs.ini not found.' }
    $sessionRoot = Join-Path $WorkspaceRoot 'vr\starfield-vr-performance-sessions'
    New-Item -ItemType Directory -Path $sessionRoot -Force | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $sessionPath = Join-Path $sessionRoot "starfield-vr-performance-$stamp.json"
    $telemetryPath = Join-Path $sessionRoot "starfield-vr-performance-$stamp.csv"

    if (-not (Test-Path -LiteralPath $audioEndpointScript -PathType Leaf)) {
        throw 'Starfield VR audio endpoint helper is missing.'
    }
    $audioCurrentJson = & $powershellExecutable -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $audioEndpointScript -Action GetDefaults 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or -not $audioCurrentJson.Trim()) { throw "Unable to capture current audio endpoint state: $($audioCurrentJson.Trim())" }
    $audioCurrent = $audioCurrentJson.Trim() | ConvertFrom-Json

    $raw = Get-Content -LiteralPath $prefsPath -Raw
    $originalSettings = [ordered]@{
        bEnableVsync = Get-IniScalar -Raw $raw -Key 'bEnableVsync'
        bDynamicResolutionEnabled = Get-IniScalar -Raw $raw -Key 'bDynamicResolutionEnabled'
        bBorderless = Get-IniScalar -Raw $raw -Key 'bBorderless'
        uiFrameGenerationTech = Get-IniScalar -Raw $raw -Key 'uiFrameGenerationTech'
    }
    $vrRaw = Set-IniScalar -Raw $raw -Key 'bEnableVsync' -Value '0'
    $vrRaw = Set-IniScalar -Raw $vrRaw -Key 'bDynamicResolutionEnabled' -Value '0'
    $vrRaw = Set-IniScalar -Raw $vrRaw -Key 'bBorderless' -Value '0'
    $vrRaw = Set-IniScalar -Raw $vrRaw -Key 'uiFrameGenerationTech' -Value '0'

    $vorpx = @(Get-Process -Name 'vorpControl','vorpScan','vorpDesktopViewer' -ErrorAction SilentlyContinue)
    $stoppedVorpX = @($vorpx | ForEach-Object { $_.Id })
    $ollamaProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('ollama app.exe','ollama.exe','llama-server.exe') })
    $app = $ollamaProcesses | Where-Object Name -eq 'ollama app.exe' | Select-Object -First 1
    $serve = $ollamaProcesses | Where-Object Name -eq 'ollama.exe' | Select-Object -First 1
    $llama = @($ollamaProcesses | Where-Object Name -eq 'llama-server.exe')
    $parkedModelCount = $llama.Count

    $hagsMode = $null
    try { $hagsMode = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' -Name HwSchMode -ErrorAction Stop).HwSchMode } catch {}

    $storageStart = Get-GameDriveSample -Root $GameRoot

    $session = [ordered]@{
        schemaVersion = 'stephanos.starfield-vr-performance-session.v1'
        enteredAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        gameRoot = $GameRoot
        prefsPath = $prefsPath
        originalSettings = $originalSettings
        appliedSettings = [ordered]@{
            bEnableVsync = '0'
            bDynamicResolutionEnabled = '0'
            bBorderless = '0'
            uiFrameGenerationTech = '0'
        }
        stoppedVorpXProcessIds = @($stoppedVorpX)
        ollama = [ordered]@{
            parkedModelCount = $parkedModelCount
            appWasRunning = [bool]$app
            appPath = if ($app) { [string]$app.ExecutablePath } else { '' }
            serveWasRunning = [bool]$serve
            servePath = if ($serve) { [string]$serve.ExecutablePath } else { '' }
        }
        audio = [ordered]@{
            originalEndpointId = [string]$audioCurrent.endpointId
            originalEndpoints = [ordered]@{
                consoleEndpointId = [string]$audioCurrent.endpoints.consoleEndpointId
                multimediaEndpointId = [string]$audioCurrent.endpoints.multimediaEndpointId
                communicationsEndpointId = [string]$audioCurrent.endpoints.communicationsEndpointId
            }
            questEndpointId = ''
        }
        hagsMode = $hagsMode
        storageStart = $storageStart
        telemetryPath = $telemetryPath
    }
    Write-JsonNoBom -Path $sessionPath -Value $session

    try {
        [System.IO.File]::WriteAllText($prefsPath, $vrRaw, (New-Object System.Text.UTF8Encoding($false)))
        Stop-ProcessIds -Ids $stoppedVorpX
        Stop-ProcessIds -Ids @($ollamaProcesses | ForEach-Object { [int]$_.ProcessId })
        Start-Sleep -Milliseconds 500
        $audioSwitchJson = & $powershellExecutable -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $audioEndpointScript -Action SwitchToQuest 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0 -or -not $audioSwitchJson.Trim()) { throw "Unable to switch VR audio: $($audioSwitchJson.Trim())" }
        $audioSwitch = $audioSwitchJson.Trim() | ConvertFrom-Json
        $session.audio.questEndpointId = [string]$audioSwitch.endpointId
        Write-JsonNoBom -Path $sessionPath -Value $session
    }
    catch {
        $rollbackSession = Get-Content -LiteralPath $sessionPath -Raw | ConvertFrom-Json
        Restore-Session -Session $rollbackSession | Out-Null
        throw
    }
    [ordered]@{
        ok = $true
        sessionPath = $sessionPath
        telemetryPath = $telemetryPath
        parkedModelCount = $parkedModelCount
        stoppedVorpXProcessCount = $stoppedVorpX.Count
        audioEndpointId = [string]$session.audio.questEndpointId
        hagsMode = $hagsMode
    } | ConvertTo-Json -Compress
    exit 0
}

if (-not $SessionPath -or -not (Test-Path -LiteralPath $SessionPath -PathType Leaf)) {
    throw 'Guard/Restore requires a valid SessionPath.'
}
$session = Get-Content -LiteralPath $SessionPath -Raw | ConvertFrom-Json

if ($Action -eq 'Restore') {
    $restored = Restore-Session -Session $session
    [ordered]@{
        ok = $true
        prefsRestored = [bool]$restored.prefsRestored
        audioRestored = [bool]$restored.audioRestored
        audioRestoreAttempts = [int]$restored.audioRestoreAttempts
        audioStableConfirmations = [int]$restored.audioStableConfirmations
        audioFinalEndpointId = [string]$restored.audioFinalEndpointId
        audioRestoreError = [string]$restored.audioRestoreError
    } | ConvertTo-Json -Depth 6 -Compress
    exit 0
}

if ($GameProcessId -le 0) { throw 'Guard requires GameProcessId.' }
$startedAt = Get-Date
$sessionEnteredUtc = [DateTime]::Parse([string]$session.enteredAtUtc).ToUniversalTime()
$currentGameProcessId = $GameProcessId
$handoffCount = 0
$observedGameProcessIds = New-Object System.Collections.Generic.List[int]
$observedGameProcessIds.Add($currentGameProcessId)
$handoffDeadline = $null
$samples = New-Object System.Collections.Generic.List[object]
$logicalProcessorCount = [Math]::Max(1, [Environment]::ProcessorCount)
$previousCpuByPid = @{}
$airLinkWasObserved = $false
$airLinkInactiveSince = $null
$audioRestoredOnAirLinkExit = $false
$airLinkExitAudioRestore = $null

while ($true) {
    $game = Get-Process -Id $currentGameProcessId -ErrorAction SilentlyContinue
    if (-not $game) {
        $candidate = Get-CimInstance Win32_Process -Filter "Name='Starfield.exe'" -ErrorAction SilentlyContinue |
            Where-Object {
                [int]$_.ProcessId -ne $currentGameProcessId -and
                $_.CreationDate -and
                ([DateTime]$_.CreationDate).ToUniversalTime() -ge $sessionEnteredUtc.AddSeconds(-5)
            } |
            Sort-Object CreationDate -Descending |
            Select-Object -First 1

        if ($candidate) {
            $currentGameProcessId = [int]$candidate.ProcessId
            if (-not $observedGameProcessIds.Contains($currentGameProcessId)) {
                $observedGameProcessIds.Add($currentGameProcessId)
                $handoffCount += 1
            }
            $handoffDeadline = $null
            continue
        }

        if (-not $handoffDeadline) {
            $handoffDeadline = (Get-Date).AddSeconds(30)
        }
        if ((Get-Date) -ge $handoffDeadline) { break }
        Start-Sleep -Seconds 1
        continue
    }

    $handoffDeadline = $null
    $sampledAt = Get-Date
    $gpu = Get-NvidiaSample
    $storage = Get-GameDriveSample -Root ([string]$session.gameRoot)
    $os = Get-CimInstance Win32_OperatingSystem

    $systemCpuPct = $null
    try {
        $processorRows = @(Get-CimInstance Win32_Processor -ErrorAction Stop)
        if ($processorRows.Count -gt 0) {
            $systemCpuPct = [math]::Round(($processorRows | Measure-Object LoadPercentage -Average).Average, 1)
        }
    } catch {}

    $starfieldCpuPct = $null
    $cpuSeconds = $game.TotalProcessorTime.TotalSeconds
    if ($previousCpuByPid.ContainsKey($currentGameProcessId)) {
        $previousCpu = $previousCpuByPid[$currentGameProcessId]
        $elapsedSeconds = [Math]::Max(0.001, ($sampledAt - $previousCpu.sampledAt).TotalSeconds)
        $cpuDeltaSeconds = [Math]::Max(0, $cpuSeconds - [double]$previousCpu.cpuSeconds)
        $starfieldCpuPct = [math]::Round(
            [Math]::Min(100, (($cpuDeltaSeconds / $elapsedSeconds) / $logicalProcessorCount) * 100),
            1
        )
    }
    $previousCpuByPid[$currentGameProcessId] = [pscustomobject]@{
        sampledAt = $sampledAt
        cpuSeconds = $cpuSeconds
    }

    $metaProcesses = @(Get-Process -Name 'OculusDash','OVRServer_x64','OVRServiceLauncher' -ErrorAction SilentlyContinue)
    $metaWorkingSetMiB = if ($metaProcesses.Count) {
        [math]::Round((($metaProcesses | Measure-Object WorkingSet64 -Sum).Sum / 1MB), 1)
    } else { 0 }
    $airLinkRuntimeActive = $null -ne ($metaProcesses | Where-Object ProcessName -eq 'OculusDash' | Select-Object -First 1)
    if ($airLinkRuntimeActive) {
        $airLinkWasObserved = $true
        $airLinkInactiveSince = $null
    }
    elseif ($airLinkWasObserved -and -not $audioRestoredOnAirLinkExit) {
        if (-not $airLinkInactiveSince) {
            $airLinkInactiveSince = Get-Date
        }
        elseif (((Get-Date) - $airLinkInactiveSince).TotalSeconds -ge 10) {
            $airLinkExitAudioRestore = Restore-AudioState -Session $session -TimeoutSeconds 10
            if ($airLinkExitAudioRestore.restored) {
                $audioRestoredOnAirLinkExit = $true
            }
        }
    }

    $gpuMemoryPct = if ($gpu -and $gpu.gpuMemoryTotalMiB -gt 0) {
        [math]::Round(($gpu.gpuMemoryUsedMiB / $gpu.gpuMemoryTotalMiB) * 100, 1)
    } else { $null }

    $sample = [pscustomobject]@{
        timestampUtc = $sampledAt.ToUniversalTime().ToString('o')
        starfieldProcessId = $currentGameProcessId
        gpuUtilPct = if ($gpu) { $gpu.gpuUtilPct } else { $null }
        gpuEncoderUtilPct = if ($gpu) { $gpu.gpuEncoderUtilPct } else { $null }
        gpuDecoderUtilPct = if ($gpu) { $gpu.gpuDecoderUtilPct } else { $null }
        gpuMemoryUsedMiB = if ($gpu) { $gpu.gpuMemoryUsedMiB } else { $null }
        gpuMemoryTotalMiB = if ($gpu) { $gpu.gpuMemoryTotalMiB } else { $null }
        gpuMemoryPct = $gpuMemoryPct
        gpuTemperatureC = if ($gpu) { $gpu.gpuTemperatureC } else { $null }
        gpuPowerW = if ($gpu) { $gpu.gpuPowerW } else { $null }
        starfieldCpuPct = $starfieldCpuPct
        systemCpuPct = $systemCpuPct
        starfieldWorkingSetMiB = [math]::Round($game.WorkingSet64 / 1MB, 1)
        starfieldPrivateMiB = [math]::Round($game.PrivateMemorySize64 / 1MB, 1)
        systemFreeMemoryMiB = [math]::Round($os.FreePhysicalMemory / 1KB, 1)
        metaVrProcessCount = $metaProcesses.Count
        metaVrWorkingSetMiB = $metaWorkingSetMiB
        airLinkRuntimeActive = [bool]$airLinkRuntimeActive
        llamaServerCount = @((Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue)).Count
        gameDrive = if ($storage) { [string]$storage.gameDrive } else { '' }
        gameDriveFreeGiB = if ($storage) { $storage.gameDriveFreeGiB } else { $null }
        gameDriveFreePct = if ($storage) { $storage.gameDriveFreePct } else { $null }
        gameDriveActivePct = if ($storage) { $storage.gameDriveActivePct } else { $null }
        gameDriveReadMiBps = if ($storage) { $storage.gameDriveReadMiBps } else { $null }
        gameDriveWriteMiBps = if ($storage) { $storage.gameDriveWriteMiBps } else { $null }
        gameDriveAvgLatencyMs = if ($storage) { $storage.gameDriveAvgLatencyMs } else { $null }
        gameDriveQueueLength = if ($storage) { $storage.gameDriveQueueLength } else { $null }
        pagesPerSec = if ($storage) { $storage.pagesPerSec } else { $null }
    }
    $samples.Add($sample)
    $sample | Export-Csv -LiteralPath $session.telemetryPath -NoTypeInformation -Append
    Start-Sleep -Seconds ([Math]::Max(1, $SampleSeconds))
}

$restored = Restore-Session -Session $session
$endedAt = Get-Date
$summaryPath = [System.IO.Path]::ChangeExtension([string]$session.telemetryPath, '.summary.json')
$gpuSamples = @($samples | Where-Object { $null -ne $_.gpuUtilPct })
$starfieldCpuSamples = @($samples | Where-Object { $null -ne $_.starfieldCpuPct })
$systemCpuSamples = @($samples | Where-Object { $null -ne $_.systemCpuPct })
$encoderSamples = @($samples | Where-Object { $null -ne $_.gpuEncoderUtilPct })
$decoderSamples = @($samples | Where-Object { $null -ne $_.gpuDecoderUtilPct })
$gpuMemoryPctSamples = @($samples | Where-Object { $null -ne $_.gpuMemoryPct })
$driveFreeGiBSamples = @($samples | Where-Object { $null -ne $_.gameDriveFreeGiB })
$driveFreePctSamples = @($samples | Where-Object { $null -ne $_.gameDriveFreePct })
$driveActiveSamples = @($samples | Where-Object { $null -ne $_.gameDriveActivePct })
$driveReadSamples = @($samples | Where-Object { $null -ne $_.gameDriveReadMiBps })
$driveWriteSamples = @($samples | Where-Object { $null -ne $_.gameDriveWriteMiBps })
$driveLatencySamples = @($samples | Where-Object { $null -ne $_.gameDriveAvgLatencyMs })
$driveQueueSamples = @($samples | Where-Object { $null -ne $_.gameDriveQueueLength })
$pagesPerSecSamples = @($samples | Where-Object { $null -ne $_.pagesPerSec })
$storageEnd = Get-GameDriveSample -Root ([string]$session.gameRoot)
$summary = [ordered]@{
    schemaVersion = 'stephanos.starfield-vr-performance-summary.v1'
    sessionPath = $SessionPath
    gameProcessId = $GameProcessId
    finalGameProcessId = $currentGameProcessId
    processHandoffCount = $handoffCount
    observedGameProcessIds = @($observedGameProcessIds)
    startedAtUtc = $startedAt.ToUniversalTime().ToString('o')
    endedAtUtc = $endedAt.ToUniversalTime().ToString('o')
    runtimeSeconds = [math]::Round(($endedAt - $startedAt).TotalSeconds, 1)
    sampleCount = $samples.Count
    avgGpuUtilPct = if ($gpuSamples.Count) { [math]::Round(($gpuSamples | Measure-Object gpuUtilPct -Average).Average, 1) } else { $null }
    maxGpuUtilPct = if ($gpuSamples.Count) { ($gpuSamples | Measure-Object gpuUtilPct -Maximum).Maximum } else { $null }
    maxGpuMemoryUsedMiB = if ($gpuSamples.Count) { ($gpuSamples | Measure-Object gpuMemoryUsedMiB -Maximum).Maximum } else { $null }
    maxGpuMemoryPct = if ($gpuMemoryPctSamples.Count) { ($gpuMemoryPctSamples | Measure-Object gpuMemoryPct -Maximum).Maximum } else { $null }
    maxGpuEncoderUtilPct = if ($encoderSamples.Count) { ($encoderSamples | Measure-Object gpuEncoderUtilPct -Maximum).Maximum } else { $null }
    maxGpuDecoderUtilPct = if ($decoderSamples.Count) { ($decoderSamples | Measure-Object gpuDecoderUtilPct -Maximum).Maximum } else { $null }
    avgStarfieldCpuPct = if ($starfieldCpuSamples.Count) { [math]::Round(($starfieldCpuSamples | Measure-Object starfieldCpuPct -Average).Average, 1) } else { $null }
    maxStarfieldCpuPct = if ($starfieldCpuSamples.Count) { ($starfieldCpuSamples | Measure-Object starfieldCpuPct -Maximum).Maximum } else { $null }
    avgSystemCpuPct = if ($systemCpuSamples.Count) { [math]::Round(($systemCpuSamples | Measure-Object systemCpuPct -Average).Average, 1) } else { $null }
    maxSystemCpuPct = if ($systemCpuSamples.Count) { ($systemCpuSamples | Measure-Object systemCpuPct -Maximum).Maximum } else { $null }
    minSystemFreeMemoryMiB = if ($samples.Count) { ($samples | Measure-Object systemFreeMemoryMiB -Minimum).Minimum } else { $null }
    maxMetaVrWorkingSetMiB = if ($samples.Count) { ($samples | Measure-Object metaVrWorkingSetMiB -Maximum).Maximum } else { 0 }
    airLinkRuntimeSamplePct = if ($samples.Count) { [math]::Round((@($samples | Where-Object airLinkRuntimeActive).Count / $samples.Count) * 100, 1) } else { 0 }
    maxLlamaServerCount = if ($samples.Count) { ($samples | Measure-Object llamaServerCount -Maximum).Maximum } else { 0 }
    gameDrive = if ($storageEnd) { [string]$storageEnd.gameDrive } elseif ($session.storageStart) { [string]$session.storageStart.gameDrive } else { '' }
    startGameDriveFreeGiB = if ($session.storageStart) { $session.storageStart.gameDriveFreeGiB } else { $null }
    startGameDriveFreePct = if ($session.storageStart) { $session.storageStart.gameDriveFreePct } else { $null }
    endGameDriveFreeGiB = if ($storageEnd) { $storageEnd.gameDriveFreeGiB } else { $null }
    endGameDriveFreePct = if ($storageEnd) { $storageEnd.gameDriveFreePct } else { $null }
    minGameDriveFreeGiB = if ($driveFreeGiBSamples.Count) { ($driveFreeGiBSamples | Measure-Object gameDriveFreeGiB -Minimum).Minimum } else { $null }
    minGameDriveFreePct = if ($driveFreePctSamples.Count) { ($driveFreePctSamples | Measure-Object gameDriveFreePct -Minimum).Minimum } else { $null }
    avgGameDriveActivePct = if ($driveActiveSamples.Count) { [math]::Round(($driveActiveSamples | Measure-Object gameDriveActivePct -Average).Average, 1) } else { $null }
    maxGameDriveActivePct = if ($driveActiveSamples.Count) { ($driveActiveSamples | Measure-Object gameDriveActivePct -Maximum).Maximum } else { $null }
    avgGameDriveReadMiBps = if ($driveReadSamples.Count) { [math]::Round(($driveReadSamples | Measure-Object gameDriveReadMiBps -Average).Average, 2) } else { $null }
    avgGameDriveWriteMiBps = if ($driveWriteSamples.Count) { [math]::Round(($driveWriteSamples | Measure-Object gameDriveWriteMiBps -Average).Average, 2) } else { $null }
    maxGameDriveLatencyMs = if ($driveLatencySamples.Count) { ($driveLatencySamples | Measure-Object gameDriveAvgLatencyMs -Maximum).Maximum } else { $null }
    maxGameDriveQueueLength = if ($driveQueueSamples.Count) { ($driveQueueSamples | Measure-Object gameDriveQueueLength -Maximum).Maximum } else { $null }
    maxPagesPerSec = if ($pagesPerSecSamples.Count) { ($pagesPerSecSamples | Measure-Object pagesPerSec -Maximum).Maximum } else { $null }
    frameTimeTelemetryAvailable = $false
    prefsRestored = [bool]$restored.prefsRestored
    audioRestored = [bool]$restored.audioRestored
    audioRestoreAttempts = [int]$restored.audioRestoreAttempts
    audioStableConfirmations = [int]$restored.audioStableConfirmations
    audioFinalEndpointId = [string]$restored.audioFinalEndpointId
    audioRestoreError = [string]$restored.audioRestoreError
    audioRestoredOnAirLinkExit = [bool]$audioRestoredOnAirLinkExit
    airLinkExitAudioRestoreAttempts = if ($airLinkExitAudioRestore) { [int]$airLinkExitAudioRestore.attempts } else { 0 }
    originalAudioEndpointId = [string]$session.audio.originalEndpointId
    originalAudioEndpoints = $session.audio.originalEndpoints
    questAudioEndpointId = [string]$session.audio.questEndpointId
}
Write-JsonNoBom -Path $summaryPath -Value $summary

try {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($node -and (Test-Path -LiteralPath $telemetryReportScript -PathType Leaf)) {
        & $node.Source $telemetryReportScript *> $null
    }
} catch {}
