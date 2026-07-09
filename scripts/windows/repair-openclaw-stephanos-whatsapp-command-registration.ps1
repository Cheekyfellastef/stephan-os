[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$StephanosRepositoryRoot = "$env:USERPROFILE\Documents\GitHub\stephan-os",
    [string]$OpenClawConfigPath = "$env:USERPROFILE\.openclaw\openclaw.json",
    [double]$MinimumSizeRatio = 0.90,
    [switch]$NoGatewayRestart
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = [System.IO.Path]::GetFullPath($StephanosRepositoryRoot)
$configPath = [System.IO.Path]::GetFullPath($OpenClawConfigPath)
$pluginIds = @('stephanos-whatsapp-command', 'stephanos-ignite-command')
$pluginRoots = @{}

foreach ($pluginId in $pluginIds) {
    $pluginRoot = Join-Path $repositoryRoot (Join-Path 'integrations\openclaw' $pluginId)
    $manifestPath = Join-Path $pluginRoot 'openclaw.plugin.json'
    $entryPath = Join-Path $pluginRoot 'index.js'

    if (-not (Test-Path -LiteralPath $pluginRoot -PathType Container)) {
        throw "Required Stephanos OpenClaw plugin folder is missing: $pluginRoot"
    }

    foreach ($requiredFile in @($manifestPath, $entryPath)) {
        if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
            throw "Required Stephanos OpenClaw plugin file is missing: $requiredFile"
        }
    }

    $pluginRoots[$pluginId] = [ordered]@{
        root = $pluginRoot
        manifest = $manifestPath
        entry = $entryPath
    }
}

if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "OpenClaw config file is missing: $configPath"
}

$originalText = Get-Content -LiteralPath $configPath -Raw
$originalLength = $originalText.Length
$config = $originalText | ConvertFrom-Json -Depth 100

function ConvertTo-OrderedHashtable {
    param([Parameter(ValueFromPipeline = $true)]$Value)

    if ($null -eq $Value) { return $null }

    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string] -and $Value -isnot [System.Management.Automation.PSCustomObject]) {
        $items = @()
        foreach ($item in $Value) { $items += ,(ConvertTo-OrderedHashtable $item) }
        return $items
    }

    if ($Value -is [System.Management.Automation.PSCustomObject]) {
        $table = [ordered]@{}
        foreach ($property in $Value.PSObject.Properties) {
            $table[$property.Name] = ConvertTo-OrderedHashtable $property.Value
        }
        return $table
    }

    return $Value
}

function Set-PluginRegistrationFields {
    param(
        [System.Collections.IDictionary]$PluginEntry,
        [string]$PluginId,
        [System.Collections.IDictionary]$Paths
    )

    $PluginEntry['id'] = $PluginId
    $PluginEntry['enabled'] = $true
    $PluginEntry['source'] = $Paths.root
    $PluginEntry['runtimeSource'] = $Paths.root
    $PluginEntry['path'] = $Paths.root
    $PluginEntry['root'] = $Paths.root
    $PluginEntry['manifest'] = $Paths.manifest
    $PluginEntry['manifestPath'] = $Paths.manifest
    $PluginEntry['entry'] = $Paths.entry
    $PluginEntry['entryPath'] = $Paths.entry
    $PluginEntry['linked'] = $true
}

function Repair-PluginNode {
    param(
        [Parameter(ValueFromPipeline = $true)]$Node,
        [string]$PluginId,
        [System.Collections.IDictionary]$Paths
    )

    $changed = $false

    if ($Node -is [System.Collections.IDictionary]) {
        $nodeText = ($Node | ConvertTo-Json -Depth 50 -Compress)
        $isPluginEntry = $false
        foreach ($key in @('id', 'name', 'pluginId', 'commandId')) {
            if ($Node.Contains($key) -and [string]$Node[$key] -eq $PluginId) { $isPluginEntry = $true }
        }
        if ($nodeText -like "*$PluginId*") { $isPluginEntry = $true }

        if ($isPluginEntry) {
            Set-PluginRegistrationFields -PluginEntry $Node -PluginId $PluginId -Paths $Paths
            $changed = $true
        }

        foreach ($key in @($Node.Keys)) {
            if ([string]$key -eq $PluginId -and $Node[$key] -is [System.Collections.IDictionary]) {
                Set-PluginRegistrationFields -PluginEntry $Node[$key] -PluginId $PluginId -Paths $Paths
                $changed = $true
            } elseif ($Node[$key] -is [System.Collections.IDictionary] -or $Node[$key] -is [array]) {
                if (Repair-PluginNode -Node $Node[$key] -PluginId $PluginId -Paths $Paths) { $changed = $true }
            }
        }
    } elseif ($Node -is [array]) {
        foreach ($item in $Node) {
            if (Repair-PluginNode -Node $item -PluginId $PluginId -Paths $Paths) { $changed = $true }
        }
    }

    return $changed
}

$configTable = ConvertTo-OrderedHashtable $config

if (-not ($configTable -is [System.Collections.IDictionary])) {
    throw 'OpenClaw config root must be a JSON object.'
}

$changedAny = $false
foreach ($pluginId in $pluginIds) {
    $changedPlugin = Repair-PluginNode -Node $configTable -PluginId $pluginId -Paths $pluginRoots[$pluginId]

    if (-not $changedPlugin) {
        if (-not $configTable.Contains('plugins') -or -not ($configTable['plugins'] -is [System.Collections.IDictionary])) {
            $configTable['plugins'] = [ordered]@{}
        }
        $configTable['plugins'][$pluginId] = [ordered]@{}
        Set-PluginRegistrationFields -PluginEntry $configTable['plugins'][$pluginId] -PluginId $pluginId -Paths $pluginRoots[$pluginId]
        $changedPlugin = $true
    }

    $changedAny = $changedAny -or $changedPlugin
}

$updatedText = ($configTable | ConvertTo-Json -Depth 100)
$validated = $updatedText | ConvertFrom-Json -Depth 100
if ($null -eq $validated) { throw 'Updated OpenClaw config failed JSON validation.' }

$minimumLength = [Math]::Floor($originalLength * $MinimumSizeRatio)
if ($updatedText.Length -lt $minimumLength) {
    throw "Refusing to write OpenClaw config because updated size is unexpectedly smaller: $originalLength->$($updatedText.Length)"
}

if ($changedAny -and $PSCmdlet.ShouldProcess($configPath, 'Repair Stephanos plugin registration paths')) {
    $backupPath = "$configPath.stephanos-repair.$(Get-Date -Format 'yyyyMMddHHmmss').bak"
    Copy-Item -LiteralPath $configPath -Destination $backupPath -Force
    Set-Content -LiteralPath $configPath -Value $updatedText -Encoding UTF8
    Write-Output "BACKUP_PATH=$backupPath"
}

Write-Output "OPENCLAW_CONFIG_PATH=$configPath"
Write-Output "OPENCLAW_CONFIG_SIZE_BEFORE=$originalLength"
Write-Output "OPENCLAW_CONFIG_SIZE_AFTER=$($updatedText.Length)"
foreach ($pluginId in $pluginIds) {
    Write-Output "PLUGIN_ID=$pluginId"
    Write-Output "RUNTIME_SOURCE=$($pluginRoots[$pluginId].root)"
}

if (-not $NoGatewayRestart) {
    $openclaw = Get-Command openclaw.cmd -ErrorAction SilentlyContinue
    if ($null -eq $openclaw) { $openclaw = Get-Command openclaw -ErrorAction Stop }

    if ($PSCmdlet.ShouldProcess('OpenClaw Gateway', 'Restart after validated config repair')) {
        & $openclaw.Source gateway restart
        if ($LASTEXITCODE -ne 0) { throw "OpenClaw Gateway restart failed with exit code $LASTEXITCODE" }
        Write-Output 'GATEWAY_RESTARTED=True'
    }
} else {
    Write-Output 'GATEWAY_RESTARTED=False'
}

Write-Output 'FINAL_VERDICT=OPENCLAW_STEPHANOS_COMMAND_REGISTRATION_REPAIRED'
