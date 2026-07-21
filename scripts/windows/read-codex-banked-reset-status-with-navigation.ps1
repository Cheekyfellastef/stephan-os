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
        profileMenuOpened = [bool](Get-PropertyValue $Navigation 'profileMenuOpened' $false)
        usagePanelOpened = [bool](Get-PropertyValue $Navigation 'usagePanelOpened' $false)
        matchedWindow = Convert-ToSafeText (Get-PropertyValue $Navigation 'matchedWindow' '') 160
        matchedProfileControl = Convert-ToSafeText (Get-PropertyValue $Navigation 'matchedProfileControl' '') 120
        matchedUsageControl = Convert-ToSafeText (Get-PropertyValue $Navigation 'matchedUsageControl' '') 160
        profileCandidates = @((Get-PropertyValue $Navigation 'profileCandidates' @()) | ForEach-Object { Convert-ToSafeText $_ 120 })
        usageCandidates = @((Get-PropertyValue $Navigation 'usageCandidates' @()) | ForEach-Object { Convert-ToSafeText $_ 120 })
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

Import-Module $navigationModule -Force
$navigation = Open-CodexUsagePanel
if ((Get-PropertyValue $navigation 'ok' $false) -ne $true) {
    Write-BlockedStatus (Convert-ToSafeText (Get-PropertyValue $navigation 'blocker' 'BLOCKED_RESET_USAGE_PANEL_NAVIGATION_FAILED') 160) $navigation
}

$hostPath = (Get-Process -Id $PID -ErrorAction Stop).Path
$coreOutput = & $hostPath -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $coreScript -RequestId $RequestId
$coreExitCode = $LASTEXITCODE
try {
    $payload = $coreOutput | ConvertFrom-Json -ErrorAction Stop
} catch {
    Write-BlockedStatus 'BLOCKED_RESET_STATUS_CORE_OUTPUT_INVALID' $navigation
}

$payload | Add-Member -NotePropertyName navigationAttempted -NotePropertyValue ([bool](Get-PropertyValue $navigation 'navigationAttempted' $false)) -Force
$payload | Add-Member -NotePropertyName profileMenuOpened -NotePropertyValue ([bool](Get-PropertyValue $navigation 'profileMenuOpened' $false)) -Force
$payload | Add-Member -NotePropertyName usagePanelOpened -NotePropertyValue ([bool](Get-PropertyValue $navigation 'usagePanelOpened' $false)) -Force
$payload | Add-Member -NotePropertyName matchedProfileControl -NotePropertyValue (Convert-ToSafeText (Get-PropertyValue $navigation 'matchedProfileControl' '') 120) -Force
$payload | Add-Member -NotePropertyName matchedUsageControl -NotePropertyValue (Convert-ToSafeText (Get-PropertyValue $navigation 'matchedUsageControl' '') 160) -Force
$proofRefs = @($payload.proofRefs) + @(Get-PropertyValue $navigation 'proofRefs' @())
$payload | Add-Member -NotePropertyName proofRefs -NotePropertyValue @($proofRefs | Select-Object -Unique) -Force
[Console]::Out.WriteLine(($payload | ConvertTo-Json -Depth 8 -Compress))
exit $coreExitCode
