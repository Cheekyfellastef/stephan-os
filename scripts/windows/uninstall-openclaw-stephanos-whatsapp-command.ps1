[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'
$pluginId = 'stephanos-whatsapp-command'
$openclaw = Get-Command openclaw.cmd -ErrorAction SilentlyContinue
if ($null -eq $openclaw) {
    $openclaw = Get-Command openclaw -ErrorAction Stop
}

if ($PSCmdlet.ShouldProcess($pluginId, 'Uninstall OpenClaw plugin and restart Gateway')) {
    & $openclaw.Source plugins uninstall $pluginId
    if ($LASTEXITCODE -ne 0) { throw "OpenClaw plugin uninstall failed with exit code $LASTEXITCODE" }

    & $openclaw.Source gateway restart
    if ($LASTEXITCODE -ne 0) { throw "OpenClaw Gateway restart failed with exit code $LASTEXITCODE" }
}

Write-Output "PLUGIN_ID=$pluginId"
Write-Output 'FINAL_VERDICT=OPENCLAW_STEPHANOS_WHATSAPP_COMMAND_UNINSTALLED'
