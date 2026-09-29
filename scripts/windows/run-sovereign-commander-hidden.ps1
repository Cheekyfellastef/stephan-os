[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..\..'))
$expectedRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
if (-not [string]::Equals($repoRoot, $expectedRepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Sovereign Commander runner must use canonical checkout: $expectedRepoRoot"
}

$serverScript = Join-Path $repoRoot 'scripts\sovereign-commander-http.mjs'
$tokenPath = Join-Path $env:USERPROFILE 'Documents\OpenClaw-Standalone\mission-runner\keys\sovereign-commander-token.txt'
$port = 18791

function Get-SovereignCommanderProcesses {
    return @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -eq 'node.exe' -and
                [string]$_.CommandLine -match 'sovereign-commander-http\.mjs'
            }
    )
}

function Test-SovereignCommanderHealth {
    try {
        $health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$port/health" -TimeoutSec 3
        return ($health.ok -eq $true -and [string]$health.service -eq 'stephanos-sovereign-commander')
    } catch {
        return $false
    }
}

$blocker = ''
$startRequested = $false
$startedPid = 0
$before = Get-SovereignCommanderProcesses
$healthyBefore = Test-SovereignCommanderHealth

if (-not (Test-Path -LiteralPath $serverScript -PathType Leaf)) {
    $blocker = 'SOVEREIGN_COMMANDER_SERVER_SCRIPT_MISSING'
} elseif (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) {
    $blocker = 'SOVEREIGN_COMMANDER_TOKEN_MISSING'
} elseif ($before.Count -eq 0 -or -not $healthyBefore) {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { $node = Get-Command node -ErrorAction SilentlyContinue }
    if (-not $node) {
        $blocker = 'SOVEREIGN_COMMANDER_NODE_NOT_FOUND'
    } else {
        $startRequested = $true
        try {
            $started = Start-Process -FilePath $node.Source -ArgumentList @($serverScript) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
            $startedPid = [int]$started.Id
            Start-Sleep -Seconds 2
        } catch {
            $blocker = 'SOVEREIGN_COMMANDER_START_FAILED'
        }
    }
}

$after = Get-SovereignCommanderProcesses
$healthyAfter = Test-SovereignCommanderHealth
$ok = ($after.Count -ge 1 -and $healthyAfter)
if (-not $ok -and -not $blocker) { $blocker = 'SOVEREIGN_COMMANDER_NOT_HEALTHY' }

[pscustomobject]@{
    schemaVersion = 'stephanos.sovereign-commander-watchdog.v1'
    taskName = 'Stephanos Sovereign Commander'
    beforeProcessCount = $before.Count
    afterProcessCount = $after.Count
    healthyBefore = [bool]$healthyBefore
    healthyAfter = [bool]$healthyAfter
    startRequested = $startRequested
    startedPid = $startedPid
    serverScript = $serverScript
    tokenPath = $tokenPath
    port = $port
    healthy = $ok
    blocker = $blocker
    vendorMeterRequired = $false
    externalSaasRelayRequired = $false
    networkInstallAllowed = $false
    packageMutationAllowed = $false
    arbitraryExecutableAllowed = $false
    arbitraryShellAllowed = $false
    unrelatedProcessRestartAllowed = $false
    pcRestartAllowed = $false
    visiblePowerShellRequired = $false
    finalVerdict = if ($ok) { 'SOVEREIGN_COMMANDER_WATCHDOG_HEALTHY' } else { 'SOVEREIGN_COMMANDER_WATCHDOG_BLOCKED' }
} | ConvertTo-Json -Depth 5

if (-not $ok) { exit 2 }
