[CmdletBinding()]
param(
    [ValidateSet('Watch','Reconcile','Status','ObserveAdmission','PrepareGaming','CancelPrepare','SetAuto','ForceOn','ForceOff')][string]$Action = 'Watch',
    [int]$PollMilliseconds = 500,
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

function Add-MissingGovernorProperty {
    param($Object, [string]$Name, $Value)
    if ($null -eq $Object) { return }
    if ($null -eq $Object.PSObject.Properties[$Name]) {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    }
}

function Normalize-GovernorState {
    param($State)
    if ($null -eq $State) { return $null }

    # Governor state is durable workspace data and can outlive the script version
    # that wrote it. Normalize older shapes before StrictMode reads any field.
    Add-MissingGovernorProperty -Object $State -Name 'phase' -Value ''
    Add-MissingGovernorProperty -Object $State -Name 'active' -Value $false
    Add-MissingGovernorProperty -Object $State -Name 'cooldownUntilUtc' -Value ''
    Add-MissingGovernorProperty -Object $State -Name 'profile' -Value $null
    Add-MissingGovernorProperty -Object $State -Name 'reappearanceCount' -Value 0
    Add-MissingGovernorProperty -Object $State -Name 'localModelAllowed' -Value $true
    Add-MissingGovernorProperty -Object $State -Name 'reason' -Value ''
    Add-MissingGovernorProperty -Object $State -Name 'overrideMode' -Value 'AUTO'
    Add-MissingGovernorProperty -Object $State -Name 'gameProcessName' -Value ''
    Add-MissingGovernorProperty -Object $State -Name 'ollamaRuntimeHardBlocked' -Value $false
    Add-MissingGovernorProperty -Object $State -Name 'ollamaRuntimeProcessCountBefore' -Value 0
    Add-MissingGovernorProperty -Object $State -Name 'ollamaRuntimeProcessCountAfter' -Value 0
    Add-MissingGovernorProperty -Object $State -Name 'ollamaRuntimeStoppedCount' -Value 0

    if ($null -ne $State.profile) {
        Add-MissingGovernorProperty -Object $State.profile -Name 'name' -Value 'generic-safe'
        Add-MissingGovernorProperty -Object $State.profile -Name 'processName' -Value ''
        Add-MissingGovernorProperty -Object $State.profile -Name 'minFreeVramMiB' -Value 8192
        Add-MissingGovernorProperty -Object $State.profile -Name 'lightweightOnly' -Value $true
        Add-MissingGovernorProperty -Object $State.profile -Name 'parkAllModels' -Value $false
        Add-MissingGovernorProperty -Object $State.profile -Name 'cooldownSeconds' -Value ([Math]::Max([Math]::Max(30, $CooldownSeconds), [Math]::Max(5, $ReleaseGraceSeconds)))
        Add-MissingGovernorProperty -Object $State.profile -Name 'customProfileApplied' -Value $false
    }

    return $State
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

function Test-StaleOculusDashAfterCrash {
    # Never infer disconnection from OculusDash alone. Fail closed if the
    # evidence is missing or ambiguous, including while the Quest is in VR.
    if (Get-Process -Name 'Starfield', 'vrcompositor', 'vrdashboard' -ErrorAction SilentlyContinue | Select-Object -First 1) { return $false }
    $log = Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Oculus') -Filter 'Service_*.txt' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $log -or $log.LastWriteTimeUtc -lt [datetime]::UtcNow.AddSeconds(-35)) { return $false }
    try {
        $stream = [IO.File]::Open($log.FullName, 'Open', 'Read', 'ReadWrite')
        try {
            $count = [int][math]::Min($stream.Length, 1048576)
            [void]$stream.Seek(-$count, 'End')
            $bytes = [byte[]]::new($count)
            $read = $stream.Read($bytes, 0, $count)
            $tail = [Text.Encoding]::UTF8.GetString($bytes, 0, $read)
        } finally { $stream.Dispose() }
        $hmd = [regex]::Matches($tail, "(?m)(\d{2}/\d{2} \d{2}:\d{2}:\d{2}\.\d{3}).*?HMD Reporting state change: \{'State':'([^']+)','IsDetected':([01])")
        if ($hmd.Count -lt 2) { return $false }
        foreach ($item in $hmd) {
            if ($item.Groups[2].Value -ne 'NotDetected' -or $item.Groups[3].Value -ne '0') { return $false }
        }
        $year = [datetime]::Now.Year
        $first = [datetime]::ParseExact("$year/$($hmd[0].Groups[1].Value)", 'yyyy/dd/MM HH:mm:ss.fff', [globalization.cultureinfo]::InvariantCulture)
        $last = [datetime]::ParseExact("$year/$($hmd[$hmd.Count - 1].Groups[1].Value)", 'yyyy/dd/MM HH:mm:ss.fff', [globalization.cultureinfo]::InvariantCulture)
        if (($last - $first).TotalMinutes -lt 10 -or $last -lt [datetime]::Now.AddSeconds(-35)) { return $false }
        # Any live wireless streaming transition keeps the VR guard engaged.
        $session = [regex]::Matches($tail, 'oculus_xrs_session_state_transition previous_state: \w+ current_state: (\w+)[^\r\n]*?current_session_type: (\w+)')
        if ($session.Count -eq 0) { return $false }
        $latest = $session[$session.Count - 1]
        if ($latest.Groups[2].Value -eq 'streaming') { return $false }
        if ($latest.Groups[1].Value -notin @('Connected', 'Disconnected')) { return $false }
        return $latest.Groups[2].Value -in @('basic', 'none')
    } catch { return $false }
}

function Test-RealAirLinkActive {
    # SteamVR processes always win. OculusDash alone can persist after a crash.
    foreach ($name in @('vrcompositor', 'vrdashboard')) {
        if (Get-Process -Name $name -ErrorAction SilentlyContinue | Select-Object -First 1) { return $true }
    }
    if (Get-Process -Name 'OculusDash' -ErrorAction SilentlyContinue | Select-Object -First 1) {
        return -not (Test-StaleOculusDashAfterCrash)
    }
    return $false
}

function Test-VirtualAirLinkTestActive {
    if (-not (Test-Path -LiteralPath $simAirLinkStatePath -PathType Leaf)) { return $false }
    try {
        $raw = Get-Content -LiteralPath $simAirLinkStatePath -Raw
        # Bind the timestamp to exactly one decoded root-level JSON member.
        # Nested or Unicode-escaped aliases cannot substitute for trusted wire
        # evidence. This readiness-only envelope has four scalar members; reject
        # unknown fields rather than silently considering unrelated timestamps.
        $wire = $raw.Trim()
        if ($wire -notmatch '^\{[\s\S]*\}$') { return $false }
        $inner = $wire.Substring(1, $wire.Length - 2)
        $members = [regex]::Matches(
            $inner,
            '"(schemaVersion|enabled|purpose|updatedAtUtc)"\s*:\s*("(?:[^"\\]|\\.)*"|true|false)'
        )
        if ($members.Count -ne 4) { return $false }
        $seen = @{}
        $cursor = 0
        $updatedAtUtc = ''
        for ($i = 0; $i -lt $members.Count; $i++) {
            $member = $members[$i]
            $between = $inner.Substring($cursor, $member.Index - $cursor)
            if ($i -eq 0) {
                if ($between -notmatch '^\s*$') { return $false }
            } elseif ($between -notmatch '^\s*,\s*$') {
                return $false
            }
            $key = [string]$member.Groups[1].Value
            if ($seen.ContainsKey($key)) { return $false }
            $seen[$key] = $true
            if ($key -eq 'updatedAtUtc') {
                $quoted = [string]$member.Groups[2].Value
                if (-not ($quoted.StartsWith('"') -and $quoted.EndsWith('"'))) { return $false }
                $updatedAtUtc = $quoted.Substring(1, $quoted.Length - 2)
            }
            $cursor = $member.Index + $member.Length
        }
        if ($inner.Substring($cursor) -notmatch '^\s*$') { return $false }
        $state = $raw | ConvertFrom-Json
        if (
            $state -isnot [pscustomobject] -or
            $state.schemaVersion -isnot [string] -or
            $state.schemaVersion -ne 'stephanos.starfield-vr-sim-air-link.v1' -or
            $state.enabled -isnot [bool] -or
            $state.enabled -ne $true -or
            $state.purpose -isnot [string] -or
            $state.purpose -ne 'readiness-only' -or
            ($state.updatedAtUtc -isnot [string] -and $state.updatedAtUtc -isnot [datetime])
        ) {
            return $false
        }
        # Only the exact decoded root member supplies the UTC timestamp.
        if ($updatedAtUtc -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$') {
            return $false
        }
        $updated = [DateTimeOffset]::MinValue
        if (-not [DateTimeOffset]::TryParse(
            $updatedAtUtc,
            [System.Globalization.CultureInfo]::InvariantCulture,
            [System.Globalization.DateTimeStyles]::AssumeUniversal,
            [ref]$updated
        )) { return $false }
        $ageMinutes = ([DateTimeOffset]::UtcNow - $updated.ToUniversalTime()).TotalMinutes
        if ($ageMinutes -lt 0 -or $ageMinutes -gt 30) { return $false }
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
    param([switch]$ThrottleFlatGameScan)

    $airLink = Get-AirLinkSignal

    # Headset detection is the highest-priority signal. Do not spend the first
    # protection cycle walking every desktop process before evicting local AI.
    if ($airLink.active) {
        # Never reuse a stale desktop game scan after a headset transition.
        if ($ThrottleFlatGameScan) { $script:cachedFlatGameSignal = $null }
        return [pscustomobject]@{
            active = $true
            airLinkActive = $true
            realAirLinkActive = [bool]$airLink.real
            virtualAirLinkTestActive = [bool]$airLink.virtual
            flatGameActive = $false
            gameProcessId = 0
            gameProcessName = ''
            gameExecutablePath = ''
            parentProcessId = 0
            parentProcessName = ''
            parentExecutablePath = ''
            reason = [string]$airLink.reason
        }
    }

    # Only Watch may reuse a bounded idle inventory. Explicit reconcile/prepare
    # actions always obtain fresh process proof.
    if ($ThrottleFlatGameScan) {
        $scanAt = Get-Date
        if ($null -eq $script:cachedFlatGameSignal -or
            ($scanAt - $script:lastFlatGameScanAt).TotalSeconds -ge $script:flatGameScanIntervalSeconds) {
            $script:cachedFlatGameSignal = Get-FlatGameSignal
            $script:lastFlatGameScanAt = Get-Date
        }
        $flatGame = $script:cachedFlatGameSignal
    } else {
        $flatGame = Get-FlatGameSignal
    }
    return [pscustomobject]@{
        active = [bool]$flatGame.active
        airLinkActive = $false
        realAirLinkActive = $false
        virtualAirLinkTestActive = $false
        flatGameActive = [bool]$flatGame.active
        gameProcessId = [int]$flatGame.processId
        gameProcessName = [string]$flatGame.processName
        gameExecutablePath = [string]$flatGame.executablePath
        parentProcessId = [int]$flatGame.parentProcessId
        parentProcessName = [string]$flatGame.parentProcessName
        parentExecutablePath = [string]$flatGame.parentExecutablePath
        reason = if ($flatGame.active) {
            [string]$flatGame.reason
        } else {
            'gaming-session-inactive'
        }
    }
}

function Read-OverrideMode {
    # A truly absent override is a clean first boot. A PRESENT but unreadable,
    # wrong-schema or wrong-typed override is not proof that the operator ended
    # a forced gaming session. Keep park-all protection until an explicit
    # SetAuto/ForceOff writes a fresh, valid override.
    if (-not (Test-Path -LiteralPath $overridePath -PathType Leaf)) { return 'AUTO' }
    try {
        $raw = Get-Content -LiteralPath $overridePath -Raw
        # Windows PowerShell 5.1 unwraps single-object JSON arrays in its pipeline.
        # A present override must have an object wire root, never an array.
        # Wrong roots retain FORCE_ON until an explicit valid operator override.
        if ($raw -isnot [string] -or $raw -notmatch '^\s*\{') { return 'FORCE_ON' }
        $state = $raw | ConvertFrom-Json
        if (
            $state -is [pscustomobject] -and
            $state.schemaVersion -is [string] -and
            $state.schemaVersion -eq 'stephanos.gaming-resource-override.v1' -and
            $state.mode -is [string] -and
            $state.mode -in @('AUTO','FORCE_ON','FORCE_OFF')
        ) {
            return [string]$state.mode
        }
    } catch {}
    return 'FORCE_ON'
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
        $raw = Get-Content -LiteralPath $preparePath -Raw
        # Windows PowerShell 5.1 may enumerate a single-object top-level JSON
        # array into a scalar when piping ConvertFrom-Json. Reject the root
        # array before parsing, not only after it has been unwrapped.
        if ($raw -notmatch '^\s*\{') { throw 'GOVERNOR_PREPARE_LEASE_INVALID_ROOT' }
        $lease = $raw | ConvertFrom-Json
        # A persisted reviewer/model reservation is a bounded two-minute
        # capability. Array-valued or wrong-typed JSON must not be coerced by
        # PowerShell collection comparisons into a live reservation.
        if ($lease -isnot [pscustomobject] -or
            $lease.schemaVersion -isnot [string] -or
            $lease.schemaVersion -ne 'stephanos.gaming-resource-prepare.v1' -or
            $lease.active -isnot [bool] -or $lease.active -ne $true -or
            $lease.processName -isnot [string] -or
            [string]::IsNullOrWhiteSpace($lease.processName) -or
            $lease.profileName -isnot [string] -or
            ($lease.createdAtUtc -isnot [string] -and $lease.createdAtUtc -isnot [datetime]) -or
            ($lease.expiresAtUtc -isnot [string] -and $lease.expiresAtUtc -isnot [datetime])) {
            throw 'GOVERNOR_PREPARE_LEASE_INVALID_SCHEMA'
        }
        $created = [DateTimeOffset]::MinValue
        $expiry = [DateTimeOffset]::MinValue
        $style = [System.Globalization.DateTimeStyles]::AssumeUniversal
        $culture = [System.Globalization.CultureInfo]::InvariantCulture
        # ConvertFrom-Json on modern PowerShell materialises ISO UTC JSON strings
        # as DateTime values. Keep that scalar typed conversion, but never accept
        # arrays, objects or date-shaped numeric values as reviewer lease authority.
        $createdText = if ($lease.createdAtUtc -is [datetime]) {
            $lease.createdAtUtc.ToUniversalTime().ToString('o', $culture)
        } else { [string]$lease.createdAtUtc }
        $expiryText = if ($lease.expiresAtUtc -is [datetime]) {
            $lease.expiresAtUtc.ToUniversalTime().ToString('o', $culture)
        } else { [string]$lease.expiresAtUtc }
        if (-not [DateTimeOffset]::TryParse($createdText, $culture, $style, [ref]$created) -or
            -not [DateTimeOffset]::TryParse($expiryText, $culture, $style, [ref]$expiry)) {
            throw 'GOVERNOR_PREPARE_LEASE_INVALID_TIME'
        }
        $nowUtc = [DateTimeOffset]::UtcNow
        if ($created -gt $nowUtc.AddSeconds(5) -or
            $expiry -le $created -or
            $expiry -gt $created.AddMinutes(2) -or
            $nowUtc -ge $expiry) {
            throw 'GOVERNOR_PREPARE_LEASE_OUTSIDE_BOUNDED_WINDOW'
        }
        return [pscustomobject]@{
            active = $true
            processName = $lease.processName
            profileName = $lease.profileName
            expiresAtUtc = $lease.expiresAtUtc
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
            if (-not $profile) { continue }
            $processProperty = $profile.PSObject.Properties['processName']
            if (-not $processProperty) { continue }
            if ([string]::Equals([string]$processProperty.Value, $RequestedProcessName, [System.StringComparison]::OrdinalIgnoreCase)) {
                # Normalize legacy/custom profile shapes before StrictMode consumers
                # read optional fields added by newer governor versions.
                return [pscustomobject]@{
                    name = if ($profile.PSObject.Properties['name']) { [string]$profile.PSObject.Properties['name'].Value } else { '' }
                    processName = [string]$processProperty.Value
                    minFreeVramMiB = if ($profile.PSObject.Properties['minFreeVramMiB']) { $profile.PSObject.Properties['minFreeVramMiB'].Value } else { $null }
                    lightweightOnly = if ($profile.PSObject.Properties['lightweightOnly']) { $profile.PSObject.Properties['lightweightOnly'].Value } else { $null }
                    parkAllModels = if ($profile.PSObject.Properties['parkAllModels']) { $profile.PSObject.Properties['parkAllModels'].Value } else { $null }
                    cooldownSeconds = if ($profile.PSObject.Properties['cooldownSeconds']) { $profile.PSObject.Properties['cooldownSeconds'].Value } else { $null }
                }
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
    $reviewerReservation = [bool](
        $RequestedProfileName -eq 'review-large-context' -and
        $process -eq 'SovereignReviewer' -and
        -not $Signal.active
    )

    if ($reviewerReservation) {
        # Fixed reviewer reservation only. It never parks a model itself; real
        # game/headset signals are evaluated before this lease and still win.
        $name = 'review-large-context'
        $minFree = 2048
        $lightweightOnly = $false
        $parkAllModels = $false
        $cooldown = 30
    }
    elseif ($Signal.airLinkActive) {
        $name = 'vr-maximum'
        $minFree = 12288
        $parkAllModels = $true
        $cooldown = [Math]::Max(90, $CooldownSeconds)
    }
    elseif ($process -in @('Starfield','Cyberpunk2077','SkyrimVR','Fallout4VR')) {
        $name = 'heavy-game-maximum'
        $minFree = 10240
    }

    if ($RequestedProfileName -and -not $reviewerReservation) {
        $name = $RequestedProfileName
        if ($RequestedProfileName -eq 'vr-maximum') {
            $minFree = 12288
            $parkAllModels = $true
        }
        if ($RequestedProfileName -eq 'heavy-game-maximum') { $minFree = 10240 }
    }

    $custom = if ($reviewerReservation) { $null } else { Get-ProfileOverride -RequestedProcessName $process }
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

function Get-OllamaVrRuntimeProcesses {
    $ollamaRoot = Join-Path $env:LOCALAPPDATA 'Programs\Ollama'
    return @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $name = [string]$_.Name
                $path = [string]$_.ExecutablePath
                $commandLine = [string]$_.CommandLine
                $underOllamaRoot = [bool](
                    $path -and
                    $path.StartsWith($ollamaRoot, [System.StringComparison]::OrdinalIgnoreCase)
                )
                $isRuntime = [bool](
                    $name -ieq 'llama-server.exe' -or
                    $name -ieq 'ollama app.exe' -or
                    ($name -ieq 'ollama.exe' -and $commandLine -match '(?i)(?:^|\s)serve(?:\s|$)')
                )
                $underOllamaRoot -and $isRuntime
            }
    )
}

function Stop-OllamaRuntimeForRealVr {
    param([bool]$Enabled)

    $result = [ordered]@{
        enabled = $Enabled
        processCountBefore = 0
        stoppedProcessCount = 0
        processCountAfter = 0
        suppressed = (-not $Enabled)
    }
    if (-not $Enabled) { return [pscustomobject]$result }

    $before = @(Get-OllamaVrRuntimeProcesses)
    $result.processCountBefore = $before.Count
    $stoppedPids = @{}
    $quietSince = $null
    $deadline = (Get-Date).AddSeconds(2)

    do {
        $current = @(Get-OllamaVrRuntimeProcesses)
        if ($current.Count -eq 0) {
            if (-not $quietSince) { $quietSince = Get-Date }
            if (((Get-Date) - $quietSince).TotalMilliseconds -ge 250) { break }
        }
        else {
            $quietSince = $null
            foreach ($name in @('llama-server.exe','ollama.exe','ollama app.exe')) {
                foreach ($process in @($current | Where-Object { [string]$_.Name -ieq $name })) {
                    try {
                        Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
                        $key = [string]$process.ProcessId
                        if (-not $stoppedPids.ContainsKey($key)) {
                            $stoppedPids[$key] = $true
                            $result.stoppedProcessCount += 1
                        }
                    }
                    catch {}
                }
            }
        }
        Start-Sleep -Milliseconds 50
    } while ((Get-Date) -lt $deadline)

    $after = @(Get-OllamaVrRuntimeProcesses)
    $result.processCountAfter = $after.Count
    $result.suppressed = $result.processCountAfter -eq 0
    return [pscustomobject]$result
}

function Invoke-ImmediateVrModelEviction {
    # Real headset presence is a hard local-AI boundary. Stopping only the loaded
    # model is insufficient because Ollama can immediately respawn it; suppress
    # the bounded Ollama runtime tree instead, before the slower reconcile pass.
    if (-not (Test-RealAirLinkActive)) { return $false }
    $suppression = Stop-OllamaRuntimeForRealVr -Enabled $true
    return [bool]($suppression.stoppedProcessCount -gt 0)
}

function Read-GovernorState {
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { return $null }
    try {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        if ($null -eq $state -or $state -isnot [pscustomobject]) {
            throw 'GOVERNOR_PERSISTED_STATE_INVALID_SHAPE'
        }
        # A present state with absent or wrong-typed identity flags must never
        # inherit Normalize-GovernorState's permissive legacy defaults.
        foreach ($requiredName in @('phase','active','localModelAllowed')) {
            if ($null -eq $state.PSObject.Properties[$requiredName]) {
                throw 'GOVERNOR_PERSISTED_STATE_REQUIRED_FIELD_MISSING'
            }
        }
        if ($state.phase -isnot [string] -or
            $state.active -isnot [bool] -or
            $state.localModelAllowed -isnot [bool]) {
            throw 'GOVERNOR_PERSISTED_STATE_REQUIRED_FIELD_INVALID'
        }
        return Normalize-GovernorState -State $state
    } catch {
        # A present but unreadable persisted state is not the same as a clean
        # first boot with no state file. Fail closed so the watcher rebuilds a
        # bounded gaming cooldown before any reviewer resource reservation.
        return Normalize-GovernorState -State ([pscustomobject]@{
            phase = 'UNKNOWN'
            active = $true
            localModelAllowed = $false
            cooldownUntilUtc = ''
            profile = $null
            reason = 'unreadable-governor-state'
        })
    }
}

function Test-InconsistentGovernorIdleState {
    param($State)
    if (-not $State) { return $false }
    $phase = [string]$State.phase
    # The same protection classification must apply to watcher reconciliation
    # and reviewer admission. Unknown phases are unsafe even if flags say idle.
    if ($phase -notin @('NORMAL','REVIEWING','GAMING','PREPARING','COOLDOWN')) { return $true }
    # NORMAL and REVIEWING are safe only with an internally consistent idle
    # observation. A contradictory active/model-denial flag remains protected.
    if ($phase -in @('NORMAL','REVIEWING')) {
        return [bool]($State.active -eq $true -or $State.localModelAllowed -eq $false)
    }
    return $false
}

function Test-ReviewerReservationBlockedByCooldown {
    param($State)
    if (-not $State) { return $false }
    $phase = [string]$State.phase
    # A just-ended game or preparation has not yet published its cooldown.
    # Do not allow a reviewer lease to erase that pending protected transition.
    if ($phase -in @('GAMING','PREPARING')) { return $true }
    # Share the idle consistency test with watcher reconciliation. Otherwise
    # a watcher could clear a denial that reviewer admission would preserve.
    if ($phase -ne 'COOLDOWN') {
        return (Test-InconsistentGovernorIdleState -State $State)
    }
    $deadline = [DateTimeOffset]::MinValue
    $parsed = [DateTimeOffset]::TryParse(
        [string]$State.cooldownUntilUtc,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::AssumeUniversal,
        [ref]$deadline
    )
    # A missing or corrupt prior deadline cannot authorise a new reviewer lease.
    return (-not $parsed -or [DateTimeOffset]::UtcNow -lt $deadline.ToUniversalTime())
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
        loadedModelsBefore = @($Payload.loadedModelsBefore)
        heavyModelsAfter = @($Payload.heavyModelsAfter)
        loadedModelsAfter = @($Payload.loadedModelsAfter)
        localModelAllowed = [bool]$Payload.localModelAllowed
        zeroLocalModelInvariant = [bool]$Payload.zeroLocalModelInvariant
        reappearanceDetected = [bool]$Payload.reappearanceDetected
        reappearanceCount = [int]$Payload.reappearanceCount
        ollamaRuntimeHardBlocked = [bool]$Payload.ollamaRuntimeHardBlocked
        ollamaRuntimeProcessCountBefore = [int]$Payload.ollamaRuntimeProcessCountBefore
        ollamaRuntimeProcessCountAfter = [int]$Payload.ollamaRuntimeProcessCountAfter
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
        [string[]]$LoadedModelsBefore,
        [string[]]$HeavyModelsBefore,
        [string[]]$HeavyModelsAfter,
        [string[]]$LoadedModelsAfter,
        [bool]$ZeroLocalModelInvariant,
        [bool]$ReappearanceDetected,
        [int]$ReappearanceCount,
        [bool]$OllamaRuntimeHardBlocked,
        [int]$OllamaRuntimeProcessCountBefore,
        [int]$OllamaRuntimeProcessCountAfter,
        [int]$OllamaRuntimeStoppedCount,
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
        governorVersion = 3
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
        loadedModelsBefore = @($LoadedModelsBefore)
        heavyModelsBefore = @($HeavyModelsBefore)
        heavyModelsAfter = @($HeavyModelsAfter)
        loadedModelsAfter = @($LoadedModelsAfter)
        zeroLocalModelInvariant = [bool]$ZeroLocalModelInvariant
        reappearanceDetected = [bool]$ReappearanceDetected
        reappearanceCount = [int]$ReappearanceCount
        ollamaRuntimeHardBlocked = [bool]$OllamaRuntimeHardBlocked
        ollamaRuntimeProcessCountBefore = [int]$OllamaRuntimeProcessCountBefore
        ollamaRuntimeProcessCountAfter = [int]$OllamaRuntimeProcessCountAfter
        ollamaRuntimeStoppedCount = [int]$OllamaRuntimeStoppedCount
        evictionHealthy = [bool](
            (-not $ShouldParkHeavy -or $HeavyModelsAfter.Count -eq 0) -and
            $ZeroLocalModelInvariant
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
    $priorParkAllModels = $false
    if (
        $PriorState -and
        $PriorState.profile -and
        $null -ne $PriorState.profile.PSObject.Properties['parkAllModels']
    ) {
        $priorParkAllModels = [bool]$PriorState.profile.parkAllModels
    }
    if (
        $Signal.active -and
        -not $lease.active -and
        $PriorState -and
        [bool]$PriorState.active -and
        $priorParkAllModels
    ) {
        # An explicitly prepared VR session must not silently downgrade to the
        # flat-game lightweight lane merely because the headset/runtime signal
        # flickers after the game process becomes authoritative.
        $profile = $PriorState.profile
    }
    elseif (-not $Signal.active -and -not $lease.active -and $PriorState -and $PriorState.profile) {
        $profile = $PriorState.profile
    }
    $nowUtc = (Get-Date).ToUniversalTime()

    # Corrupt or contradictory persisted state is not permission to run a
    # local model. Recover with park-all even if the prior profile was the
    # non-parking SovereignReviewer or generic-safe profile.
    $recoveryProfileRequired = [bool](
        $PriorState -and (
            (Test-InconsistentGovernorIdleState -State $PriorState) -or
            ($PriorState.localModelAllowed -eq $false -and -not [bool]$profile.parkAllModels)
        )
    )
    if ($recoveryProfileRequired) {
        $profile = [pscustomobject]@{
            name = 'protected-cooldown-recovery'
            processName = ''
            minFreeVramMiB = 12288
            lightweightOnly = $true
            parkAllModels = $true
            cooldownSeconds = [Math]::Min(600, [Math]::Max(30, $CooldownSeconds))
            customProfileApplied = $false
        }
    }

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
        # An explicit forced gaming session must not reuse a cancelled or expired
        # SovereignReviewer profile or a custom profile that permits local models.
        # Keep gaming-safe eviction even when no game or headset signal is live.
        $profile = [pscustomobject]@{
            name = 'operator-forced-gaming'
            processName = if ($Signal.gameProcessName) { [string]$Signal.gameProcessName } else { '' }
            minFreeVramMiB = 12288
            lightweightOnly = $true
            parkAllModels = $true
            cooldownSeconds = [Math]::Min(600, [Math]::Max(30, $CooldownSeconds))
            customProfileApplied = $false
        }
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

    # A reviewer reservation may not replace an unexpired gaming cooldown.
    # Keep the prior protected profile and deadline, including a malformed
    # deadline that must fail closed until separately repaired.
    if (
        -not $Signal.active -and
        $lease.active -and
        [string]$profile.name -eq 'review-large-context' -and
        [string]$profile.processName -eq 'SovereignReviewer' -and
        (Test-ReviewerReservationBlockedByCooldown -State $PriorState)
    ) {
        $protectedProfile = $profile
        if ($PriorState.profile) { $protectedProfile = $PriorState.profile }
        $protectedUntilUtc = [string]$PriorState.cooldownUntilUtc
        $priorDeadline = [DateTimeOffset]::MinValue
        $deadlineKnown = [DateTimeOffset]::TryParse(
            [string]$PriorState.cooldownUntilUtc,
            [System.Globalization.CultureInfo]::InvariantCulture,
            [System.Globalization.DateTimeStyles]::AssumeUniversal,
            [ref]$priorDeadline
        )
        if ([string]$PriorState.phase -ne 'COOLDOWN' -or -not $deadlineKnown) {
            # The watcher may not yet have observed the game exit. Start its
            # cooldown from the original gaming profile, never the reviewer.
            $protectedSeconds = 0
            if (
                -not [int]::TryParse([string]$protectedProfile.cooldownSeconds, [ref]$protectedSeconds) -or
                $protectedSeconds -lt 30
            ) {
                $protectedSeconds = [Math]::Max(30, $CooldownSeconds)
            }
            $protectedUntilUtc = $nowUtc.AddSeconds($protectedSeconds).ToString('o')
        }
        return [pscustomobject]@{
            phase = 'COOLDOWN'
            active = $true
            reason = 'gaming-session-cooldown'
            overrideMode = $override
            profile = $protectedProfile
            lease = $lease
            cooldownUntilUtc = $protectedUntilUtc
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

    if (
        $lease.active -and
        [string]$profile.name -eq 'review-large-context' -and
        [string]$profile.processName -eq 'SovereignReviewer'
    ) {
        return [pscustomobject]@{
            phase = 'REVIEWING'
            active = $false
            reason = 'reviewer-resource-reservation'
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
        $priorPhase = [string]$PriorState.phase
        $priorInconsistent = (Test-InconsistentGovernorIdleState -State $PriorState)
        $priorWasProtected = [bool](
            $priorPhase -in @('PREPARING','GAMING','COOLDOWN') -or
            $priorInconsistent
        )
        if ([string]$PriorState.cooldownUntilUtc) {
            [void][DateTime]::TryParse([string]$PriorState.cooldownUntilUtc, [ref]$cooldownUntil)
        }
        if ($priorWasProtected -and ($priorInconsistent -or $cooldownUntil -eq [DateTime]::MinValue)) {
            # Unknown/contradictory persisted phases must rebuild a bounded
            # cooldown even if they carry a parseable expired or far-future
            # deadline; otherwise a watcher may first publish NORMAL and then
            # admit a reviewer. A consistent COOLDOWN with a valid expired
            # deadline may still expire as intended.
            $cooldownUntil = $nowUtc.AddSeconds([Math]::Max(30, [int]$profile.cooldownSeconds))
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

    $gpuBefore = Get-GpuSnapshot
    $parkAllModels = [bool]($Effective.active -and $Effective.profile.parkAllModels)
    $hardBlockRealVr = [bool]($parkAllModels -and $Signal.realAirLinkActive)
    $started = Get-Date
    $runtimeSuppression = Stop-OllamaRuntimeForRealVr -Enabled $hardBlockRealVr
    $ollamaExecutable = Resolve-OllamaExecutable

    # Do not call Ollama's control API while its runtime is intentionally blocked.
    # A synchronous 'ollama stop' can itself stall for minutes while a model is
    # loading, which is exactly how Qwen escaped the previous guard.
    if ($hardBlockRealVr) {
        $loadedBefore = @()
    }
    else {
        $loadedBefore = @(Get-LoadedOllamaModels -OllamaExecutable $ollamaExecutable)
    }
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
    $modelsToPark = if ($parkAllModels) { @($loadedBefore) } else { @($heavyBefore) }

    # Plain PowerShell array avoids the Windows PowerShell 5.1 generic-list
    # binder failure seen during post-crash reconcile.
    $parked = @()
    if (($shouldPark -or $parkAllModels) -and $ollamaExecutable -and -not $hardBlockRealVr) {
        foreach ($model in $modelsToPark) {
            if (Stop-OllamaModel -OllamaExecutable $ollamaExecutable -Model $model) {
                $parked += [string]$model
            }
        }
    }
    $evictionDuration = [long]((Get-Date) - $started).TotalMilliseconds
    if ($hardBlockRealVr) {
        $loadedAfter = @()
        $runtimeProcessesAfter = @(Get-OllamaVrRuntimeProcesses)
    }
    else {
        $loadedAfter = @(Get-LoadedOllamaModels -OllamaExecutable $ollamaExecutable)
        $runtimeProcessesAfter = @()
    }
    $heavyAfter = @(Get-HeavyModels -Models $loadedAfter)
    $zeroLocalModelInvariant = [bool](
        -not ($Effective.active -and $parkAllModels) -or
        ($loadedAfter.Count -eq 0 -and (-not $hardBlockRealVr -or $runtimeProcessesAfter.Count -eq 0))
    )
    $priorReappearanceCount = 0
    if ($PriorState -and $null -ne $PriorState.PSObject.Properties['reappearanceCount']) {
        $priorReappearanceCount = [int]$PriorState.reappearanceCount
    }
    $runtimeReappearanceDetected = [bool](
        $hardBlockRealVr -and
        [int]$runtimeSuppression.processCountBefore -gt 0 -and
        $PriorState -and
        [bool]$PriorState.active -and
        $null -ne $PriorState.PSObject.Properties['localModelAllowed'] -and
        $PriorState.localModelAllowed -eq $false
    )
    $modelReappearanceDetected = [bool](
        $parkAllModels -and
        $loadedBefore.Count -gt 0 -and
        $PriorState -and
        [bool]$PriorState.active -and
        $null -ne $PriorState.PSObject.Properties['localModelAllowed'] -and
        $PriorState.localModelAllowed -eq $false
    )
    $reappearanceDetected = [bool]($runtimeReappearanceDetected -or $modelReappearanceDetected)
    $reappearanceCount = $priorReappearanceCount
    if ($reappearanceDetected) { $reappearanceCount += 1 }
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
        LoadedModelsBefore = @($loadedBefore)
        HeavyModelsBefore = @($heavyBefore)
        HeavyModelsAfter = @($heavyAfter)
        LoadedModelsAfter = @($loadedAfter)
        ZeroLocalModelInvariant = $zeroLocalModelInvariant
        ReappearanceDetected = $reappearanceDetected
        ReappearanceCount = $reappearanceCount
        OllamaRuntimeHardBlocked = $hardBlockRealVr
        OllamaRuntimeProcessCountBefore = [int]$runtimeSuppression.processCountBefore
        OllamaRuntimeProcessCountAfter = [int]$runtimeProcessesAfter.Count
        OllamaRuntimeStoppedCount = [int]$runtimeSuppression.stoppedProcessCount
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

if ($Action -eq 'ObserveAdmission') {
    # Fresh read-only admission for cooperative CPU workers. Leave the sole
    # watcher/reconciler in charge of persisted state, leases and model actions.
    # Do not call Resolve-EffectiveState: it can clear prepare-lease evidence.
    $signal = Get-GamingSignal
    [pscustomobject]@{
        schemaVersion = 'stephanos.gaming-resource-admission-observation.v1'
        observedAtUtc = [DateTime]::UtcNow.ToString('o')
        signalActive = [bool]$signal.active
        overrideMode = [string](Read-OverrideMode)
        preparePending = [bool](Test-Path -LiteralPath $preparePath)
        readOnly = $true
    } | ConvertTo-Json -Depth 4
    exit 0
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
    if (
        $ProfileName -eq 'review-large-context' -and
        $ProcessName -eq 'SovereignReviewer' -and
        (Test-ReviewerReservationBlockedByCooldown -State (Read-GovernorState))
    ) {
        throw 'REVIEWER_RESERVATION_BLOCKED_BY_GAMING_COOLDOWN'
    }
    Write-PrepareLease -RequestedProcessName $ProcessName -RequestedProfileName $ProfileName | Out-Null
    $prepared = Invoke-CurrentReconcile
    $prepared | ConvertTo-Json -Depth 8
    if ($ProfileName -eq 'review-large-context') {
        if (
            $ProcessName -ne 'SovereignReviewer' -or
            [string]$prepared.phase -ne 'REVIEWING' -or
            $prepared.active -ne $false -or
            $prepared.prepareLeaseActive -ne $true -or
            [string]$prepared.profile.name -ne 'review-large-context' -or
            [string]$prepared.profile.processName -ne 'SovereignReviewer' -or
            $prepared.profile.customProfileApplied -ne $false -or
            $prepared.localModelAllowed -ne $true -or
            $prepared.heavyModelAllowed -ne $true -or
            [string]$prepared.ollamaLoadMode -ne 'balanced'
        ) {
            Clear-PrepareLease
            exit 4
        }
        exit 0
    }
    if (-not $prepared.evictionHealthy -or $prepared.heavyModelAllowed -ne $false) { exit 2 }
    if (
        $prepared.profile.parkAllModels -eq $true -and
        (
            $prepared.localModelAllowed -ne $false -or
            @($prepared.loadedModelsAfter).Count -gt 0 -or
            $prepared.zeroLocalModelInvariant -ne $true
        )
    ) { exit 3 }
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

$poll = [Math]::Max(250, $PollMilliseconds)
$lastGuardAt = [DateTime]::MinValue
# Retain fast real-headset detection and immediate AI-model eviction on every
# watcher tick. Expensive all-process flat-game discovery is capped at 1/3s.
$script:flatGameScanIntervalSeconds = 3
$script:lastFlatGameScanAt = [DateTime]::MinValue
$script:cachedFlatGameSignal = $null

while ($true) {
    # First bite: headset presence wins over every other workload. If any Ollama
    # runner has appeared, evict it immediately before the slower inventory pass.
    [void](Invoke-ImmediateVrModelEviction)

    $prior = Read-GovernorState
    $signal = Get-GamingSignal -ThrottleFlatGameScan
    $effective = Resolve-EffectiveState -Signal $signal -PriorState $prior
    $now = Get-Date
    $phaseChanged = -not $prior -or [string]$prior.phase -ne [string]$effective.phase
    $reasonChanged = -not $prior -or [string]$prior.reason -ne [string]$effective.reason
    $overrideChanged = -not $prior -or [string]$prior.overrideMode -ne [string]$effective.overrideMode
    $processChanged = -not $prior -or [string]$prior.gameProcessName -ne [string]$signal.gameProcessName
    $guardIntervalSeconds = if ($effective.active -and $effective.profile.parkAllModels) { 0.5 } else { 5 }
    $guardDue = $effective.active -and ($now - $lastGuardAt).TotalSeconds -ge $guardIntervalSeconds
    # Keep an independently observed idle-state heartbeat fresh for bounded
    # GPU/CPU model admission. Without this, Watch refreshes its JSON only on
    # transitions. Core expires evidence at 15s (the reviewer at 30s), so
    # refresh at 5s to leave room for observation and reconciliation latency.
    # Do not extend consumer freshness limits or reuse an unobserved idle state.
    # The watcher still scans game/headset signals on every tick BEFORE this.
    $idleHeartbeatDue = $false
    if (-not $effective.active) {
        try {
            $observedUtc = [DateTime]::Parse(
                [string]$prior.updatedAtUtc,
                [System.Globalization.CultureInfo]::InvariantCulture,
                [System.Globalization.DateTimeStyles]::RoundtripKind
            ).ToUniversalTime()
            $idleHeartbeatDue = ($now.ToUniversalTime() - $observedUtc).TotalSeconds -ge 5
        } catch {
            $idleHeartbeatDue = $true
        }
    }

    if ($phaseChanged -or $reasonChanged -or $overrideChanged -or $processChanged -or $guardDue -or $idleHeartbeatDue) {
        $state = Invoke-Reconcile -Signal $signal -Effective $effective -PriorState $prior
        if ($state.active) { $lastGuardAt = $now }
    }

    Start-Sleep -Milliseconds $poll
}
