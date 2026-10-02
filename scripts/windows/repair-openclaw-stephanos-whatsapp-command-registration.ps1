[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$StephanosRepositoryRoot = "$env:USERPROFILE\Documents\GitHub\stephan-os",
    [string]$OpenClawConfigPath = "$env:USERPROFILE\.openclaw\openclaw.json",
    [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
$pluginId = 'stephanos-whatsapp-command'
$repositoryRoot = [System.IO.Path]::GetFullPath($StephanosRepositoryRoot)
$pluginRoot = Join-Path $repositoryRoot 'integrations\openclaw\stephanos-whatsapp-command'
$manifestPath = Join-Path $pluginRoot 'openclaw.plugin.json'
$entryPath = Join-Path $pluginRoot 'index.js'
$configPath = [System.IO.Path]::GetFullPath($OpenClawConfigPath)

foreach ($requiredFile in @($manifestPath, $entryPath, $configPath)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required file is missing: $requiredFile"
    }
}

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$original = [System.IO.File]::ReadAllText($configPath, $utf8NoBom)
$updated = $original
# Replace only string values that already point at this plugin registration. This avoids the
# OpenClaw CLI full-config rewrite path and leaves every unrelated byte in
# openclaw.json intact.
$pluginPathPattern = '(?i)([A-Z]:)?[\\/][^"\r\n]*?[\\/]integrations[\\/]openclaw[\\/]stephanos-whatsapp-command(?:[\\/](?:index\.js|openclaw\.plugin\.json))?'
$updated = [System.Text.RegularExpressions.Regex]::Replace($updated, $pluginPathPattern, {
    param($match)
    $value = $match.Value
    $replacement = $pluginRoot
    if ($value -match '(?i)[\\/]index\.js$') { $replacement = $entryPath }
    if ($value -match '(?i)[\\/]openclaw\.plugin\.json$') { $replacement = $manifestPath }
    if ($value.Contains('\\')) { return $replacement.Replace('\', '\\') }
    return $replacement
})

$changed = -not [string]::Equals($original, $updated, [System.StringComparison]::Ordinal)
if ($changed) {
    $beforeLength = $original.Length
    $afterLength = $updated.Length
    $delta = $afterLength - $beforeLength
    if ($PSCmdlet.ShouldProcess($configPath, "Surgically repair $pluginId path strings without invoking OpenClaw config rewrite")) {
        [System.IO.File]::WriteAllText($configPath, $updated, $utf8NoBom)
    }
    Write-Output "CONFIG_CHANGED=True"
    Write-Output "CONFIG_LENGTH_BEFORE=$beforeLength"
    Write-Output "CONFIG_LENGTH_AFTER=$afterLength"
    Write-Output "CONFIG_LENGTH_DELTA=$delta"
} else {
    Write-Output "CONFIG_CHANGED=False"
}

Write-Output "PLUGIN_ID=$pluginId"
Write-Output "CONFIG_PATH=$configPath"
Write-Output "RUNTIME_SOURCE=$entryPath"
Write-Output "MANIFEST_SOURCE=$manifestPath"
Write-Output "PLUGIN_ROOT=$pluginRoot"
Write-Output 'REPAIR_MODE=surgical_text_patch_no_openclaw_config_rewrite'

if (-not $NoRestart) {
    $openclaw = Get-Command openclaw.cmd -ErrorAction SilentlyContinue
    if ($null -eq $openclaw) { $openclaw = Get-Command openclaw -ErrorAction Stop }
    if ($PSCmdlet.ShouldProcess('OpenClaw Gateway', 'Restart after surgical Stephanos registration repair')) {
        & $openclaw.Source gateway restart
        if ($LASTEXITCODE -ne 0) { throw "OpenClaw Gateway restart failed with exit code $LASTEXITCODE" }
    }
}

Write-Output 'COMMAND=/stephanos <message>'
Write-Output 'COMMAND=/stephanos-ignite help'
Write-Output 'FINAL_VERDICT=OPENCLAW_STEPHANOS_WHATSAPP_COMMAND_REGISTRATION_REPAIRED'
