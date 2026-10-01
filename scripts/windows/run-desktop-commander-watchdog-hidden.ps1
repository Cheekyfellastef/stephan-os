[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

$requiredVersion = '0.2.51'

function Get-CommanderProcesses {
    return @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -eq 'node.exe' -and
                [string]$_.CommandLine -match 'desktop-commander' -and
                [string]$_.CommandLine -match 'dist[\\\\/]index\\.js' -and
                [string]$_.CommandLine -match '(?:^|\\s)remote(?:\\s|$)'
            }
    )
}

function Resolve-CommanderPackage {
    $candidates = @()
    if ($env:APPDATA) {
        $candidates += [pscustomobject]@{
            path = Join-Path $env:APPDATA 'npm\node_modules\@wonderwhy-er\desktop-commander'
            source = 'global-npm'
            mtime = [datetime]::MinValue
        }
    }
    if ($env:LOCALAPPDATA) {
        $npxRoot = Join-Path $env:LOCALAPPDATA 'npm-cache\_npx'
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

$before = Get-CommanderProcesses
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

$after = Get-CommanderProcesses
$ok = $after.Count -ge 1
if (-not $ok -and -not $blocker) { $blocker = 'DESKTOP_COMMANDER_REMOTE_PROCESS_NOT_HEALTHY' }

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
