[CmdletBinding()]
param(
    [string]$StephanosRepositoryRoot = "$env:USERPROFILE\Documents\GitHub\stephan-os"
)

$ErrorActionPreference = 'Stop'
$pluginId = 'stephanos-whatsapp-command'
$repositoryRoot = [System.IO.Path]::GetFullPath($StephanosRepositoryRoot)
$pluginRoot = Join-Path $repositoryRoot 'integrations\openclaw\stephanos-whatsapp-command'
$manifestPath = Join-Path $pluginRoot 'openclaw.plugin.json'
$entryPath = Join-Path $pluginRoot 'index.js'
$openclaw = Get-Command openclaw.cmd -ErrorAction SilentlyContinue
if ($null -eq $openclaw) {
    $openclaw = Get-Command openclaw -ErrorAction Stop
}

$inspectOutput = @(& $openclaw.Source plugins inspect $pluginId --runtime --json 2>&1)
$inspectExit = $LASTEXITCODE
$statusOutput = @(& $openclaw.Source status --json 2>&1)
$statusExit = $LASTEXITCODE

Write-Output "PLUGIN_ID=$pluginId"
Write-Output "SOURCE_PLUGIN_ROOT=$pluginRoot"
Write-Output "SOURCE_MANIFEST_EXISTS=$((Test-Path -LiteralPath $manifestPath -PathType Leaf))"
Write-Output "SOURCE_ENTRY_EXISTS=$((Test-Path -LiteralPath $entryPath -PathType Leaf))"
if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    Write-Output "SOURCE_MANIFEST_SHA256=$((Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash.ToLowerInvariant())"
}
if (Test-Path -LiteralPath $entryPath -PathType Leaf) {
    Write-Output "SOURCE_ENTRY_SHA256=$((Get-FileHash -Algorithm SHA256 -LiteralPath $entryPath).Hash.ToLowerInvariant())"
}
Write-Output "PLUGIN_INSPECT_EXIT=$inspectExit"
Write-Output 'PLUGIN_INSPECT_BEGIN'
$inspectOutput
Write-Output 'PLUGIN_INSPECT_END'
Write-Output "OPENCLAW_STATUS_EXIT=$statusExit"
Write-Output 'OPENCLAW_STATUS_BEGIN'
$statusOutput
Write-Output 'OPENCLAW_STATUS_END'

if ($inspectExit -ne 0 -or $statusExit -ne 0) {
    Write-Output 'FINAL_VERDICT=OPENCLAW_STEPHANOS_WHATSAPP_COMMAND_STATUS_BLOCKED'
    exit 1
}

Write-Output 'FINAL_VERDICT=OPENCLAW_STEPHANOS_WHATSAPP_COMMAND_STATUS_PASS'
