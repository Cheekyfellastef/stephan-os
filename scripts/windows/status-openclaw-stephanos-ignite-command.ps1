[CmdletBinding()]
param(
    [string]$StephanosRepositoryRoot = "$env:USERPROFILE\Documents\GitHub\stephan-os"
)

$ErrorActionPreference = 'Stop'
$pluginId = 'stephanos-ignite-command'
$repositoryRoot = [System.IO.Path]::GetFullPath($StephanosRepositoryRoot)
$pluginRoot = Join-Path $repositoryRoot 'integrations\openclaw\stephanos-ignite-command'
$manifestPath = Join-Path $pluginRoot 'openclaw.plugin.json'
$entryPath = Join-Path $pluginRoot 'index.js'

$openclaw = Get-Command openclaw.cmd -ErrorAction SilentlyContinue
if ($null -eq $openclaw) {
    $openclaw = Get-Command openclaw -ErrorAction Stop
}

$inspectOutput = @(& $openclaw.Source plugins inspect $pluginId --runtime --json 2>&1)
if ($LASTEXITCODE -ne 0) {
    throw "OpenClaw runtime inspect failed for ${pluginId}: $($inspectOutput -join [Environment]::NewLine)"
}

Write-Output "PLUGIN_ID=$pluginId"
Write-Output "SOURCE_PLUGIN_ROOT=$pluginRoot"
Write-Output "MANIFEST_PRESENT=$((Test-Path -LiteralPath $manifestPath -PathType Leaf).ToString().ToLowerInvariant())"
Write-Output "ENTRY_PRESENT=$((Test-Path -LiteralPath $entryPath -PathType Leaf).ToString().ToLowerInvariant())"
Write-Output 'RUNTIME_INSPECT_JSON_BEGIN'
$inspectOutput | ForEach-Object { Write-Output $_ }
Write-Output 'RUNTIME_INSPECT_JSON_END'
Write-Output 'WHATSAPP_PROOF_COMMANDS=/stephanos-ignite help | /stephanos-ignite openclaw-status | /stephanos-ignite status'
Write-Output 'FINAL_VERDICT=OPENCLAW_STEPHANOS_IGNITE_COMMAND_RUNTIME_PRESENT'
