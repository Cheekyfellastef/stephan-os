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

function Invoke-OpenClawAllowNotInstalled {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $output = @(& $openclaw.Source @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
    return [pscustomobject]@{ ExitCode = $exitCode; Output = $output }
}

function Get-JsonStringValues {
    param([AllowNull()]$Value)

    $values = New-Object System.Collections.Generic.List[string]
    if ($null -eq $Value) { return $values }
    if ($Value -is [string]) {
        $values.Add($Value)
        return $values
    }
    if ($Value -is [System.Collections.IDictionary]) {
        foreach ($key in $Value.Keys) {
            foreach ($child in (Get-JsonStringValues $Value[$key])) { $values.Add($child) }
        }
        return $values
    }
    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
        foreach ($item in $Value) {
            foreach ($child in (Get-JsonStringValues $item)) { $values.Add($child) }
        }
        return $values
    }
    $properties = $Value.PSObject.Properties
    foreach ($property in $properties) {
        foreach ($child in (Get-JsonStringValues $property.Value)) { $values.Add($child) }
    }
    return $values
}

function Test-RuntimeEntryMatchesCanonicalPath {
    param([Parameter(Mandatory = $true)][string[]]$InspectOutput)

    $jsonText = ($InspectOutput -join [Environment]::NewLine).Trim()
    if ([string]::IsNullOrWhiteSpace($jsonText)) { return $false }
    try {
        $document = $jsonText | ConvertFrom-Json -Depth 64
    } catch {
        return $false
    }

    $expected = ([System.IO.Path]::GetFullPath($entryPath)).ToLowerInvariant()
    foreach ($value in (Get-JsonStringValues $document)) {
        $candidateText = [string]$value
        if (-not $candidateText) { continue }
        try {
            $candidate = ([System.IO.Path]::GetFullPath($candidateText)).ToLowerInvariant()
        } catch {
            continue
        }
        if ($candidate -eq $expected) { return $true }
    }
    return $false
}

Write-Output 'CANONICAL_PRECEDENCE=OpenClaw runtime plugin registry/installation database wins over repo .openclaw/openclaw.json and install.sourcePath; repair must remove the stale installed plugin record, then link the canonical main-repo plugin root.'
Write-Output "PLUGIN_ID=$pluginId"
Write-Output "CANONICAL_PLUGIN_ROOT=$pluginRoot"
Write-Output "CANONICAL_ENTRY=$entryPath"

if ($PSCmdlet.ShouldProcess($pluginId, 'Clear stale OpenClaw registry record, relink canonical plugin, enable it, and restart Gateway')) {
    $before = Invoke-OpenClawAllowNotInstalled @('plugins', 'inspect', $pluginId, '--runtime', '--json')
    Write-Output "BEFORE_INSPECT_EXIT=$($before.ExitCode)"
    Write-Output 'BEFORE_INSPECT_BEGIN'
    $before.Output
    Write-Output 'BEFORE_INSPECT_END'

    $uninstall = Invoke-OpenClawAllowNotInstalled @('plugins', 'uninstall', $pluginId)
    Write-Output "UNINSTALL_EXIT=$($uninstall.ExitCode)"
    if ($uninstall.Output.Count -gt 0) { $uninstall.Output }
    if ($uninstall.ExitCode -ne 0 -and (($uninstall.Output -join "`n") -notmatch '(?i)not\s+installed|not\s+found|unknown\s+plugin')) {
        throw "OpenClaw plugin uninstall failed with exit code $($uninstall.ExitCode)"
    }

    & $openclaw.Source plugins install --link $pluginRoot
    if ($LASTEXITCODE -ne 0) { throw "OpenClaw plugin install failed with exit code $LASTEXITCODE" }

    & $openclaw.Source plugins enable $pluginId
    if ($LASTEXITCODE -ne 0) { throw "OpenClaw plugin enable failed with exit code $LASTEXITCODE" }

    & $openclaw.Source gateway restart
    if ($LASTEXITCODE -ne 0) { throw "OpenClaw Gateway restart failed with exit code $LASTEXITCODE" }

    $after = Invoke-OpenClawAllowNotInstalled @('plugins', 'inspect', $pluginId, '--runtime', '--json')
    Write-Output "AFTER_INSPECT_EXIT=$($after.ExitCode)"
    Write-Output 'AFTER_INSPECT_BEGIN'
    $after.Output
    Write-Output 'AFTER_INSPECT_END'
    if ($after.ExitCode -ne 0) { throw "OpenClaw plugin inspect failed with exit code $($after.ExitCode)" }
    if (-not (Test-RuntimeEntryMatchesCanonicalPath $after.Output)) {
        throw "OpenClaw runtime inspect did not report canonical entry path: $entryPath"
    }
}

Write-Output "MANIFEST_SHA256=$((Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash.ToLowerInvariant())"
Write-Output "ENTRY_SHA256=$((Get-FileHash -Algorithm SHA256 -LiteralPath $entryPath).Hash.ToLowerInvariant())"
Write-Output 'VERIFY_COMMAND=openclaw plugins inspect stephanos-whatsapp-command --runtime --json'
Write-Output 'VERIFY_CHAT_COMMAND=/stephanos-ignite help'
Write-Output 'FINAL_VERDICT=OPENCLAW_STEPHANOS_WHATSAPP_COMMAND_REGISTRY_REPAIRED'
