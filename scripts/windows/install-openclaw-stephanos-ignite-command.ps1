[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$StephanosRepositoryRoot = "$env:USERPROFILE\Documents\GitHub\stephan-os"
)

$ErrorActionPreference = 'Stop'
$pluginId = 'stephanos-ignite-command'
$repositoryRoot = [System.IO.Path]::GetFullPath($StephanosRepositoryRoot)
$pluginRoot = Join-Path $repositoryRoot 'integrations\openclaw\stephanos-ignite-command'
$manifestPath = Join-Path $pluginRoot 'openclaw.plugin.json'
$entryPath = Join-Path $pluginRoot 'index.js'

foreach ($requiredFile in @($manifestPath, $entryPath)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required Stephanos OpenClaw plugin file is missing: $requiredFile"
    }
}

$openclaw = Get-Command openclaw.cmd -ErrorAction SilentlyContinue
if ($null -eq $openclaw) {
    $openclaw = Get-Command openclaw -ErrorAction Stop
}

if ($PSCmdlet.ShouldProcess($pluginId, "Install linked OpenClaw plugin from $pluginRoot")) {
    & $openclaw.Source plugins install --link $pluginRoot
    if ($LASTEXITCODE -ne 0) { throw "OpenClaw plugin install failed with exit code $LASTEXITCODE" }

    & $openclaw.Source plugins enable $pluginId
    if ($LASTEXITCODE -ne 0) { throw "OpenClaw plugin enable failed with exit code $LASTEXITCODE" }

    & $openclaw.Source gateway restart
    if ($LASTEXITCODE -ne 0) { throw "OpenClaw Gateway restart failed with exit code $LASTEXITCODE" }
}

Write-Output "PLUGIN_ID=$pluginId"
Write-Output "PLUGIN_ROOT=$pluginRoot"
Write-Output "MANIFEST_SHA256=$((Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash.ToLowerInvariant())"
Write-Output "ENTRY_SHA256=$((Get-FileHash -Algorithm SHA256 -LiteralPath $entryPath).Hash.ToLowerInvariant())"
Write-Output 'INSPECT_COMMAND=openclaw plugins inspect stephanos-ignite-command --runtime --json'
Write-Output 'WHATSAPP_COMMANDS=/stephanos-ignite help | /stephanos-ignite openclaw-status | /stephanos-ignite status'
Write-Output 'FINAL_VERDICT=OPENCLAW_STEPHANOS_IGNITE_COMMAND_INSTALLED'
