[CmdletBinding()]
param(
    [ValidateSet('Watch','Reconcile','Status','PrepareGaming','CancelPrepare','SetAuto','ForceOn','ForceOff')][string]$Action = 'Watch',
    [int]$PollMilliseconds = 1000,
    [int]$ReleaseGraceSeconds = 45,
    [int]$CooldownSeconds = 90,
    [string]$ProcessName = '',
    [string]$ProfileName = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }

$workspaceRoot = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'
$stateRoot = Join-Path $workspaceRoot 'vr'
$statePath = Join-Path $stateRoot 'vr-resource-governor-current.json'
$overridePath = Join-Path $stateRoot 'gaming-resource-override.json'
$preparePath = Join-Path $stateRoot 'gaming-resource-prepare.json'
$profilesPath = Join-Path $stateRoot 'gaming-resource-profiles.json'
$telemetryPath = Join-Path $stateRoot 'gaming-resource-governor-events.jsonl'
$simAirLinkStatePath = Join-Path $stateRoot 'starfield-vr-sim-air-link.json'
$lightweightModel = 'llama3.2:3b'

function Ensure-StateRoot {
    if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) {
        New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
    }
}

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

function Get-GpuSnapshot {
    $command = Get-Command nvidia-smi.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) {
        return [pscustomobject]@{
            available = $false
            memoryFreeMiB = $null
            memoryUsedMiB = $null
            memoryTotalMiB = $null
            utilizationGpuPercent = $null
        }
    }
    try {
        $line = @(
            & $command.Source '--query-gpu=memory.free,memory.used,memory.total,utilization.gpu' '--format=csv,noheader,nounits' 2>$null
        ) | Select-Object -First 1
        if (-not $line) { throw 'nvidia-smi returned no rows' }
        $parts = @(([string]$line).Split(',') | ForEach-Object { $_.Trim() })
        if ($parts.Count -lt 4) { throw 'nvidia-smi returned an incomplete row' }
        return [pscustomobject]@{
            available = $true
            memoryFreeMiB = [int]$parts[0]
            memoryUsedMiB = [int]$parts[1]
            memoryTotalMiB = [int]$parts[2]
            utilizationGpuPercent = [int]$parts[3]
        }
    }
    catch {
        return [pscustomobject]@{
            available = $false
            memoryFreeMiB = $null
            memoryUsedMiB = $null
            memoryTotalMiB = $null
            utilizationGpuPercent = $null
        }
    }
}

function Test-RealAirLinkActive {
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
        if (
            $state.schemaVersion -ne 'stephanos.starfield-vr-sim-air-link.v1' -or
            $state.enabled -ne $true -or
            $state.purpose -ne 'readiness-only'
        ) {
            return $false
        }
        $updated = [DateTime]::MinValue
        if ([DateTime]::TryParse([string]$state.updatedAtUtc, [ref]$updated)) {
            if (((Get-Date).ToUniversalTime() - $updated.ToUniversalTime()).TotalMinutes -gt 30) {
                return $false
            }
        }
        return $true
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
            'vr-runtime-active'
        } elseif ($virtual) {
            'virtual-air-link-test-active'
        } else {
            'vr-runtime-inactive'
        }
    }
}

function Test-WindowsGamePresenceActive {
    return $null -ne (Get-Process -Name 'GameBarPresenceWriter' -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Get-ParentProcessInfo {
    param([int]$ProcessId)

    try {
        $row = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $ProcessId) -ErrorAction Stop
        $parentId = [int]$row.ParentProcessId
        if ($parentId -le 0) {
            return [pscustomobject]@{ processId = 0; processName = ''; executablePath = '' }
        }
        $parent = Get-Process -Id $parentId -ErrorAction SilentlyContinue
        $path = ''
        if ($parent) {
            try { $path = [string]$parent.Path } catch { $path = '' }
        }
        return [pscustomobject]@{
            processId = $parentId
            processName = if ($parent) { [string]$parent.ProcessName } else { '' }
            executablePath = $path
        }
    }
    catch {
        return [pscustomobject]@{ processId = 0; processName = ''; executablePath = '' }
    }
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
        $normalizedRoot = $root.TrimEnd('\')
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
            $parent = Get-ParentProcessInfo -ProcessId ([int]$process.Id)
            return [pscustomobject]@{
                active = $true
                processId = [int]$process.Id
                processName = $name
                executablePath = $path
                parentProcessId = [int]$parent.processId
                parentProcessName = [string]$parent.processName
                parentExecutablePath = [string]$parent.executablePath
                reason = if ($known) { 'known-game-process-active' } else { 'game-library-process-active' }
            }
        }
    }

    if (Test-WindowsGamePresenceActive) {
        return [pscustomobject]@{
            active = $true
            processId = 0
            processName = 'GameBarPresenceWriter'
            executablePath = ''
            parentProcessId = 0
            parentProcessName = ''
            parentExecutablePath = ''
            reason = 'windows-game-presence-active'
        }
    }

    return [pscustomobject]@{
        active = $false
        processId = 0
        processName = ''
        executablePath = ''
        parentProcessId = 0
        parentProcessName = ''
        parentExecutablePath = ''
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
        gameProcessId = [int]$flatGame.processId
        gameProcessName = [string]$flatGame.processName
        gameExecutablePath = [string]$flatGame.executablePath
        parentProcessId = [int]$flatGame.parentProcessId
        parentProcessName = [string]$flatGame.parentProcessName
        parentExecutablePath = [string]$flatGame.parentExecutablePath
        reason = if ($airLink.active) {
            [string]$airLink.reason
        } elseif ($flatGame.active) {
            [string]$flatGame.reason
        } else {
            'gaming-session-inactive'
        }
    }
}

function Read-OverrideMode {
    if (-not (Test-Path -LiteralPath $overridePath -PathType Leaf)) { return 'AUTO' }
    try {
        $state = Get-Content -LiteralPath $overridePath -Raw | ConvertFrom-Json
        $mode = [string]$state.mode
        if ($mode -in @('AUTO','FORCE_ON','FORCE_OFF')) { return $mode }
    } catch {}
    return 'AUTO'
}

function Write-OverrideMode {
    param([ValidateSet('AUTO','FORCE_ON','FORCE_OFF')][string]$Mode)
    Ensure-StateRoot
    $payload = [ordered]@{
        schemaVersion = 'stephanos.gaming-resource-override.v1'
        mode = $Mode
        updatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    }
    [System.IO.File]::WriteAllText(
        $overridePath,
        ($payload | ConvertTo-Json -Depth 4),
        (New-Object System.Text.UTF8Encoding($false))
    )
    return [pscustomobject]$payload
}

function Write-PrepareLease {
    param([string]$RequestedProcessName, [string]$RequestedProfileName)
    Ensure-StateRoot
    $now = (Get-Date).ToUniversalTime()
    $payload = [ordered]@{
        schemaVersion = 'stephanos.gaming-resource-prepare.v1'
        active = $true
        processName = if ($RequestedProcessName) { $RequestedProcessName } else { 'StephanosLaunch' }
        profileName = [string]$RequestedProfileName
        createdAtUtc = $now.ToString('o')
        expiresAtUtc = $now.AddMinutes(2).ToString('o')
    }
    [System.IO.File]::WriteAllText(
        $preparePath,
        ($payload | ConvertTo-Json -Depth 4),
        (New-Object System.Text.UTF8Encoding($false))
    )
    return [pscustomobject]$payload
}

function Clear-PrepareLease {
    if (Test-Path -LiteralPath $preparePath -PathType Leaf) {
        Remove-Item -LiteralPath $preparePath -Force -ErrorAction SilentlyContinue
    }
}

function Read-PrepareLease {
    if (-not (Test-Path -LiteralPath $preparePath -PathType Leaf)) {
        return [pscustomobject]@{ active = $false; processName = ''; profileName = ''; expiresAtUtc = '' }
    }
    try {
        $lease = Get-Content -LiteralPath $preparePath -Raw | ConvertFrom-Json
        if ($lease.schemaVersion -ne 'stephanos.gaming-resource-prepare.v1' -or $lease.active -ne $true) {
            return [pscustomobject]@{ active = $false; processName = ''; profileName = ''; expiresAtUtc = '' }
        }
        $expiry = [DateTime]::MinValue
        if (-not [DateTime]::TryParse([string]$lease.expiresAtUtc, [ref]$expiry)) {
            Clear-PrepareLease
            return [pscustomobject]@{ active = $false; processName = ''; profileName = ''; expiresAtUtc = '' }
        }
        if ((Get-Date).ToUniversalTime() -ge $expiry.ToUniversalTime()) {
            Clear-PrepareLease
            return [pscustomobject]@{ active = $false; processName = ''; profileName = ''; expiresAtUtc = '' }
        }
        return [pscustomobject]@{
            active = $true
            processName = [string]$lease.processName
            profileName = [string]$lease.profileName
            expiresAtUtc = [string]$lease.expiresAtUtc
        }
    }
    catch {
        Clear-PrepareLease
        return [pscustomobject]@{ active = $false; processName = ''; profileName = ''; expiresAtUtc = '' }
    }
}

function Get-ProfileOverride {
    param([string]$RequestedProcessName)
    if (-not $RequestedProcessName -or -not (Test-Path -LiteralPath $profilesPath -PathType Leaf)) { return $null }
    try {
        $config = Get-Content -LiteralPath $profilesPath -Raw | ConvertFrom-Json
        if ($config.schemaVersion -ne 'stephanos.gaming-resource-profiles.v1') { return $null }
        foreach ($profile in @($config.profiles)) {
            if ([string]::Equals([string]$profile.processName, $RequestedProcessName, [System.StringComparison]::OrdinalIgnoreCase)) {
                return $profile
            }
        }
    } catch {}
    return $null
}

function Resolve-GamingProfile {
    param(
        $Signal,
        [string]$RequestedProcessName = '',
        [string]$RequestedProfileName = ''
    )

    $process = if ($RequestedProcessName) { $RequestedProcessName } else { [string]$Signal.gameProcessName }
    $name = 'generic-safe'
    $minFree = 8192
    $lightweightOnly = $true
    $parkAllModels = $false
    $cooldown = [Math]::Max([Math]::Max(30, $CooldownSeconds), [Math]::Max(5, $ReleaseGraceSeconds))

    if ($Signal.airLinkActive) {
        $name = 'vr-maximum'
        $minFree = 12288
        $parkAllModels = $true
        $cooldown = [Math]::Max(90, $CooldownSeconds)
    }
    elseif ($process -in @('Starfield','Cyberpunk2077','SkyrimVR','Fallout4VR')) {
        $name = 'heavy-game-maximum'
        $minFree = 10240
    }

    if ($RequestedProfileName) {
        $name = $RequestedProfileName
        if ($RequestedProfileName -eq 'vr-maximum') {
            $minFree = 12288
            $parkAllModels = $true
        }
        if ($RequestedProfileName -eq 'heavy-game-maximum') { $minFree = 10240 }
    }

    $custom = Get-ProfileOverride -RequestedProcessName $process
    if ($custom) {
        if ([string]$custom.name) { $name = [string]$custom.name }
        if ($null -ne $custom.minFreeVramMiB) {
            $minFree = [Math]::Max(2048, [Math]::Min(24576, [int]$custom.minFreeVramMiB))
        }
        if ($null -ne $custom.lightweightOnly) { $lightweightOnly = [bool]$custom.lightweightOnly }
        if ($null -ne $custom.parkAllModels) { $parkAllModels = [bool]$custom.parkAllModels }
        if ($null -ne $custom.cooldownSeconds) {
            $cooldown = [Math]::Max(15, [Math]::Min(600, [int]$custom.cooldownSeconds))
        }
    }

    return [pscustomobject]@{
        name = $name
        processName = $process
        minFreeVramMiB = [int]$minFree
        lightweightOnly = [bool]$lightweightOnly
        parkAllModels = [bool]$parkAllModels
        cooldownSeconds = [int]$cooldown
        customProfileApplied = [bool]($null -ne $custom)
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

function Read-GovernorState {
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { return $null }
    try { return Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } catch { return $null }
}

function Append-TelemetryEvent {
    param($Payload)
    Ensure-StateRoot
    $event = [ordered]@{
        schemaVersion = 'stephanos.gaming-resource-governor-event.v1'
        writtenAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        phase = [string]$Payload.phase
        active = [bool]$Payload.active
        reason = [string]$Payload.reason
        transition = [string]$Payload.transition
        overrideMode = [string]$Payload.overrideMode
        profileName = [string]$Payload.profile.name
        gameProcessName = [string]$Payload.gameProcessName
        parentProcessName = [string]$Payload.parentProcessName
        vramPressure = [bool]$Payload.vramPressure
        vramReleasedMiB = $Payload.vramReleasedMiB
        parkedModels = @($Payload.parkedModels)
        heavyModelsAfter = @($Payload.heavyModelsAfter)
        loadedModelsAfter = @($Payload.loadedModelsAfter)
        localModelAllowed = [bool]$Payload.localModelAllowed
    }
    $line = $event | ConvertTo-Json -Compress -Depth 6
    $existing = @()
    if (Test-Path -LiteralPath $telemetryPath -PathType Leaf) {
        $existing = @(Get-Content -LiteralPath $telemetryPath -ErrorAction SilentlyContinue | Select-Object -Last 199)
    }
    @($existing + $line) | Set-Content -LiteralPath $telemetryPath -Encoding UTF8
}

function Write-GovernorState {
    param(
        [string]$Phase,
        [bool]$Active,
        [bool]$AirLinkActive,
        [bool]$RealAirLinkActive,
        [bool]$VirtualAirLinkTestActive,
        [bool]$FlatGameActive,
        [int]$GameProcessId,
        [string]$GameProcessName,
        [string]$GameExecutablePath,
        [int]$ParentProcessId,
        [string]$ParentProcessName,
        [string]$ParentExecutablePath,
        [string[]]$ParkedModels,
        [string[]]$HeavyModelsBefore,
        [string[]]$HeavyModelsAfter,
        [string[]]$LoadedModelsAfter,
        [string]$OllamaExecutable,
        [string]$Reason,
        [string]$OverrideMode,
        $Profile,
        $GpuBefore,
        $GpuAfter,
        [bool]$VramPressure,
        [Nullable[int]]$VramReleasedMiB,
        [long]$EvictionDurationMs,
        [string]$CooldownUntilUtc,
        [bool]$PrepareLeaseActive,
        [string]$PrepareExpiresAtUtc,
        [string]$Transition,
        [bool]$ShouldParkHeavy,
        [bool]$ParkAllModels
    )
    Ensure-StateRoot
    $payload = [ordered]@{
        schemaVersion = 'stephanos.vr-resource-governor.v1'
        governorVersion = 2
        phase = $Phase
        active = [bool]$Active
        airLinkActive = [bool]$AirLinkActive
        realAirLinkActive = [bool]$RealAirLinkActive
        virtualAirLinkTestActive = [bool]$VirtualAirLinkTestActive
        flatGameActive = [bool]$FlatGameActive
        gameProcessId = [int]$GameProcessId
        gameProcessName = $GameProcessName
        gameExecutablePath = $GameExecutablePath
        parentProcessId = [int]$ParentProcessId
        parentProcessName = $ParentProcessName
        parentExecutablePath = $ParentExecutablePath
        preferredModel = $lightweightModel
        ollamaLoadMode = if ($ParkAllModels) { 'off' } elseif ($ShouldParkHeavy) { 'cool' } else { 'balanced' }
        heavyModelAllowed = -not $ShouldParkHeavy
        localModelAllowed = -not ($Active -and $ParkAllModels)
        parkedModels = @($ParkedModels)
        heavyModelsBefore = @($HeavyModelsBefore)
        heavyModelsAfter = @($HeavyModelsAfter)
        loadedModelsAfter = @($LoadedModelsAfter)
        evictionHealthy = [bool](
            (-not $ShouldParkHeavy -or $HeavyModelsAfter.Count -eq 0) -and
            (-not ($Active -and $ParkAllModels) -or $LoadedModelsAfter.Count -eq 0)
        )
        ollamaAvailable = [bool]$OllamaExecutable
        reason = $Reason
        overrideMode = $OverrideMode
        profile = $Profile
        gpuBefore = $GpuBefore
        gpuAfter = $GpuAfter
        vramPressure = [bool]$VramPressure
        vramReleasedMiB = $VramReleasedMiB
        evictionDurationMs = [long]$EvictionDurationMs
        cooldownUntilUtc = $CooldownUntilUtc
        prepareLeaseActive = [bool]$PrepareLeaseActive
        prepareExpiresAtUtc = $PrepareExpiresAtUtc
        transition = $Transition
        telemetryPath = $telemetryPath
        updatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    }
    [System.IO.File]::WriteAllText(
        $statePath,
        ($payload | ConvertTo-Json -Depth 8),
        (New-Object System.Text.UTF8Encoding($false))
    )
    Append-TelemetryEvent -Payload ([pscustomobject]$payload)
    return [pscustomobject]$payload
}

function Resolve-EffectiveState {
    param($Signal, $PriorState)

    $override = Read-OverrideMode
    $lease = Read-PrepareLease
    $requestedProcess = if ($Signal.gameProcessName) { [string]$Signal.gameProcessName } elseif ($lease.active) { [string]$lease.processName } else { '' }
    $requestedProfile = if ($lease.active) { [string]$lease.profileName } else { '' }
    $profile = Resolve-GamingProfile -Signal $Signal -RequestedProcessName $requestedProcess -RequestedProfileName $requestedProfile
    if (-not $Signal.active -and -not $lease.active -and $PriorState -and $PriorState.profile) {
        $profile = $PriorState.profile
    }
    $nowUtc = (Get-Date).ToUniversalTime()

    if ($override -eq 'FORCE_OFF') {
        return [pscustomobject]@{
            phase = 'NORMAL'
            active = $false
            reason = 'operator-force-off'
            overrideMode = $override
            profile = $profile
            lease = $lease
            cooldownUntilUtc = ''
        }
    }

    if ($override -eq 'FORCE_ON') {
        return [pscustomobject]@{
            phase = 'GAMING'
            active = $true
            reason = 'operator-force-on'
            overrideMode = $override
            profile = $profile
            lease = $lease
            cooldownUntilUtc = ''
        }
    }

    if ($Signal.active) {
        if ($lease.active) { Clear-PrepareLease; $lease = Read-PrepareLease }
        return [pscustomobject]@{
            phase = 'GAMING'
            active = $true
            reason = [string]$Signal.reason
            overrideMode = $override
            profile = $profile
            lease = $lease
            cooldownUntilUtc = ''
        }
    }

    if ($lease.active) {
        return [pscustomobject]@{
            phase = 'PREPARING'
            active = $true
            reason = 'pre-launch-resource-gate'
            overrideMode = $override
            profile = $profile
            lease = $lease
            cooldownUntilUtc = ''
        }
    }

    $cooldownUntil = [DateTime]::MinValue
    $priorWasProtected = $false
    if ($PriorState) {
        $priorWasProtected = [string]$PriorState.phase -in @('PREPARING','GAMING','COOLDOWN')
        if ([string]$PriorState.cooldownUntilUtc) {
            [void][DateTime]::TryParse([string]$PriorState.cooldownUntilUtc, [ref]$cooldownUntil)
        }
        if (
            $priorWasProtected -and
            [string]$PriorState.phase -ne 'COOLDOWN' -and
            $cooldownUntil -eq [DateTime]::MinValue
        ) {
            $cooldownUntil = $nowUtc.AddSeconds([int]$profile.cooldownSeconds)
        }
    }

    if ($cooldownUntil -ne [DateTime]::MinValue -and $nowUtc -lt $cooldownUntil.ToUniversalTime()) {
        return [pscustomobject]@{
            phase = 'COOLDOWN'
            active = $true
            reason = 'gaming-session-cooldown'
            overrideMode = $override
            profile = $profile
            lease = $lease
            cooldownUntilUtc = $cooldownUntil.ToUniversalTime().ToString('o')
        }
    }

    return [pscustomobject]@{
        phase = 'NORMAL'
        active = $false
        reason = 'gaming-session-inactive'
        overrideMode = $override
        profile = $profile
        lease = $lease
        cooldownUntilUtc = ''
    }
}

function Invoke-Reconcile {
    param($Signal, $Effective, $PriorState)

    $ollamaExecutable = Resolve-OllamaExecutable
    $gpuBefore = Get-GpuSnapshot
    $loadedBefore = @(Get-LoadedOllamaModels -OllamaExecutable $ollamaExecutable)
    $heavyBefore = @(Get-HeavyModels -Models $loadedBefore)
    $vramPressure = [bool](
        $Effective.active -and
        $gpuBefore.available -and
        [int]$gpuBefore.memoryFreeMiB -lt [int]$Effective.profile.minFreeVramMiB
    )
    $shouldPark = [bool](
        $Effective.active -and
        ($Effective.profile.lightweightOnly -or $vramPressure)
    )
    $parkAllModels = [bool]($Effective.active -and $Effective.profile.parkAllModels)
    $modelsToPark = if ($parkAllModels) { @($loadedBefore) } else { @($heavyBefore) }

    # Plain PowerShell array avoids the Windows PowerShell 5.1 generic-list
    # binder failure seen during post-crash reconcile.
    $parked = @()
    $started = Get-Date
    if (($shouldPark -or $parkAllModels) -and $ollamaExecutable) {
        foreach ($model in $modelsToPark) {
            if (Stop-OllamaModel -OllamaExecutable $ollamaExecutable -Model $model) {
                $parked += [string]$model
            }
        }
    }
    $evictionDuration = [long]((Get-Date) - $started).TotalMilliseconds
    $loadedAfter = @(Get-LoadedOllamaModels -OllamaExecutable $ollamaExecutable)
    $heavyAfter = @(Get-HeavyModels -Models $loadedAfter)
    $gpuAfter = Get-GpuSnapshot
    $vramReleased = $null
    if ($gpuBefore.available -and $gpuAfter.available) {
        $vramReleased = [int]($gpuAfter.memoryFreeMiB - $gpuBefore.memoryFreeMiB)
    }

    $priorPhase = if ($PriorState) { [string]$PriorState.phase } else { '' }
    $transition = if (-not $priorPhase) {
        'START->' + [string]$Effective.phase
    } elseif ($priorPhase -ne [string]$Effective.phase) {
        $priorPhase + '->' + [string]$Effective.phase
    } else {
        $priorPhase + '->' + $priorPhase
    }

    $effectiveProcessName = if ($Signal.gameProcessName) {
        [string]$Signal.gameProcessName
    } else {
        [string]$Effective.profile.processName
    }
    $writeParams = @{
        Phase = [string]$Effective.phase
        Active = [bool]$Effective.active
        AirLinkActive = [bool]$Signal.airLinkActive
        RealAirLinkActive = [bool]$Signal.realAirLinkActive
        VirtualAirLinkTestActive = [bool]$Signal.virtualAirLinkTestActive
        FlatGameActive = [bool]$Signal.flatGameActive
        GameProcessId = [int]$Signal.gameProcessId
        GameProcessName = $effectiveProcessName
        GameExecutablePath = [string]$Signal.gameExecutablePath
        ParentProcessId = [int]$Signal.parentProcessId
        ParentProcessName = [string]$Signal.parentProcessName
        ParentExecutablePath = [string]$Signal.parentExecutablePath
        ParkedModels = @($parked)
        HeavyModelsBefore = @($heavyBefore)
        HeavyModelsAfter = @($heavyAfter)
        LoadedModelsAfter = @($loadedAfter)
        OllamaExecutable = $ollamaExecutable
        Reason = [string]$Effective.reason
        OverrideMode = [string]$Effective.overrideMode
        Profile = $Effective.profile
        GpuBefore = $gpuBefore
        GpuAfter = $gpuAfter
        VramPressure = $vramPressure
        VramReleasedMiB = $vramReleased
        EvictionDurationMs = $evictionDuration
        CooldownUntilUtc = [string]$Effective.cooldownUntilUtc
        PrepareLeaseActive = [bool]$Effective.lease.active
        PrepareExpiresAtUtc = [string]$Effective.lease.expiresAtUtc
        Transition = $transition
        ShouldParkHeavy = $shouldPark
        ParkAllModels = $parkAllModels
    }
    return Write-GovernorState @writeParams
}

function Invoke-CurrentReconcile {
    $signal = Get-GamingSignal
    $prior = Read-GovernorState
    $effective = Resolve-EffectiveState -Signal $signal -PriorState $prior
    return Invoke-Reconcile -Signal $signal -Effective $effective -PriorState $prior
}

if ($Action -eq 'SetAuto') {
    Write-OverrideMode -Mode 'AUTO' | Out-Null
    Invoke-CurrentReconcile | ConvertTo-Json -Depth 8
    exit 0
}
if ($Action -eq 'ForceOn') {
    Write-OverrideMode -Mode 'FORCE_ON' | Out-Null
    Invoke-CurrentReconcile | ConvertTo-Json -Depth 8
    exit 0
}
if ($Action -eq 'ForceOff') {
    Write-OverrideMode -Mode 'FORCE_OFF' | Out-Null
    Clear-PrepareLease
    Invoke-CurrentReconcile | ConvertTo-Json -Depth 8
    exit 0
}
if ($Action -eq 'PrepareGaming') {
    if ((Read-OverrideMode) -eq 'FORCE_OFF') {
        throw 'GAMING_RESOURCE_PREPARE_BLOCKED_BY_FORCE_OFF'
    }
    Write-PrepareLease -RequestedProcessName $ProcessName -RequestedProfileName $ProfileName | Out-Null
    $prepared = Invoke-CurrentReconcile
    $prepared | ConvertTo-Json -Depth 8
    if (-not $prepared.evictionHealthy -or $prepared.heavyModelAllowed -ne $false) { exit 2 }
    exit 0
}
if ($Action -eq 'CancelPrepare') {
    Clear-PrepareLease
    Invoke-CurrentReconcile | ConvertTo-Json -Depth 8
    exit 0
}
if ($Action -eq 'Status') {
    $state = Read-GovernorState
    if (-not $state) { $state = Invoke-CurrentReconcile }
    $state | ConvertTo-Json -Depth 8
    exit 0
}
if ($Action -eq 'Reconcile') {
    $state = Invoke-CurrentReconcile
    $state | ConvertTo-Json -Depth 8
    if (-not $state.evictionHealthy) { exit 2 }
    exit 0
}

$poll = [Math]::Max(500, $PollMilliseconds)
$lastGuardAt = [DateTime]::MinValue

while ($true) {
    $prior = Read-GovernorState
    $signal = Get-GamingSignal
    $effective = Resolve-EffectiveState -Signal $signal -PriorState $prior
    $now = Get-Date
    $phaseChanged = -not $prior -or [string]$prior.phase -ne [string]$effective.phase
    $reasonChanged = -not $prior -or [string]$prior.reason -ne [string]$effective.reason
    $overrideChanged = -not $prior -or [string]$prior.overrideMode -ne [string]$effective.overrideMode
    $processChanged = -not $prior -or [string]$prior.gameProcessName -ne [string]$signal.gameProcessName
    $guardDue = $effective.active -and ($now - $lastGuardAt).TotalSeconds -ge 5

    if ($phaseChanged -or $reasonChanged -or $overrideChanged -or $processChanged -or $guardDue) {
        $state = Invoke-Reconcile -Signal $signal -Effective $effective -PriorState $prior
        if ($state.active) { $lastGuardAt = $now }
    }

    Start-Sleep -Milliseconds $poll
}
