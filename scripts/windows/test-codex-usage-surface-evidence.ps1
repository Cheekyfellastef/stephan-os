$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$modulePath = Join-Path $PSScriptRoot 'codex-usage-surface-evidence.psm1'
Import-Module $modulePath -Force -ErrorAction Stop

function New-TestItem {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [string]$Type = 'ControlType.Text',
        [string]$AutomationId = '',
        [string]$Value = ''
    )

    return [pscustomobject]@{
        Name = $Name
        Type = $Type
        AutomationId = $AutomationId
        Value = $Value
        Enabled = $true
        Offscreen = $false
    }
}

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Actual,
        [Parameter(Mandatory = $true)]
        [object]$Expected,
        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    if ($Actual -ne $Expected) {
        throw "$Label expected '$Expected' but received '$Actual'."
    }
}

function New-EdgeFixture {
    return @(
        New-TestItem 'Address and search bar' 'ControlType.Edit' 'addressEditBox' 'https://chatgpt.com/codex/cloud/settings/analytics#usage'
        New-TestItem 'Codex and Work Analytics'
        New-TestItem 'Weekly usage limit'
        New-TestItem '46%'
        New-TestItem 'remaining'
        New-TestItem 'Usage limit resets Sep 1, 2026 4:03 PM'
        New-TestItem 'Banked reset expires Sep 21, 2026'
        New-TestItem 'Use reset' 'ControlType.Button'
    )
}

$validEdge = Resolve-CodexUsageSurfaceEvidence -Snapshot @(New-EdgeFixture) -ProcessName msedge
Assert-Equal $validEdge.valid $true 'exact Edge Analytics validity'
Assert-Equal $validEdge.surfaceKind 'authenticated-edge-codex-analytics' 'exact Edge Analytics identity'
Assert-Equal $validEdge.meterSummary 'Codex weekly usage limit 46% remaining' 'weekly meter binding'

$wrongOrigin = @(New-EdgeFixture | Where-Object { $_.AutomationId -ne 'addressEditBox' })
$wrongOrigin = @(New-TestItem 'Address and search bar' 'ControlType.Edit' 'addressEditBox' 'https://example.com/codex/cloud/settings/analytics#usage') + $wrongOrigin
$wrongOriginResult = Resolve-CodexUsageSurfaceEvidence -Snapshot $wrongOrigin -ProcessName msedge
Assert-Equal $wrongOriginResult.valid $false 'wrong Edge origin rejection'
Assert-Equal $wrongOriginResult.blocker 'EDGE_CODEX_ANALYTICS_ORIGIN_NOT_UNIQUE' 'wrong Edge origin blocker'

$genericEdge = @(New-EdgeFixture | Where-Object { $_.Name -ne 'Codex and Work Analytics' })
$genericEdge = @(New-TestItem 'Team Work Analytics') + $genericEdge
$genericResult = Resolve-CodexUsageSurfaceEvidence -Snapshot $genericEdge -ProcessName msedge
Assert-Equal $genericResult.valid $false 'generic Edge page rejection'
Assert-Equal $genericResult.blocker 'EDGE_CODEX_ANALYTICS_HEADING_NOT_UNIQUE' 'generic Edge page blocker'

$duplicateWeekly = @(New-EdgeFixture) + @(New-TestItem 'Weekly usage limit')
$duplicateResult = Resolve-CodexUsageSurfaceEvidence -Snapshot $duplicateWeekly -ProcessName msedge
Assert-Equal $duplicateResult.valid $false 'duplicate weekly-card rejection'
Assert-Equal $duplicateResult.blocker 'EDGE_WEEKLY_USAGE_LABEL_NOT_UNIQUE' 'duplicate weekly-card blocker'

$ambiguousPercentage = @(
    New-TestItem 'Address and search bar' 'ControlType.Edit' 'addressEditBox' 'https://chatgpt.com/codex/cloud/settings/analytics#usage'
    New-TestItem 'Codex and Work Analytics'
    New-TestItem 'Weekly usage limit'
    New-TestItem '46%'
    New-TestItem 'remaining'
    New-TestItem '100%'
    New-TestItem 'remaining'
    New-TestItem 'Usage limit resets Sep 1, 2026 4:03 PM'
    New-TestItem 'Banked reset expires Sep 21, 2026'
    New-TestItem 'Use reset' 'ControlType.Button'
)
$ambiguousResult = Resolve-CodexUsageSurfaceEvidence -Snapshot $ambiguousPercentage -ProcessName msedge
Assert-Equal $ambiguousResult.valid $false 'nearby chart percentage rejection'
Assert-Equal $ambiguousResult.blocker 'EDGE_WEEKLY_REMAINING_PERCENTAGE_NOT_UNIQUE' 'nearby chart percentage blocker'

$duplicatePercentage = @(
    New-TestItem 'Address and search bar' 'ControlType.Edit' 'addressEditBox' 'https://chatgpt.com/codex/cloud/settings/analytics#usage'
    New-TestItem 'Codex and Work Analytics'
    New-TestItem 'Weekly usage limit'
    New-TestItem '46% remaining'
    New-TestItem '46% remaining'
    New-TestItem 'Usage limit resets Sep 1, 2026 4:03 PM'
    New-TestItem 'Use reset' 'ControlType.Button'
)
$duplicatePercentageResult = Resolve-CodexUsageSurfaceEvidence -Snapshot $duplicatePercentage -ProcessName msedge
Assert-Equal $duplicatePercentageResult.valid $false 'duplicate percentage-node rejection'
Assert-Equal $duplicatePercentageResult.blocker 'EDGE_WEEKLY_REMAINING_PERCENTAGE_NOT_UNIQUE' 'duplicate percentage-node blocker'

$noDate = @(New-EdgeFixture | Where-Object { $_.Name -notmatch '(?i)expires|resets' }) + @(New-TestItem 'Usage limit resets soon')
$noDateResult = Resolve-CodexUsageSurfaceEvidence -Snapshot $noDate -ProcessName msedge
Assert-Equal $noDateResult.valid $false 'undated reset rejection'
Assert-Equal $noDateResult.blocker 'EDGE_USAGE_RESET_TIME_NOT_FOUND' 'undated reset blocker'

$noAction = @(New-EdgeFixture | Where-Object { $_.Name -ne 'Use reset' }) + @(New-TestItem 'Buy credits' 'ControlType.Button')
$noActionResult = Resolve-CodexUsageSurfaceEvidence -Snapshot $noAction -ProcessName msedge
Assert-Equal $noActionResult.valid $false 'non-reset action rejection'
Assert-Equal $noActionResult.blocker 'EDGE_BANKED_RESET_ACTION_NOT_FOUND' 'non-reset action blocker'

$desktop = @(
    New-TestItem 'Codex weekly usage remaining 46%'
    New-TestItem 'Banked reset expires Sep 21, 2026'
    New-TestItem 'Use reset' 'ControlType.Button'
)
$desktopResult = Resolve-CodexUsageSurfaceEvidence -Snapshot $desktop -ProcessName ChatGPT
Assert-Equal $desktopResult.valid $true 'desktop compatibility'
Assert-Equal $desktopResult.surfaceKind 'authenticated-desktop-codex-usage' 'desktop identity'

$sameProcessWindows = @(
    [pscustomobject]@{ ProcessId = 4401; ProcessName = 'msedge'; Name = 'Codex' }
    [pscustomobject]@{ ProcessId = 4401; ProcessName = 'msedge'; Name = 'Codex Analytics' }
)
$sameProcessResult = @(Select-CodexUniqueProcessCandidates -Candidates $sameProcessWindows)
Assert-Equal $sameProcessResult.Count 1 'same-process window deduplication'
Assert-Equal $sameProcessResult[0].ProcessId 4401 'same-process identity preservation'

$distinctProcessWindows = @(
    [pscustomobject]@{ ProcessId = 4401; ProcessName = 'msedge'; Name = 'Codex Analytics' }
    [pscustomobject]@{ ProcessId = 4402; ProcessName = 'msedge'; Name = 'Codex Analytics' }
)
$distinctProcessResult = @(Select-CodexUniqueProcessCandidates -Candidates $distinctProcessWindows)
Assert-Equal $distinctProcessResult.Count 2 'distinct-process ambiguity preservation'

[Console]::Out.WriteLine('codex-usage-surface-evidence: 10/10 adversarial fixtures passed')
