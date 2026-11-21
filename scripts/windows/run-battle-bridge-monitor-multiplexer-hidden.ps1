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
    throw "Monitor Multiplexer launcher must run from the canonical checkout: $expectedRepoRoot"
}

$runtimePath = (Resolve-Path (Join-Path $repoRoot 'scripts\battle-bridge-monitor-multiplexer-runtime-v2.mjs')).Path
$canonicalNode = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $canonicalNode -PathType Leaf)) {
    throw "Canonical Node executable is missing: $canonicalNode"
}

& $canonicalNode $runtimePath *> $null
exit $LASTEXITCODE
