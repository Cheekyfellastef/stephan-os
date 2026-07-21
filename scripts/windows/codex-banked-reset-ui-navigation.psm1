Set-StrictMode -Version Latest

function Convert-ToCodexSafeText {
    param([object]$Value, [int]$Limit = 220)
    $text = [string]$Value
    $text = ($text -replace '[\r\n\t]+', ' ' -replace '\s+', ' ').Trim()
    if ($text.Length -gt $Limit) { return $text.Substring(0, $Limit) }
    return $text
}

function Get-CodexUiSnapshot {
    param([System.Windows.Automation.AutomationElement]$Window)

    $trueCondition = [System.Windows.Automation.Condition]::TrueCondition
    $elements = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $trueCondition)
    $items = @()
    foreach ($element in $elements) {
        try {
            $name = Convert-ToCodexSafeText $element.Current.Name 220
            $automationId = Convert-ToCodexSafeText $element.Current.AutomationId 160
            $className = Convert-ToCodexSafeText $element.Current.ClassName 120
            if (-not $name -and -not $automationId) { continue }
            $rect = $element.Current.BoundingRectangle
            $items += [pscustomobject]@{
                Element = $element
                Name = $name
                AutomationId = $automationId
                ClassName = $className
                Type = Convert-ToCodexSafeText $element.Current.ControlType.ProgrammaticName 100
                Enabled = [bool]$element.Current.IsEnabled
                Offscreen = [bool]$element.Current.IsOffscreen
                Left = [double]$rect.Left
                Top = [double]$rect.Top
                Right = [double]$rect.Right
                Bottom = [double]$rect.Bottom
            }
        } catch { continue }
    }
    return @($items)
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
        return [pscustomobject]@{ Ok = $false; Blocker = 'NOT_FOUND'; Candidates = @(); Selected = $null }
    }

    $ranked = @($candidates | ForEach-Object {
        [pscustomobject]@{ Item = $_; Rank = [int](& $Rank $_) }
    } | Sort-Object Rank, @{ Expression = { $_.Item.Top } }, @{ Expression = { $_.Item.Left } })

    $bestRank = $ranked[0].Rank
    $best = @($ranked | Where-Object { $_.Rank -eq $bestRank } | ForEach-Object { $_.Item })
    if ($best.Count -ne 1) {
        return [pscustomobject]@{ Ok = $false; Blocker = 'AMBIGUOUS'; Candidates = $best; Selected = $null }
    }
    return [pscustomobject]@{ Ok = $true; Blocker = ''; Candidates = $candidates; Selected = $best[0] }
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
            $windows += [pscustomobject]@{ Element = $window; Name = $name; ProcessName = $processName }
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
        $snapshot = Get-CodexUiSnapshot $window.Element
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
    $snapshot = Get-CodexUiSnapshot $selectedWindow.Element
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
    $menuSnapshot = Get-CodexUiSnapshot $selectedWindow.Element
    $usageSelection = Select-CodexUiCandidate $menuSnapshot {
        param($item)
        $interactiveType = $item.Type -match 'ControlType\.(Button|MenuItem|Hyperlink|ListItem)'
        if (-not $interactiveType) { return $false }
        if ($item.Name -match '(?i)billing|security|privacy|upgrade|purchase|buy credits|add credits|auto.?top.?up') { return $false }
        return $item.Name -match '(?i)\b\d+\s+reset(s)?\s+available\b|reset(s)?\s+available|usage summary|usage dashboard|codex usage|\busage\b|remaining' `
            -or $item.AutomationId -match '(?i)usage|limit|reset'
    } {
        param($item)
        if ($item.Name -match '(?i)\b\d+\s+reset(s)?\s+available\b|reset(s)?\s+available') { return 0 }
        if ($item.Name -match '(?i)codex usage|usage summary|usage dashboard') { return 1 }
        if ($item.AutomationId -match '(?i)usage|limit|reset') { return 2 }
        return 3
    }

    if (-not $usageSelection.Ok) {
        return [pscustomobject]@{
            ok = $false
            blocker = if ($usageSelection.Blocker -eq 'AMBIGUOUS') { 'BLOCKED_RESET_USAGE_CONTROL_AMBIGUOUS' } else { 'BLOCKED_RESET_USAGE_CONTROL_NOT_FOUND' }
            navigationAttempted = $true
            profileMenuOpened = $true
            usagePanelOpened = $false
            matchedWindow = $selectedWindow.Name
            matchedProfileControl = Convert-ToCodexSafeText $profileControl.Name 120
            usageCandidates = @($usageSelection.Candidates | ForEach-Object { Convert-ToCodexSafeText $_.Name 120 })
            proofRefs = @('codex-usage-panel-fixed-navigation', 'profile-menu-opened')
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
            proofRefs = @('codex-usage-panel-fixed-navigation', 'profile-menu-opened')
        }
    }

    Start-Sleep -Milliseconds 1200
    $usageSnapshot = Get-CodexUiSnapshot $selectedWindow.Element
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
            proofRefs = @('codex-usage-panel-fixed-navigation', 'profile-menu-opened', 'usage-control-invoked')
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
        proofRefs = @('codex-usage-panel-fixed-navigation', 'profile-menu-opened', 'usage-panel-opened')
    }
}

Export-ModuleMember -Function Open-CodexUsagePanel
