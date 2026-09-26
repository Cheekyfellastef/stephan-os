#requires -Version 5.1
param(
  [switch]$WhatIfInstall
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$PluginRoot = Join-Path $RepoRoot 'integrations\openclaw\whatsapp-agent-commands'
$ManifestPath = Join-Path $PluginRoot 'openclaw.plugin.json'
$EntryPath = Join-Path $PluginRoot 'index.js'
$StatusScript = Join-Path $PSScriptRoot 'status-openclaw-whatsapp-agent-commands.ps1'

function Get-FileSha256([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return '<missing>' }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

& $StatusScript

Write-Host 'OPENCLAW_WHATSAPP_AGENT_COMMANDS_INSTALL_PLAN'
Write-Host ("pluginRoot={0}" -f $PluginRoot)
Write-Host ("manifestSha256={0}" -f (Get-FileSha256 $ManifestPath))
Write-Host ("entrySha256={0}" -f (Get-FileSha256 $EntryPath))
Write-Host 'commands=/standalone,/scout-coder,/scout_coder'
Write-Host 'preserve=/stephanos,plain ChatClean'

if (-not $WhatIfInstall) {
  Write-Host 'VERDICT=INSTALL_NOT_RUN_RUNTIME_GATE_REQUIRED'
  Write-Host 'RERUN_WITH=-WhatIfInstall only for dry-run source proof. Real install requires Milestone 3 operator approval.'
  exit 0
}

Write-Host 'VERDICT=DRY_RUN_OK_NO_RUNTIME_MUTATION'
