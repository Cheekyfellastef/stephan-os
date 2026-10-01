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
    # Keep the legacy name for state/schema compatibility, but treat any active VR
    # compositor/dashboard as a gaming-protection signal.
    foreach ($name in @('OculusDash', 'vrcompositor', 'vrdashboard')) {
        if ($null -ne (Get-Process -Name $name -ErrorAction SilentlyContinue | Select-Object -First 1)) {
            return $true
        }
    }
    return $false
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

function Test-WindowsGamePresenceActive {
    # GameBarPresenceWriter is spawned by Windows gaming presence detection for an
    # active game. It gives us a generic signal for titles we have never seen before.
    return $null -ne (Get-Process -Name 'GameBarPresenceWriter' -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Get-FlatGameSignal {
    $knownProcessNames = @(
        'Starfield',
        'Cyberpunk2077',
        'SkyrimSE',
        'SkyrimVR',
        'Fallout4',
        'Fallout4VR'
    )
    $extraNames = @(
        ([string]$env:STEPHANOS_GAME_PROCESS_NAMES -split '[,;]' |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ })
    )
    $allKnownNames = @($knownProcessNames + $extraNames | Select-Object -Unique)

    $libraryPatterns = New-Object System.Collections.Generic.List[string]
    foreach ($pattern in @(
        '\\steamapps\\common\\',
        '\\SteamLibrary\\steamapps\\common\\',
        '\\XboxGames\\',
        '\\Epic Games\\',
        '\\GOG Games\\',
        '\\EA Games\\',
        '\\Ubisoft\\Ubisoft Game Launcher\\games\\',
        '\\Rockstar Games\\',
        '\\Battle.net\\',
        '\\itch\\apps\\'
    )) {
        $libraryPatterns.Add($pattern)
    }

    foreach ($root in @(
        ([string]$env:STEPHANOS_GAME_LIBRARY_ROOTS -split ';' |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ })
    )) {
        $normalizedRoot = $root.TrimEnd('\\')
        if ($normalizedRoot) {
            $libraryPatterns.Add(([regex]::Escape($normalizedRoot) + '\\'))
        }
    }

    $excludedNames = @(
        'steam',
        'steamwebhelper',
        'EpicGamesLauncher',
        'GalaxyClient',
        'GalaxyClientService',
        'Battle.net',
        'EADesktop',
        'XboxPcApp',
        'GamingServices',
        'UbisoftConnect',
        'upc',
        'RockstarService',
        'RockstarErrorHandler'
    )

    foreach ($process in @(Get-Process -ErrorAction SilentlyContinue)) {
        $name = [string]$process.ProcessName
        if (-not $name -or $excludedNames -contains $name) { continue }

        $known = $allKnownNames -contains $name
        $path = ''
        try { $path = [string]$process.Path } catch { $path = '' }

        $inGameLibrary = $false
        if ($path) {
            foreach ($pattern in $libraryPatterns) {
                if ($path -match $pattern) {
                    $inGameLibrary = $true
                    break
                }
            }
        }

        $hasGameWindow = $false
        try { $hasGameWindow = [int64]$process.MainWindowHandle -ne 0 } catch { $hasGameWindow = $false }

        if ($known -or ($inGameLibrary -and $hasGameWindow)) {
            return [pscustomobject]@{
                active = $true
                processName = $name
                executablePath = $path
                reason = if ($known) { 'known-game-process-active' } else { 'game-library-process-active' }
            }
        }
    }

    if (Test-WindowsGamePresenceActive) {
        return [pscustomobject]@{
            active = $true
            processName = 'GameBarPresenceWriter'
            executablePath = ''
            reason = 'windows-game-presence-active'
        }
    }

    return [pscustomobject]@{
        active = $false
        processName = ''
        executablePath = ''
        reason = 'flat-game-inactive'
    }
}

function Get-GamingSignal {
    $airLink = Get-AirLinkSignal
    $flatGame = Get-FlatGameSignal
    return [pscustomobject]@{
        active = [bool]($airLink.active -or $flatGame.active)
        airLinkActive = [bool]$airLink.active
        realAirLinkActive = [bool]$airLink.real
        virtualAirLinkTestActive = [bool]$airLink.virtual
        flatGameActive = [bool]$flatGame.active
        gameProcessName = [string]$flatGame.processName
        gameExecutablePath = [string]$flatGame.executablePath
        reason = if ($airLink.active) {
            [string]$airLink.reason
        } elseif ($flatGame.active) {
            [string]$flatGame.reason
        } else {
            'gaming-session-inactive'
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
        [bool]$FlatGameActive = $false,
        [string]$GameProcessName = '',
        [string]$GameExecutablePath = '',
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
        flatGameActive = [bool]$FlatGameActive
        gameProcessName = [string]$GameProcessName
        gameExecutablePath = [string]$GameExecutablePath
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
        [bool]$FlatGameActive = $false,
        [string]$GameProcessName = '',
        [string]$GameExecutablePath = '',
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
    return Write-GovernorState -Active $EffectiveActive -AirLinkActive $AirLinkActive -RealAirLinkActive $RealAirLinkActive -VirtualAirLinkTestActive $VirtualAirLinkTestActive -FlatGameActive $FlatGameActive -GameProcessName $GameProcessName -GameExecutablePath $GameExecutablePath -ParkedModels @($parked) -OllamaExecutable $ollamaExecutable -Reason $Reason
}

if ($Action -eq 'Status') {
    if (Test-Path -LiteralPath $statePath -PathType Leaf) {
        Get-Content -LiteralPath $statePath -Raw
    }
    else {
        $signal = Get-GamingSignal
        Write-GovernorState -Active $false -AirLinkActive $signal.airLinkActive -RealAirLinkActive $signal.realAirLinkActive -VirtualAirLinkTestActive $signal.virtualAirLinkTestActive -FlatGameActive $signal.flatGameActive -GameProcessName $signal.gameProcessName -GameExecutablePath $signal.gameExecutablePath -Reason 'status-initialised' | ConvertTo-Json -Depth 6
    }
    exit 0
}

if ($Action -eq 'Reconcile') {
    $signal = Get-GamingSignal
    $state = Invoke-Reconcile -EffectiveActive $signal.active -AirLinkActive $signal.airLinkActive -RealAirLinkActive $signal.realAirLinkActive -VirtualAirLinkTestActive $signal.virtualAirLinkTestActive -FlatGameActive $signal.flatGameActive -GameProcessName $signal.gameProcessName -GameExecutablePath $signal.gameExecutablePath -Reason $signal.reason
    $state | ConvertTo-Json -Depth 6
    exit 0
}

$poll = [Math]::Max(500, $PollMilliseconds)
$grace = [Math]::Max(5, $ReleaseGraceSeconds)
$lastGamingSignalSeen = [DateTime]::MinValue
$lastEffectiveActive = $null
$lastModelGuardAt = [DateTime]::MinValue

while ($true) {
    $now = Get-Date
    $signal = Get-GamingSignal
    $gamingActive = [bool]$signal.active
    if ($gamingActive) { $lastGamingSignalSeen = $now }
    $withinReleaseGrace = -not $gamingActive -and $lastGamingSignalSeen -ne [DateTime]::MinValue -and ($now - $lastGamingSignalSeen).TotalSeconds -lt $grace
    $effectiveActive = [bool]($gamingActive -or $withinReleaseGrace)
    $transitioned = $null -eq $lastEffectiveActive -or $effectiveActive -ne [bool]$lastEffectiveActive
    $guardDue = $effectiveActive -and ($now - $lastModelGuardAt).TotalSeconds -ge 5

    if ($transitioned -or $guardDue) {
        $reason = if ($gamingActive) {
            [string]$signal.reason
        } elseif ($withinReleaseGrace) {
            'gaming-session-release-grace'
        } else {
            'gaming-session-inactive'
        }
        Invoke-Reconcile -EffectiveActive $effectiveActive -AirLinkActive $signal.airLinkActive -RealAirLinkActive $signal.realAirLinkActive -VirtualAirLinkTestActive $signal.virtualAirLinkTestActive -FlatGameActive $signal.flatGameActive -GameProcessName $signal.gameProcessName -GameExecutablePath $signal.gameExecutablePath -Reason $reason | Out-Null
        if ($effectiveActive) { $lastModelGuardAt = $now }
        $lastEffectiveActive = $effectiveActive
    }

    Start-Sleep -Milliseconds $poll
}
