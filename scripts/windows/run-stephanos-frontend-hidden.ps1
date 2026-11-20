[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$expectedRepo = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
if (-not [string]::Equals($repoRoot, $expectedRepo, [StringComparison]::OrdinalIgnoreCase)) { throw 'FRONTEND_CANONICAL_CHECKOUT_REQUIRED' }
$node = 'C:\Program Files\nodejs\node.exe'
$entry = Join-Path $repoRoot 'scripts\sovereign-frontend-autostart.mjs'
Push-Location -LiteralPath $repoRoot
try { & $node $entry --operator-approved; exit $LASTEXITCODE }
finally { Pop-Location }
