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
if (-not $SharedWorkspace) {
    $SharedWorkspace = Join-Path $env:USERPROFILE "Documents\Stephanos-openclaw-workspace"
}

$installRoot = Join-Path $env:USERPROFILE ".codex\plugins\stephanos-codex-dispatch"
$manifestPath = Join-Path $installRoot ".codex-plugin\plugin.json"
$mcpConfigPath = Join-Path $installRoot ".mcp.json"
$mcpServerPath = Join-Path $RepositoryRoot "scripts\stephanos-codex-dispatch-mcp.mjs"
$workerPath = Join-Path $RepositoryRoot "scripts\stephanos-codex-dispatch-worker.mjs"
$proofPath = Join-Path $SharedWorkspace "codex-dispatch\install-proof.json"

$codex = Get-Command codex -ErrorAction SilentlyContinue
$mcpRegistered = $false
$mcpList = @()
if ($codex) {
    try {
        $mcpList = @(& codex mcp list 2>&1)
        $mcpRegistered = (($mcpList -join "`n") -match "stephanos-codex-dispatch")
    }
    catch {}
}

$status = [ordered]@{
    schemaVersion = "stephanos.codex-dispatch-install-status.v1"
    checkedAt = (Get-Date).ToUniversalTime().ToString("o")
    repositoryRoot = $RepositoryRoot
    pluginInstallRoot = $installRoot
    pluginManifestPresent = Test-Path -LiteralPath $manifestPath
    mcpConfigPresent = Test-Path -LiteralPath $mcpConfigPath
    mcpServerPresent = Test-Path -LiteralPath $mcpServerPath
    workerPresent = Test-Path -LiteralPath $workerPath
    installProofPresent = Test-Path -LiteralPath $proofPath
    nodePresent = [bool](Get-Command node -ErrorAction SilentlyContinue)
    codexPresent = [bool]$codex
    codexMcpRegistered = $mcpRegistered
    chatgptPluginToolProof = "requires-new-compatible-chat-tools-list"
    readyForCodexCliDispatch = (
        (Test-Path -LiteralPath $manifestPath) -and
        (Test-Path -LiteralPath $mcpConfigPath) -and
        (Test-Path -LiteralPath $mcpServerPath) -and
        (Test-Path -LiteralPath $workerPath) -and
        [bool]$codex -and
        $mcpRegistered
    )
    finalVerdict = ""
}
$status.finalVerdict = if ($status.readyForCodexCliDispatch) {
    "STEPHANOS_CODEX_DISPATCH_BRIDGE_LOCAL_READY"
}
elseif (-not $status.codexPresent) {
    "BLOCKED_CODEX_COMMAND_MISSING"
}
elseif (-not $status.codexMcpRegistered) {
    "BLOCKED_CODEX_MCP_NOT_REGISTERED"
}
else {
    "BLOCKED_PLUGIN_FILES_INCOMPLETE"
}

$status | ConvertTo-Json -Depth 8
if (-not $status.readyForCodexCliDispatch) { exit 1 }
