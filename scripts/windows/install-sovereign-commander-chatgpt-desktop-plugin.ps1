[CmdletBinding()]
param(
    [string]$RepositoryRoot = "",
    [string]$SharedWorkspace = "",
    [switch]$SkipCodexMcpRegistration
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step([string]$Message) {
    Write-Host "[SOVEREIGN COMMANDER DESKTOP] $Message" -ForegroundColor Cyan
}

if (-not $env:USERPROFILE) {
    throw "USERPROFILE is required."
}

if (-not $RepositoryRoot) {
    $RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}
else {
    $RepositoryRoot = (Resolve-Path $RepositoryRoot).Path
}

$canonicalRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE "Documents\GitHub\stephan-os"))
$resolvedRoot = [System.IO.Path]::GetFullPath($RepositoryRoot)
if (-not [string]::Equals($resolvedRoot, $canonicalRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Sovereign Commander desktop plugin installer must use canonical checkout: $canonicalRoot"
}

if (-not $SharedWorkspace) {
    $SharedWorkspace = Join-Path $env:USERPROFILE "Documents\Stephanos-openclaw-workspace"
}

$pluginSource = Join-Path $RepositoryRoot "plugins\sovereign-commander"
$mcpServerPath = Join-Path $RepositoryRoot "scripts\sovereign-commander-mcp.mjs"
$installRoot = Join-Path $env:USERPROFILE ".codex\plugins\sovereign-commander"
$templatePath = Join-Path $pluginSource ".mcp.json.template"
$installedMcpPath = Join-Path $installRoot ".mcp.json"
$proofRoot = Join-Path $SharedWorkspace "sovereign-commander"
$proofPath = Join-Path $proofRoot "desktop-plugin-install-proof.json"

foreach ($required in @(
    $pluginSource,
    $mcpServerPath,
    $templatePath,
    (Join-Path $pluginSource ".codex-plugin\plugin.json"),
    (Join-Path $pluginSource "skills\use-sovereign-commander\SKILL.md")
)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Required Sovereign Commander desktop plugin source is missing: $required"
    }
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    throw "Node.js is required but node was not found on PATH."
}

Write-Step "Installing local plugin files to $installRoot"
New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
Get-ChildItem -LiteralPath $installRoot -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
Copy-Item -Path (Join-Path $pluginSource "*") -Destination $installRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $pluginSource ".codex-plugin") -Destination $installRoot -Recurse -Force

$template = Get-Content -LiteralPath $templatePath -Raw
$escapedServer = $mcpServerPath.Replace("\", "\\")
$escapedRepo = $RepositoryRoot.Replace("\", "\\")
$config = $template.Replace("__MCP_SERVER_PATH__", $escapedServer).Replace("__REPO_ROOT__", $escapedRepo)
$config | Set-Content -LiteralPath $installedMcpPath -Encoding UTF8

$registration = "skipped"
$registrationOutput = @()
$codex = Get-Command codex -ErrorAction SilentlyContinue
if (-not $SkipCodexMcpRegistration) {
    if (-not $codex) {
        $registration = "blocked-codex-command-missing"
    }
    else {
        Write-Step "Registering Sovereign Commander with the local MCP client"
        try {
            $existing = @(& codex mcp list 2>&1)
            if (($existing -join "`n") -match "(?m)^sovereign-commander\b") {
                $registrationOutput += @(& codex mcp remove sovereign-commander 2>&1)
                if ($LASTEXITCODE -ne 0) {
                    throw "Unable to remove the previous Sovereign Commander MCP registration."
                }
            }
            $registrationOutput += @(& codex mcp add sovereign-commander -- node $mcpServerPath 2>&1)
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
    schemaVersion = "stephanos.sovereign-commander-desktop-plugin-install.v1"
    writtenAt = (Get-Date).ToUniversalTime().ToString("o")
    repositoryRoot = $RepositoryRoot
    pluginInstallRoot = $installRoot
    pluginManifestPresent = Test-Path -LiteralPath (Join-Path $installRoot ".codex-plugin\plugin.json")
    skillPresent = Test-Path -LiteralPath (Join-Path $installRoot "skills\use-sovereign-commander\SKILL.md")
    mcpConfigPresent = Test-Path -LiteralPath $installedMcpPath
    mcpServerPresent = Test-Path -LiteralPath $mcpServerPath
    nodeCommand = $node.Source
    codexCommandPresent = [bool]$codex
    codexMcpRegistration = $registration
    codexMcpRegistrationOutput = @($registrationOutput | ForEach-Object { [string]$_ })
    localStdioTransport = $true
    bearerTokenExported = $false
    vendorMeterRequired = $false
    externalSaasRelayRequired = $false
    chatgptDesktopRestartRequired = $true
    chatgptPluginUiInstallRequired = $true
    finalVerdict = if ($registration -eq "registered" -or $SkipCodexMcpRegistration) {
        "SOVEREIGN_COMMANDER_DESKTOP_PLUGIN_PREPARED"
    }
    else {
        "SOVEREIGN_COMMANDER_DESKTOP_PLUGIN_FILES_INSTALLED_REGISTRATION_PENDING"
    }
}
$proof | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $proofPath -Encoding UTF8

Write-Host ""
Write-Host "SOVEREIGN_COMMANDER_DESKTOP_PLUGIN_FILES_INSTALLED" -ForegroundColor Green
Write-Host "PLUGIN_ROOT=$installRoot"
Write-Host "MCP_REGISTRATION=$registration"
Write-Host "INSTALL_PROOF=$proofPath"
Write-Host "CHATGPT_DESKTOP_RESTART_REQUIRED=yes" -ForegroundColor Yellow
Write-Host "CHATGPT_PLUGIN_UI_INSTALL_REQUIRED=yes" -ForegroundColor Yellow

if ($registration -eq "registration-failed") {
    exit 2
}
