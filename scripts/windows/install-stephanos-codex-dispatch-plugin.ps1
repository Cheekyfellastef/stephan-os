[CmdletBinding()]
param(
    [string]$RepositoryRoot = "",
    [string]$SharedWorkspace = "",
    [switch]$SkipCodexMcpRegistration
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
    Write-Host "[CODEX DISPATCH INSTALL] $Message" -ForegroundColor Cyan
}

if (-not $RepositoryRoot) {
    $RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}
else {
    $RepositoryRoot = (Resolve-Path $RepositoryRoot).Path
}

if (-not $SharedWorkspace) {
    $SharedWorkspace = Join-Path $env:USERPROFILE "Documents\Stephanos-openclaw-workspace"
}

$pluginSource = Join-Path $RepositoryRoot "plugins\stephanos-codex-dispatch"
$mcpServerPath = Join-Path $RepositoryRoot "scripts\stephanos-codex-dispatch-mcp.mjs"
$workerPath = Join-Path $RepositoryRoot "scripts\stephanos-codex-dispatch-worker.mjs"
$installRoot = Join-Path $env:USERPROFILE ".codex\plugins\stephanos-codex-dispatch"
$templatePath = Join-Path $pluginSource ".mcp.json.template"
$installedMcpPath = Join-Path $installRoot ".mcp.json"
$proofRoot = Join-Path $SharedWorkspace "codex-dispatch"
$proofPath = Join-Path $proofRoot "install-proof.json"

foreach ($required in @($pluginSource, $mcpServerPath, $workerPath, $templatePath)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Required dispatch bridge source is missing: $required"
    }
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    throw "Node.js is required but node was not found on PATH."
}

Write-Step "Installing plugin files to $installRoot"
New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
Get-ChildItem -LiteralPath $installRoot -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
Copy-Item -Path (Join-Path $pluginSource "*") -Destination $installRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $pluginSource ".codex-plugin") -Destination $installRoot -Recurse -Force

$template = Get-Content -LiteralPath $templatePath -Raw
$escapedServer = $mcpServerPath.Replace("\", "\\")
$escapedRepo = $RepositoryRoot.Replace("\", "\\")
$escapedWorkspace = $SharedWorkspace.Replace("\", "\\")
$config = $template.Replace("__MCP_SERVER_PATH__", $escapedServer).Replace("__REPO_ROOT__", $escapedRepo).Replace("__WORKSPACE_ROOT__", $escapedWorkspace)
$config | Set-Content -LiteralPath $installedMcpPath -Encoding UTF8

$registration = "skipped"
$registrationOutput = @()
$codex = Get-Command codex -ErrorAction SilentlyContinue
if (-not $SkipCodexMcpRegistration) {
    if (-not $codex) {
        $registration = "blocked-codex-command-missing"
    }
    else {
        Write-Step "Registering the MCP server with the local Codex client"
        try {
            $existing = @(& codex mcp list 2>&1)
            if (($existing -join "`n") -match "stephanos-codex-dispatch") {
                $registrationOutput += @(& codex mcp remove stephanos-codex-dispatch 2>&1)
                if ($LASTEXITCODE -ne 0) {
                    throw "Unable to remove the previous MCP registration."
                }
            }
            $registrationOutput += @(& codex mcp add stephanos-codex-dispatch -- node $mcpServerPath 2>&1)
            if ($LASTEXITCODE -ne 0) {
                throw "codex mcp add returned exit code $LASTEXITCODE"
            }
            $registration = "registered"
        }
        catch {
            $registration = "registration-failed"
            $registrationOutput += $_.Exception.Message
        }
    }
}

New-Item -ItemType Directory -Force -Path $proofRoot | Out-Null
$proof = [ordered]@{
    schemaVersion = "stephanos.codex-dispatch-install-proof.v1"
    writtenAt = (Get-Date).ToUniversalTime().ToString("o")
    repositoryRoot = $RepositoryRoot
    sharedWorkspace = $SharedWorkspace
    pluginInstallRoot = $installRoot
    pluginManifestPresent = Test-Path -LiteralPath (Join-Path $installRoot ".codex-plugin\plugin.json")
    mcpConfigPresent = Test-Path -LiteralPath $installedMcpPath
    mcpServerPresent = Test-Path -LiteralPath $mcpServerPath
    workerPresent = Test-Path -LiteralPath $workerPath
    nodeCommand = $node.Source
    codexCommandPresent = [bool]$codex
    codexMcpRegistration = $registration
    codexMcpRegistrationOutput = @($registrationOutput | ForEach-Object { [string]$_ })
    chatgptDesktopRestartRequired = $true
    chatgptPluginUiInstallRequired = $true
    finalVerdict = if ($registration -eq "registered" -or $SkipCodexMcpRegistration) { "STEPHANOS_CODEX_DISPATCH_BRIDGE_PREPARED" } else { "STEPHANOS_CODEX_DISPATCH_BRIDGE_FILES_INSTALLED_REGISTRATION_PENDING" }
}
$proof | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $proofPath -Encoding UTF8

Write-Host ""
Write-Host "STEPHANOS_CODEX_DISPATCH_PLUGIN_FILES_INSTALLED" -ForegroundColor Green
Write-Host "PLUGIN_ROOT=$installRoot"
Write-Host "CODEX_MCP_REGISTRATION=$registration"
Write-Host "INSTALL_PROOF=$proofPath"
Write-Host "CHATGPT_DESKTOP_RESTART_REQUIRED=yes" -ForegroundColor Yellow
Write-Host "CHATGPT_PLUGIN_UI_INSTALL_REQUIRED=yes" -ForegroundColor Yellow
Write-Host ""
Write-Host "After restarting ChatGPT desktop, install the local plugin named 'stephanos-codex-dispatch' from the plugin/developer interface, then open a new compatible chat and verify that dispatch_codex_task is listed." -ForegroundColor Yellow

if ($registration -eq "registration-failed") {
    exit 2
}
