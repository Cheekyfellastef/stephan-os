[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$')]
    [string]$RequestId
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:SecretPattern = '(?i)secret|token|session|password|credential|private[_-]?key|api[_-]?key|cookie|\.env\b|BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY'

function Convert-ToSafeText([object]$Value, [int]$Limit = 220) {
    $text = [string]$Value
    $text = ($text -replace '[\r\n\t]+', ' ' -replace '\s+', ' ').Trim()
    if ($text.Length -gt $Limit) { return $text.Substring(0, $Limit) }
    return $text
}

function Convert-ToSafeDiagnosticText([object]$Value, [int]$Limit = 220) {
    $text = Convert-ToSafeText $Value $Limit
    if (-not $text -or $text -match $script:SecretPattern) { return '' }
    return $text
}

function Get-PropertyValue([object]$Object, [string]$Name, [object]$Default = $null) {
    if ($null -eq $Object) { return $Default }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $Default }
    return $property.Value
}

function Write-Outcome([hashtable]$Outcome, [int]$ExitCode) {
    [Console]::Out.WriteLine(($Outcome | ConvertTo-Json -Depth 8 -Compress))
    exit $ExitCode
}

function Write-BlockedStatus([string]$Blocker, [object]$Navigation = $null) {
    Write-Outcome ([ordered]@{
        schemaVersion = 'stephanos.codex-banked-reset-status-ui.v1'
        requestId = $RequestId
        ok = $false
        blocker = $Blocker
        finalVerdict = 'CODEX_BANKED_RESET_STATUS_BLOCKED'
        observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        desktopInteractive = [Environment]::UserInteractive
        appWindowFound = [bool](Get-PropertyValue $Navigation 'matchedWindow' '')
        usageSurfaceMatched = $false
        meterSummary = ''
        expiryTexts = @()
        resetButtons = @()
        activeCodexTask = $false
        readOnly = $true
        pressAttempted = $false
        pressCount = 0
        navigationAttempted = [bool](Get-PropertyValue $Navigation 'navigationAttempted' $false)
        navigationRetryCount = [int](Get-PropertyValue $Navigation 'navigationRetryCount' 0)
        profileMenuOpened = [bool](Get-PropertyValue $Navigation 'profileMenuOpened' $false)
        usagePanelOpened = [bool](Get-PropertyValue $Navigation 'usagePanelOpened' $false)
        matchedWindow = Convert-ToSafeText (Get-PropertyValue $Navigation 'matchedWindow' '') 160
        matchedProfileControl = Convert-ToSafeText (Get-PropertyValue $Navigation 'matchedProfileControl' '') 120
        matchedUsageControl = Convert-ToSafeText (Get-PropertyValue $Navigation 'matchedUsageControl' '') 160
        matchedUsageLabel = Convert-ToSafeText (Get-PropertyValue $Navigation 'matchedUsageLabel' '') 160
        usageControlResolution = Convert-ToSafeText (Get-PropertyValue $Navigation 'usageControlResolution' '') 80
        error = Convert-ToSafeDiagnosticText (Get-PropertyValue $Navigation 'error' '') 300
        profileCandidates = @((Get-PropertyValue $Navigation 'profileCandidates' @()) | ForEach-Object { Convert-ToSafeText $_ 120 })
        usageCandidates = @((Get-PropertyValue $Navigation 'usageCandidates' @()) | ForEach-Object { Convert-ToSafeText $_ 120 })
        usageLabelCandidates = @((Get-PropertyValue $Navigation 'usageLabelCandidates' @()) | ForEach-Object { Convert-ToSafeText $_ 120 })
        proofRefs = @(Get-PropertyValue $Navigation 'proofRefs' @('codex-usage-panel-fixed-navigation'))
        arbitraryShellAllowed = $false
        arbitraryBrowserAutomationAllowed = $false
        credentialsMayBeReadOrExported = $false
    }) 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$navigationModule = Join-Path $scriptDir 'codex-banked-reset-ui-navigation.psm1'
$coreScript = Join-Path $scriptDir 'read-codex-banked-reset-status.ps1'
if (-not (Test-Path -LiteralPath $navigationModule -PathType Leaf)) {
    Write-BlockedStatus 'BLOCKED_RESET_NAVIGATION_MODULE_MISSING'
}
if (-not (Test-Path -LiteralPath $coreScript -PathType Leaf)) {
    Write-BlockedStatus 'BLOCKED_RESET_STATUS_CORE_MISSING'
}

try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
} catch {
    Write-BlockedStatus 'BLOCKED_RESET_UI_AUTOMATION_PRELOAD_FAILED' ([pscustomobject]@{
        error = Convert-ToSafeDiagnosticText $_.Exception.Message 300
        proofRefs = @('codex-usage-panel-fixed-navigation', 'uia-preload-failed')
    })
}

try {
    Import-Module $navigationModule -Force -ErrorAction Stop
} catch {
    Write-BlockedStatus 'BLOCKED_RESET_NAVIGATION_MODULE_IMPORT_FAILED' ([pscustomobject]@{
        error = Convert-ToSafeDiagnosticText $_.Exception.Message 300
        proofRefs = @('codex-usage-panel-fixed-navigation', 'navigation-module-import-failed')
    })
}

$navigation = $null
$navigationRetryCount = 0
$firstNavigationError = ''
try {
    $navigation = Open-CodexUsagePanel
} catch {
    $firstNavigationError = Convert-ToSafeDiagnosticText $_.Exception.Message 300
    $navigationRetryCount = 1
    Start-Sleep -Milliseconds 350
    try {
        $navigation = Open-CodexUsagePanel
    } catch {
        $retryError = Convert-ToSafeDiagnosticText $_.Exception.Message 300
        $combinedRetryError = Convert-ToSafeDiagnosticText ("first: $firstNavigationError | retry: $retryError") 300
        Write-BlockedStatus 'BLOCKED_RESET_USAGE_PANEL_NAVIGATION_EXCEPTION' ([pscustomobject]@{
            error = $combinedRetryError
            navigationRetryCount = 1
            proofRefs = @('codex-usage-panel-fixed-navigation', 'navigation-exception-retry-failed')
        })
    }
}
if ($null -eq $navigation) {
    Write-BlockedStatus 'BLOCKED_RESET_USAGE_PANEL_NAVIGATION_NO_RESULT' ([pscustomobject]@{
        error = $firstNavigationError
        navigationRetryCount = $navigationRetryCount
        proofRefs = @('codex-usage-panel-fixed-navigation', 'navigation-no-result')
    })
}
$navigation | Add-Member -NotePropertyName navigationRetryCount -NotePropertyValue $navigationRetryCount -Force
if ($navigationRetryCount -eq 1) {
    $navigation | Add-Member -NotePropertyName error -NotePropertyValue $firstNavigationError -Force
    $retryProofRefs = @((Get-PropertyValue $navigation 'proofRefs' @())) + @('navigation-exception-retry-pass')
    $navigation | Add-Member -NotePropertyName proofRefs -NotePropertyValue @($retryProofRefs | Select-Object -Unique) -Force
}
if ((Get-PropertyValue $navigation 'ok' $false) -ne $true) {
    Write-BlockedStatus (Convert-ToSafeText (Get-PropertyValue $navigation 'blocker' 'BLOCKED_RESET_USAGE_PANEL_NAVIGATION_FAILED') 160) $navigation
}

try {
    $hostPath = (Get-Process -Id $PID -ErrorAction Stop).Path
    $coreOutput = & $hostPath -NoProfile -Sta -ExecutionPolicy Bypass -File $coreScript -RequestId $RequestId
    $coreExitCode = $LASTEXITCODE
} catch {
    $navigation | Add-Member -NotePropertyName error -NotePropertyValue (Convert-ToSafeDiagnosticText $_.Exception.Message 300) -Force
    Write-BlockedStatus 'BLOCKED_RESET_STATUS_CORE_LAUNCH_FAILED' $navigation
}
try {
    $payload = $coreOutput | ConvertFrom-Json -ErrorAction Stop
} catch {
    $navigation | Add-Member -NotePropertyName error -NotePropertyValue (Convert-ToSafeDiagnosticText $_.Exception.Message 300) -Force
    Write-BlockedStatus 'BLOCKED_RESET_STATUS_CORE_OUTPUT_INVALID' $navigation
}

$payload | Add-Member -NotePropertyName navigationAttempted -NotePropertyValue ([bool](Get-PropertyValue $navigation 'navigationAttempted' $false)) -Force
$payload | Add-Member -NotePropertyName navigationRetryCount -NotePropertyValue $navigationRetryCount -Force
$payload | Add-Member -NotePropertyName profileMenuOpened -NotePropertyValue ([bool](Get-PropertyValue $navigation 'profileMenuOpened' $false)) -Force
$payload | Add-Member -NotePropertyName usagePanelOpened -NotePropertyValue ([bool](Get-PropertyValue $navigation 'usagePanelOpened' $false)) -Force
$payload | Add-Member -NotePropertyName matchedProfileControl -NotePropertyValue (Convert-ToSafeText (Get-PropertyValue $navigation 'matchedProfileControl' '') 120) -Force
$payload | Add-Member -NotePropertyName matchedUsageControl -NotePropertyValue (Convert-ToSafeText (Get-PropertyValue $navigation 'matchedUsageControl' '') 160) -Force
$payload | Add-Member -NotePropertyName matchedUsageLabel -NotePropertyValue (Convert-ToSafeText (Get-PropertyValue $navigation 'matchedUsageLabel' '') 160) -Force
$payload | Add-Member -NotePropertyName usageControlResolution -NotePropertyValue (Convert-ToSafeText (Get-PropertyValue $navigation 'usageControlResolution' '') 80) -Force
$proofRefs = @($payload.proofRefs) + @(Get-PropertyValue $navigation 'proofRefs' @())
$payload | Add-Member -NotePropertyName proofRefs -NotePropertyValue @($proofRefs | Select-Object -Unique) -Force
[Console]::Out.WriteLine(($payload | ConvertTo-Json -Depth 8 -Compress))
exit $coreExitCode
