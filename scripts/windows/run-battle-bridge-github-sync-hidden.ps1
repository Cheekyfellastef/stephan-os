[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

if (-not $env:USERPROFILE) {
    throw 'USERPROFILE is required to resolve the canonical Battle Bridge checkout.'
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
$expectedRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
if ([System.IO.Path]::GetFullPath($repoRoot) -ne $expectedRepoRoot) {
    throw "GitHub sync launcher must run from the canonical checkout: $expectedRepoRoot"
}

$coordinatorPath = (Resolve-Path (Join-Path $repoRoot 'scripts\battle-bridge-github-sync-and-refresh.mjs')).Path
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) { $nodeCommand = Get-Command node -ErrorAction Stop }

& $nodeCommand.Source $coordinatorPath *> $null
$syncExitCode = $LASTEXITCODE
if ($syncExitCode -ne 0) { exit $syncExitCode }

# Resolve this path only after the source sync completes. That ensures the
# control-plane repair comes from the exact newly synchronized main checkout
# and cannot wake the mailbox early on a stale source head.
$reconcilePath = (Resolve-Path (Join-Path $repoRoot 'scripts\windows\reconcile-battle-bridge-control-plane.ps1')).Path
& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
    -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $reconcilePath *> $null
$reconcileExitCode = $LASTEXITCODE
if ($reconcileExitCode -ne 0) { exit 30 }

exit 0
