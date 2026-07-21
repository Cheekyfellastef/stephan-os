Set-StrictMode -Version Latest

function Convert-ToCodexSafeText {
    param([object]$Value, [int]$Limit = 220)
    $text = [string]$Value
    $text = ($text -replace '[\r\n\t]+', ' ' -replace '\s+', ' ').Trim()
    if ($text.Length -gt $Limit) { return $text.Substring(0, $Limit) }
    return $text
}

function New-CodexUiSnapshotItem {
    param(
        [System.Windows.Automation.AutomationElement]$Element,
        [switch]$AllowUnnamed,
        [string]$FallbackName = ''
    )

    try {
        $name = Convert-ToCodexSafeText $Element.Current.Name 220
        $automationId = Convert-ToCodexSafeText $Element.Current.AutomationId 160
        $className = Convert-ToCodexSafeText $Element.Current.ClassName 120
        if (-not $name -and $FallbackName) {
            $name = Convert-ToCodexSafeText $FallbackName 220
        }
        if (-not $name -and -not $automationId -and -not $AllowUnnamed) { return $null }
        $rect = $Element.Current.BoundingRectangle
        return [pscustomobject]@{
            Element = $Element
            Name = $name
            AutomationId = $automationId
            ClassName = $className
            Type = Convert-ToCodexSafeText $Element.Current.ControlType.ProgrammaticName 100
            Enabled = [bool]$Element.Current.IsEnabled
            Offscreen = [bool]$Element.Current.IsOffscreen
            Left = [double]$rect.Left
            Top = [double]$rect.Top
            Right = [double]$rect.Right
            Bottom = [double]$rect.Bottom
        }
    } catch {
        return $null
    }
}

function Get-CodexUiElementKey {
    param([System.Windows.Automation.AutomationElement]$Element)

    try {
        return [string]::Join('.', $Element.GetRuntimeId())
    } catch {
        try {
            $rect = $Element.Current.BoundingRectangle
            return '{0}|{1}|{2}|{3}|{4}|{5}' -f `
                $Element.Current.ProcessId,
                (Convert-ToCodexSafeText $Element.Current.ControlType.ProgrammaticName 100),
                (Convert-ToCodexSafeText $Element.Current.Name 160),
                [Math]::Round([double]$rect.Left, 0),
                [Math]::Round([double]$rect.Top, 0),
                [Math]::Round([double]$rect.Right, 0)
        } catch {
            return ''
        }
    }
}

function Get-CodexUiSnapshot {
    param([System.Windows.Automation.AutomationElement]$Window)

    $trueCondition = [System.Windows.Automation.Condition]::TrueCondition
    $elements = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $trueCondition)
    $items = @()
    foreach ($element in $elements) {
        $item = New-CodexUiSnapshotItem $element
        if ($null -ne $item) { $items += $item }
    }
    return @($items)
}

function Get-CodexProcessSnapshot {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        [int]$ProcessId
    )

    $trueCondition = [System.Windows.Automation.Condition]::TrueCondition
    $surfaces = $Root.FindAll([System.Windows.Automation.TreeScope]::Children, $trueCondition)
    $itemsByKey = @{}
    foreach ($surface in $surfaces) {
        try {
            if ([int]$surface.Current.ProcessId -ne $ProcessId) { continue }
        } catch {
            continue
        }

        $surfaceItem = New-CodexUiSnapshotItem $surface
        if ($null -ne $surfaceItem) {
            $surfaceKey = Get-CodexUiElementKey $surface
            if ($surfaceKey) { $itemsByKey[$surfaceKey] = $surfaceItem }
        }

        foreach ($item in (Get-CodexUiSnapshot $surface)) {
            $key = Get-CodexUiElementKey $item.Element
            if ($key -and -not $itemsByKey.ContainsKey($key)) {
                $itemsByKey[$key] = $item
            }
        }
    }
    return @($itemsByKey.Values)
}

function Test-CodexUiElementInvocable {
    param([System.Windows.Automation.AutomationElement]$Element)

    foreach ($pattern in @(
        [System.Windows.Automation.InvokePattern]::Pattern,
        [System.Windows.Automation.SelectionItemPattern]::Pattern,
        [System.Windows.Automation.ExpandCollapsePattern]::Pattern
    )) {
        $patternObject = $null
        try {
            if ($Element.TryGetCurrentPattern($pattern, [ref]$patternObject)) { return $true }
        } catch {
            continue
        }
    }
    return $false
}

function Test-CodexEligibleInteractiveElement {
    param([System.Windows.Automation.AutomationElement]$Element)

    try {
        if (-not $Element.Current.IsEnabled -or $Element.Current.IsOffscreen) { return $false }
        $type = Convert-ToCodexSafeText $Element.Current.ControlType.ProgrammaticName 100
        if ($type -notmatch 'ControlType\.(Button|MenuItem|Hyperlink|ListItem|Custom|Group)') { return $false }
        return Test-CodexUiElementInvocable $Element
    } catch {
        return $false
    }
}

function Get-CodexInvocableAncestor {
    param(
        [System.Windows.Automation.AutomationElement]$LabelElement,
        [System.Windows.Automation.AutomationElement]$WindowElement,
        [int]$MaximumDepth = 5
    )

    if (Test-CodexEligibleInteractiveElement $LabelElement) {
        return [pscustomobject]@{
            Element = $LabelElement
            Resolution = 'labeled-control'
            Depth = 0
        }
    }

    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    $current = $LabelElement
    for ($depth = 1; $depth -le $MaximumDepth; $depth += 1) {
        try {
            $current = $walker.GetParent($current)
        } catch {
            return $null
        }
        if ($null -eq $current -or $current -eq $WindowElement) { return $null }
        if (Test-CodexEligibleInteractiveElement $current) {
            return [pscustomobject]@{
                Element = $current
                Resolution = 'labeled-ancestor'
                Depth = $depth
            }
        }
    }
    return $null
}

function Invoke-CodexUiElement {
    param([System.Windows.Automation.AutomationElement]$Element)

    $patternObject = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$patternObject)) {
        ([System.Windows.Automation.InvokePattern]$patternObject).Invoke()
        return $true
    }

    $patternObject = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$patternObject)) {
        ([System.Windows.Automation.SelectionItemPattern]$patternObject).Select()
        return $true
    }

    $patternObject = $null
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$patternObject)) {
        $expand = [System.Windows.Automation.ExpandCollapsePattern]$patternObject
        if ($expand.Current.ExpandCollapseState -ne [System.Windows.Automation.ExpandCollapseState]::Expanded) {
            $expand.Expand()
        }
        return $true
    }

    return $false
}

function Select-CodexUiCandidate {
    param(
        [array]$Snapshot,
        [scriptblock]$Filter,
        [scriptblock]$Rank
    )

    $candidates = @($Snapshot | Where-Object {
        $_.Enabled -and -not $_.Offscreen -and (& $Filter $_)
    })
    if ($candidates.Count -eq 0) {
        return [pscustomobject]@{ Ok = $false; Blocker = 'NOT_FOUND'; Candidates = @(); LabelCandidates = @(); Selected = $null; MatchedLabel = ''; Resolution = 'direct-control' }
    }

    $ranked = @($candidates | ForEach-Object {
        [pscustomobject]@{ Item = $_; Rank = [int](& $Rank $_) }
    } | Sort-Object Rank, @{ Expression = { $_.Item.Top } }, @{ Expression = { $_.Item.Left } })

    $bestRank = $ranked[0].Rank
    $best = @($ranked | Where-Object { $_.Rank -eq $bestRank } | ForEach-Object { $_.Item })
    if ($best.Count -ne 1) {
        return [pscustomobject]@{ Ok = $false; Blocker = 'AMBIGUOUS'; Candidates = $best; LabelCandidates = @(); Selected = $null; MatchedLabel = ''; Resolution = 'direct-control' }
    }
    return [pscustomobject]@{ Ok = $true; Blocker = ''; Candidates = $candidates; LabelCandidates = @(); Selected = $best[0]; MatchedLabel = ''; Resolution = 'direct-control' }
}

function Select-CodexLabeledUsageControl {
    param(
        [array]$Snapshot,
        [System.Windows.Automation.AutomationElement]$WindowElement
    )

    $forbidden = '(?i)billing|security|privacy|upgrade|purchase|buy credits|add credits|auto.?top.?up'
    $labels = @($Snapshot | Where-Object {
        $_.Enabled -and -not $_.Offscreen -and
        $_.Name -notmatch $forbidden -and
        (
            $_.Name -match '(?i)\b\d+\s+(banked\s+)?reset(s)?\s+available\b|banked reset|rate.?limit reset|reset(s)?\s+available|usage summary|usage dashboard|codex usage|\busage\b|remaining' -or
            $_.AutomationId -match '(?i)usage|limit|reset'
        )
    })
    if ($labels.Count -eq 0) {
        return [pscustomobject]@{
            Ok = $false
            Blocker = 'NOT_FOUND'
            Candidates = @()
            LabelCandidates = @()
            Selected = $null
            MatchedLabel = ''
            Resolution = ''
        }
    }

    $resolvedByKey = @{}
    foreach ($label in $labels) {
        $resolved = Get-CodexInvocableAncestor -LabelElement $label.Element -WindowElement $WindowElement
        if ($null -eq $resolved) { continue }

        $controlItem = New-CodexUiSnapshotItem -Element $resolved.Element -AllowUnnamed -FallbackName $label.Name
        if ($null -eq $controlItem) { continue }
        $key = Get-CodexUiElementKey $resolved.Element
        if (-not $key) { continue }

        $rank = 4
        if ($label.Name -match '(?i)\b\d+\s+(banked\s+)?reset(s)?\s+available\b|reset(s)?\s+available') { $rank = 0 }
        elseif ($label.Name -match '(?i)banked reset|rate.?limit reset') { $rank = 1 }
        elseif ($label.Name -match '(?i)codex usage|usage summary|usage dashboard') { $rank = 2 }
        elseif ($label.AutomationId -match '(?i)usage|limit|reset') { $rank = 3 }

        if (-not $resolvedByKey.ContainsKey($key) -or $rank -lt $resolvedByKey[$key].Rank) {
            $resolvedByKey[$key] = [pscustomobject]@{
                Item = $controlItem
                Label = $label
                Rank = $rank
                Resolution = $resolved.Resolution
                Depth = $resolved.Depth
            }
        }
    }

    $ranked = @($resolvedByKey.Values | Sort-Object Rank, @{ Expression = { $_.Item.Top } }, @{ Expression = { $_.Item.Left } })
    if ($ranked.Count -eq 0) {
        return [pscustomobject]@{
            Ok = $false
            Blocker = 'LABEL_NOT_INVOCABLE'
            Candidates = @()
            LabelCandidates = $labels
            Selected = $null
            MatchedLabel = ''
            Resolution = ''
        }
    }

    $bestRank = $ranked[0].Rank
    $best = @($ranked | Where-Object { $_.Rank -eq $bestRank })
    if ($best.Count -ne 1) {
        return [pscustomobject]@{
            Ok = $false
            Blocker = 'AMBIGUOUS'
            Candidates = @($best | ForEach-Object { $_.Item })
            LabelCandidates = @($best | ForEach-Object { $_.Label })
            Selected = $null
            MatchedLabel = ''
            Resolution = ''
        }
    }

    return [pscustomobject]@{
        Ok = $true
        Blocker = ''
        Candidates = @($ranked | ForEach-Object { $_.Item })
        LabelCandidates = $labels
        Selected = $best[0].Item
        MatchedLabel = Convert-ToCodexSafeText $best[0].Label.Name 160
        Resolution = $best[0].Resolution
        AncestorDepth = [int]$best[0].Depth
    }
}

function Test-CodexUsagePanelEvidence {
    param([array]$Snapshot)

    $strong = @($Snapshot | Where-Object {
        $_.Name -match '(?i)banked reset|rate.?limit reset|reset(s)? available|usage dashboard|weekly|five.?day|5.?day|credits? balance'
    })
    if ($strong.Count -gt 0) { return $true }

    $usage = @($Snapshot | Where-Object {
        $_.Name -match '(?i)codex usage|usage summary|remaining' -or $_.AutomationId -match '(?i)usage|limit|reset'
    })
    return $usage.Count -ge 2
}

function Open-CodexUsagePanel {
    [CmdletBinding()]
    param()

    try {
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
    } catch {
        return [pscustomobject]@{
            ok = $false
            blocker = 'BLOCKED_RESET_UI_AUTOMATION_UNAVAILABLE'
            navigationAttempted = $false
            profileMenuOpened = $false
            usagePanelOpened = $false
            proofRefs = @('codex-usage-panel-fixed-navigation')
        }
    }

    if (-not [Environment]::UserInteractive) {
        return [pscustomobject]@{
            ok = $false
            blocker = 'BLOCKED_RESET_DESKTOP_NOT_INTERACTIVE'
            navigationAttempted = $false
            profileMenuOpened = $false
            usagePanelOpened = $false
            proofRefs = @('codex-usage-panel-fixed-navigation')
        }
    }

    $root = [System.Windows.Automation.AutomationElement]::RootElement
    if ($null -eq $root) {
        return [pscustomobject]@{
            ok = $false
            blocker = 'BLOCKED_RESET_DESKTOP_ROOT_UNAVAILABLE'
            navigationAttempted = $false
            profileMenuOpened = $false
            usagePanelOpened = $false
            proofRefs = @('codex-usage-panel-fixed-navigation')
        }
    }

    $allowedProcessNames = @('ChatGPT', 'Codex', 'msedge')
    $trueCondition = [System.Windows.Automation.Condition]::TrueCondition
    $topWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $trueCondition)
    $windows = @()
    foreach ($window in $topWindows) {
        try {
            $name = Convert-ToCodexSafeText $window.Current.Name 160
            $processId = [int]$window.Current.ProcessId
            $processName = ''
            try { $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch { continue }
            if ($allowedProcessNames -notcontains $processName) { continue }
            if ($name -notmatch '(?i)codex|chatgpt|openai') { continue }
            $windows += [pscustomobject]@{ Element = $window; Name = $name; ProcessName = $processName; ProcessId = $processId }
        } catch { continue }
    }

    if ($windows.Count -eq 0) {
        return [pscustomobject]@{
            ok = $false
            blocker = 'BLOCKED_RESET_AUTHENTICATED_APP_WINDOW_NOT_FOUND'
            navigationAttempted = $false
            profileMenuOpened = $false
            usagePanelOpened = $false
            proofRefs = @('codex-usage-panel-fixed-navigation')
        }
    }

    $matchingWindows = @()
    foreach ($window in $windows) {
        $snapshot = Get-CodexProcessSnapshot -Root $root -ProcessId $window.ProcessId
        if (Test-CodexUsagePanelEvidence $snapshot) {
            $matchingWindows += [pscustomobject]@{ Window = $window; Snapshot = $snapshot }
        }
    }
    if ($matchingWindows.Count -eq 1) {
        return [pscustomobject]@{
            ok = $true
            blocker = ''
            navigationAttempted = $false
            profileMenuOpened = $false
            usagePanelOpened = $true
            matchedWindow = $matchingWindows[0].Window.Name
            matchedProfileControl = ''
            matchedUsageControl = 'already-open'
            matchedUsageLabel = ''
            usageControlResolution = 'already-open'
            proofRefs = @('codex-usage-panel-fixed-navigation', 'usage-panel-already-open')
        }
    }
    if ($matchingWindows.Count -gt 1) {
        return [pscustomobject]@{
            ok = $false
            blocker = 'BLOCKED_RESET_MULTIPLE_USAGE_WINDOWS'
            navigationAttempted = $false
            profileMenuOpened = $false
            usagePanelOpened = $false
            proofRefs = @('codex-usage-panel-fixed-navigation')
        }
    }

    if ($windows.Count -ne 1) {
        return [pscustomobject]@{
            ok = $false
            blocker = 'BLOCKED_RESET_MULTIPLE_APP_WINDOWS'
            navigationAttempted = $false
            profileMenuOpened = $false
            usagePanelOpened = $false
            proofRefs = @('codex-usage-panel-fixed-navigation')
        }
    }

    $selectedWindow = $windows[0]
    $snapshot = Get-CodexProcessSnapshot -Root $root -ProcessId $selectedWindow.ProcessId
    $profileTokens = @()
    foreach ($source in @($env:USERNAME, (Split-Path -Leaf $env:USERPROFILE))) {
        foreach ($token in ([string]$source -split '[^A-Za-z0-9]+')) {
            if ($token.Length -ge 3) { $profileTokens += [regex]::Escape($token) }
        }
    }
    $profileTokenPattern = if ($profileTokens.Count) { '(?i)(' + (($profileTokens | Select-Object -Unique) -join '|') + ')' } else { '(?!)' }

    $profileSelection = Select-CodexUiCandidate $snapshot {
        param($item)
        $interactiveType = $item.Type -match 'ControlType\.(Button|MenuItem|Hyperlink|ListItem)'
        if (-not $interactiveType) { return $false }
        if ($item.Name -match '(?i)sign out|log out|billing|security|privacy|upgrade|new chat|compose') { return $false }
        return $item.Name -match '(?i)profile|account|user menu|avatar|personal menu' `
            -or $item.AutomationId -match '(?i)profile|account|user|avatar' `
            -or $item.Name -match $profileTokenPattern
    } {
        param($item)
        if ($item.Name -match '(?i)profile menu|open profile|user menu|account menu') { return 0 }
        if ($item.AutomationId -match '(?i)profile|account|user|avatar') { return 1 }
        if ($item.Name -match '(?i)profile|account|avatar') { return 2 }
        return 3
    }

    if (-not $profileSelection.Ok) {
        return [pscustomobject]@{
            ok = $false
            blocker = if ($profileSelection.Blocker -eq 'AMBIGUOUS') { 'BLOCKED_RESET_PROFILE_CONTROL_AMBIGUOUS' } else { 'BLOCKED_RESET_PROFILE_CONTROL_NOT_FOUND' }
            navigationAttempted = $true
            profileMenuOpened = $false
            usagePanelOpened = $false
            matchedWindow = $selectedWindow.Name
            profileCandidates = @($profileSelection.Candidates | ForEach-Object { Convert-ToCodexSafeText $_.Name 120 })
            proofRefs = @('codex-usage-panel-fixed-navigation')
        }
    }

    $profileControl = $profileSelection.Selected
    try {
        if (-not (Invoke-CodexUiElement $profileControl.Element)) {
            throw 'No supported fixed UI Automation pattern was exposed.'
        }
    } catch {
        return [pscustomobject]@{
            ok = $false
            blocker = 'BLOCKED_RESET_PROFILE_CONTROL_NOT_INVOCABLE'
            navigationAttempted = $true
            profileMenuOpened = $false
            usagePanelOpened = $false
            matchedWindow = $selectedWindow.Name
            matchedProfileControl = Convert-ToCodexSafeText $profileControl.Name 120
            proofRefs = @('codex-usage-panel-fixed-navigation')
        }
    }

    Start-Sleep -Milliseconds 900
    $menuSnapshot = Get-CodexProcessSnapshot -Root $root -ProcessId $selectedWindow.ProcessId
    $usageSelection = Select-CodexUiCandidate $menuSnapshot {
        param($item)
        $interactiveType = $item.Type -match 'ControlType\.(Button|MenuItem|Hyperlink|ListItem)'
        if (-not $interactiveType) { return $false }
        if ($item.Name -match '(?i)billing|security|privacy|upgrade|purchase|buy credits|add credits|auto.?top.?up') { return $false }
        return $item.Name -match '(?i)\b\d+\s+(banked\s+)?reset(s)?\s+available\b|banked reset|rate.?limit reset|reset(s)?\s+available|usage summary|usage dashboard|codex usage|\busage\b|remaining' `
            -or $item.AutomationId -match '(?i)usage|limit|reset'
    } {
        param($item)
        if ($item.Name -match '(?i)\b\d+\s+(banked\s+)?reset(s)?\s+available\b|reset(s)?\s+available') { return 0 }
        if ($item.Name -match '(?i)banked reset|rate.?limit reset') { return 1 }
        if ($item.Name -match '(?i)codex usage|usage summary|usage dashboard') { return 2 }
        if ($item.AutomationId -match '(?i)usage|limit|reset') { return 3 }
        return 4
    }

    $matchedUsageLabel = ''
    $usageControlResolution = 'direct-control'
    if (-not $usageSelection.Ok -and $usageSelection.Blocker -eq 'NOT_FOUND') {
        $usageSelection = Select-CodexLabeledUsageControl -Snapshot $menuSnapshot -WindowElement $selectedWindow.Element
        $matchedUsageLabel = Convert-ToCodexSafeText $usageSelection.MatchedLabel 160
        $usageControlResolution = Convert-ToCodexSafeText $usageSelection.Resolution 80
    }

    if (-not $usageSelection.Ok) {
        $blocker = 'BLOCKED_RESET_USAGE_CONTROL_NOT_FOUND'
        if ($usageSelection.Blocker -eq 'AMBIGUOUS') { $blocker = 'BLOCKED_RESET_USAGE_CONTROL_AMBIGUOUS' }
        elseif ($usageSelection.Blocker -eq 'LABEL_NOT_INVOCABLE') { $blocker = 'BLOCKED_RESET_USAGE_LABEL_NOT_INVOCABLE' }

        return [pscustomobject]@{
            ok = $false
            blocker = $blocker
            navigationAttempted = $true
            profileMenuOpened = $true
            usagePanelOpened = $false
            matchedWindow = $selectedWindow.Name
            matchedProfileControl = Convert-ToCodexSafeText $profileControl.Name 120
            matchedUsageLabel = $matchedUsageLabel
            usageControlResolution = $usageControlResolution
            usageCandidates = @($usageSelection.Candidates | ForEach-Object { Convert-ToCodexSafeText $_.Name 120 })
            usageLabelCandidates = @($usageSelection.LabelCandidates | ForEach-Object { Convert-ToCodexSafeText $_.Name 120 })
            proofRefs = @('codex-usage-panel-fixed-navigation', 'profile-menu-opened', 'same-process-popup-scanned')
        }
    }

    $usageControl = $usageSelection.Selected
    try {
        if (-not (Invoke-CodexUiElement $usageControl.Element)) {
            throw 'No supported fixed UI Automation pattern was exposed.'
        }
    } catch {
        return [pscustomobject]@{
            ok = $false
            blocker = 'BLOCKED_RESET_USAGE_CONTROL_NOT_INVOCABLE'
            navigationAttempted = $true
            profileMenuOpened = $true
            usagePanelOpened = $false
            matchedWindow = $selectedWindow.Name
            matchedProfileControl = Convert-ToCodexSafeText $profileControl.Name 120
            matchedUsageControl = Convert-ToCodexSafeText $usageControl.Name 160
            matchedUsageLabel = $matchedUsageLabel
            usageControlResolution = $usageControlResolution
            proofRefs = @('codex-usage-panel-fixed-navigation', 'profile-menu-opened', 'same-process-popup-scanned')
        }
    }

    Start-Sleep -Milliseconds 1200
    $usageSnapshot = Get-CodexProcessSnapshot -Root $root -ProcessId $selectedWindow.ProcessId
    if (-not (Test-CodexUsagePanelEvidence $usageSnapshot)) {
        return [pscustomobject]@{
            ok = $false
            blocker = 'BLOCKED_RESET_USAGE_PANEL_NOT_PROVEN'
            navigationAttempted = $true
            profileMenuOpened = $true
            usagePanelOpened = $false
            matchedWindow = $selectedWindow.Name
            matchedProfileControl = Convert-ToCodexSafeText $profileControl.Name 120
            matchedUsageControl = Convert-ToCodexSafeText $usageControl.Name 160
            matchedUsageLabel = $matchedUsageLabel
            usageControlResolution = $usageControlResolution
            proofRefs = @('codex-usage-panel-fixed-navigation', 'profile-menu-opened', 'same-process-popup-scanned', 'usage-control-invoked')
        }
    }

    return [pscustomobject]@{
        ok = $true
        blocker = ''
        navigationAttempted = $true
        profileMenuOpened = $true
        usagePanelOpened = $true
        matchedWindow = $selectedWindow.Name
        matchedProfileControl = Convert-ToCodexSafeText $profileControl.Name 120
        matchedUsageControl = Convert-ToCodexSafeText $usageControl.Name 160
        matchedUsageLabel = $matchedUsageLabel
        usageControlResolution = $usageControlResolution
        proofRefs = @('codex-usage-panel-fixed-navigation', 'profile-menu-opened', 'same-process-popup-scanned', 'usage-panel-opened')
    }
}

Export-ModuleMember -Function Open-CodexUsagePanel
