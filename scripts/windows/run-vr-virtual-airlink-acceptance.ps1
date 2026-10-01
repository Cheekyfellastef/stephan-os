[CmdletBinding()]
param(
    [int]$ObservationSeconds = 12,
    [int]$PollMilliseconds = 1000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..\..'))
$workspaceRoot = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'
$stateRoot = Join-Path $workspaceRoot 'vr'
$simStatePath = Join-Path $stateRoot 'starfield-vr-sim-air-link.json'
$governorStatePath = Join-Path $stateRoot 'vr-resource-governor-current.json'
$governorScript = Join-Path $repoRoot 'scripts\windows\run-vr-resource-governor.ps1'
$powershellExecutable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$lightweightModel = 'llama3.2:3b'
$governorScriptPattern = [regex]::Escape($governorScript)

function Resolve-OllamaExecutable {
    $command = Get-Command ollama.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return [string]$command.Source }
    foreach ($candidate in @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
        (Join-Path $env:LOCALAPPDATA 'Ollama\ollama.exe')
    )) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return ''
}

function Get-LoadedOllamaModels {
    param([string]$OllamaExecutable)
    if (-not $OllamaExecutable) { return @() }
    try {
        $lines = @(& $OllamaExecutable ps 2>$null)
        if ($LASTEXITCODE -ne 0 -or $lines.Count -lt 2) { return @() }
        return @(
            $lines |
                Select-Object -Skip 1 |
                ForEach-Object {
                    $line = [string]$_
                    if (-not $line.Trim()) { return }
                    $parts = @($line.Trim() -split '\s+')
                    if ($parts.Count -gt 0 -and $parts[0]) { [string]$parts[0] }
                } |
                Where-Object { $_ } |
                Select-Object -Unique
        )
    } catch {
        return @()
    }
}

function Get-HeavyModels {
    param([string[]]$Models = @())
    return @(
        $Models |
            Where-Object {
                $_ -and -not [string]::Equals(
                    [string]$_,
                    $lightweightModel,
                    [System.StringComparison]::OrdinalIgnoreCase
                )
            }
    )
}

function Get-GpuSnapshot {
    $command = Get-Command nvidia-smi.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) {
        return [pscustomobject]@{ available = $false; memoryUsedMiB = $null; memoryTotalMiB = $null; utilizationGpuPercent = $null }
    }
    try {
        $line = @(
            & $command.Source '--query-gpu=memory.used,memory.total,utilization.gpu' '--format=csv,noheader,nounits' 2>$null
        ) | Select-Object -First 1
        if (-not $line) {
            return [pscustomobject]@{ available = $false; memoryUsedMiB = $null; memoryTotalMiB = $null; utilizationGpuPercent = $null }
        }
        $parts = @(([string]$line).Split(',') | ForEach-Object { $_.Trim() })
        if ($parts.Count -lt 3) {
            return [pscustomobject]@{ available = $false; memoryUsedMiB = $null; memoryTotalMiB = $null; utilizationGpuPercent = $null }
        }
        return [pscustomobject]@{
            available = $true
            memoryUsedMiB = [int]$parts[0]
            memoryTotalMiB = [int]$parts[1]
            utilizationGpuPercent = [int]$parts[2]
        }
    } catch {
        return [pscustomobject]@{ available = $false; memoryUsedMiB = $null; memoryTotalMiB = $null; utilizationGpuPercent = $null }
    }
}

function Get-GovernorWatchProcesses {
    return @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -eq 'powershell.exe' -and
                [string]$_.CommandLine -match $governorScriptPattern -and
                [string]$_.CommandLine -match '(?i)-Action\s+Watch'
            }
    )
}

function Ensure-GovernorWatch {
    $before = @(Get-GovernorWatchProcesses)
    $started = $false
    if ($before.Count -eq 0) {
        if (-not (Test-Path -LiteralPath $powershellExecutable -PathType Leaf)) {
            throw 'VR_ACCEPTANCE_POWERSHELL_MISSING'
        }
        $quotedScript = '"' + $governorScript.Replace('"', '\"') + '"'
        Start-Process -FilePath $powershellExecutable -ArgumentList @(
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-File', $quotedScript,
            '-Action', 'Watch'
        ) -WorkingDirectory $repoRoot -WindowStyle Hidden | Out-Null
        $started = $true
        Start-Sleep -Milliseconds 700
    }
    $after = @(Get-GovernorWatchProcesses)
    return [pscustomobject]@{
        started = [bool]$started
        processCount = [int]$after.Count
        healthy = [bool]($after.Count -ge 1)
    }
}

function Set-VirtualAirLink {
    param([bool]$Enabled)
    if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) {
        New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
    }
    $payload = [ordered]@{
        schemaVersion = 'stephanos.starfield-vr-sim-air-link.v1'
        enabled = [bool]$Enabled
        purpose = 'readiness-only'
        updatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    }
    [System.IO.File]::WriteAllText(
        $simStatePath,
        ($payload | ConvertTo-Json -Depth 4),
        (New-Object System.Text.UTF8Encoding($false))
    )
    return [pscustomobject]$payload
}

function Invoke-GovernorReconcile {
    if (-not (Test-Path -LiteralPath $governorScript -PathType Leaf)) {
        throw 'VR_ACCEPTANCE_GOVERNOR_SCRIPT_MISSING'
    }
    & $powershellExecutable -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $governorScript -Action Reconcile | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'VR_ACCEPTANCE_GOVERNOR_RECONCILE_FAILED' }
}

function Read-GovernorState {
    if (-not (Test-Path -LiteralPath $governorStatePath -PathType Leaf)) { return $null }
    try {
        return Get-Content -LiteralPath $governorStatePath -Raw | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Test-VirtualAirLinkOff {
    if (-not (Test-Path -LiteralPath $simStatePath -PathType Leaf)) { return $true }
    try {
        $state = Get-Content -LiteralPath $simStatePath -Raw | ConvertFrom-Json
        return [bool](
            $state.schemaVersion -eq 'stephanos.starfield-vr-sim-air-link.v1' -and
            $state.enabled -ne $true
        )
    } catch {
        return $false
    }
}

$ollamaExecutable = Resolve-OllamaExecutable
$beforeModels = @(Get-LoadedOllamaModels -OllamaExecutable $ollamaExecutable)
$heavyBefore = @(Get-HeavyModels -Models $beforeModels)
$gpuBefore = Get-GpuSnapshot
$watch = $null
$governorStateDuringTest = $null
$heavySamples = New-Object System.Collections.Generic.List[string]
$finalModels = @()
$heavyAfter = @()
$gpuAfter = $null
$blocker = ''
$testPassed = $false
$virtualOffRestored = $false

try {
    $watch = Ensure-GovernorWatch
    if (-not $watch.healthy) { throw 'VR_ACCEPTANCE_GOVERNOR_WATCH_NOT_RUNNING' }

    Set-VirtualAirLink -Enabled $true | Out-Null
    Invoke-GovernorReconcile
    Start-Sleep -Seconds 2

    $deadline = (Get-Date).AddSeconds([Math]::Max(6, $ObservationSeconds))
    $poll = [Math]::Max(500, $PollMilliseconds)
    while ((Get-Date) -lt $deadline) {
        $sampleModels = @(Get-LoadedOllamaModels -OllamaExecutable $ollamaExecutable)
        foreach ($model in @(Get-HeavyModels -Models $sampleModels)) {
            if (-not $heavySamples.Contains([string]$model)) {
                $heavySamples.Add([string]$model)
            }
        }
        Start-Sleep -Milliseconds $poll
    }

    $governorStateDuringTest = Read-GovernorState
    $finalModels = @(Get-LoadedOllamaModels -OllamaExecutable $ollamaExecutable)
    $heavyAfter = @(Get-HeavyModels -Models $finalModels)
    $gpuAfter = Get-GpuSnapshot

    if (-not $governorStateDuringTest) {
        $blocker = 'VR_ACCEPTANCE_GOVERNOR_STATE_MISSING'
    } elseif ($governorStateDuringTest.schemaVersion -ne 'stephanos.vr-resource-governor.v1') {
        $blocker = 'VR_ACCEPTANCE_GOVERNOR_STATE_SCHEMA_INVALID'
    } elseif ($governorStateDuringTest.active -ne $true) {
        $blocker = 'VR_ACCEPTANCE_GOVERNOR_NOT_ACTIVE'
    } elseif ($governorStateDuringTest.virtualAirLinkTestActive -ne $true) {
        $blocker = 'VR_ACCEPTANCE_VIRTUAL_AIR_LINK_NOT_OBSERVED'
    } elseif ($governorStateDuringTest.heavyModelAllowed -ne $false) {
        $blocker = 'VR_ACCEPTANCE_HEAVY_MODEL_POLICY_NOT_BLOCKED'
    } elseif ($heavySamples.Count -gt 0 -or $heavyAfter.Count -gt 0) {
        $blocker = 'VR_ACCEPTANCE_HEAVY_MODEL_RESPAWNED'
    } else {
        $testPassed = $true
    }
} catch {
    if (-not $blocker) {
        $blocker = if ($_.Exception.Message) { [string]$_.Exception.Message } else { 'VR_ACCEPTANCE_EXECUTION_FAILED' }
    }
} finally {
    try {
        Set-VirtualAirLink -Enabled $false | Out-Null
        Invoke-GovernorReconcile
        $virtualOffRestored = Test-VirtualAirLinkOff
    } catch {
        $virtualOffRestored = $false
        if (-not $blocker) { $blocker = 'VR_ACCEPTANCE_VIRTUAL_AIR_LINK_RESET_FAILED' }
    }
}

$ok = [bool]($testPassed -and $virtualOffRestored)
if (-not $ok -and -not $blocker) { $blocker = 'VR_ACCEPTANCE_FAILED' }

$vramReleasedMiB = $null
if ($gpuBefore.available -and $gpuAfter -and $gpuAfter.available) {
    $vramReleasedMiB = [int]($gpuBefore.memoryUsedMiB - $gpuAfter.memoryUsedMiB)
}

[pscustomobject]@{
    schemaVersion = 'stephanos.vr-virtual-airlink-acceptance.v1'
    ok = $ok
    virtualAirLinkTestUsed = $true
    virtualAirLinkRestoredOff = [bool]$virtualOffRestored
    launchAllowed = $false
    realHeadsetProofClaimed = $false
    governorWatchStarted = [bool]($watch -and $watch.started)
    governorWatchProcessCount = if ($watch) { [int]$watch.processCount } else { 0 }
    lightweightModel = $lightweightModel
    loadedModelsBefore = @($beforeModels)
    heavyModelsBefore = @($heavyBefore)
    heavyModelSamplesDuringGuard = @($heavySamples)
    loadedModelsAfterGuard = @($finalModels)
    heavyModelsAfterGuard = @($heavyAfter)
    gpuBefore = $gpuBefore
    gpuAfter = $gpuAfter
    vramReleasedMiB = $vramReleasedMiB
    governorState = $governorStateDuringTest
    observationSeconds = [Math]::Max(6, $ObservationSeconds)
    blocker = $blocker
    arbitraryShellAllowed = $false
    arbitraryPathAllowed = $false
    sourceMutationAllowed = $false
    pcRestartAllowed = $false
    finalVerdict = if ($ok) {
        'SOVEREIGN_COMMANDER_VIRTUAL_AIR_LINK_ACCEPTANCE_PASSED'
    } else {
        'SOVEREIGN_COMMANDER_VIRTUAL_AIR_LINK_ACCEPTANCE_FAILED'
    }
} | ConvertTo-Json -Depth 8

if ($ok) { exit 0 }
exit 2
