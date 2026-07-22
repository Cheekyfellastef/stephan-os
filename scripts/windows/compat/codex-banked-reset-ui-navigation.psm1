Set-StrictMode -Version Latest

$baseModulePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'codex-banked-reset-ui-navigation.psm1'
if (-not (Test-Path -LiteralPath $baseModulePath -PathType Leaf)) {
    throw 'Base Codex UI navigation module is missing.'
}

$script:BaseNavigationModule = Import-Module $baseModulePath -Force -PassThru -ErrorAction Stop

# PowerShell unwraps a one-item function result into a scalar. Under StrictMode,
# the base navigation module's later `.Count` check then throws. Replace only
# the internal snapshot-delta helper and emit its result as one array object.
& $script:BaseNavigationModule {
    function Get-CodexNewlyVisibleSnapshot {
        param(
            [array]$Before,
            [array]$After
        )

        $beforeVisibleKeys = @{}
        foreach ($item in @($Before)) {
            if (-not $item.Enabled -or $item.Offscreen) { continue }
            $key = Get-CodexUiElementKey $item.Element
            if ($key) { $beforeVisibleKeys[$key] = $true }
        }

        $newlyVisible = @()
        foreach ($item in @($After)) {
            if (-not $item.Enabled -or $item.Offscreen) { continue }
            $key = Get-CodexUiElementKey $item.Element
            if ($key -and -not $beforeVisibleKeys.ContainsKey($key)) {
                $newlyVisible += $item
            }
        }

        Write-Output -NoEnumerate @($newlyVisible)
    }
}

function Open-CodexUsagePanel {
    [CmdletBinding()]
    param()

    & $script:BaseNavigationModule {
        Open-CodexUsagePanel
    }
}

Export-ModuleMember -Function Open-CodexUsagePanel
