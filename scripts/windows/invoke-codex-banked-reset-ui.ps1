[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$')]
    [string]$RequestId,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:-]{2,120}$')]
    [string]$ResetId,

    [Parameter(Mandatory = $true)]
    [datetime]$ResetExpiresAtUtc,

    [Parameter(Mandatory = $true)]
    [datetime]$LatestSafeExecutionUtc,

    [Parameter(Mandatory = $true)]
    [ValidateSet('operator-policy/codex-banked-reset-v1')]
    [string]$StandingOperatorPolicyRef
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-IsoUtc([datetime]$Value) {
    return $Value.ToUniversalTime().ToString('o')
}

function Convert-ToSafeText([object]$Value, [int]$Limit = 200) {
    $text = [string]$Value
    $text = ($text -replace '[\r\n\t]+', ' ' -replace '\s+', ' ').Trim()
    if ($text.Length -gt $Limit) { return $text.Substring(0, $Limit) }
    return $text
}

function Write-Outcome([hashtable]$Outcome, [int]$ExitCode) {
    $base = [ordered]@{
        schemaVersion = 'stephanos.codex-banked-reset-ui.v1'
        requestId = $RequestId
        resetId = $ResetId
        resetExpiresAtUtc = Get-IsoUtc $ResetExpiresAtUtc
        standingOperatorPolicyRef = $StandingOperatorPolicyRef
        fixedUiActionOnly = $true
        singlePressOnly = $true
        arbitraryShellAllowed = $false
        arbitraryBrowserAutomationAllowed = $false
        credentialsMayBeReadOrExported = $false
        repeatedPressAllowed = $false
    }
    foreach ($key in $Outcome.Keys) { $base[$key] = $Outcome[$key] }
    [Console]::Out.WriteLine(($base | ConvertTo-Json -Depth 6 -Compress))
    exit $ExitCode
}

function Block([string]$Blocker, [hashtable]$Details = @{}) {
    $payload = [ordered]@{
        ok = $false
        blocker = $Blocker
        finalVerdict = 'CODEX_BANKED_RESET_EXECUTION_BLOCKED'
        observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        completedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        desktopInteractive = $false
        appWindowFound = $false
        usageSurfaceMatched = $false
        pressAttempted = $false
        pressCount = 0
        meterRestored = $false
        resetControlDisappeared = $false
        proofRefs = @('battle-bridge-ui-automation')
    }
    foreach ($key in $Details.Keys) { $payload[$key] = $Details[$key] }
    Write-Outcome $payload 1
}

$nowUtc = (Get-Date).ToUniversalTime()
if ($LatestSafeExecutionUtc.ToUniversalTime() -le $nowUtc) { Block 'BLOCKED_RESET_ACTION_EXPIRED' }
if ($ResetExpiresAtUtc.ToUniversalTime() -le $nowUtc) { Block 'BLOCKED_RESET_ALREADY_EXPIRED' }
if ($LatestSafeExecutionUtc.ToUniversalTime() -gt $ResetExpiresAtUtc.ToUniversalTime()) { Block 'BLOCKED_RESET_TIME_MISMATCH' }
if (-not [Environment]::UserInteractive) { Block 'BLOCKED_RESET_DESKTOP_NOT_INTERACTIVE' }

try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
} catch {
    Block 'BLOCKED_RESET_UI_AUTOMATION_UNAVAILABLE' @{ error = Convert-ToSafeText $_.Exception.Message 300 }
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
if ($null -eq $root) { Block 'BLOCKED_RESET_DESKTOP_ROOT_UNAVAILABLE' }

$trueCondition = [System.Windows.Automation.Condition]::TrueCondition
$topWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $trueCondition)
$allowedProcessNames = @('ChatGPT', 'Codex', 'msedge')
$windowCandidates = @()

foreach ($window in $topWindows) {
    try {
        $windowName = Convert-ToSafeText $window.Current.Name 160
        $processId = [int]$window.Current.ProcessId
        $processName = ''
        try { $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch { continue }
        if ($allowedProcessNames -notcontains $processName) { continue }
        if ($windowName -notmatch '(?i)codex|chatgpt|openai') { continue }
        $windowCandidates += [pscustomobject]@{ Element = $window; Name = $windowName; ProcessName = $processName }
    } catch { continue }
}

if ($windowCandidates.Count -eq 0) {
    Block 'BLOCKED_RESET_AUTHENTICATED_APP_WINDOW_NOT_FOUND' @{
        desktopInteractive = $true
        appWindowFound = $false
    }
}

function Get-Elements([System.Windows.Automation.AutomationElement]$Window) {
    return $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $trueCondition)
}

function Get-ElementSnapshot([System.Windows.Automation.AutomationElementCollection]$Elements) {
    $items = @()
    foreach ($element in $Elements) {
        try {
            $name = Convert-ToSafeText $element.Current.Name 220
            if (-not $name) { continue }
            $typeName = Convert-ToSafeText $element.Current.ControlType.ProgrammaticName 100
            $rect = $element.Current.BoundingRectangle
            $items += [pscustomobject]@{
                Element = $element
                Name = $name
                Type = $typeName
                Enabled = [bool]$element.Current.IsEnabled
                Offscreen = [bool]$element.Current.IsOffscreen
                Left = [double]$rect.Left
                Top = [double]$rect.Top
                Right = [double]$rect.Right
                Bottom = [double]$rect.Bottom
            }
        } catch { continue }
    }
    return $items
}

function Get-ExpiryTokens([datetime]$ExpiryUtc) {
    $utc = $ExpiryUtc.ToUniversalTime()
    $local = $ExpiryUtc.ToLocalTime()
    return @(
        $utc.ToString('yyyy-MM-dd'),
        $utc.ToString('dd/MM/yyyy'),
        $utc.ToString('d/M/yyyy'),
        $utc.ToString('dd MMM yyyy', [Globalization.CultureInfo]::InvariantCulture),
        $utc.ToString('d MMM yyyy', [Globalization.CultureInfo]::InvariantCulture),
        $local.ToString('yyyy-MM-dd'),
        $local.ToString('dd/MM/yyyy'),
        $local.ToString('d/M/yyyy'),
        $local.ToString('dd MMM yyyy', [Globalization.CultureInfo]::InvariantCulture),
        $local.ToString('d MMM yyyy', [Globalization.CultureInfo]::InvariantCulture)
    ) | Select-Object -Unique
}

function Get-MeterSummary($Snapshot) {
    $matches = $Snapshot | Where-Object {
        $_.Name -match '\b\d{1,3}\s*%' -and $_.Name -match '(?i)usage|remaining|meter|limit|codex|weekly|five.day|5.day'
    } | Select-Object -ExpandProperty Name -Unique -First 4
    return Convert-ToSafeText ($matches -join ' | ') 200
}

function Find-Target($Snapshot, [string[]]$ExpiryTokens) {
    $usageMatches = @($Snapshot | Where-Object { $_.Name -match '(?i)usage|remaining|meter|limit|banked reset|rate.limit reset' })
    $activeTaskMatches = @($Snapshot | Where-Object { $_.Name -match '(?i)(codex|task|job).*(running|working|in progress)|running.*(codex|task|job)' })
    if ($activeTaskMatches.Count -gt 0) {
        return [pscustomobject]@{ Blocker = 'BLOCKED_RESET_ACTIVE_CODEX_TASK'; UsageMatched = $usageMatches.Count -gt 0 }
    }

    $expiryMatches = @($Snapshot | Where-Object {
        $name = $_.Name
        ($ExpiryTokens | Where-Object { $name -like "*$_*" }).Count -gt 0
    })
    if ($expiryMatches.Count -eq 0) {
        return [pscustomobject]@{ Blocker = 'BLOCKED_RESET_EXPIRY_NOT_VISIBLE'; UsageMatched = $usageMatches.Count -gt 0 }
    }

    $buttons = @($Snapshot | Where-Object {
        $_.Type -eq 'ControlType.Button' -and $_.Enabled -and -not $_.Offscreen -and
        $_.Name -match '(?i)\b(redeem|apply|use|reset)\b'
    })
    if ($buttons.Count -eq 0) {
        return [pscustomobject]@{ Blocker = 'BLOCKED_RESET_BUTTON_NOT_FOUND'; UsageMatched = $usageMatches.Count -gt 0; ExpiryText = $expiryMatches[0].Name }
    }

    $nearButtons = @()
    foreach ($button in $buttons) {
        foreach ($expiry in $expiryMatches) {
            $verticalDistance = [Math]::Abs((($button.Top + $button.Bottom) / 2) - (($expiry.Top + $expiry.Bottom) / 2))
            $horizontalOverlap = [Math]::Min($button.Right, $expiry.Right) - [Math]::Max($button.Left, $expiry.Left)
            if ($verticalDistance -le 240 -or $horizontalOverlap -ge -80) {
                $nearButtons += $button
                break
            }
        }
    }
    $nearButtons = @($nearButtons | Sort-Object Name, Top, Left -Unique)
    if ($nearButtons.Count -ne 1) {
        return [pscustomobject]@{
            Blocker = if ($nearButtons.Count -eq 0) { 'BLOCKED_RESET_BUTTON_NOT_BOUND_TO_EXPIRY' } else { 'BLOCKED_RESET_UI_AMBIGUOUS' }
            UsageMatched = $usageMatches.Count -gt 0
            ExpiryText = $expiryMatches[0].Name
            CandidateCount = $nearButtons.Count
        }
    }

    return [pscustomobject]@{
        Blocker = ''
        UsageMatched = $usageMatches.Count -gt 0
        ExpiryText = $expiryMatches[0].Name
        Button = $nearButtons[0]
        CandidateCount = 1
    }
}

$expiryTokens = Get-ExpiryTokens $ResetExpiresAtUtc
$selectedWindow = $null
$selectedSnapshot = $null
$target = $null

foreach ($candidate in $windowCandidates) {
    $snapshot = Get-ElementSnapshot (Get-Elements $candidate.Element)
    $candidateTarget = Find-Target $snapshot $expiryTokens
    if (-not $candidateTarget.Blocker) {
        if ($null -ne $selectedWindow) {
            Block 'BLOCKED_RESET_MULTIPLE_MATCHING_WINDOWS' @{
                desktopInteractive = $true
                appWindowFound = $true
                usageSurfaceMatched = $true
            }
        }
        $selectedWindow = $candidate
        $selectedSnapshot = $snapshot
        $target = $candidateTarget
    }
}

if ($null -eq $selectedWindow) {
    $first = $windowCandidates[0]
    $firstSnapshot = Get-ElementSnapshot (Get-Elements $first.Element)
    $firstTarget = Find-Target $firstSnapshot $expiryTokens
    Block $firstTarget.Blocker @{
        desktopInteractive = $true
        appWindowFound = $true
        usageSurfaceMatched = [bool]$firstTarget.UsageMatched
        matchedWindow = Convert-ToSafeText $first.Name 160
        matchedExpiryText = Convert-ToSafeText $firstTarget.ExpiryText 160
        candidateButtonCount = [int]($firstTarget.CandidateCount)
        meterBefore = Get-MeterSummary $firstSnapshot
    }
}

$meterBefore = Get-MeterSummary $selectedSnapshot
$buttonName = Convert-ToSafeText $target.Button.Name 120
$expiryText = Convert-ToSafeText $target.ExpiryText 160

try {
    $patternObject = $null
    $hasInvoke = $target.Button.Element.TryGetCurrentPattern(
        [System.Windows.Automation.InvokePattern]::Pattern,
        [ref]$patternObject
    )
    if (-not $hasInvoke -or $null -eq $patternObject) {
        Block 'BLOCKED_RESET_BUTTON_NOT_INVOCABLE' @{
            desktopInteractive = $true
            appWindowFound = $true
            usageSurfaceMatched = [bool]$target.UsageMatched
            matchedWindow = Convert-ToSafeText $selectedWindow.Name 160
            matchedButton = $buttonName
            matchedExpiryText = $expiryText
            meterBefore = $meterBefore
        }
    }

    $patternObject.Invoke()
} catch {
    Block 'BLOCKED_RESET_PRESS_FAILED' @{
        desktopInteractive = $true
        appWindowFound = $true
        usageSurfaceMatched = [bool]$target.UsageMatched
        matchedWindow = Convert-ToSafeText $selectedWindow.Name 160
        matchedButton = $buttonName
        matchedExpiryText = $expiryText
        meterBefore = $meterBefore
        pressAttempted = $true
        pressCount = 1
        error = Convert-ToSafeText $_.Exception.Message 300
    }
}

Start-Sleep -Seconds 8
$afterSnapshot = Get-ElementSnapshot (Get-Elements $selectedWindow.Element)
$meterAfter = Get-MeterSummary $afterSnapshot
$afterTarget = Find-Target $afterSnapshot $expiryTokens
$resetControlDisappeared = $afterTarget.Blocker -in @('BLOCKED_RESET_EXPIRY_NOT_VISIBLE', 'BLOCKED_RESET_BUTTON_NOT_FOUND', 'BLOCKED_RESET_BUTTON_NOT_BOUND_TO_EXPIRY')
$meterChanged = [bool]($meterBefore -and $meterAfter -and $meterBefore -ne $meterAfter)
$meterRestored = $meterChanged -or $resetControlDisappeared

if (-not $meterRestored) {
    Block 'BLOCKED_RESET_CONFIRMATION_NOT_PROVEN' @{
        desktopInteractive = $true
        appWindowFound = $true
        usageSurfaceMatched = [bool]$target.UsageMatched
        matchedWindow = Convert-ToSafeText $selectedWindow.Name 160
        matchedButton = $buttonName
        matchedExpiryText = $expiryText
        meterBefore = $meterBefore
        meterAfter = $meterAfter
        pressAttempted = $true
        pressCount = 1
        meterRestored = $false
        resetControlDisappeared = $false
        proofRefs = @('battle-bridge-ui-automation', 'single-press-attempted-no-retry')
    }
}

Write-Outcome ([ordered]@{
    ok = $true
    blocker = ''
    finalVerdict = 'CODEX_BANKED_RESET_CONFIRMED'
    observedAtUtc = $nowUtc.ToString('o')
    completedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    desktopInteractive = $true
    appWindowFound = $true
    usageSurfaceMatched = [bool]$target.UsageMatched
    matchedWindow = Convert-ToSafeText $selectedWindow.Name 160
    matchedButton = $buttonName
    matchedExpiryText = $expiryText
    meterBefore = $meterBefore
    meterAfter = $meterAfter
    pressAttempted = $true
    pressCount = 1
    meterRestored = $true
    resetControlDisappeared = [bool]$resetControlDisappeared
    proofRefs = @('battle-bridge-ui-automation', 'single-press-confirmed')
}) 0
