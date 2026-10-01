[CmdletBinding()]
param(
    [string]$StephanosRepositoryRoot = "$env:USERPROFILE\Documents\GitHub\stephan-os"
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

$repositoryRoot = [System.IO.Path]::GetFullPath($StephanosRepositoryRoot)
$plugins = @(
    [pscustomobject]@{
        id = 'stephanos-ignite-command'
        root = Join-Path $repositoryRoot 'integrations\openclaw\stephanos-ignite-command'
        requiredFiles = @('openclaw.plugin.json','package.json','index.js','lib\ignite-status.mjs')
    },
    [pscustomobject]@{
        id = 'stephanos-whatsapp-command'
        root = Join-Path $repositoryRoot 'integrations\openclaw\stephanos-whatsapp-command'
        requiredFiles = @('openclaw.plugin.json','index.js')
    }
)

$openclaw = Get-Command openclaw.cmd -ErrorAction SilentlyContinue
if ($null -eq $openclaw) {
    $openclaw = Get-Command openclaw -ErrorAction Stop
}

function Invoke-OpenClaw {
    param([string[]]$Arguments)
    $output = @(& $openclaw.Source @Arguments 2>&1)
    return [pscustomobject]@{
        exitCode = [int]$LASTEXITCODE
        output = @($output | ForEach-Object { [string]$_ })
    }
}

function Assert-PluginSource {
    param([object]$Plugin)
    foreach ($relativePath in @($Plugin.requiredFiles)) {
        $path = Join-Path $Plugin.root $relativePath
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "OPENCLAW_PLUGIN_SOURCE_MISSING:$($Plugin.id):$relativePath"
        }
    }
}

function Ensure-LinkedPlugin {
    param([object]$Plugin)

    Assert-PluginSource -Plugin $Plugin

    $install = Invoke-OpenClaw -Arguments @('plugins','install','--link',$Plugin.root)
    if ($install.exitCode -ne 0) {
        $existing = Invoke-OpenClaw -Arguments @('plugins','inspect',$Plugin.id,'--runtime','--json')
        if ($existing.exitCode -ne 0) {
            throw "OPENCLAW_PLUGIN_LINK_FAILED:$($Plugin.id)"
        }
    }

    $enable = Invoke-OpenClaw -Arguments @('plugins','enable',$Plugin.id)
    if ($enable.exitCode -ne 0) {
        throw "OPENCLAW_PLUGIN_ENABLE_FAILED:$($Plugin.id)"
    }
}

foreach ($plugin in $plugins) {
    Ensure-LinkedPlugin -Plugin $plugin
}

$restart = Invoke-OpenClaw -Arguments @('gateway','restart')
if ($restart.exitCode -ne 0) {
    throw 'OPENCLAW_GATEWAY_RESTART_FAILED'
}

$pluginProofs = @()
$statusReady = $false
$healthReady = $false
$identityReady = $false
$product = ''
$runtimeIdPresent = $false
$identityStatus = ''
$readinessAttempts = 0

for ($attempt = 1; $attempt -le 20; $attempt++) {
    $readinessAttempts = $attempt
    $pluginProofs = @()
    foreach ($plugin in $plugins) {
        $inspect = Invoke-OpenClaw -Arguments @('plugins','inspect',$plugin.id,'--runtime','--json')
        $pluginProofs += [pscustomobject]@{
            id = $plugin.id
            inspectExit = $inspect.exitCode
            runtimeReady = ($inspect.exitCode -eq 0)
        }
    }

    $status = Invoke-OpenClaw -Arguments @('status','--json')
    $statusReady = $status.exitCode -eq 0

    $healthReady = $false
    $identityReady = $false
    $product = ''
    $runtimeIdPresent = $false
    $identityStatus = ''
    try {
        $healthResponse = Invoke-WebRequest -Uri 'http://127.0.0.1:18789/health' -UseBasicParsing -TimeoutSec 3
        $health = $healthResponse.Content | ConvertFrom-Json
        $healthStateValue = if ($health.status) { $health.status } else { $health.state }
        $healthState = ([string]$healthStateValue).ToLowerInvariant()
        $healthReady = $healthResponse.StatusCode -eq 200 -and ($health.ok -eq $true -or @('ok','live','ready') -contains $healthState)

        $identityResponse = Invoke-WebRequest -Uri 'http://127.0.0.1:18789/identity' -UseBasicParsing -TimeoutSec 3
        $identity = $identityResponse.Content | ConvertFrom-Json
        $product = [string]$identity.product
        $identityStatus = ([string]$identity.status).ToLowerInvariant()
        $runtimeIdPresent = -not [string]::IsNullOrWhiteSpace([string]$identity.runtimeId)
        $identityReady = $identityResponse.StatusCode -eq 200 -and $product -eq 'OpenClaw' -and $runtimeIdPresent -and @('ok','live','ready') -contains $identityStatus
    } catch {
        $healthReady = $false
        $identityReady = $false
    }

    $allPluginsReady = @($pluginProofs | Where-Object { -not $_.runtimeReady }).Count -eq 0
    if ($allPluginsReady -and $statusReady -and $healthReady -and $identityReady) {
        break
    }
    Start-Sleep -Seconds 1
}

$allPluginsReady = @($pluginProofs | Where-Object { -not $_.runtimeReady }).Count -eq 0
$ok = $allPluginsReady -and $statusReady -and $healthReady -and $identityReady

$proof = [ordered]@{
    schemaVersion = 'stephanos.openclaw-full-stack-repair.v1'
    ok = [bool]$ok
    gateway = [ordered]@{
        healthReady = [bool]$healthReady
        identityReady = [bool]$identityReady
        product = $product
        runtimeIdPresent = [bool]$runtimeIdPresent
        status = $identityStatus
    }
    plugins = @($pluginProofs)
    openclawStatusReady = [bool]$statusReady
    readinessAttempts = [int]$readinessAttempts
    arbitraryShellAllowed = $false
    arbitraryPluginIdAllowed = $false
    sourceMutationAllowed = $false
    pcRestartAllowed = $false
    finalVerdict = if ($ok) { 'OPENCLAW_FULL_STACK_REPAIR_GREEN' } else { 'OPENCLAW_FULL_STACK_REPAIR_BLOCKED' }
}

$proof | ConvertTo-Json -Depth 6 -Compress
if (-not $ok) { exit 1 }
