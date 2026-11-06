[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$hostScript = Join-Path $repositoryRoot 'scripts\spatial-window-host.mjs'
$stateRoot = Join-Path $repositoryRoot '.stephanos\local-state-checkpoints'
$destination = Join-Path $stateRoot 'spatial-window'
$staging = Join-Path $stateRoot ('spatial-window-build-' + [Guid]::NewGuid().ToString('N'))
$node = (Get-Command node.exe -ErrorAction Stop).Source
# Finish compilation before stopping an existing connection. No source, browser
# storage, unrelated service or other process is modified by this installer.
& (Join-Path $PSScriptRoot 'build-spatial-window.ps1') -OutputDirectory $staging
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort 4180 -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
    $owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($owners.Count -ne 1) { throw 'The console port has an unexpected owner; no process was stopped.' }
    $owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $owners[0])
    $expectedCommand = '"' + $node + '" "' + $hostScript + '"'
    if (-not $owner -or $owner.ExecutablePath -ne $node -or $owner.CommandLine -cne $expectedCommand) { throw 'The console port belongs to another process; no process was stopped.' }
    $again = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $owner.ProcessId)
    if (-not $again -or $again.CreationDate -ne $owner.CreationDate -or $again.CommandLine -cne $expectedCommand) { throw 'The console process changed during installation.' }
    Stop-Process -Id $owner.ProcessId -ErrorAction Stop
}
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$deadline = (Get-Date).AddSeconds(5)
do {
    try { Copy-Item -LiteralPath (Join-Path $staging 'SpatialWindow.exe') -Destination (Join-Path $destination 'SpatialWindow.exe') -Force; break }
    catch { if ((Get-Date) -ge $deadline) { throw }; Start-Sleep -Milliseconds 200 }
} while ($true)
Copy-Item -LiteralPath (Join-Path $staging 'build.json') -Destination (Join-Path $destination 'build.json') -Force
& $node $hostScript --verify-installation
if ($LASTEXITCODE -ne 0) { throw 'The console installation did not verify.' }
