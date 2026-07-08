[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$StephanosRepositoryRoot = "$env:USERPROFILE\Documents\GitHub\stephan-os"
)

$ErrorActionPreference = 'Stop'
$expectedRepositoryFragment = 'Documents\GitHub\stephan-os'
$pluginIds = @('stephanos-whatsapp-command', 'stephanos-ignite-command')
$repositoryRoot = [System.IO.Path]::GetFullPath($StephanosRepositoryRoot)
$whatsappPluginRoot = Join-Path $repositoryRoot 'integrations\openclaw\stephanos-whatsapp-command'
$ignitePluginRoot = Join-Path $repositoryRoot 'integrations\openclaw\stephanos-ignite-command'
$pluginRoots = @{
  'stephanos-whatsapp-command' = $whatsappPluginRoot
  'stephanos-ignite-command' = $ignitePluginRoot
}
$repairScriptPath = $PSCommandPath

foreach ($requiredPath in $pluginRoots.Values) {
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

foreach ($pluginId in $pluginIds) {
  $pluginRoot = $pluginRoots[$pluginId]
  if ($PSCmdlet.ShouldProcess($pluginId, "Repair linked OpenClaw plugin source to $pluginRoot")) {
    & $openclaw.Source plugins install --link $pluginRoot
    if ($LASTEXITCODE -ne 0) { throw "OpenClaw plugin install failed for $pluginId with exit code $LASTEXITCODE" }
    & $openclaw.Source plugins enable $pluginId
    if ($LASTEXITCODE -ne 0) { throw "OpenClaw plugin enable failed for $pluginId with exit code $LASTEXITCODE" }
  }
}

$inspectResults = @{}
$allRuntimeSourcesUseRepository = $true
foreach ($pluginId in $pluginIds) {
  $inspectOutput = @(& $openclaw.Source plugins inspect $pluginId --runtime --json 2>&1)
  $inspectExit = $LASTEXITCODE
  $inspectText = ($inspectOutput -join "`n")
  $runtimeSource = ''
  try {
    $inspectJson = $inspectText | ConvertFrom-Json -ErrorAction Stop
    $runtimeSource = ''
    if ($null -ne $inspectJson.runtime -and $null -ne $inspectJson.runtime.source) {
      $runtimeSource = [string]$inspectJson.runtime.source
    } elseif ($null -ne $inspectJson.source) {
      $runtimeSource = [string]$inspectJson.source
    } elseif ($null -ne $inspectJson.path) {
      $runtimeSource = [string]$inspectJson.path
    }
  } catch {
    $runtimeSource = $inspectText
  }
  $normalizedRuntimeSource = $runtimeSource -replace '/', '\'
  $usesRepositorySource = $normalizedRuntimeSource -like "*$expectedRepositoryFragment*" -and $normalizedRuntimeSource -notlike '*stephan-os-worktrees*'
  if ($inspectExit -ne 0 -or -not $usesRepositorySource) {
    $allRuntimeSourcesUseRepository = $false
  }
  $inspectResults[$pluginId] = [ordered]@{
    Output = $inspectOutput
    Exit = $inspectExit
    RuntimeSource = $runtimeSource
    UsesRepositorySource = $usesRepositorySource
  }
}

$statusOutput = @(& $openclaw.Source status 2>&1)
$statusExit = $LASTEXITCODE

Write-Output "REPOSITORY_ROOT=$repositoryRoot"
Write-Output "WHATSAPP_PLUGIN_ROOT=$whatsappPluginRoot"
Write-Output "IGNITE_PLUGIN_ROOT=$ignitePluginRoot"
Write-Output "REPAIR_SCRIPT_PATH=$repairScriptPath"
Write-Output "WHATSAPP_PLUGIN_EXISTS=$((Test-Path -LiteralPath $whatsappPluginRoot -PathType Container))"
Write-Output "IGNITE_PLUGIN_EXISTS=$((Test-Path -LiteralPath $ignitePluginRoot -PathType Container))"
Write-Output "REPAIR_SCRIPT_EXISTS=$((Test-Path -LiteralPath $repairScriptPath -PathType Leaf))"
foreach ($pluginId in $pluginIds) {
  $result = $inspectResults[$pluginId]
  Write-Output "PLUGIN_ID=$pluginId"
  Write-Output "PLUGIN_INSPECT_EXIT=$($result.Exit)"
  Write-Output "PLUGIN_RUNTIME_SOURCE=$($result.RuntimeSource)"
  Write-Output "RUNTIME_SOURCE_UNDER_DOCUMENTS_REPO=$($result.UsesRepositorySource)"
  Write-Output 'PLUGIN_INSPECT_BEGIN'
  $result.Output
  Write-Output 'PLUGIN_INSPECT_END'
}
Write-Output "OPENCLAW_STATUS_EXIT=$statusExit"
Write-Output 'OPENCLAW_STATUS_BEGIN'
$statusOutput
Write-Output 'OPENCLAW_STATUS_END'

if ($statusExit -ne 0 -or -not $allRuntimeSourcesUseRepository) {
  Write-Output 'FINAL_VERDICT=OPENCLAW_STEPHANOS_COMMAND_REPAIR_BLOCKED'
  exit 1
}

Write-Output 'FINAL_VERDICT=OPENCLAW_STEPHANOS_COMMAND_REPAIR_PASS'
