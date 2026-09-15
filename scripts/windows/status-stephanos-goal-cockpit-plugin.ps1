[CmdletBinding()]
param(
    [string]$RepositoryRoot = "",
    [string]$SharedWorkspace = ""
)

$ErrorActionPreference = "Stop"

if (-not $RepositoryRoot) {
    $RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}
else {
    $RepositoryRoot = (Resolve-Path $RepositoryRoot).Path
}
if (-not $env:USERPROFILE) {
    throw "USERPROFILE is required to select the local Codex plugin directory."
}
if (-not $SharedWorkspace) {
    $SharedWorkspace = Join-Path $env:USERPROFILE "Documents\Stephanos-openclaw-workspace"
}
$SharedWorkspace = [System.IO.Path]::GetFullPath($SharedWorkspace)

$installRoot = Join-Path $env:USERPROFILE ".codex\plugins\stephanos-goal-cockpit"
$manifestPath = Join-Path $installRoot ".codex-plugin\plugin.json"
$mcpConfigPath = Join-Path $installRoot ".mcp.json"
$installedMcpServerPath = Join-Path $installRoot "scripts\goal-cockpit-mcp.mjs"
$installedUiPath = Join-Path $installRoot "assets\goal-cockpit.html"
$projectionServicePath = Join-Path $RepositoryRoot "stephanos-server\services\goalCockpitChatService.js"
$proofPath = Join-Path $SharedWorkspace "goal-cockpit\install-proof.json"

$configValid = $false
$configTargetsInstalledServer = $false
$configBindsRepository = $false
$configBindsWorkspace = $false
$configError = ""
if (Test-Path -LiteralPath $mcpConfigPath) {
    try {
        $config = Get-Content -LiteralPath $mcpConfigPath -Raw | ConvertFrom-Json
        $serverProperty = $config.mcpServers.PSObject.Properties["stephanos-goal-cockpit"]
        if (-not $serverProperty) {
            throw "The stephanos-goal-cockpit server entry is missing."
        }
        $serverConfig = $serverProperty.Value
        $configArgs = @($serverConfig.args | ForEach-Object { [string]$_ })
        $configValid = ([string]$serverConfig.command -eq "node")
        if ($configArgs.Count -gt 0) {
            $configTargetsInstalledServer = ($configArgs[0] -eq $installedMcpServerPath)
        }
        for ($index = 0; $index -lt ($configArgs.Count - 1); $index += 1) {
            if ($configArgs[$index] -eq "--repo-root" -and $configArgs[$index + 1] -eq $RepositoryRoot) {
                $configBindsRepository = $true
            }
            if ($configArgs[$index] -eq "--workspace-root" -and $configArgs[$index + 1] -eq $SharedWorkspace) {
                $configBindsWorkspace = $true
            }
        }
    }
    catch {
        $configError = $_.Exception.Message
    }
}

$codex = Get-Command codex -ErrorAction SilentlyContinue
$mcpRegistered = $false
$mcpList = @()
if ($codex) {
    try {
        $mcpList = @(& codex mcp list 2>&1)
        $mcpRegistered = (($mcpList -join "`n") -match "stephanos-goal-cockpit")
    }
    catch {}
}

$status = [ordered]@{
    schemaVersion = "stephanos.goal-cockpit-install-status.v1"
    checkedAt = (Get-Date).ToUniversalTime().ToString("o")
    repositoryRoot = $RepositoryRoot
    sharedWorkspace = $SharedWorkspace
    pluginInstallRoot = $installRoot
    pluginManifestPresent = Test-Path -LiteralPath $manifestPath
    mcpConfigPresent = Test-Path -LiteralPath $mcpConfigPath
    mcpConfigValid = $configValid
    mcpConfigTargetsInstalledServer = $configTargetsInstalledServer
    mcpConfigBindsRepository = $configBindsRepository
    mcpConfigBindsWorkspace = $configBindsWorkspace
    mcpConfigError = $configError
    mcpServerPresent = Test-Path -LiteralPath $installedMcpServerPath
    uiResourcePresent = Test-Path -LiteralPath $installedUiPath
    projectionServicePresent = Test-Path -LiteralPath $projectionServicePath
    installProofPresent = Test-Path -LiteralPath $proofPath
    nodePresent = [bool](Get-Command node -ErrorAction SilentlyContinue)
    codexPresent = [bool]$codex
    codexMcpRegistered = $mcpRegistered
    readOnlyPlugin = $true
    secureMcpTunnelRequiredForChatGPTCrossDevice = $true
    chatgptCrossDeviceToolProof = "requires-separate-secure-connection-and-compatible-chat"
    readyForLocalCodexCockpit = $false
    finalVerdict = ""
}
$status.readyForLocalCodexCockpit = (
    $status.pluginManifestPresent -and
    $status.mcpConfigPresent -and
    $status.mcpConfigValid -and
    $status.mcpConfigTargetsInstalledServer -and
    $status.mcpConfigBindsRepository -and
    $status.mcpConfigBindsWorkspace -and
    $status.mcpServerPresent -and
    $status.uiResourcePresent -and
    $status.projectionServicePresent -and
    $status.nodePresent -and
    $status.codexPresent -and
    $status.codexMcpRegistered
)
$status.finalVerdict = if ($status.readyForLocalCodexCockpit) {
    "STEPHANOS_GOAL_COCKPIT_LOCAL_CODEX_READY"
}
elseif (-not $status.pluginManifestPresent -or -not $status.mcpServerPresent -or -not $status.uiResourcePresent) {
    "BLOCKED_PLUGIN_FILES_INCOMPLETE"
}
elseif (-not $status.mcpConfigValid -or -not $status.mcpConfigTargetsInstalledServer -or -not $status.mcpConfigBindsRepository -or -not $status.mcpConfigBindsWorkspace) {
    "BLOCKED_MCP_CONFIG_INVALID"
}
elseif (-not $status.projectionServicePresent) {
    "BLOCKED_REPOSITORY_PROJECTION_SERVICE_MISSING"
}
elseif (-not $status.nodePresent) {
    "BLOCKED_NODE_COMMAND_MISSING"
}
elseif (-not $status.codexPresent) {
    "BLOCKED_CODEX_COMMAND_MISSING"
}
elseif (-not $status.codexMcpRegistered) {
    "BLOCKED_CODEX_MCP_NOT_REGISTERED"
}
else {
    "BLOCKED_LOCAL_READINESS_UNKNOWN"
}

$status | ConvertTo-Json -Depth 8
if (-not $status.readyForLocalCodexCockpit) { exit 1 }
