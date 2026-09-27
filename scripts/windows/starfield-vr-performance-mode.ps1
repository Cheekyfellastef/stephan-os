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

    $audioRestored = $false
    try {
        if ($Session.audio.originalEndpointId -and (Test-Path -LiteralPath $audioEndpointScript -PathType Leaf)) {
            $audioRestore = & $powershellExecutable -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $audioEndpointScript -Action SetDefault -EndpointId ([string]$Session.audio.originalEndpointId) 2>&1 | Out-String
            if ($LASTEXITCODE -eq 0 -and $audioRestore.Trim()) { $audioRestored = $true }
        }
    } catch {}

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
        audioRestored = $audioRestored
    }
}

function Get-NvidiaSample {
    $nvidia = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $nvidia) { return $null }
    $line = & $nvidia.Source --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits 2>$null | Select-Object -First 1
    if (-not $line) { return $null }
    $parts = @($line -split ',') | ForEach-Object { $_.Trim() }
    if ($parts.Count -lt 5) { return $null }
    return [pscustomobject]@{
        gpuUtilPct = [double]$parts[0]
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
    $audioCurrentJson = & $powershellExecutable -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $audioEndpointScript -Action GetDefault 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or -not $audioCurrentJson.Trim()) { throw "Unable to capture current audio endpoint: $($audioCurrentJson.Trim())" }
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
            questEndpointId = ''
        }
        hagsMode = $hagsMode
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
    } | ConvertTo-Json -Compress
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
    $gpu = Get-NvidiaSample
    $os = Get-CimInstance Win32_OperatingSystem
    $sample = [pscustomobject]@{
        timestampUtc = (Get-Date).ToUniversalTime().ToString('o')
        starfieldProcessId = $currentGameProcessId
        gpuUtilPct = if ($gpu) { $gpu.gpuUtilPct } else { $null }
        gpuMemoryUsedMiB = if ($gpu) { $gpu.gpuMemoryUsedMiB } else { $null }
        gpuMemoryTotalMiB = if ($gpu) { $gpu.gpuMemoryTotalMiB } else { $null }
        gpuTemperatureC = if ($gpu) { $gpu.gpuTemperatureC } else { $null }
        gpuPowerW = if ($gpu) { $gpu.gpuPowerW } else { $null }
        starfieldWorkingSetMiB = [math]::Round($game.WorkingSet64 / 1MB, 1)
        starfieldPrivateMiB = [math]::Round($game.PrivateMemorySize64 / 1MB, 1)
        systemFreeMemoryMiB = [math]::Round($os.FreePhysicalMemory / 1KB, 1)
        llamaServerCount = @((Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue)).Count
    }
    $samples.Add($sample)
    $sample | Export-Csv -LiteralPath $session.telemetryPath -NoTypeInformation -Append
    Start-Sleep -Seconds ([Math]::Max(1, $SampleSeconds))
}

$restored = Restore-Session -Session $session
$endedAt = Get-Date
$summaryPath = [System.IO.Path]::ChangeExtension([string]$session.telemetryPath, '.summary.json')
$gpuSamples = @($samples | Where-Object { $null -ne $_.gpuUtilPct })
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
    maxGpuUtilPct = if ($gpuSamples.Count) { ($gpuSamples | Measure-Object gpuUtilPct -Maximum).Maximum } else { $null }
    maxGpuMemoryUsedMiB = if ($gpuSamples.Count) { ($gpuSamples | Measure-Object gpuMemoryUsedMiB -Maximum).Maximum } else { $null }
    minSystemFreeMemoryMiB = if ($samples.Count) { ($samples | Measure-Object systemFreeMemoryMiB -Minimum).Minimum } else { $null }
    maxLlamaServerCount = if ($samples.Count) { ($samples | Measure-Object llamaServerCount -Maximum).Maximum } else { 0 }
    prefsRestored = [bool]$restored.prefsRestored
    audioRestored = [bool]$restored.audioRestored
    originalAudioEndpointId = [string]$session.audio.originalEndpointId
    questAudioEndpointId = [string]$session.audio.questEndpointId
}
Write-JsonNoBom -Path $summaryPath -Value $summary
