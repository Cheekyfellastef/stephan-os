[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$taskName = 'Stephanos Battle Bridge Recovery Mesh'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$info = if ($task) { Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue } else { $null }
$workspaceRoot = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'
$statusPath = Join-Path $workspaceRoot 'status\battle-bridge-recovery-mesh-current.json'
$status = $null
if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
    try { $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json } catch { $status = [pscustomobject]@{ classification = 'RECOVERY_MESH_STATUS_INVALID' } }
}

# Reuse this already captured fixed-runtime status script to inspect the
# original mailbox and A/B Lifeboat. This is NOT a wake or repair operation.
function Read-BoundedObservation([string]$Path) {
    try {
        $file = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
        if (-not ($file -is [IO.FileInfo]) -or
            ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            $file.Length -lt 2 -or $file.Length -gt 65536) { return $null }
        return (Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop)
    } catch { return $null }
}
function Fixed-TaskObservation([string]$Name) {
    $found = $null
    try { $found = Get-ScheduledTask -TaskName $Name -TaskPath '\' -ErrorAction Stop }
    catch {
        # Get-ScheduledTask errors do not prove that a task is absent.
        # Keep the native writer/installer in HOLD rather than claiming false absence.
        return [ordered]@{
            installed = $null
            enabled = $null
            state = 'UNPROVEN'
            lastResult = $null
            lastRunAtUtc = ''
            exactTaskIdentityProven = $false
        }
    }
    $status = $null
    try { $status = Get-ScheduledTaskInfo -TaskName $Name -TaskPath '\' -ErrorAction Stop } catch {}
    return [ordered]@{
        installed = $true
        enabled = if ($null -ne $found.Settings) { [bool]$found.Settings.Enabled } else { $null }
        state = [string]$found.State
        lastResult = if ($null -ne $status) { [int64]$status.LastTaskResult } else { $null }
        lastRunAtUtc = if ($null -ne $status -and $status.LastRunTime.Year -gt 2000) {
            $status.LastRunTime.ToUniversalTime().ToString('o')
        } else { '' }
        exactTaskIdentityProven = $false
    }
}
function Safe-Code([object]$Record, [string]$Name) {
    if ($null -eq $Record) { return '' }
    $field = $Record.PSObject.Properties[$Name]
    if ($null -eq $field) { return '' }
    $value = [string]$field.Value
    if ($value -cmatch '^[A-Za-z][A-Za-z0-9_:-]{0,119}$') { return $value }
    return ''
}
$mailbox = Fixed-TaskObservation 'Stephanos Battle Bridge GitHub Command Mailbox'
$lifeboat = Fixed-TaskObservation 'Stephanos Battle Bridge Recovery Lifeboat'
$localWorkspace = Join-Path $env:USERPROFILE 'Documents\Stephanos\shared-agent-workspace'
$lockPath = Join-Path $localWorkspace 'github-command-mailbox\receipt-publication-deferred-v1.json.lock-v1.json'
$lockState = 'UNPROVEN'
try { $lockState = if (Test-Path -LiteralPath $lockPath -PathType Leaf) { 'PRESENT_OWNER_UNVERIFIED' } else { 'DEFAULT_ROOT_ABSENT_CANONICAL_ROOT_UNPROVEN' } } catch {}
$lifeboatRoot = Join-Path $env:LOCALAPPDATA 'Stephanos\BattleBridgeRecoveryLifeboat'
$recovery = Read-BoundedObservation (Join-Path $lifeboatRoot 'status\mobile-recovery-current.json')
$active = Read-BoundedObservation (Join-Path $lifeboatRoot 'state\active-bank.json')
$bankId = Safe-Code $active 'activeBank'
if ($bankId -cnotin @('A', 'B')) { $bankId = '' }
$bankHeartbeat = $null
if ($bankId) { $bankHeartbeat = Read-BoundedObservation (Join-Path $lifeboatRoot ("status\bank-$bankId-heartbeat.json")) }

[pscustomobject]@{
    schemaVersion = 'stephanos.battle-bridge-recovery-mesh-status.v1'
    taskName = $taskName
    installed = [bool]$task
    state = if ($task) { [string]$task.State } else { 'Missing' }
    lastTaskResult = if ($info) { [int64]$info.LastTaskResult } else { -1 }
    lastRunTimeUtc = if ($info -and $info.LastRunTime.Year -gt 2000) { $info.LastRunTime.ToUniversalTime().ToString('o') } else { '' }
    nextRunTimeUtc = if ($info -and $info.NextRunTime.Year -gt 2000) { $info.NextRunTime.ToUniversalTime().ToString('o') } else { '' }
    status = $status
    maximumConcurrentExecutors = 1
    mailboxTask = $mailbox
    lifeboatTask = $lifeboat
    mailboxGuardLockState = $lockState
    mailboxGuardOwnerProven = $false
    lifeboatActiveBank = $bankId
    lifeboatBankPayloadVerified = ($null -ne $bankHeartbeat -and $null -ne $bankHeartbeat.PSObject.Properties['payloadVerified'] -and $bankHeartbeat.PSObject.Properties['payloadVerified'].Value -eq $true)
    lifeboatGithubClaimVerdict = (Safe-Code $bankHeartbeat 'githubClaimVerdict')
    lifeboatRemoteAccessHealVerdict = (Safe-Code $bankHeartbeat 'remoteAccessAutoHealVerdict')
    lifeboatNativeRecoveryVerdict = (Safe-Code $recovery 'verdict')
    lifeboatNativeRecoveryRequestId = (Safe-Code $recovery 'requestId')
    lifeboatNativeRecoveryReceiptId = (Safe-Code $recovery 'receiptId')
    nativeMailboxIngressProven = $false
    mailboxCutoverProven = $false
    readOnly = $true
    taskStartAllowed = $false
    guardLockMutationAllowed = $false
    arbitraryShellAllowed = $false
    sourceMutationAllowed = $false
    pcRestartAllowed = $false
} | ConvertTo-Json -Depth 10
