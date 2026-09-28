[CmdletBinding()]
param(
    [string]$WorkspaceUrl = 'http://127.0.0.1:4173/apps/spatial-bridge/quest-entry.html'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$requestedHead = (& git -C $repositoryRoot rev-parse HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $requestedHead -notmatch '^[0-9a-f]{40}$') {
    throw 'Unable to resolve the Spatial Workspace repository HEAD for exact-head runtime proof.'
}
$ignitionScript = Join-Path $repositoryRoot 'windows\Invoke-Stephanos-Ignite-With-Approval.ps1'
$powershellExecutable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$canonicalSharedWorkspaceRoot = if ($env:STEPHANOS_SHARED_WORKSPACE -and $env:STEPHANOS_SHARED_WORKSPACE.Trim()) { $env:STEPHANOS_SHARED_WORKSPACE.Trim() } elseif ($env:STEPHANOS_OPENCLAW_WORKSPACE -and $env:STEPHANOS_OPENCLAW_WORKSPACE.Trim()) { $env:STEPHANOS_OPENCLAW_WORKSPACE.Trim() } else { Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Stephanos-openclaw-workspace' }
$battleBridgeSupervisorCurrentPath = Join-Path $canonicalSharedWorkspaceRoot 'status/battle-bridge-ignition-supervisor-current.json'
$launchStartedAtUtc = (Get-Date).ToUniversalTime()
if ($WorkspaceUrl.Contains('"') -or -not $WorkspaceUrl.StartsWith('http://127.0.0.1:4173/')) {
    throw 'Spatial Workspace URL must use the trusted local Stephanos origin.'
}

function Test-SpatialWorkspaceRoute {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $WorkspaceUrl -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content -match 'Stephanos Spatial Workspace'
    }
    catch {
        return $false
    }
}
function Test-ExactHeadBattleBridgeSupervisorReady {
    if (-not (Test-Path -LiteralPath $battleBridgeSupervisorCurrentPath -PathType Leaf)) { return $false }
    try {
        $record = Get-Content -LiteralPath $battleBridgeSupervisorCurrentPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($record.trafficLight -ne 'green') { return $false }
        $sourceExpectedHead = if ($record.sourceTruthVerdict -and $record.sourceTruthVerdict.expectedHead) { [string]$record.sourceTruthVerdict.expectedHead } else { '' }
        $servedProof = if ($record.services -and $record.services.stephanosUi4173) { $record.services.stephanosUi4173.servedRuntimeProof } else { $null }
        $servedCurrentHead = if ($servedProof -and $servedProof.currentHead) { [string]$servedProof.currentHead } else { '' }
        return $sourceExpectedHead -eq $requestedHead -and $servedProof.ready -eq $true -and $servedCurrentHead -eq $requestedHead
    }
    catch {
        return $false
    }
}
function Get-FreshBattleBridgeSupervisorBlocker {
    if (-not (Test-Path -LiteralPath $battleBridgeSupervisorCurrentPath -PathType Leaf)) { return '' }
    try {
        $freshnessBoundaryUtc = $launchStartedAtUtc.AddSeconds(-2)
        $statusFile = Get-Item -LiteralPath $battleBridgeSupervisorCurrentPath -ErrorAction Stop
        if ($statusFile.LastWriteTimeUtc -lt $freshnessBoundaryUtc) { return '' }
        $record = Get-Content -LiteralPath $battleBridgeSupervisorCurrentPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $generatedAtUtc = [DateTimeOffset]::MinValue
        if (-not $record.generatedAt -or -not [DateTimeOffset]::TryParse([string]$record.generatedAt, [ref]$generatedAtUtc)) { return '' }
        if ($generatedAtUtc.UtcDateTime -lt $freshnessBoundaryUtc) { return '' }
        if ($record.blockerId) { return [string]$record.blockerId }
        return ''
    }
    catch {
        return ''
    }
}
function Start-StephanosIgnition {
    if (-not (Test-Path -LiteralPath $ignitionScript -PathType Leaf)) {
        throw "Stephanos ignition script is missing: $ignitionScript"
    }
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $powershellExecutable
    $startInfo.Arguments = ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -RepositoryRoot "{1}"' -f $ignitionScript, $repositoryRoot)
    $startInfo.WorkingDirectory = $repositoryRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void]$process.Start()
    return $process
}

$ignitionProcess = $null
if (-not (Test-SpatialWorkspaceRoute) -or -not (Test-ExactHeadBattleBridgeSupervisorReady)) {
    $ignitionProcess = Start-StephanosIgnition
    $deadline = (Get-Date).AddSeconds(300)
    do {
        Start-Sleep -Milliseconds 500
        if ((Test-SpatialWorkspaceRoute) -and (Test-ExactHeadBattleBridgeSupervisorReady)) { break }
        if ($ignitionProcess -and $ignitionProcess.HasExited -and $ignitionProcess.ExitCode -ne 0) {
            throw "Stephanos ignition helper exited with code $($ignitionProcess.ExitCode) before the Spatial Workspace route became ready."
        }
        $supervisorBlocker = Get-FreshBattleBridgeSupervisorBlocker
        if ($supervisorBlocker) {
            throw "Stephanos ignition supervisor blocked before the Spatial Workspace route became ready: $supervisorBlocker"
        }
    } while ((Get-Date) -lt $deadline)
}

if (-not (Test-SpatialWorkspaceRoute)) {
    throw 'Stephanos Spatial Workspace route did not become ready on port 4173.'
}
if (-not (Test-ExactHeadBattleBridgeSupervisorReady)) {
    throw "Stephanos Spatial Workspace refused to open because canonical supervisor exact-head proof does not match repository HEAD ${requestedHead}."
}

$pf = [Environment]::GetFolderPath('ProgramFiles')
$pf86 = [Environment]::GetFolderPath('ProgramFilesX86')
$browserCandidates = @(
    @(
        (Join-Path $pf86 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $pf 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $pf 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $pf86 'Google\Chrome\Application\chrome.exe')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
)

if ($browserCandidates.Count -eq 0) {
    Start-Process $WorkspaceUrl
}
else {
    $browser = $browserCandidates[0]
    Start-Process -FilePath $browser -ArgumentList @('--new-window', $WorkspaceUrl)
}

[pscustomobject]@{
    schemaVersion = 'stephanos.spatial-workspace-launch.v1'
    verdict = 'SPATIAL_WORKSPACE_SPLASH_OPENED'
    url = $WorkspaceUrl
    workspaceRouteReady = $true
    runtimeReadiness = 'canonical supervisor exact-head proof verified before browser open'
    headsetAcceptance = 'pending-operator-playtest'
} | ConvertTo-Json -Compress
