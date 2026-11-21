[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$actualRoot = [System.IO.Path]::GetFullPath((Resolve-Path (Join-Path $scriptDir '..\..')).Path)
if ($actualRoot -ne $repoRoot) { throw 'OUTBOUND_BEACON_CANONICAL_CHECKOUT_REQUIRED' }

$node = 'C:\Program Files\nodejs\node.exe'
$runner = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'scripts\battle-bridge-outbound-health-beacon.mjs'))
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw 'OUTBOUND_BEACON_CANONICAL_NODE_MISSING' }
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw 'OUTBOUND_BEACON_RUNNER_MISSING' }

& $node $runner *> $null
exit $LASTEXITCODE
