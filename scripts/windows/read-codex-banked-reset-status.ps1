[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$')]
    [string]$RequestId
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Convert-ToSafeText([object]$Value, [int]$Limit = 220) {
    $text = [string]$Value
    $text = ($text -replace '[\r\n\t]+', ' ' -replace '\s+', ' ').Trim()
    if ($text.Length -gt $Limit) { return $text.Substring(0, $Limit) }
    return $text
}

function Write-Outcome([hashtable]$Outcome, [int]$ExitCode) {
    $base = [ordered]@{
        schemaVersion = 'stephanos.codex-banked-reset-status-ui.v1'
        requestId = $RequestId
        readOnly = $true
        pressAttempted = $false
        pressCount = 0
        arbitraryShellAllowed = $false
        arbitraryBrowserAutomationAllowed = $false
        credentialsMayBeReadOrExported = $false
    }
    foreach ($key in $Outcome.Keys) { $base[$key] = $Outcome[$key] }
    [Console]::Out.WriteLine(($base | ConvertTo-Json -Depth 6 -Compress))
    exit $ExitCode
}

function Block([string]$Blocker, [hashtable]$Details = @{}) {
    $payload = [ordered]@{
        ok = $false
        blocker = $Blocker
        finalVerdict = 'CODEX_BANKED_RESET_STATUS_BLOCKED'
        observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        desktopInteractive = $false
        appWindowFound = $false
        usageSurfaceMatched = $false
        meterSummary = ''
        expiryTexts = @()
        resetButtons = @()
        activeCodexTask = $false
        proofRefs = @('battle-bridge-ui-automation-read-only')
    }
    foreach ($key in $Details.Keys) { $payload[$key] = $Details[$key] }
    Write-Outcome $payload 1
}

if (-not [Environment]::UserInteractive) { Block 'BLOCKED_RESET_STATUS_DESKTOP_NOT_INTERACTIVE' }

try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
} catch {
    Block 'BLOCKED_RESET_STATUS_UI_AUTOMATION_UNAVAILABLE' @{ error = Convert-ToSafeText $_.Exception.Message 300 }
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
if ($null -eq $root) { Block 'BLOCKED_RESET_STATUS_DESKTOP_ROOT_UNAVAILABLE' }

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
    Block 'BLOCKED_RESET_STATUS_AUTHENTICATED_APP_WINDOW_NOT_FOUND' @{
        desktopInteractive = $true
        appWindowFound = $false
    }
}

function Get-Snapshot([System.Windows.Automation.AutomationElement]$Window) {
    $elements = $Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $trueCondition)
    $items = @()
    foreach ($element in $elements) {
        try {
            $name = Convert-ToSafeText $element.Current.Name 220
            if (-not $name) { continue }
            $items += [pscustomobject]@{
                Name = $name
                Type = Convert-ToSafeText $element.Current.ControlType.ProgrammaticName 100
                Enabled = [bool]$element.Current.IsEnabled
                Offscreen = [bool]$element.Current.IsOffscreen
            }
        } catch { continue }
    }
    return $items
}

$matching = @()
foreach ($candidate in $windowCandidates) {
    $snapshot = Get-Snapshot $candidate.Element
    $usageMatches = @($snapshot | Where-Object { $_.Name -match '(?i)usage|remaining|meter|limit|banked reset|rate.limit reset' })
    if ($usageMatches.Count -eq 0) { continue }
    $matching += [pscustomobject]@{ Window = $candidate; Snapshot = $snapshot }
}

if ($matching.Count -eq 0) {
    Block 'BLOCKED_RESET_STATUS_USAGE_SURFACE_NOT_FOUND' @{
        desktopInteractive = $true
        appWindowFound = $true
    }
}
if ($matching.Count -gt 1) {
    Block 'BLOCKED_RESET_STATUS_MULTIPLE_USAGE_WINDOWS' @{
        desktopInteractive = $true
        appWindowFound = $true
        usageSurfaceMatched = $true
    }
}

$selected = $matching[0]
$snapshot = $selected.Snapshot
$meterTexts = @($snapshot | Where-Object {
    $_.Name -match '\b\d{1,3}\s*%' -and $_.Name -match '(?i)usage|remaining|meter|limit|codex|weekly|five.day|5.day'
} | Select-Object -ExpandProperty Name -Unique -First 6)
$expiryTexts = @($snapshot | Where-Object {
    $_.Name -match '(?i)expire|expiry|expires|banked reset|rate.limit reset' -and
    $_.Name -match '(?i)\b20\d{2}\b|\bjan(?:uary)?\b|\bfeb(?:ruary)?\b|\bmar(?:ch)?\b|\bapr(?:il)?\b|\bmay\b|\bjun(?:e)?\b|\bjul(?:y)?\b|\baug(?:ust)?\b|\bsep(?:tember)?\b|\boct(?:ober)?\b|\bnov(?:ember)?\b|\bdec(?:ember)?\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b'
} | Select-Object -ExpandProperty Name -Unique -First 12)
$resetButtons = @($snapshot | Where-Object {
    $_.Type -eq 'ControlType.Button' -and $_.Enabled -and -not $_.Offscreen -and
    $_.Name -match '(?i)\b(redeem|apply|use|reset)\b'
} | Select-Object -ExpandProperty Name -Unique -First 12)
$activeTask = @($snapshot | Where-Object {
    $_.Name -match '(?i)(codex|task|job).*(running|working|in progress)|running.*(codex|task|job)'
}).Count -gt 0

Write-Outcome ([ordered]@{
    ok = $true
    blocker = ''
    finalVerdict = 'CODEX_BANKED_RESET_STATUS_READY'
    observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    desktopInteractive = $true
    appWindowFound = $true
    usageSurfaceMatched = $true
    matchedWindow = Convert-ToSafeText $selected.Window.Name 160
    meterSummary = Convert-ToSafeText ($meterTexts -join ' | ') 300
    expiryTexts = @($expiryTexts | ForEach-Object { Convert-ToSafeText $_ 220 })
    resetButtons = @($resetButtons | ForEach-Object { Convert-ToSafeText $_ 120 })
    activeCodexTask = [bool]$activeTask
    proofRefs = @('battle-bridge-ui-automation-read-only', 'codex-usage-surface-observed')
}) 0
