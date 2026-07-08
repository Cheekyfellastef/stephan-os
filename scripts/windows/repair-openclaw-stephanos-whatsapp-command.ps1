[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$StephanosRepositoryRoot = "$env:USERPROFILE\Documents\GitHub\stephan-os"
)

$ErrorActionPreference = 'Stop'
$expectedRepositoryFragment = 'Documents\GitHub\stephan-os'
$pluginId = 'stephanos-whatsapp-command'
$repositoryRoot = [System.IO.Path]::GetFullPath($StephanosRepositoryRoot)
$whatsappPluginRoot = Join-Path $repositoryRoot 'integrations\openclaw\stephanos-whatsapp-command'
$ignitePluginRoot = Join-Path $repositoryRoot 'integrations\openclaw\stephanos-ignite-command'
$repairScriptPath = $PSCommandPath

foreach ($requiredPath in @($whatsappPluginRoot, $ignitePluginRoot)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Container)) {
        throw "Required Stephanos OpenClaw plugin folder is missing: $requiredPath"
    }
}

foreach ($requiredFile in @(
    (Join-Path $whatsappPluginRoot 'openclaw.plugin.json'),
    (Join-Path $whatsappPluginRoot 'index.js'),
    (Join-Path $ignitePluginRoot 'openclaw.plugin.json'),
    (Join-Path $ignitePluginRoot 'index.js')
)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required Stephanos OpenClaw plugin file is missing: $requiredFile"
    }
}

$openclaw = Get-Command openclaw.cmd -ErrorAction SilentlyContinue
if ($null -eq $openclaw) {
    $openclaw = Get-Command openclaw -ErrorAction Stop
}

if ($PSCmdlet.ShouldProcess($pluginId, "Repair linked OpenClaw plugin source to $whatsappPluginRoot")) {
    & $openclaw.Source plugins install --link $whatsappPluginRoot
    if ($LASTEXITCODE -ne 0) { throw "OpenClaw plugin install failed with exit code $LASTEXITCODE" }

    & $openclaw.Source plugins enable $pluginId
    if ($LASTEXITCODE -ne 0) { throw "OpenClaw plugin enable failed with exit code $LASTEXITCODE" }
}

$inspectOutput = @(& $openclaw.Source plugins inspect $pluginId --runtime --json 2>&1)
$inspectExit = $LASTEXITCODE
$statusOutput = @(& $openclaw.Source status 2>&1)
$statusExit = $LASTEXITCODE
$inspectText = ($inspectOutput -join "`n")
$usesRepositorySource = $inspectText -like "*$expectedRepositoryFragment*" -and $inspectText -notlike '*stephan-os-worktrees*'

Write-Output "PLUGIN_ID=$pluginId"
Write-Output "REPOSITORY_ROOT=$repositoryRoot"
Write-Output "WHATSAPP_PLUGIN_ROOT=$whatsappPluginRoot"
Write-Output "IGNITE_PLUGIN_ROOT=$ignitePluginRoot"
Write-Output "REPAIR_SCRIPT_PATH=$repairScriptPath"
Write-Output "WHATSAPP_PLUGIN_EXISTS=$((Test-Path -LiteralPath $whatsappPluginRoot -PathType Container))"
Write-Output "IGNITE_PLUGIN_EXISTS=$((Test-Path -LiteralPath $ignitePluginRoot -PathType Container))"
Write-Output "REPAIR_SCRIPT_EXISTS=$((Test-Path -LiteralPath $repairScriptPath -PathType Leaf))"
Write-Output "PLUGIN_INSPECT_EXIT=$inspectExit"
Write-Output 'PLUGIN_INSPECT_BEGIN'
$inspectOutput
Write-Output 'PLUGIN_INSPECT_END'
Write-Output "OPENCLAW_STATUS_EXIT=$statusExit"
Write-Output 'OPENCLAW_STATUS_BEGIN'
$statusOutput
Write-Output 'OPENCLAW_STATUS_END'
Write-Output "RUNTIME_SOURCE_UNDER_DOCUMENTS_REPO=$usesRepositorySource"

if ($inspectExit -ne 0 -or $statusExit -ne 0 -or -not $usesRepositorySource) {
    Write-Output 'FINAL_VERDICT=OPENCLAW_STEPHANOS_WHATSAPP_COMMAND_REPAIR_BLOCKED'
    exit 1
}

Write-Output 'FINAL_VERDICT=OPENCLAW_STEPHANOS_WHATSAPP_COMMAND_REPAIR_PASS'
