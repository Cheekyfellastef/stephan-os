[CmdletBinding()]
param(
    [string]$RepositoryRoot = "",
    [string]$SharedWorkspace = "",
    [switch]$SkipCodexMcpRegistration
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
    Write-Host "[GOAL COCKPIT INSTALL] $Message" -ForegroundColor Cyan
}

function ConvertTo-JsonPlaceholder([string]$Value) {
    $encoded = ConvertTo-Json -InputObject $Value -Compress
    return $encoded.Substring(1, $encoded.Length - 2)
}

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

$pluginSource = Join-Path $RepositoryRoot "plugins\stephanos-goal-cockpit"
$sourceMcpServerPath = Join-Path $pluginSource "scripts\goal-cockpit-mcp.mjs"
$sourceUiPath = Join-Path $pluginSource "assets\goal-cockpit.html"
$templatePath = Join-Path $pluginSource ".mcp.json.template"
$manifestSourcePath = Join-Path $pluginSource ".codex-plugin\plugin.json"
$installRoot = Join-Path $env:USERPROFILE ".codex\plugins\stephanos-goal-cockpit"
$installedMcpServerPath = Join-Path $installRoot "scripts\goal-cockpit-mcp.mjs"
$installedUiPath = Join-Path $installRoot "assets\goal-cockpit.html"
$installedMcpPath = Join-Path $installRoot ".mcp.json"
$proofRoot = Join-Path $SharedWorkspace "goal-cockpit"
$proofPath = Join-Path $proofRoot "install-proof.json"

foreach ($required in @($pluginSource, $sourceMcpServerPath, $sourceUiPath, $templatePath, $manifestSourcePath)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Required Goal Cockpit source is missing: $required"
    }
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    throw "Node.js is required but node was not found on PATH."
}

Write-Step "Installing read-only plugin files to $installRoot"
New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
Get-ChildItem -LiteralPath $installRoot -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath $pluginSource -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $installRoot -Recurse -Force
}

$template = Get-Content -LiteralPath $templatePath -Raw
$config = $template.Replace("__MCP_SERVER_PATH__", (ConvertTo-JsonPlaceholder $installedMcpServerPath))
$config = $config.Replace("__REPO_ROOT__", (ConvertTo-JsonPlaceholder $RepositoryRoot))
$config = $config.Replace("__WORKSPACE_ROOT__", (ConvertTo-JsonPlaceholder $SharedWorkspace))
try {
    $null = ConvertFrom-Json -InputObject $config
}
catch {
    throw "Materialized Goal Cockpit MCP configuration is not valid JSON: $($_.Exception.Message)"
}
$config | Set-Content -LiteralPath $installedMcpPath -Encoding UTF8

$registration = "skipped"
$registrationOutput = @()
$codex = Get-Command codex -ErrorAction SilentlyContinue
if (-not $SkipCodexMcpRegistration) {
    if (-not $codex) {
        $registration = "blocked-codex-command-missing"
    }
    else {
        Write-Step "Registering the read-only MCP server with the local Codex client"
        try {
            $existing = @(& codex mcp list 2>&1)
            if (($existing -join "`n") -match "stephanos-goal-cockpit") {
                $registrationOutput += @(& codex mcp remove stephanos-goal-cockpit 2>&1)
                if ($LASTEXITCODE -ne 0) {
                    throw "Unable to remove the previous Goal Cockpit MCP registration."
                }
            }
            $registrationOutput += @(
                & codex mcp add stephanos-goal-cockpit -- node $installedMcpServerPath --repo-root $RepositoryRoot --workspace-root $SharedWorkspace 2>&1
            )
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
    schemaVersion = "stephanos.goal-cockpit-install-proof.v1"
    writtenAt = (Get-Date).ToUniversalTime().ToString("o")
    repositoryRoot = $RepositoryRoot
    sharedWorkspace = $SharedWorkspace
    pluginInstallRoot = $installRoot
    pluginManifestPresent = Test-Path -LiteralPath (Join-Path $installRoot ".codex-plugin\plugin.json")
    mcpConfigPresent = Test-Path -LiteralPath $installedMcpPath
    mcpServerPresent = Test-Path -LiteralPath $installedMcpServerPath
    uiResourcePresent = Test-Path -LiteralPath $installedUiPath
    nodeCommand = $node.Source
    codexCommandPresent = [bool]$codex
    codexMcpRegistration = $registration
    codexMcpRegistrationOutput = @($registrationOutput | ForEach-Object { [string]$_ })
    readOnlyPlugin = $true
    secureMcpTunnelRequiredForChatGPTCrossDevice = $true
    secureMcpTunnelVerified = $false
    chatgptDeveloperModeConnectionVerified = $false
    compatibleChatToolProof = "not-run"
    finalVerdict = if ($registration -eq "registered" -or $SkipCodexMcpRegistration) {
        "STEPHANOS_GOAL_COCKPIT_LOCAL_FILES_PREPARED"
    }
    else {
        "STEPHANOS_GOAL_COCKPIT_LOCAL_FILES_INSTALLED_REGISTRATION_PENDING"
    }
}
$proof | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $proofPath -Encoding UTF8

Write-Host ""
Write-Host "STEPHANOS_GOAL_COCKPIT_PLUGIN_FILES_INSTALLED" -ForegroundColor Green
Write-Host "PLUGIN_ROOT=$installRoot"
Write-Host "CODEX_MCP_REGISTRATION=$registration"
Write-Host "INSTALL_PROOF=$proofPath"
Write-Host "CHATGPT_CROSS_DEVICE_CONNECTION=not-verified" -ForegroundColor Yellow
Write-Host ""
Write-Host "Open a new Codex chat to verify local tools. Phone, iPad, and ChatGPT access require a separately verified secure MCP connection; this installer does not claim that proof." -ForegroundColor Yellow

if ($registration -eq "registration-failed") {
    exit 2
}
