[CmdletBinding()]
param(
    [switch]$SkipSovereignCrossHeal
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

$requiredVersion = '0.2.52'
$requiredSovereignCapabilityVersion = '2026-10-05-continuous-repair-reporting-v4'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..\..'))
$sovereignTaskName = 'Stephanos Sovereign Commander'

function Get-SovereignCommanderHealthContract {
    $client = $null
    try {
        $client = [System.Net.Http.HttpClient]::new()
        $client.Timeout = [TimeSpan]::FromSeconds(3)
        $json = $client.GetStringAsync('http://127.0.0.1:18791/health').GetAwaiter().GetResult()
        $health = $json | ConvertFrom-Json
        $capabilityProperty = $health.PSObject.Properties['capabilityVersion']
        $guardianProperty = $health.PSObject.Properties['continuousRepairGuardian']
        $capabilityVersion = if ($null -ne $capabilityProperty) { [string]$capabilityProperty.Value } else { '' }
        $guardian = if ($null -ne $guardianProperty) { $guardianProperty.Value } else { $null }
        $guardianEnabled = [bool]($null -ne $guardian -and $guardian.PSObject.Properties['enabled'] -and $guardian.enabled -eq $true)
        $guardianRunning = [bool]($null -ne $guardian -and $guardian.PSObject.Properties['running'] -and $guardian.running -eq $true)
        $guardianScheduled = [bool]($null -ne $guardian -and $guardian.PSObject.Properties['scheduled'] -and $guardian.scheduled -eq $true)
        return [pscustomobject]@{
            healthy = [bool](
                $health.ok -eq $true -and
                [string]$health.service -eq 'stephanos-sovereign-commander' -and
                $capabilityVersion -eq $requiredSovereignCapabilityVersion -and
                $guardianEnabled -and
                ($guardianRunning -or $guardianScheduled)
            )
            capabilityVersion = $capabilityVersion
            guardianEnabled = $guardianEnabled
            guardianRunning = $guardianRunning
            guardianScheduled = $guardianScheduled
        }
    } catch {
        return [pscustomobject]@{
            healthy = $false
            capabilityVersion = ''
            guardianEnabled = $false
            guardianRunning = $false
            guardianScheduled = $false
        }
    } finally {
        if ($null -ne $client) { $client.Dispose() }
    }
}

function Get-CommanderProcesses {
    return @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -eq 'node.exe' -and
                [string]$_.CommandLine -match 'desktop-commander' -and
                [string]$_.CommandLine -match 'dist[\\/]index\.js' -and
                [string]$_.CommandLine -match '(?:^|\s)remote(?:\s|$)'
            }
    )
}

function Resolve-CommanderPackage {
    $candidates = @()
    $appDataRoot = if ($env:APPDATA) { $env:APPDATA } elseif ($env:USERPROFILE) { Join-Path $env:USERPROFILE 'AppData\Roaming' } else { '' }
    $localAppDataRoot = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } elseif ($env:USERPROFILE) { Join-Path $env:USERPROFILE 'AppData\Local' } else { '' }
    if ($appDataRoot) {
        $candidates += [pscustomobject]@{
            path = Join-Path $appDataRoot 'npm\node_modules\@wonderwhy-er\desktop-commander'
            source = 'global-npm'
            mtime = [datetime]::MinValue
        }
    }
    if ($localAppDataRoot) {
        $npxRoot = Join-Path $localAppDataRoot 'npm-cache\_npx'
        if (Test-Path -LiteralPath $npxRoot -PathType Container) {
            foreach ($entry in @(Get-ChildItem -LiteralPath $npxRoot -Directory -ErrorAction SilentlyContinue)) {
                $candidates += [pscustomobject]@{
                    path = Join-Path $entry.FullName 'node_modules\@wonderwhy-er\desktop-commander'
                    source = 'npx-cache'
                    mtime = $entry.LastWriteTimeUtc
                }
            }
        }
    }

    foreach ($candidate in @($candidates | Sort-Object mtime -Descending)) {
        $packageJson = Join-Path $candidate.path 'package.json'
        $indexPath = Join-Path $candidate.path 'dist\index.js'
        if (-not (Test-Path -LiteralPath $packageJson -PathType Leaf) -or -not (Test-Path -LiteralPath $indexPath -PathType Leaf)) { continue }
        try { $package = Get-Content -LiteralPath $packageJson -Raw | ConvertFrom-Json } catch { continue }
        if ([string]$package.name -cne '@wonderwhy-er/desktop-commander') { continue }
        if ([string]$package.version -cne $requiredVersion) { continue }
        return [pscustomobject]@{
            indexPath = [System.IO.Path]::GetFullPath($indexPath)
            packageRoot = [System.IO.Path]::GetFullPath($candidate.path)
            version = [string]$package.version
            source = [string]$candidate.source
        }
    }
    return $null
}

$before = @(Get-CommanderProcesses)
$startRequested = $false
$startPid = 0
$package = $null
$blocker = ''

if ($before.Count -eq 0) {
    $package = Resolve-CommanderPackage
    if ($null -eq $package) {
        $blocker = 'DESKTOP_COMMANDER_QUALIFIED_LOCAL_PACKAGE_NOT_FOUND'
    } else {
        $node = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $node) { $node = Get-Command node -ErrorAction SilentlyContinue }
        if (-not $node) {
            $blocker = 'DESKTOP_COMMANDER_NODE_NOT_FOUND'
        } else {
            $startRequested = $true
            try {
                $quotedIndex = '"' + ([string]$package.indexPath).Replace('"', '\"') + '"'
                $started = Start-Process -FilePath $node.Source -ArgumentList @($quotedIndex, 'remote') -WindowStyle Hidden -PassThru
                $startPid = [int]$started.Id
                Start-Sleep -Seconds 2
            } catch {
                $blocker = 'DESKTOP_COMMANDER_REMOTE_START_FAILED'
            }
        }
    }
}

$after = @(Get-CommanderProcesses)
$ok = $after.Count -ge 1
if (-not $ok -and -not $blocker) { $blocker = 'DESKTOP_COMMANDER_REMOTE_PROCESS_NOT_HEALTHY' }

$sovereignCrossHealRequested = $false
$sovereignHealth = Get-SovereignCommanderHealthContract
$sovereignCrossHealOk = [bool]$sovereignHealth.healthy
$sovereignCrossHealBlocker = ''
if (-not $SkipSovereignCrossHeal -and -not $sovereignCrossHealOk) {
    $sovereignCrossHealRequested = $true
    $sovereignTask = Get-ScheduledTask -TaskName $sovereignTaskName -ErrorAction SilentlyContinue
    if ($null -eq $sovereignTask) {
        $sovereignCrossHealBlocker = 'SOVEREIGN_COMMANDER_TASK_MISSING'
    } else {
        try {
            if ([string]$sovereignTask.State -ne 'Running') {
                Start-ScheduledTask -TaskName $sovereignTaskName
            }
            for ($attempt = 0; $attempt -lt 12 -and -not $sovereignCrossHealOk; $attempt++) {
                Start-Sleep -Milliseconds 500
                $sovereignHealth = Get-SovereignCommanderHealthContract
                $sovereignCrossHealOk = [bool]$sovereignHealth.healthy
            }
            if (-not $sovereignCrossHealOk) { $sovereignCrossHealBlocker = 'SOVEREIGN_COMMANDER_CROSS_HEAL_NOT_HEALTHY' }
        } catch {
            $sovereignCrossHealBlocker = 'SOVEREIGN_COMMANDER_CROSS_HEAL_FAILED'
        }
    }
}

[pscustomobject]@{
    schemaVersion = 'stephanos.desktop-commander-watchdog.v1'
    taskName = 'Stephanos Commander Watchdog'
    requiredVersion = $requiredVersion
    beforeProcessCount = $before.Count
    afterProcessCount = $after.Count
    startRequested = $startRequested
    startedPid = $startPid
    packageSource = if ($null -eq $package) { '' } else { [string]$package.source }
    packageRoot = if ($null -eq $package) { '' } else { [string]$package.packageRoot }
    packageVersion = if ($null -eq $package) { '' } else { [string]$package.version }
    healthy = $ok
    blocker = $blocker
    sovereignCrossHealSkipped = [bool]$SkipSovereignCrossHeal
    sovereignCrossHealRequested = [bool]$sovereignCrossHealRequested
    sovereignCrossHealOk = [bool]$sovereignCrossHealOk
    sovereignCrossHealBlocker = [string]$sovereignCrossHealBlocker
    networkInstallAllowed = $false
    packageMutationAllowed = $false
    arbitraryExecutableAllowed = $false
    arbitraryShellAllowed = $false
    unrelatedProcessRestartAllowed = $false
    pcRestartAllowed = $false
    visiblePowerShellRequired = $false
    finalVerdict = if ($ok) { 'DESKTOP_COMMANDER_WATCHDOG_HEALTHY' } else { 'DESKTOP_COMMANDER_WATCHDOG_BLOCKED' }
} | ConvertTo-Json -Depth 5

if (-not $ok) { exit 2 }
