#requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$PluginRoot = Join-Path $RepoRoot 'integrations\openclaw\whatsapp-agent-commands'
$ManifestPath = Join-Path $PluginRoot 'openclaw.plugin.json'
$EntryPath = Join-Path $PluginRoot 'index.js'
$ContractPath = Join-Path $PluginRoot 'lib\agent-command-contract.mjs'

function Get-FileSha256([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return '<missing>' }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

$required = @(
  @{ Name = 'manifest'; Path = $ManifestPath },
  @{ Name = 'entry'; Path = $EntryPath },
  @{ Name = 'contract'; Path = $ContractPath }
)

$missing = @($required | Where-Object { -not (Test-Path -LiteralPath $_.Path) })
if ($missing.Count -gt 0) {
  Write-Host 'MILESTONE_3_STATUS_BLOCKED_MISSING_FILES'
  $missing | ForEach-Object { Write-Host ("missing={0} path={1}" -f $_.Name, $_.Path) }
  exit 1
}

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$contract = Get-Content -LiteralPath $ContractPath -Raw

$checks = [ordered]@{
  pluginId = $manifest.id -eq 'stephanos-whatsapp-agent-commands'
  standalone = $contract -match "command:\s*'standalone'" -and $contract -match "targetAgentId:\s*'standalone'"
  scoutHyphen = $contract -match "command:\s*'scout-coder'" -and $contract -match "targetAgentId:\s*'stephanos-scout-coder'"
  scoutUnderscore = $contract -match "command:\s*'scout_coder'" -and $contract -match "canonicalCommand:\s*'/scout-coder'"
  noMutationTools = -not ((Get-Content -LiteralPath $EntryPath -Raw) -match 'registerTool\s*\(')
}

Write-Host 'OPENCLAW_WHATSAPP_AGENT_COMMANDS_STATUS'
Write-Host ("pluginId={0}" -f $manifest.id)
Write-Host ("pluginRoot={0}" -f $PluginRoot)
Write-Host ("manifestSha256={0}" -f (Get-FileSha256 $ManifestPath))
Write-Host ("entrySha256={0}" -f (Get-FileSha256 $EntryPath))
Write-Host ("contractSha256={0}" -f (Get-FileSha256 $ContractPath))
Write-Host 'commands=/standalone,/scout-coder,/scout_coder'
Write-Host 'targets=/standalone:standalone,/scout-coder:stephanos-scout-coder,/scout_coder:stephanos-scout-coder'
foreach ($key in $checks.Keys) { Write-Host ("check.{0}={1}" -f $key, $checks[$key]) }

if ($checks.Values -contains $false) {
  Write-Host 'VERDICT=FAIL'
  exit 1
}

Write-Host 'SCOUT_UNDERSCORE_ALIAS_REQUIRED=/scout_coder'
Write-Host 'CONCIERGE_AGENT_NAME=ChatClean'
Write-Host 'VERDICT=SOURCE_STATUS_OK_RUNTIME_INSTALL_NOT_ATTEMPTED'
