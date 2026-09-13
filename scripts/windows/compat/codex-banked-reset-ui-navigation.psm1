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
#
# When the current ChatGPT UI has moved the usage route entirely, retain a
# bounded set of safe navigation labels in the blocked result. This is
# diagnostic evidence only: it never invokes Settings, Plan, Account or any
# other newly observed control. The next source repair can therefore adapt to
# UI drift without generic browser automation, credential access or guessing.
& $script:BaseNavigationModule {
    $script:CodexPopupFallbackUsed = $false
    $script:CodexSafeNavigationDiagnosticsUsed = $false
    $script:OriginalSelectCodexLabeledUsageControl = ${function:Select-CodexLabeledUsageControl}

    function script:Get-CodexSafeNavigationCandidates {
        param([array]$Snapshot)

        $allowed = '(?i)settings|preferences|usage|limit|reset|plan|subscription|account|manage|help|about'
        $forbidden = '(?i)billing|security|privacy|upgrade|purchase|buy credits|add credits|auto.?top.?up|sign out|log out|password|credential|token|session'
        $email = '(?i)\b[^\s@]+@[^\s@]+\.[^\s@]+\b'
        $seen = @{}
        $candidates = @()
        foreach ($item in @($Snapshot)) {
            if (-not $item.Enabled -or $item.Offscreen) { continue }
            if ($item.Type -notmatch 'ControlType\.(Button|MenuItem|Hyperlink|ListItem|Custom|Group)') { continue }
            $name = Convert-ToCodexSafeText $item.Name 120
            $automationId = Convert-ToCodexSafeText $item.AutomationId 120
            if (-not $name -or $name -match $forbidden -or $name -match $email -or $name -notmatch $allowed) { continue }
            if ($automationId -match $forbidden -or $automationId -match $email) { continue }
            if ($seen.ContainsKey($name)) { continue }
            $seen[$name] = $true
            $candidates += $item
            if ($candidates.Count -ge 12) { break }
        }
        Write-Output -NoEnumerate @($candidates)
    }

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

    function script:Select-CodexLabeledUsageControl {
        param(
            [array]$Snapshot,
            [System.Windows.Automation.AutomationElement]$WindowElement
        )

        $result = & $script:OriginalSelectCodexLabeledUsageControl -Snapshot $Snapshot -WindowElement $WindowElement
        if ($null -ne $result -and -not $result.Ok -and $result.Blocker -eq 'NOT_FOUND') {
            $diagnosticCandidates = Get-CodexSafeNavigationCandidates -Snapshot $Snapshot
            if (@($diagnosticCandidates).Count -gt 0) {
                $script:CodexSafeNavigationDiagnosticsUsed = $true
                return [pscustomobject]@{
                    Ok = $false
                    Blocker = 'NOT_FOUND'
                    Candidates = @($diagnosticCandidates)
                    LabelCandidates = @()
                    Selected = $null
                    MatchedLabel = ''
                    Resolution = 'safe-navigation-diagnostics-only'
                }
            }
        }
        return $result
    }
}

function Open-CodexUsagePanel {
    [CmdletBinding()]
    param()

    & $script:BaseNavigationModule {
        $script:CodexPopupFallbackUsed = $false
        $script:CodexSafeNavigationDiagnosticsUsed = $false
    }
    $result = & $script:BaseNavigationModule {
        Open-CodexUsagePanel
    }
    $fallbackUsed = & $script:BaseNavigationModule {
        [bool]$script:CodexPopupFallbackUsed
    }
    $diagnosticsUsed = & $script:BaseNavigationModule {
        [bool]$script:CodexSafeNavigationDiagnosticsUsed
    }

    if (($fallbackUsed -or $diagnosticsUsed) -and $null -ne $result) {
        $proofRefs = @()
        $proofProperty = $result.PSObject.Properties['proofRefs']
        if ($null -ne $proofProperty) {
            $proofRefs = @($proofProperty.Value)
        }
        $updatedProofRefs = @($proofRefs)
        if ($fallbackUsed) {
            $updatedProofRefs += 'profile-popup-same-process-usage-fallback'
        }
        if ($diagnosticsUsed) {
            $updatedProofRefs += 'safe-menu-navigation-candidates-captured'
        }
        $result | Add-Member -NotePropertyName proofRefs -NotePropertyValue @($updatedProofRefs | Select-Object -Unique) -Force
    }

    return $result
}

Export-ModuleMember -Function Open-CodexUsagePanel
