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
    throw "GitHub command mailbox launcher must run from the canonical checkout: $expectedRepoRoot"
}

# The bounded guard delegates command parsing/execution only to the canonical
# battle-bridge-github-command-mailbox-with-receipt-index.mjs runner. This keeps
# the established receipt-index authority and windowless task identity intact.
$runnerPath = (Resolve-Path (Join-Path $repoRoot 'scripts\battle-bridge-github-command-mailbox-outbox-guard-v1.mjs')).Path
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) { $nodeCommand = Get-Command node -ErrorAction Stop }

& $nodeCommand.Source $runnerPath *> $null
exit $LASTEXITCODE
