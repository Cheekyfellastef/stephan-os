[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedHead,
    [ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedLockSha256,
    [switch]$AbsentLock,
    [switch]$OperatorApproved,
    [switch]$RetireOnlyChild
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# A user-writable checkout cannot authenticate the entry bytes already parsed by
# PowerShell, including across an elevation boundary. Keep the public contract,
# but admit no recovery mode until an independently qualified, owner-installed
# immutable bootstrap exists. Historical policy/native fixtures are test data;
# this entry never loads them and never changes a lock or starts a process.
[ordered]@{
    schemaVersion = 'stephanos.core-lock-recovery.v1'
    ok = $false
    finalVerdict = 'CORE_RECOVERY_BLOCKED'
    blocker = 'CORE_RECOVERY_TRUSTED_BOOTSTRAP_REQUIRED'
    expectedHead = $ExpectedHead
    expectedLockSha256 = $ExpectedLockSha256
    observedAtUtc = [DateTime]::UtcNow.ToString('o')
    lockRetired = $false
    coreStartRequested = $false
    buildPickupProven = $false
    leaseReleaseAllowed = $false
    standingElevationCreated = $false
    pcRestartAllowed = $false
} | ConvertTo-Json -Compress
exit 2
