[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($args.Count -ne 0) { throw 'SOVEREIGN_MAILBOX_STATUS_ARGUMENTS_NOT_ALLOWED' }

function Task-Observation([string]$Name) {
    try {
        $task = Get-ScheduledTask -TaskName $Name -ErrorAction Stop
        $info = Get-ScheduledTaskInfo -TaskName $Name -ErrorAction Stop
        return [ordered]@{
            installed = $true
            enabled = [bool]$task.Settings.Enabled
            state = [string]$task.State
            lastRunAtUtc = if ($info.LastRunTime.Year -ge 2000) { $info.LastRunTime.ToUniversalTime().ToString('o') } else { '' }
            lastTaskResult = [int64]$info.LastTaskResult
            identityVerified = $false
        }
    } catch {
        return [ordered]@{
            installed = $false
            enabled = $false
            state = 'UNPROVEN'
            lastRunAtUtc = ''
            lastTaskResult = -1
            identityVerified = $false
        }
    }
}

function Read-BoundedStatus([string]$Path) {
    try {
        $info = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
        if (-not ($info -is [System.IO.FileInfo]) -or ($info.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or $info.Length -lt 2 -or $info.Length -gt 65536) { return $null }
        return (Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop)
    } catch { return $null }
}

function Bounded-Code([object]$Value) {
    $string = [string]$Value
    if ($string -cmatch '^[A-Za-z][A-Za-z0-9_:-]{0,119}
$profileRoot = [string]$env:USERPROFILE
$localAppData = [string]$env:LOCALAPPDATA
if ([string]::IsNullOrWhiteSpace($profileRoot) -or [string]::IsNullOrWhiteSpace($localAppData)) {
    [pscustomobject]@{
        schemaVersion = 'stephanos.sovereign-mailbox-lifeboat-observation.v1'
        ok = $false
        blocker = 'FIXED_USER_PROFILE_UNAVAILABLE'
        readOnly = $true
        taskStartAllowed = $false
        guardLockMutationAllowed = $false
        sourceMutationAllowed = $false
        pcRestartAllowed = $false
    } | ConvertTo-Json -Depth 5
    exit 0
}

$mailboxTask = Task-Observation 'Stephanos Battle Bridge GitHub Command Mailbox'
$lifeboatTask = Task-Observation 'Stephanos Battle Bridge Recovery Lifeboat'
$sharedRoot = Join-Path $profileRoot 'Documents\Stephanos\shared-agent-workspace'
$lifeboatRoot = Join-Path $localAppData 'Stephanos\BattleBridgeRecoveryLifeboat'
$lockFile = Join-Path $sharedRoot 'github-command-mailbox\receipt-publication-deferred-v1.json.lock-v1.json'
$recovery = Read-BoundedStatus (Join-Path $lifeboatRoot 'status\mobile-recovery-current.json')
$activeBank = Read-BoundedStatus (Join-Path $lifeboatRoot 'state\active-bank.json')

$lockState = 'UNPROVEN'
try { $lockState = if (Test-Path -LiteralPath $lockFile -PathType Leaf) { 'PRESENT_OWNER_UNVERIFIED' } else { 'ABSENT_AT_OBSERVATION' } } catch {}

$bankId = ''
if ($null -ne $activeBank -and [string]$activeBank.activeBank -cin @('A', 'B')) { $bankId = [string]$activeBank.activeBank }
$bankHeartbeat = $null
if ($bankId) {
    $bankHeartbeat = Read-BoundedStatus (Join-Path $lifeboatRoot ("status\bank-$bankId-heartbeat.json"))
}
$claimVerdict = Safe-StatusCode $bankHeartbeat 'githubClaimVerdict'
$healVerdict = Safe-StatusCode $bankHeartbeat 'remoteAccessAutoHealVerdict'
$latestRequestId = Safe-StatusCode $recovery 'requestId'
$nativeVerdict = Safe-StatusCode $recovery 'verdict'
$nativeReceiptId = Safe-StatusCode $recovery 'receiptId'

[pscustomobject]@{
    schemaVersion = 'stephanos.sovereign-mailbox-lifeboat-observation.v1'
    observedAtUtc = [DateTime]::UtcNow.ToString('o')
    ok = $true
    mailboxTask = $mailboxTask
    lifeboatTask = $lifeboatTask
    guardLockState = $lockState
    guardLockOwnerVerified = $false
    lifeboatActiveBank = $bankId
    lifeboatBankPayloadVerified = ($null -ne $bankHeartbeat -and $bankHeartbeat.payloadVerified -eq $true)
    githubClaimVerdict = $claimVerdict
    remoteAccessAutoHealVerdict = $healVerdict
    nativeRecoveryVerdict = $nativeVerdict
    nativeRecoveryRequestId = $latestRequestId
    nativeRecoveryReceiptId = $nativeReceiptId
    nativeRecoveryTargetHealthy = ($null -ne $recovery -and $recovery.targetComponentHealthy -eq $true)
    nativeMailboxIngressProven = $false
    mailboxCutoverProven = $false
    readOnly = $true
    taskStartAllowed = $false
    guardLockMutationAllowed = $false
    sourceMutationAllowed = $false
    gitMutationAllowed = $false
    mergeAuthority = $false
    pcRestartAllowed = $false
    finalVerdict = 'SOVEREIGN_MAILBOX_LIFEBOAT_OBSERVATION_ONLY'
} | ConvertTo-Json -Depth 8
) { return $string }
    return ''
}

function Safe-StatusCode([object]$Value, [string]$Name) {
    if ($null -eq $Value) { return '' }
    $property = $Value.PSObject.Properties[$Name]
    if ($null -eq $property) { return '' }
    return (Bounded-Code $property.Value)
}

$profileRoot = [string]$env:USERPROFILE
$localAppData = [string]$env:LOCALAPPDATA
if ([string]::IsNullOrWhiteSpace($profileRoot) -or [string]::IsNullOrWhiteSpace($localAppData)) {
    [pscustomobject]@{
        schemaVersion = 'stephanos.sovereign-mailbox-lifeboat-observation.v1'
        ok = $false
        blocker = 'FIXED_USER_PROFILE_UNAVAILABLE'
        readOnly = $true
        taskStartAllowed = $false
        guardLockMutationAllowed = $false
        sourceMutationAllowed = $false
        pcRestartAllowed = $false
    } | ConvertTo-Json -Depth 5
    exit 0
}

$mailboxTask = Task-Observation 'Stephanos Battle Bridge GitHub Command Mailbox'
$lifeboatTask = Task-Observation 'Stephanos Battle Bridge Recovery Lifeboat'
$sharedRoot = Join-Path $profileRoot 'Documents\Stephanos\shared-agent-workspace'
$lifeboatRoot = Join-Path $localAppData 'Stephanos\BattleBridgeRecoveryLifeboat'
$lockFile = Join-Path $sharedRoot 'github-command-mailbox\receipt-publication-deferred-v1.json.lock-v1.json'
$recovery = Read-BoundedStatus (Join-Path $lifeboatRoot 'status\mobile-recovery-current.json')
$activeBank = Read-BoundedStatus (Join-Path $lifeboatRoot 'state\active-bank.json')

$lockState = 'UNPROVEN'
try { $lockState = if (Test-Path -LiteralPath $lockFile -PathType Leaf) { 'PRESENT_OWNER_UNVERIFIED' } else { 'ABSENT_AT_OBSERVATION' } } catch {}

$bankId = ''
if ([string]$activeBank.activeBank -cin @('A', 'B')) { $bankId = [string]$activeBank.activeBank }
$bankHeartbeat = $null
if ($bankId) {
    $bankHeartbeat = Read-BoundedStatus (Join-Path $lifeboatRoot ("status\bank-$bankId-heartbeat.json"))
}
$claimVerdict = Bounded-Code $bankHeartbeat.githubClaimVerdict
$healVerdict = Bounded-Code $bankHeartbeat.remoteAccessAutoHealVerdict
$latestRequestId = Bounded-Code $recovery.requestId
$nativeVerdict = Bounded-Code $recovery.verdict
$nativeReceiptId = Bounded-Code $recovery.receiptId

[pscustomobject]@{
    schemaVersion = 'stephanos.sovereign-mailbox-lifeboat-observation.v1'
    observedAtUtc = [DateTime]::UtcNow.ToString('o')
    ok = $true
    mailboxTask = $mailboxTask
    lifeboatTask = $lifeboatTask
    guardLockState = $lockState
    guardLockOwnerVerified = $false
    lifeboatActiveBank = $bankId
    lifeboatBankPayloadVerified = ($null -ne $bankHeartbeat -and $bankHeartbeat.payloadVerified -eq $true)
    githubClaimVerdict = $claimVerdict
    remoteAccessAutoHealVerdict = $healVerdict
    nativeRecoveryVerdict = $nativeVerdict
    nativeRecoveryRequestId = $latestRequestId
    nativeRecoveryReceiptId = $nativeReceiptId
    nativeRecoveryTargetHealthy = ($null -ne $recovery -and $recovery.targetComponentHealthy -eq $true)
    nativeMailboxIngressProven = $false
    mailboxCutoverProven = $false
    readOnly = $true
    taskStartAllowed = $false
    guardLockMutationAllowed = $false
    sourceMutationAllowed = $false
    gitMutationAllowed = $false
    mergeAuthority = $false
    pcRestartAllowed = $false
    finalVerdict = 'SOVEREIGN_MAILBOX_LIFEBOAT_OBSERVATION_ONLY'
} | ConvertTo-Json -Depth 8
