[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$StephanosRepositoryRoot = "$env:USERPROFILE\Documents\GitHub\stephan-os",
    [switch]$Relink
)

$ErrorActionPreference = 'Stop'
$pluginId = 'stephanos-ignite-command'
$repositoryRoot = [System.IO.Path]::GetFullPath($StephanosRepositoryRoot)
$pluginRoot = Join-Path $repositoryRoot 'integrations\openclaw\stephanos-ignite-command'
$manifestPath = Join-Path $pluginRoot 'openclaw.plugin.json'
$packagePath = Join-Path $pluginRoot 'package.json'
$entryPath = Join-Path $pluginRoot 'index.js'
$libraryPath = Join-Path $pluginRoot 'lib\ignite-status.mjs'

foreach ($requiredFile in @($manifestPath, $packagePath, $entryPath, $libraryPath)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required Stephanos Ignite OpenClaw plugin file is missing: $requiredFile"
    }
}

Write-Output "PLUGIN_ID=$pluginId"
Write-Output "CANONICAL_REPOSITORY_ROOT=$repositoryRoot"
Write-Output "CANONICAL_PLUGIN_ROOT=$pluginRoot"
Write-Output "MANIFEST_SHA256=$((Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash.ToLowerInvariant())"
Write-Output "ENTRY_SHA256=$((Get-FileHash -Algorithm SHA256 -LiteralPath $entryPath).Hash.ToLowerInvariant())"
Write-Output 'COMMAND_SURFACE=/stephanos-ignite help|openclaw-status|status'
Write-Output 'DOCTOR_FIX_USED=false'

if (-not $Relink) {
    Write-Output 'FINAL_VERDICT=OPENCLAW_STEPHANOS_IGNITE_COMMAND_SOURCE_PRESENT'
    return
}

$openclaw = Get-Command openclaw.cmd -ErrorAction SilentlyContinue
if ($null -eq $openclaw) {
    $openclaw = Get-Command openclaw -ErrorAction Stop
}

if ($PSCmdlet.ShouldProcess($pluginId, "Relink and enable OpenClaw plugin from $pluginRoot")) {
    & $openclaw.Source plugins install --link $pluginRoot
    if ($LASTEXITCODE -ne 0) { throw "OpenClaw plugin link failed with exit code $LASTEXITCODE" }

    & $openclaw.Source plugins enable $pluginId
    if ($LASTEXITCODE -ne 0) { throw "OpenClaw plugin enable failed with exit code $LASTEXITCODE" }
}

Write-Output 'FINAL_VERDICT=OPENCLAW_STEPHANOS_IGNITE_COMMAND_RELINKED'
