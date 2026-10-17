# Read-only, source-head-pinned diagnostic for the exact original #2962/r7 witness.
# No arguments, service control, privileges, writes, signer or lease operations.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$serviceName = 'StephanosOriginalR7CustodyWitness'
$leaseId = 'critical-2962-elastic-goal-r7-lease'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$unknown = @()
$servicePresent = $false
$serviceStatus = 'NOT_INSTALLED'
$processCount = $null
$taskCount = $null

try {
    # Pin the service name in the source. Never accept an input name or image.
    $services = @(Get-CimInstance -ClassName Win32_Service -Filter "Name='$serviceName'" -ErrorAction Stop)
    if ($services.Count -gt 1) {
        $serviceStatus = 'UNKNOWN'
        $unknown += 'SERVICE_ENUMERATION_UNAVAILABLE'
    } elseif ($services.Count -eq 1) {
        $servicePresent = $true
        if ([string]$services[0].State -eq 'Running') {
            $serviceStatus = 'RUNNING'
        } elseif ([string]$services[0].State -eq 'Stopped') {
            $serviceStatus = 'STOPPED'
        } else {
            $serviceStatus = 'UNKNOWN'
        }
    }
} catch {
    $serviceStatus = 'UNKNOWN'
    $unknown += 'SERVICE_ENUMERATION_UNAVAILABLE'
}

try {
    # Diagnostic candidate count, not authenticated original token provenance.
    $candidates = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop |
        Where-Object { ([string]$_.CommandLine).Contains($leaseId) })
    $processCount = $candidates.Count
} catch { $unknown += 'PROCESS_ENUMERATION_UNAVAILABLE' }

try {
    $tasks = @(Get-ScheduledTask -ErrorAction Stop |
        Where-Object { ([string]$_.TaskName).StartsWith('Stephanos') })
    $taskCount = $tasks.Count
} catch { $unknown += 'SCHEDULED_TASK_ENUMERATION_UNAVAILABLE' }

try {
    # No ACL inspection or file content is emitted.
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.git'))) {
        $unknown += 'CHECKOUT_INSPECTION_UNAVAILABLE'
    }
} catch { $unknown += 'CHECKOUT_INSPECTION_UNAVAILABLE' }

# Even a RUNNING service, zero candidates and a readable checkout are not
# authenticated writer exclusion, operator approval or a commissioned signer.
$report = [ordered]@{
    schemaVersion = 'stephanos.original-r7-witness-commissioning-audit.v1'
    repository = 'Cheekyfellastef/stephan-os'
    originalLeaseId = $leaseId
    serviceName = $serviceName
    inspectionMode = 'UNPRIVILEGED_READ_ONLY'
    observedAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    servicePresent = [bool]$servicePresent
    serviceStatus = $serviceStatus
    originalProcessCandidateCount = $processCount
    relatedTaskCount = $taskCount
    unknownObservations = @($unknown | Sort-Object -Unique)
    privilegedServiceSidVerified = $false
    sourceAclDenialEnforced = $false
    outOfJobWritersExcluded = $false
    wmiComRelaunchDenied = $false
    scheduledTaskRelaunchDenied = $false
    trustRootsVerified = $false
    independentOperatorSignatureVerified = $false
    leaseReleaseAuthorized = $false
    sourceMutationAuthorized = $false
    finalVerdict = 'COMMISSIONING_NOT_PROVEN'
}
$report | ConvertTo-Json -Depth 4 -Compress
