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
    [Console]::Out.WriteLine(($Outcome | ConvertTo-Json -Depth 8 -Compress))
    exit $ExitCode
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$navigationModule = Join-Path $scriptDir 'codex-banked-reset-ui-navigation.psm1'
$coreScript = Join-Path $scriptDir 'read-codex-banked-reset-status.ps1'
if (-not (Test-Path -LiteralPath $navigationModule -PathType Leaf)) {
    Write-Outcome ([ordered]@{
        schemaVersion = 'stephanos.codex-banked-reset-status-ui.v1'
        requestId = $RequestId
        ok = $false
        blocker = 'BLOCKED_RESET_NAVIGATION_MODULE_MISSING'
        finalVerdict = 'CODEX_BANKED_RESET_STATUS_BLOCKED'
        observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        desktopInteractive = [Environment]::UserInteractive
        appWindowFound = $false
        usageSurfaceMatched = $false
        meterSummary = ''
        expiryTexts = @()
        resetButtons = @()
        activeCodexTask = $false
        readOnly = $true
        pressAttempted = $false
        pressCount = 0
        navigationAttempted = $false
        profileMenuOpened = $false
        usagePanelOpened = $false
        proofRefs = @('codex-usage-panel-fixed-navigation')
        arbitraryShellAllowed = $false
        arbitraryBrowserAutomationAllowed = $false
        credentialsMayBeReadOrExported = $false
    }) 1
}
if (-not (Test-Path -LiteralPath $coreScript -PathType Leaf)) {
    Write-Outcome ([ordered]@{
        schemaVersion = 'stephanos.codex-banked-reset-status-ui.v1'
        requestId = $RequestId
        ok = $false
        blocker = 'BLOCKED_RESET_STATUS_CORE_MISSING'
        finalVerdict = 'CODEX_BANKED_RESET_STATUS_BLOCKED'
        observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        desktopInteractive = [Environment]::UserInteractive
        appWindowFound = $false
        usageSurfaceMatched = $false
        meterSummary = ''
        expiryTexts = @()
        resetButtons = @()
        activeCodexTask = $false
        readOnly = $true
        pressAttempted = $false
        pressCount = 0
        navigationAttempted = $false
        profileMenuOpened = $false
        usagePanelOpened = $false
        proofRefs = @('codex-usage-panel-fixed-navigation')
        arbitraryShellAllowed = $false
        arbitraryBrowserAutomationAllowed = $false
        credentialsMayBeReadOrExported = $false
    }) 1
}

Import-Module $navigationModule -Force
$navigation = Open-CodexUsagePanel
if ($navigation.ok -ne $true) {
    Write-Outcome ([ordered]@{
        schemaVersion = 'stephanos.codex-banked-reset-status-ui.v1'
        requestId = $RequestId
        ok = $false
        blocker = Convert-ToSafeText $navigation.blocker 160
        finalVerdict = 'CODEX_BANKED_RESET_STATUS_BLOCKED'
        observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        desktopInteractive = [Environment]::UserInteractive
        appWindowFound = [bool]$navigation.matchedWindow
        usageSurfaceMatched = $false
        meterSummary = ''
        expiryTexts = @()
        resetButtons = @()
        activeCodexTask = $false
        readOnly = $true
        pressAttempted = $false
        pressCount = 0
        navigationAttempted = [bool]$navigation.navigationAttempted
        profileMenuOpened = [bool]$navigation.profileMenuOpened
        usagePanelOpened = [bool]$navigation.usagePanelOpened
        matchedWindow = Convert-ToSafeText $navigation.matchedWindow 160
        matchedProfileControl = Convert-ToSafeText $navigation.matchedProfileControl 120
        matchedUsageControl = Convert-ToSafeText $navigation.matchedUsageControl 160
        profileCandidates = @($navigation.profileCandidates | ForEach-Object { Convert-ToSafeText $_ 120 })
        usageCandidates = @($navigation.usageCandidates | ForEach-Object { Convert-ToSafeText $_ 120 })
        proofRefs = @($navigation.proofRefs)
        arbitraryShellAllowed = $false
        arbitraryBrowserAutomationAllowed = $false
        credentialsMayBeReadOrExported = $false
    }) 1
}

$hostPath = (Get-Process -Id $PID -ErrorAction Stop).Path
$coreOutput = & $hostPath -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $coreScript -RequestId $RequestId
$coreExitCode = $LASTEXITCODE
try {
    $payload = $coreOutput | ConvertFrom-Json -ErrorAction Stop
} catch {
    Write-Outcome ([ordered]@{
        schemaVersion = 'stephanos.codex-banked-reset-status-ui.v1'
        requestId = $RequestId
        ok = $false
        blocker = 'BLOCKED_RESET_STATUS_CORE_OUTPUT_INVALID'
        finalVerdict = 'CODEX_BANKED_RESET_STATUS_BLOCKED'
        observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        desktopInteractive = [Environment]::UserInteractive
        appWindowFound = $true
        usageSurfaceMatched = $false
        meterSummary = ''
        expiryTexts = @()
        resetButtons = @()
        activeCodexTask = $false
        readOnly = $true
        pressAttempted = $false
        pressCount = 0
        navigationAttempted = [bool]$navigation.navigationAttempted
        profileMenuOpened = [bool]$navigation.profileMenuOpened
        usagePanelOpened = [bool]$navigation.usagePanelOpened
        matchedWindow = Convert-ToSafeText $navigation.matchedWindow 160
        matchedProfileControl = Convert-ToSafeText $navigation.matchedProfileControl 120
        matchedUsageControl = Convert-ToSafeText $navigation.matchedUsageControl 160
        proofRefs = @($navigation.proofRefs)
        arbitraryShellAllowed = $false
        arbitraryBrowserAutomationAllowed = $false
        credentialsMayBeReadOrExported = $false
    }) 1
}

$payload | Add-Member -NotePropertyName navigationAttempted -NotePropertyValue ([bool]$navigation.navigationAttempted) -Force
$payload | Add-Member -NotePropertyName profileMenuOpened -NotePropertyValue ([bool]$navigation.profileMenuOpened) -Force
$payload | Add-Member -NotePropertyName usagePanelOpened -NotePropertyValue ([bool]$navigation.usagePanelOpened) -Force
$payload | Add-Member -NotePropertyName matchedProfileControl -NotePropertyValue (Convert-ToSafeText $navigation.matchedProfileControl 120) -Force
$payload | Add-Member -NotePropertyName matchedUsageControl -NotePropertyValue (Convert-ToSafeText $navigation.matchedUsageControl 160) -Force
$proofRefs = @($payload.proofRefs) + @($navigation.proofRefs)
$payload | Add-Member -NotePropertyName proofRefs -NotePropertyValue @($proofRefs | Select-Object -Unique) -Force
[Console]::Out.WriteLine(($payload | ConvertTo-Json -Depth 8 -Compress))
exit $coreExitCode
