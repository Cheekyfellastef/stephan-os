Set-StrictMode -Version Latest

$baseModulePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'codex-banked-reset-ui-navigation.psm1'
if (-not (Test-Path -LiteralPath $baseModulePath -PathType Leaf)) {
    throw 'Base Codex UI navigation module is missing.'
}

$script:BaseNavigationModule = Import-Module $baseModulePath -Force -PassThru -ErrorAction Stop

# PowerShell unwraps a one-item function result into a scalar. Under StrictMode,
# the base navigation module's later `.Count` check then throws. Replace only
# the internal snapshot-delta helper in the base module's persistent script
# scope and emit its result as one array object.
#
# WebView2 can also expose profile-menu items before and after invocation with
# identical runtime IDs, so there may be no newly-visible delta even though the
# profile menu is open. In that case, fall back only to visible same-process
# items whose accessible text identifies the bounded usage/reset route. The
# base selector still requires one unambiguous invocable candidate and the
# usage panel still needs structural proof before any reset path can continue.
& $script:BaseNavigationModule {
    $script:CodexPopupFallbackUsed = $false

    function script:Get-CodexNewlyVisibleSnapshot {
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

        if ($newlyVisible.Count -eq 0) {
            $forbidden = '(?i)billing|security|privacy|upgrade|purchase|buy credits|add credits|auto.?top.?up'
            $usageLabel = '(?i)\b\d+\s+(banked\s+)?reset(s)?\s+available\b|banked reset|rate.?limit reset|reset(s)?\s+available|usage summary|usage dashboard|codex usage|\busage\b'
            $fallback = @($After | Where-Object {
                $_.Enabled -and -not $_.Offscreen -and
                $_.Name -notmatch $forbidden -and
                $_.AutomationId -notmatch $forbidden -and
                (
                    $_.Name -match $usageLabel -or
                    $_.AutomationId -match '(?i)usage|limit|reset'
                )
            })
            if ($fallback.Count -gt 0) {
                $script:CodexPopupFallbackUsed = $true
                $newlyVisible = $fallback
            }
        }

        Write-Output -NoEnumerate @($newlyVisible)
    }
}

function Open-CodexUsagePanel {
    [CmdletBinding()]
    param(
        [switch]$AllowReadOnlyEdgeAnalytics
    )

    & $script:BaseNavigationModule {
        $script:CodexPopupFallbackUsed = $false
    }
    $result = & $script:BaseNavigationModule {
        param([bool]$AllowEdgeAnalytics)
        Open-CodexUsagePanel -AllowReadOnlyEdgeAnalytics:$AllowEdgeAnalytics
    } $AllowReadOnlyEdgeAnalytics.IsPresent
    $fallbackUsed = & $script:BaseNavigationModule {
        [bool]$script:CodexPopupFallbackUsed
    }

    if ($fallbackUsed -and $null -ne $result) {
        $proofRefs = @()
        $proofProperty = $result.PSObject.Properties['proofRefs']
        if ($null -ne $proofProperty) {
            $proofRefs = @($proofProperty.Value)
        }
        $updatedProofRefs = @($proofRefs) + @('profile-popup-same-process-usage-fallback')
        $result | Add-Member -NotePropertyName proofRefs -NotePropertyValue @($updatedProofRefs | Select-Object -Unique) -Force
    }

    return $result
}

Export-ModuleMember -Function Open-CodexUsagePanel
