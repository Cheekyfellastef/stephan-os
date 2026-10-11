[CmdletBinding()]
param(
    [int]$ObservationSeconds = 8
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..\..'))
$workspaceRoot = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'
$stateRoot = Join-Path $workspaceRoot 'vr'
$governorScript = Join-Path $repoRoot 'scripts\windows\run-vr-resource-governor.ps1'
$statePath = Join-Path $stateRoot 'vr-resource-governor-current.json'
$overridePath = Join-Path $stateRoot 'gaming-resource-override.json'
$telemetryPath = Join-Path $stateRoot 'gaming-resource-governor-events.jsonl'
$powershellExecutable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Invoke-Governor {
    param(
        [Parameter(Mandatory)][string]$Action,
        [string]$ProcessName = '',
        [string]$ProfileName = ''
    )
    $args = @(
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', $governorScript,
        '-Action', $Action
    )
    if ($ProcessName) { $args += @('-ProcessName', $ProcessName) }
    if ($ProfileName) { $args += @('-ProfileName', $ProfileName) }

    $text = & $powershellExecutable @args 2>&1 | Out-String
    $exit = $LASTEXITCODE
    if (-not $text.Trim()) {
        throw ('GAMING_ACCEPTANCE_' + $Action + '_EMPTY')
    }
    try {
        $payload = $text.Trim() | ConvertFrom-Json
    }
    catch {
        throw ('GAMING_ACCEPTANCE_' + $Action + '_JSON_INVALID: ' + $text.Trim())
    }
    return [pscustomobject]@{
        exitCode = $exit
        payload = $payload
        raw = $text.Trim()
    }
}

function Read-OriginalOverride {
    if (-not (Test-Path -LiteralPath $overridePath -PathType Leaf)) { return 'AUTO' }
    try {
        $state = Get-Content -LiteralPath $overridePath -Raw | ConvertFrom-Json
        if ([string]$state.mode -in @('AUTO','FORCE_ON','FORCE_OFF')) { return [string]$state.mode }
    } catch {}
    return 'AUTO'
}

function Restore-Override {
    param([string]$Mode)
    switch ($Mode) {
        'FORCE_ON' { [void](Invoke-Governor -Action 'ForceOn') }
        'FORCE_OFF' { [void](Invoke-Governor -Action 'ForceOff') }
        default { [void](Invoke-Governor -Action 'SetAuto') }
    }
}

$originalOverride = Read-OriginalOverride
$baseline = $null
$prepared = $null
$forced = $null
$forcedOff = $null
$restored = $null
$blocker = ''
$ok = $false
$telemetryObserved = $false

try {
    if (-not (Test-Path -LiteralPath $governorScript -PathType Leaf)) {
        throw 'GAMING_ACCEPTANCE_GOVERNOR_SCRIPT_MISSING'
    }

    [void](Invoke-Governor -Action 'SetAuto')
    [void](Invoke-Governor -Action 'CancelPrepare')
    $baseline = Invoke-Governor -Action 'Reconcile'
    if ($baseline.exitCode -ne 0) { throw 'GAMING_ACCEPTANCE_BASELINE_RECONCILE_FAILED' }

    if (
        $baseline.payload.realAirLinkActive -eq $true -or
        $baseline.payload.flatGameActive -eq $true
    ) {
        throw 'GAMING_ACCEPTANCE_REAL_GAMING_SESSION_ACTIVE'
    }

    $prepared = Invoke-Governor -Action 'PrepareGaming' -ProcessName 'AcceptanceGame' -ProfileName 'heavy-game-maximum'
    if ($prepared.exitCode -ne 0) { throw 'GAMING_ACCEPTANCE_PREPARE_FAILED' }
    if ([string]$prepared.payload.phase -ne 'PREPARING') { throw 'GAMING_ACCEPTANCE_PREPARE_PHASE_INVALID' }
    if ($prepared.payload.active -ne $true) { throw 'GAMING_ACCEPTANCE_PREPARE_NOT_ACTIVE' }
    if ($prepared.payload.heavyModelAllowed -ne $false) { throw 'GAMING_ACCEPTANCE_PREPARE_HEAVY_MODEL_ALLOWED' }
    if (@($prepared.payload.heavyModelsAfter).Count -gt 0) { throw 'GAMING_ACCEPTANCE_PREPARE_HEAVY_MODEL_REMAINED' }
    if ($prepared.payload.evictionHealthy -ne $true) { throw 'GAMING_ACCEPTANCE_PREPARE_EVICTION_UNHEALTHY' }

    $forced = Invoke-Governor -Action 'ForceOn'
    if ($forced.exitCode -ne 0) { throw 'GAMING_ACCEPTANCE_FORCE_ON_FAILED' }
    if ([string]$forced.payload.phase -ne 'GAMING') { throw 'GAMING_ACCEPTANCE_FORCE_ON_PHASE_INVALID' }
    if ([string]$forced.payload.overrideMode -ne 'FORCE_ON') { throw 'GAMING_ACCEPTANCE_FORCE_ON_OVERRIDE_INVALID' }
    if ($forced.payload.heavyModelAllowed -ne $false) { throw 'GAMING_ACCEPTANCE_FORCE_ON_HEAVY_MODEL_ALLOWED' }

    Start-Sleep -Seconds ([Math]::Max(1, [Math]::Min(20, $ObservationSeconds)))

    $forcedOff = Invoke-Governor -Action 'ForceOff'
    if ($forcedOff.exitCode -ne 0) { throw 'GAMING_ACCEPTANCE_FORCE_OFF_FAILED' }
    if ([string]$forcedOff.payload.phase -ne 'NORMAL') { throw 'GAMING_ACCEPTANCE_FORCE_OFF_PHASE_INVALID' }
    if ($forcedOff.payload.active -ne $false) { throw 'GAMING_ACCEPTANCE_FORCE_OFF_STILL_ACTIVE' }
    if ([string]$forcedOff.payload.overrideMode -ne 'FORCE_OFF') { throw 'GAMING_ACCEPTANCE_FORCE_OFF_OVERRIDE_INVALID' }

    if (Test-Path -LiteralPath $telemetryPath -PathType Leaf) {
        $tail = @(Get-Content -LiteralPath $telemetryPath -ErrorAction SilentlyContinue | Select-Object -Last 12)
        $tailText = $tail -join [Environment]::NewLine
        $telemetryObserved = [bool](
            $tailText -match '"phase":"PREPARING"' -and
            $tailText -match '"phase":"GAMING"' -and
            $tailText -match '"phase":"NORMAL"'
        )
    }
    if (-not $telemetryObserved) { throw 'GAMING_ACCEPTANCE_TELEMETRY_INCOMPLETE' }

    $ok = $true
}
catch {
    $blocker = if ($_.Exception.Message) { [string]$_.Exception.Message } else { 'GAMING_ACCEPTANCE_FAILED' }
}
finally {
    try {
        Restore-Override -Mode $originalOverride
        [void](Invoke-Governor -Action 'CancelPrepare')
        $restored = Invoke-Governor -Action 'Reconcile'
    }
    catch {
        if (-not $blocker) { $blocker = 'GAMING_ACCEPTANCE_RESTORE_FAILED' }
        $ok = $false
    }
}

[pscustomobject]@{
    schemaVersion = 'stephanos.gaming-resource-acceptance.v1'
    ok = [bool]$ok
    originalOverride = $originalOverride
    baseline = if ($baseline) { $baseline.payload } else { $null }
    prepared = if ($prepared) { $prepared.payload } else { $null }
    forcedOn = if ($forced) { $forced.payload } else { $null }
    forcedOff = if ($forcedOff) { $forcedOff.payload } else { $null }
    restored = if ($restored) { $restored.payload } else { $null }
    telemetryObserved = [bool]$telemetryObserved
    realGameLaunchUsed = $false
    realHeadsetProofClaimed = $false
    arbitraryShellAllowed = $false
    arbitraryProcessKillAllowed = $false
    blocker = $blocker
    finalVerdict = if ($ok) {
        'SOVEREIGN_COMMANDER_GAMING_RESOURCE_ACCEPTANCE_PASSED'
    } else {
        'SOVEREIGN_COMMANDER_GAMING_RESOURCE_ACCEPTANCE_FAILED'
    }
} | ConvertTo-Json -Depth 10

if ($ok) { exit 0 }
exit 2
