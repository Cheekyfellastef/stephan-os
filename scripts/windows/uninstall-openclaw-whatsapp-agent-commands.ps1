#requires -Version 5.1
param(
  [switch]$WhatIfRollback
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$PluginRoot = Join-Path $RepoRoot 'integrations\openclaw\whatsapp-agent-commands'
$StatusScript = Join-Path $PSScriptRoot 'status-openclaw-whatsapp-agent-commands.ps1'

Write-Host 'OPENCLAW_WHATSAPP_AGENT_COMMANDS_ROLLBACK_PLAN'
Write-Host ("pluginRoot={0}" -f $PluginRoot)
Write-Host 'preserve=/stephanos,plain ChatClean'
Write-Host 'actions=disable plugin,uninstall linked plugin,restart gateway,status inspect'

if (-not $WhatIfRollback) {
  Write-Host 'VERDICT=ROLLBACK_NOT_RUN_RUNTIME_GATE_REQUIRED'
  Write-Host 'RERUN_WITH=-WhatIfRollback only for dry-run rollback proof. Real rollback requires Milestone 3 operator approval.'
  exit 0
}

& $StatusScript
Write-Host 'VERDICT=ROLLBACK_DRY_RUN_OK_NO_RUNTIME_MUTATION'
