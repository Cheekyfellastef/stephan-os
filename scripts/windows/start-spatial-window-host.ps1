[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot 'spatial-window-install-lock.ps1')
$installationLock = Enter-SpatialWindowInstallLock -RepositoryRoot $repositoryRoot
try {
$hostScript = Join-Path $repositoryRoot 'scripts\spatial-window-host.mjs'
$receiptPath = Join-Path $repositoryRoot '.stephanos\local-state-checkpoints\spatial-window\build.json'
if (-not (Test-Path -LiteralPath $receiptPath)) { throw 'The spatial console needs its reviewed Windows helper installed.' }
$receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
if ($receipt.schema -ne 'stephanos.spatial-window-build.v1' -or $receipt.buildId -notmatch '^[a-f0-9]{64}$') { throw 'The spatial console installation receipt is invalid.' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
# Validate exact sources and binary before accepting an already running helper.
& $node $hostScript --verify-installation | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'The installed console source or binary changed. Rebuild the reviewed helper.' }
function Get-ConsoleHealth {
    try { return Invoke-RestMethod -Uri 'http://127.0.0.1:4180/health' -Headers @{Origin='http://127.0.0.1:4173'} -TimeoutSec 2 } catch { return $null }
}
$health = Get-ConsoleHealth
if ($health) {
    if ($health.schema -ne 'stephanos.spatial-window-health.v1' -or $health.buildId -ne $receipt.buildId) { throw 'A different console version is still running. Re-run the reviewed Spatial Workspace installer to update it.' }
    return
}
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $node
$startInfo.Arguments = '"' + $hostScript + '"'
$startInfo.WorkingDirectory = $repositoryRoot
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$process = [Diagnostics.Process]::Start($startInfo)
$deadline = (Get-Date).AddSeconds(12)
do {
    $health = Get-ConsoleHealth
    if ($health -and $health.schema -eq 'stephanos.spatial-window-health.v1' -and $health.buildId -eq $receipt.buildId) { return }
    if ($process.HasExited) { throw 'The spatial console helper could not start. Its local port may already be in use.' }
    Start-Sleep -Milliseconds 200
} while ((Get-Date) -lt $deadline)
throw 'The spatial console helper did not become ready. The existing workspace has not been changed.'
} finally { Exit-SpatialWindowInstallLock -Mutex $installationLock }
