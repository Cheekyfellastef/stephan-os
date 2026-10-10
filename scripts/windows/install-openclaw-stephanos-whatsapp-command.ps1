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

$openclaw = Get-Command openclaw.cmd -ErrorAction SilentlyContinue
if ($null -eq $openclaw) {
    $openclaw = Get-Command openclaw -ErrorAction Stop
}

if ($PSCmdlet.ShouldProcess($pluginId, "Install linked OpenClaw plugin from $pluginRoot")) {
    $uninstallOutput = @(& $openclaw.Source plugins uninstall $pluginId 2>&1)
    $uninstallExit = $LASTEXITCODE
    if ($uninstallExit -ne 0 -and (($uninstallOutput -join "`n") -notmatch '(?i)not\s+installed|not\s+found|unknown\s+plugin')) {
        $uninstallOutput
        throw "OpenClaw stale plugin uninstall failed with exit code $uninstallExit"
    }

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
Write-Output 'COMMAND=/stephanos <message>'
Write-Output 'FINAL_VERDICT=OPENCLAW_STEPHANOS_WHATSAPP_COMMAND_INSTALLED'
