[CmdletBinding()]
param(
    [string]$WorkspaceUrl = 'http://127.0.0.1:4173/apps/spatial-bridge/quest-entry.html'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ignitionScript = Join-Path $repositoryRoot 'windows\Launch-Stephanos-Local.cmd'

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
function Start-StephanosIgnition {
    if (-not (Test-Path -LiteralPath $ignitionScript -PathType Leaf)) {
        throw "Stephanos ignition script is missing: $ignitionScript"
    }
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $env:ComSpec
    $startInfo.Arguments = ('/d /c ""{0}""' -f $ignitionScript)
    $startInfo.WorkingDirectory = Split-Path -Parent $ignitionScript
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void]$process.Start()
}

if (-not (Test-SpatialWorkspaceRoute)) {
    Start-StephanosIgnition
    $deadline = (Get-Date).AddSeconds(25)
    do {
        Start-Sleep -Milliseconds 500
        if (Test-SpatialWorkspaceRoute) { break }
    } while ((Get-Date) -lt $deadline)
}

if (-not (Test-SpatialWorkspaceRoute)) {
    throw 'Stephanos Spatial Workspace route did not become ready on port 4173.'
}
$pf = [Environment]::GetFolderPath('ProgramFiles')
$pf86 = [Environment]::GetFolderPath('ProgramFilesX86')
$browserCandidates = @(
    (Join-Path $pf86 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $pf 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $pf 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $pf86 'Google\Chrome\Application\chrome.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }

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
    runtimeReady = $true
    headsetAcceptance = 'pending-operator-playtest'
} | ConvertTo-Json -Compress
