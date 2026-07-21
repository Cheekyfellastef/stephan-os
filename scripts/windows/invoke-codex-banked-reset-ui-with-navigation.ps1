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

function Write-NavigationBlock([string]$Blocker, [object]$Navigation) {
    $proofRefs = @(Get-PropertyValue $Navigation 'proofRefs' @('codex-usage-panel-fixed-navigation'))
    Write-Outcome ([ordered]@{
        schemaVersion = 'stephanos.codex-banked-reset-ui.v1'
        requestId = $RequestId
        resetId = $ResetId
        resetExpiresAtUtc = $ResetExpiresAtUtc.ToUniversalTime().ToString('o')
        standingOperatorPolicyRef = $StandingOperatorPolicyRef
        ok = $false
        blocker = $Blocker
        finalVerdict = 'CODEX_BANKED_RESET_EXECUTION_BLOCKED'
        observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        completedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        desktopInteractive = [Environment]::UserInteractive
        appWindowFound = [bool](Get-PropertyValue $Navigation 'matchedWindow' '')
        usageSurfaceMatched = $false
        matchedWindow = Convert-ToSafeText (Get-PropertyValue $Navigation 'matchedWindow' '') 160
        matchedProfileControl = Convert-ToSafeText (Get-PropertyValue $Navigation 'matchedProfileControl' '') 120
        matchedUsageControl = Convert-ToSafeText (Get-PropertyValue $Navigation 'matchedUsageControl' '') 160
        matchedUsageLabel = Convert-ToSafeText (Get-PropertyValue $Navigation 'matchedUsageLabel' '') 160
        usageControlResolution = Convert-ToSafeText (Get-PropertyValue $Navigation 'usageControlResolution' '') 80
        navigationAttempted = [bool](Get-PropertyValue $Navigation 'navigationAttempted' $false)
        profileMenuOpened = [bool](Get-PropertyValue $Navigation 'profileMenuOpened' $false)
        usagePanelOpened = [bool](Get-PropertyValue $Navigation 'usagePanelOpened' $false)
        meterBefore = ''
        meterAfter = ''
        pressAttempted = $false
        pressCount = 0
        meterRestored = $false
        resetControlDisappeared = $false
        fixedUiActionOnly = $true
        singlePressOnly = $true
        arbitraryShellAllowed = $false
        arbitraryBrowserAutomationAllowed = $false
        credentialsMayBeReadOrExported = $false
        repeatedPressAllowed = $false
        proofRefs = $proofRefs
    }) 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$navigationModule = Join-Path $scriptDir 'codex-banked-reset-ui-navigation.psm1'
$coreScript = Join-Path $scriptDir 'invoke-codex-banked-reset-ui.ps1'
if (-not (Test-Path -LiteralPath $navigationModule -PathType Leaf)) {
    Write-NavigationBlock 'BLOCKED_RESET_NAVIGATION_MODULE_MISSING' $null
}
if (-not (Test-Path -LiteralPath $coreScript -PathType Leaf)) {
    Write-NavigationBlock 'BLOCKED_RESET_EXECUTOR_CORE_MISSING' $null
}

Import-Module $navigationModule -Force
$navigation = Open-CodexUsagePanel
if ((Get-PropertyValue $navigation 'ok' $false) -ne $true) {
    Write-NavigationBlock (Convert-ToSafeText (Get-PropertyValue $navigation 'blocker' 'BLOCKED_RESET_USAGE_PANEL_NAVIGATION_FAILED') 160) $navigation
}

$hostPath = (Get-Process -Id $PID -ErrorAction Stop).Path
$coreOutput = & $hostPath `
    -NoProfile `
    -NonInteractive `
    -ExecutionPolicy Bypass `
    -File $coreScript `
    -RequestId $RequestId `
    -ResetId $ResetId `
    -ResetExpiresAtUtc $ResetExpiresAtUtc.ToUniversalTime().ToString('o') `
    -LatestSafeExecutionUtc $LatestSafeExecutionUtc.ToUniversalTime().ToString('o') `
    -StandingOperatorPolicyRef $StandingOperatorPolicyRef
$coreExitCode = $LASTEXITCODE
try {
    $payload = $coreOutput | ConvertFrom-Json -ErrorAction Stop
} catch {
    Write-NavigationBlock 'BLOCKED_RESET_EXECUTOR_CORE_OUTPUT_INVALID' $navigation
}

$payload | Add-Member -NotePropertyName navigationAttempted -NotePropertyValue ([bool](Get-PropertyValue $navigation 'navigationAttempted' $false)) -Force
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
