[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$StephanosRepositoryRoot = "$env:USERPROFILE\Documents\GitHub\stephan-os"
)

$ErrorActionPreference = 'Stop'
$pluginId = 'stephanos-whatsapp-command'
$repositoryRoot = [System.IO.Path]::GetFullPath($StephanosRepositoryRoot)
$pluginRoot = Join-Path $repositoryRoot 'integrations\openclaw\stephanos-whatsapp-command'
$manifestPath = Join-Path $pluginRoot 'openclaw.plugin.json'
$entryPath = Join-Path $pluginRoot 'index.js'

foreach ($requiredFile in @($manifestPath, $entryPath)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required Stephanos OpenClaw plugin file is missing: $requiredFile"
    }
}

$repairScript = Join-Path $repositoryRoot 'scripts\windows\repair-openclaw-stephanos-whatsapp-command-registration.ps1'
if (-not (Test-Path -LiteralPath $repairScript -PathType Leaf)) {
    throw "Required Stephanos OpenClaw repair script is missing: $repairScript"
}

if ($PSCmdlet.ShouldProcess($pluginId, "Repair linked OpenClaw plugin registration at $pluginRoot without full config rewrite")) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $repairScript -StephanosRepositoryRoot $repositoryRoot
    if ($LASTEXITCODE -ne 0) { throw "OpenClaw plugin registration repair failed with exit code $LASTEXITCODE" }
}

Write-Output "PLUGIN_ID=$pluginId"
Write-Output "PLUGIN_ROOT=$pluginRoot"
Write-Output "MANIFEST_SHA256=$((Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash.ToLowerInvariant())"
Write-Output "ENTRY_SHA256=$((Get-FileHash -Algorithm SHA256 -LiteralPath $entryPath).Hash.ToLowerInvariant())"
Write-Output 'COMMAND=/stephanos <message>'
Write-Output 'FINAL_VERDICT=OPENCLAW_STEPHANOS_WHATSAPP_COMMAND_INSTALLED'
