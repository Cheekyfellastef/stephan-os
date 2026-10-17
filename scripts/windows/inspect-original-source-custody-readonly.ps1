# Requires: PowerShell 5.1+. Read-only census of the exact historical #2962 r7 blocker.
# No process termination, ACL mutation, signing, lease release or machine provisioning.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$leaseId = 'critical-2962-elastic-goal-r7-lease'
$unknown = @()
$candidateCount = $null
$taskCount = $null
$aclReadable = $false
$checkoutPresent = $false

try {
    $checkoutPresent = (Test-Path -LiteralPath (Join-Path $repoRoot '.git') -PathType Container)
} catch { $unknown += 'CHECKOUT_PROBE_UNAVAILABLE' }

try {
    # Count only; do not export command lines, usernames, paths, tokens or PIDs.
    # This is a heuristic, never evidence that other writers do not exist.
    $seen = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop |
        Where-Object { ([string]$_.CommandLine).Contains($leaseId) })
    $candidateCount = $seen.Count
} catch { $unknown += 'CIM_PROCESS_INVENTORY_UNAVAILABLE' }

try {
    # Task name census is contextual. WMI/COM, services and direct shell
    # launches are deliberately not considered excluded by this read.
    $found = @(Get-ScheduledTask -ErrorAction Stop |
        Where-Object { ([string]$_.TaskName).StartsWith('Stephanos') })
    $taskCount = $found.Count
} catch { $unknown += 'TASK_INVENTORY_UNAVAILABLE' }

try {
    if ($checkoutPresent) {
        $null = Get-Acl -LiteralPath $repoRoot -ErrorAction Stop
        $aclReadable = $true
    } else { $unknown += 'CHECKOUT_UNAVAILABLE' }
} catch { $unknown += 'CHECKOUT_ACL_UNAVAILABLE' }

# These facts cannot attest historic terminal execution or current OS denial.
# A different, independently commissioned OS principal must witness exclusion
# of the original writer, out-of-job launches and ACL/scheduled-task re-entry.
$result = [ordered]@{
    schemaVersion = 'stephanos.original-source-custody-readonly-census.v1'
    repository = 'Cheekyfellastef/stephan-os'
    originalLeaseId = $leaseId
    inspectionMode = 'UNPRIVILEGED_READ_ONLY'
    inspectedAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    checkoutPresent = [bool]$checkoutPresent
    aclReadable = [bool]$aclReadable
    candidateProcessCount = $candidateCount
    stephanosScheduledTaskCount = $taskCount
    unknownObservations = @($unknown | Sort-Object -Unique)
    historicalExecutionOutcome = 'UNKNOWN'
    originalReceiptReconstructed = $false
    independentWindowsExclusionProven = $false
    outOfJobWriterExclusionProven = $false
    sourceAclDenialProven = $false
    independentOperatorApprovalProven = $false
    leaseReleaseAuthorized = $false
    sourceMutationAuthorized = $false
    finalVerdict = 'INSPECTION_ONLY_CUSTODY_HOLD'
}
$result | ConvertTo-Json -Depth 5 -Compress
