[CmdletBinding()]
param(
    [string]$RequireCapabilityVersion = ''
)

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
$canonicalNode = 'C:\Program Files\nodejs\node.exe'
$port = 18791
$serverScriptPattern = [regex]::Escape($serverScript)

function Get-SovereignCommanderProcesses {
    return @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -eq 'node.exe' -and
                [string]$_.CommandLine -match $serverScriptPattern
            }
    )
}

function Get-SovereignCommanderHealth {
    try {
        $health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$port/health" -TimeoutSec 3
        $basicHealthy = ($health.ok -eq $true -and [string]$health.service -eq 'stephanos-sovereign-commander')
        $capabilityProperty = $health.PSObject.Properties['capabilityVersion']
        $capabilityVersion = if ($null -ne $capabilityProperty) { [string]$capabilityProperty.Value } else { '' }
        $capabilitySatisfied = (-not $RequireCapabilityVersion) -or ($capabilityVersion -eq $RequireCapabilityVersion)
        return [pscustomobject]@{
            healthy = [bool]($basicHealthy -and $capabilitySatisfied)
            basicHealthy = [bool]$basicHealthy
            capabilitySatisfied = [bool]$capabilitySatisfied
            capabilityVersion = $capabilityVersion
        }
    } catch {
        return [pscustomobject]@{
            healthy = $false
            basicHealthy = $false
            capabilitySatisfied = (-not $RequireCapabilityVersion)
            capabilityVersion = ''
        }
    }
}

$blocker = ''
$startRequested = $false
$startedPid = 0
$before = @(Get-SovereignCommanderProcesses)
$healthBefore = Get-SovereignCommanderHealth
$healthyBefore = [bool]$healthBefore.healthy
$staleCapability = [bool]($healthBefore.basicHealthy -and -not $healthBefore.capabilitySatisfied)
$staleCapabilityRecycleRequested = $false
$stoppedPidCount = 0

if (-not (Test-Path -LiteralPath $serverScript -PathType Leaf)) {
    $blocker = 'SOVEREIGN_COMMANDER_SERVER_SCRIPT_MISSING'
} elseif (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) {
    $blocker = 'SOVEREIGN_COMMANDER_TOKEN_MISSING'
} elseif ($before.Count -eq 0 -or -not $healthyBefore) {
    if (-not (Test-Path -LiteralPath $canonicalNode -PathType Leaf)) {
        $blocker = 'SOVEREIGN_COMMANDER_CANONICAL_NODE_MISSING'
    } else {
        if ($staleCapability -and $before.Count -gt 0) {
            $staleCapabilityRecycleRequested = $true
            try {
                foreach ($process in $before) {
                    Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
                    $stoppedPidCount += 1
                }
                Start-Sleep -Milliseconds 500
            } catch {
                $blocker = 'SOVEREIGN_COMMANDER_STALE_CAPABILITY_RECYCLE_FAILED'
            }
        }
        if (-not $blocker) {
            $startRequested = $true
            try {
                $quotedServerScript = '"' + $serverScript.Replace('"', '\"') + '"'
                $started = Start-Process -FilePath $canonicalNode -ArgumentList @($quotedServerScript) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
                $startedPid = [int]$started.Id
                Start-Sleep -Seconds 2
            } catch {
                $blocker = 'SOVEREIGN_COMMANDER_START_FAILED'
            }
        }
    }
}

$after = @(Get-SovereignCommanderProcesses)
$healthAfter = Get-SovereignCommanderHealth
$healthyAfter = [bool]$healthAfter.healthy
$ok = ($after.Count -ge 1 -and $healthyAfter)
if (-not $ok -and -not $blocker) { $blocker = 'SOVEREIGN_COMMANDER_NOT_HEALTHY' }

[pscustomobject]@{
    schemaVersion = 'stephanos.sovereign-commander-watchdog.v1'
    taskName = 'Stephanos Sovereign Commander'
    beforeProcessCount = $before.Count
    afterProcessCount = $after.Count
    healthyBefore = [bool]$healthyBefore
    healthyAfter = [bool]$healthyAfter
    requiredCapabilityVersion = $RequireCapabilityVersion
    capabilityVersionBefore = [string]$healthBefore.capabilityVersion
    capabilityVersionAfter = [string]$healthAfter.capabilityVersion
    staleCapabilityRecycleRequested = [bool]$staleCapabilityRecycleRequested
    stoppedPidCount = [int]$stoppedPidCount
    startRequested = $startRequested
    startedPid = $startedPid
    serverScript = $serverScript
    nodeExecutable = $canonicalNode
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
