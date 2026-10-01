[CmdletBinding()]
param(
    [ValidateSet('Watch','Reconcile','Status')][string]$Action = 'Watch',
    [int]$PollMilliseconds = 1500,
    [int]$ReleaseGraceSeconds = 45
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }

$workspaceRoot = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'
$stateRoot = Join-Path $workspaceRoot 'vr'
$statePath = Join-Path $stateRoot 'vr-resource-governor-current.json'
$simAirLinkStatePath = Join-Path $stateRoot 'starfield-vr-sim-air-link.json'
$lightweightModel = 'llama3.2:3b'

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

function Test-RealAirLinkActive {
    return $null -ne (Get-Process -Name 'OculusDash' -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Test-VirtualAirLinkTestActive {
    if (-not (Test-Path -LiteralPath $simAirLinkStatePath -PathType Leaf)) { return $false }
    try {
        $state = Get-Content -LiteralPath $simAirLinkStatePath -Raw | ConvertFrom-Json
        return [bool](
            $state.schemaVersion -eq 'stephanos.starfield-vr-sim-air-link.v1' -and
            $state.enabled -eq $true -and
            $state.purpose -eq 'readiness-only'
        )
    }
    catch {
        return $false
    }
}

function Get-AirLinkSignal {
    $real = Test-RealAirLinkActive
    $virtual = Test-VirtualAirLinkTestActive
    return [pscustomobject]@{
        active = [bool]($real -or $virtual)
        real = [bool]$real
        virtual = [bool]$virtual
        reason = if ($real) {
            'meta-air-link-session-active'
        } elseif ($virtual) {
            'virtual-air-link-test-active'
        } else {
            'meta-air-link-session-inactive'
        }
    }
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
    }
    catch {
        return @()
    }
}

function Stop-OllamaModel {
    param([string]$OllamaExecutable, [string]$Model)
    if (-not $OllamaExecutable -or -not $Model) { return $false }
    try {
        & $OllamaExecutable stop $Model *> $null
        return $LASTEXITCODE -eq 0
    }
    catch {
        return $false
    }
}

function Write-GovernorState {
    param(
        [bool]$Active,
        [bool]$AirLinkActive,
        [bool]$RealAirLinkActive = $false,
        [bool]$VirtualAirLinkTestActive = $false,
        [string[]]$ParkedModels = @(),
        [string]$OllamaExecutable = '',
        [string]$Reason = ''
    )
    if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) {
        New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
    }
    $payload = [ordered]@{
        schemaVersion = 'stephanos.vr-resource-governor.v1'
        active = [bool]$Active
        airLinkActive = [bool]$AirLinkActive
        realAirLinkActive = [bool]$RealAirLinkActive
        virtualAirLinkTestActive = [bool]$VirtualAirLinkTestActive
        preferredModel = $lightweightModel
        ollamaLoadMode = if ($Active) { 'cool' } else { 'balanced' }
        heavyModelAllowed = -not $Active
        parkedModels = @($ParkedModels)
        ollamaAvailable = [bool]$OllamaExecutable
        reason = $Reason
        updatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    }
    [System.IO.File]::WriteAllText(
        $statePath,
        ($payload | ConvertTo-Json -Depth 6),
        (New-Object System.Text.UTF8Encoding($false))
    )
    return [pscustomobject]$payload
}

function Invoke-Reconcile {
    param(
        [bool]$EffectiveActive,
        [bool]$AirLinkActive,
        [bool]$RealAirLinkActive = $false,
        [bool]$VirtualAirLinkTestActive = $false,
        [string]$Reason
    )
    $ollamaExecutable = Resolve-OllamaExecutable
    $parked = New-Object System.Collections.Generic.List[string]
    if ($EffectiveActive -and $ollamaExecutable) {
        foreach ($model in @(Get-LoadedOllamaModels -OllamaExecutable $ollamaExecutable)) {
            if ([string]::Equals($model, $lightweightModel, [System.StringComparison]::OrdinalIgnoreCase)) {
                continue
            }
            if (Stop-OllamaModel -OllamaExecutable $ollamaExecutable -Model $model) {
                $parked.Add($model)
            }
        }
    }
    return Write-GovernorState -Active $EffectiveActive -AirLinkActive $AirLinkActive -RealAirLinkActive $RealAirLinkActive -VirtualAirLinkTestActive $VirtualAirLinkTestActive -ParkedModels @($parked) -OllamaExecutable $ollamaExecutable -Reason $Reason
}

if ($Action -eq 'Status') {
    if (Test-Path -LiteralPath $statePath -PathType Leaf) {
        Get-Content -LiteralPath $statePath -Raw
    }
    else {
        $signal = Get-AirLinkSignal
        Write-GovernorState -Active $false -AirLinkActive $signal.active -RealAirLinkActive $signal.real -VirtualAirLinkTestActive $signal.virtual -Reason 'status-initialised' | ConvertTo-Json -Depth 6
    }
    exit 0
}

if ($Action -eq 'Reconcile') {
    $signal = Get-AirLinkSignal
    $state = Invoke-Reconcile -EffectiveActive $signal.active -AirLinkActive $signal.active -RealAirLinkActive $signal.real -VirtualAirLinkTestActive $signal.virtual -Reason $signal.reason
    $state | ConvertTo-Json -Depth 6
    exit 0
}

$poll = [Math]::Max(500, $PollMilliseconds)
$grace = [Math]::Max(5, $ReleaseGraceSeconds)
$lastAirLinkSeen = [DateTime]::MinValue
$lastEffectiveActive = $null
$lastModelGuardAt = [DateTime]::MinValue

while ($true) {
    $now = Get-Date
    $signal = Get-AirLinkSignal
    $airLinkActive = [bool]$signal.active
    if ($airLinkActive) { $lastAirLinkSeen = $now }
    $withinReleaseGrace = -not $airLinkActive -and $lastAirLinkSeen -ne [DateTime]::MinValue -and ($now - $lastAirLinkSeen).TotalSeconds -lt $grace
    $effectiveActive = [bool]($airLinkActive -or $withinReleaseGrace)
    $transitioned = $null -eq $lastEffectiveActive -or $effectiveActive -ne [bool]$lastEffectiveActive
    $guardDue = $effectiveActive -and ($now - $lastModelGuardAt).TotalSeconds -ge 5

    if ($transitioned -or $guardDue) {
        $reason = if ($airLinkActive) {
            [string]$signal.reason
        } elseif ($withinReleaseGrace) {
            'meta-air-link-release-grace'
        } else {
            'meta-air-link-session-inactive'
        }
        Invoke-Reconcile -EffectiveActive $effectiveActive -AirLinkActive $airLinkActive -RealAirLinkActive $signal.real -VirtualAirLinkTestActive $signal.virtual -Reason $reason | Out-Null
        if ($effectiveActive) { $lastModelGuardAt = $now }
        $lastEffectiveActive = $effectiveActive
    }

    Start-Sleep -Milliseconds $poll
}
