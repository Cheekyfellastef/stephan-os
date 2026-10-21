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
    $allProcesses = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
    $seen = @($allProcesses | Where-Object {
        -not [string]::IsNullOrWhiteSpace([string]$_.CommandLine) -and
        ([string]$_.CommandLine).Contains($leaseId)
    })
    $candidateCount = $seen.Count
    # A process can exist even when its CommandLine is hidden or unreadable.
    # Do not treat a zero exact-lease match as a full original-writer exclusion.
    # Emit only an allowlisted uncertainty code, never a PID, SID, username or path.
    $unreadable = @($allProcesses | Where-Object {
        [string]::IsNullOrWhiteSpace([string]$_.CommandLine)
    })
    if ($unreadable.Count -gt 0) {
        $unknown += 'CIM_PROCESS_COMMAND_LINE_UNOBSERVED'
    }
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
