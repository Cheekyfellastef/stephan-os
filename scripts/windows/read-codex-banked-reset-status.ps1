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

$usageEvidenceModulePath = Join-Path $PSScriptRoot 'codex-usage-surface-evidence.psm1'
if (-not (Test-Path -LiteralPath $usageEvidenceModulePath -PathType Leaf)) {
    Block 'BLOCKED_RESET_STATUS_EVIDENCE_MODULE_MISSING'
}
try {
    Import-Module $usageEvidenceModulePath -Force -ErrorAction Stop
} catch {
    Block 'BLOCKED_RESET_STATUS_EVIDENCE_MODULE_INVALID' @{ error = Convert-ToSafeText $_.Exception.Message 300 }
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
        $windowCandidates += [pscustomobject]@{ Element = $window; Name = $windowName; ProcessName = $processName; ProcessId = $processId }
    } catch { continue }
}
$windowCandidates = @(Select-CodexUniqueProcessCandidates -Candidates @($windowCandidates))

if ($windowCandidates.Count -eq 0) {
    Block 'BLOCKED_RESET_STATUS_AUTHENTICATED_APP_WINDOW_NOT_FOUND' @{
        desktopInteractive = $true
        appWindowFound = $false
    }
}
function Get-SurfaceSnapshot([System.Windows.Automation.AutomationElement]$Surface) {
    $elements = $Surface.FindAll([System.Windows.Automation.TreeScope]::Descendants, $trueCondition)
    $items = @()
    foreach ($element in $elements) {
        try {
            $name = Convert-ToSafeText $element.Current.Name 220
            if (-not $name) { continue }
            $typeName = Convert-ToSafeText $element.Current.ControlType.ProgrammaticName 100
            $automationId = Convert-ToSafeText $element.Current.AutomationId 160
            $value = ''
            $valuePattern = $null
            try {
                if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
                    $typedValuePattern = [System.Windows.Automation.ValuePattern]$valuePattern
                    $value = Convert-ToSafeText $typedValuePattern.Current.Value 500
                }
            } catch {
                $value = ''
            }
            $items += [pscustomobject]@{
                Name = $name
                Type = $typeName
                AutomationId = $automationId
                Value = $value
                Enabled = [bool]$element.Current.IsEnabled
                Offscreen = [bool]$element.Current.IsOffscreen
            }
        } catch { continue }
    }
    return @($items)
}

function Get-ProcessSnapshot([int]$ProcessId) {
    $items = @()
    foreach ($surface in $root.FindAll([System.Windows.Automation.TreeScope]::Children, $trueCondition)) {
        try {
            if ([int]$surface.Current.ProcessId -ne $ProcessId) { continue }
        } catch {
            continue
        }
        $items += @(Get-SurfaceSnapshot $surface)
    }
    return @($items)
}

$matchingUsageWindows = @()
foreach ($candidate in $windowCandidates) {
    $candidateSnapshot = Get-ProcessSnapshot $candidate.ProcessId
    $candidateEvidence = Resolve-CodexUsageSurfaceEvidence -Snapshot @($candidateSnapshot) -ProcessName $candidate.ProcessName
    if ($candidateEvidence.valid -eq $true) {
        $matchingUsageWindows += [pscustomobject]@{
            Window = $candidate
            Snapshot = $candidateSnapshot
            Evidence = $candidateEvidence
        }
    }
}

if ($matchingUsageWindows.Count -eq 0) {
    Block 'BLOCKED_RESET_STATUS_METER_NOT_FOUND' @{
        desktopInteractive = $true
        appWindowFound = $true
        proofRefs = @('battle-bridge-ui-automation-read-only', 'same-process-usage-surface-scanned', 'usage-surface-semantic-proof-required')
    }
}
if ($matchingUsageWindows.Count -ne 1) {
    Block 'BLOCKED_RESET_STATUS_MULTIPLE_USAGE_WINDOWS' @{
        desktopInteractive = $true
        appWindowFound = $true
        proofRefs = @('battle-bridge-ui-automation-read-only', 'same-process-usage-surface-scanned', 'usage-surface-ambiguity-failed-closed')
    }
}

$selectedMatch = $matchingUsageWindows[0]
$selected = $selectedMatch.Window
$snapshot = @($selectedMatch.Snapshot)
$usageEvidence = $selectedMatch.Evidence
$meterTexts = @($usageEvidence.meterSummary)
$expiryTexts = @($usageEvidence.expiryTexts)
$resetButtons = @($usageEvidence.resetButtons)
$activeTask = @($snapshot | Where-Object {
    $_.Name -match '(?i)(codex|task|job).*(running|working|in progress)|running.*(codex|task|job)'
}).Count -gt 0

if ($meterTexts.Count -eq 0) {
    Block 'BLOCKED_RESET_STATUS_METER_NOT_FOUND' @{
        desktopInteractive = $true
        appWindowFound = $true
        usageSurfaceMatched = $false
        matchedWindow = Convert-ToSafeText $selected.Name 160
        expiryTexts = @($expiryTexts | ForEach-Object { Convert-ToSafeText $_ 220 })
        resetButtons = @($resetButtons | ForEach-Object { Convert-ToSafeText $_ 120 })
        activeCodexTask = [bool]$activeTask
        proofRefs = @('battle-bridge-ui-automation-read-only', 'same-process-usage-surface-scanned')
    }
}
if ($expiryTexts.Count -eq 0) {
    Block 'BLOCKED_RESET_STATUS_EXPIRY_NOT_FOUND' @{
        desktopInteractive = $true
        appWindowFound = $true
        usageSurfaceMatched = $true
        matchedWindow = Convert-ToSafeText $selected.Name 160
        meterSummary = Convert-ToSafeText ($meterTexts -join ' | ') 300
        resetButtons = @($resetButtons | ForEach-Object { Convert-ToSafeText $_ 120 })
        activeCodexTask = [bool]$activeTask
        proofRefs = @('battle-bridge-ui-automation-read-only', 'same-process-usage-surface-scanned')
    }
}
if ($resetButtons.Count -eq 0) {
    Block 'BLOCKED_RESET_STATUS_BUTTON_NOT_FOUND' @{
        desktopInteractive = $true
        appWindowFound = $true
        usageSurfaceMatched = $true
        matchedWindow = Convert-ToSafeText $selected.Name 160
        meterSummary = Convert-ToSafeText ($meterTexts -join ' | ') 300
        expiryTexts = @($expiryTexts | ForEach-Object { Convert-ToSafeText $_ 220 })
        activeCodexTask = [bool]$activeTask
        proofRefs = @('battle-bridge-ui-automation-read-only', 'same-process-usage-surface-scanned')
    }
}

Write-Outcome ([ordered]@{
    ok = $true
    blocker = ''
    finalVerdict = 'CODEX_BANKED_RESET_STATUS_READY'
    observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    desktopInteractive = $true
    appWindowFound = $true
    usageSurfaceMatched = $true
    matchedWindow = Convert-ToSafeText $selected.Name 160
    usageSurfaceKind = Convert-ToSafeText $usageEvidence.surfaceKind 80
    meterSummary = Convert-ToSafeText ($meterTexts -join ' | ') 300
    expiryTexts = @($expiryTexts | ForEach-Object { Convert-ToSafeText $_ 220 })
    resetButtons = @($resetButtons | ForEach-Object { Convert-ToSafeText $_ 120 })
    activeCodexTask = [bool]$activeTask
    proofRefs = @('battle-bridge-ui-automation-read-only', 'same-process-usage-surface-scanned', 'codex-usage-surface-observed') + @($usageEvidence.proofRefs)
}) 0
