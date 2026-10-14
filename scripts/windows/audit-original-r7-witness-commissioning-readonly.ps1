# Requires PowerShell 5.1+. A bounded, non-authoritative census of the
# independently commissioned r7 Windows witness. No shell input, PID, path,
# service creation, signer installation, ACL mutation, cancellation or lease release.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$serviceName = 'StephanosOriginalR7CustodyWitness'
$leaseId = 'critical-2962-elastic-goal-r7-lease'
$unknown = @()
$servicePresent = $false
$serviceStatus = 'UNKNOWN'
$candidates = $null
$relatedTaskCount = $null

try {
    $observed = @(Get-CimInstance -ClassName Win32_Service -Filter "Name='StephanosOriginalR7CustodyWitness'" -ErrorAction Stop)
    if ($observed.Count -eq 0) {
        $serviceStatus = 'NOT_INSTALLED'
    } elseif ($observed.Count -eq 1) {
        $servicePresent = $true
        $serviceStatus = if (([string]$observed[0].State) -eq 'Running') { 'RUNNING' } else { 'STOPPED' }
    } else {
        $unknown += 'SERVICE_ENUMERATION_UNAVAILABLE'
    }
} catch {
    $unknown += 'SERVICE_ENUMERATION_UNAVAILABLE'
}

try {
    # Count only. The result does NOT prove that detached or WMI/COM
    # writers have stopped. Never publish commands, PIDs, accounts or paths.
    $processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
    # An unreadable/null CommandLine is an UNKNOWN writer, not a clean
    # observation. Protected and other-principal processes may hide it.
    # Do not publish raw command lines, identities or PIDs.
    $unreadable = @($processes | Where-Object {
        $null -eq $_.CommandLine -or [string]::IsNullOrWhiteSpace([string]$_.CommandLine)
    })
    if ($unreadable.Count -gt 0) {
        $unknown += 'PROCESS_ENUMERATION_UNAVAILABLE'
    }
    $matches = @($processes | Where-Object {
        $null -ne $_.CommandLine -and ([string]$_.CommandLine).Contains($leaseId)
    })
    $candidates = $matches.Count
} catch {
    $unknown += 'PROCESS_ENUMERATION_UNAVAILABLE'
}

try {
    # Task names are context, not proof that a task cannot be re-created.
    $tasks = @(Get-ScheduledTask -ErrorAction Stop |
        Where-Object { ([string]$_.TaskName).StartsWith('Stephanos') })
    $relatedTaskCount = $tasks.Count
} catch {
    $unknown += 'SCHEDULED_TASK_ENUMERATION_UNAVAILABLE'
}

# A service record, a zero process count or an ACL read is never
# independent enforcement. Only a separately commissioned Windows OS
# witness with an externally protected signing key and negative write
# probes can establish prospective custody.
$result = [ordered]@{
    schemaVersion = 'stephanos.original-r7-witness-commissioning-audit.v1'
    repository = 'Cheekyfellastef/stephan-os'
    originalLeaseId = $leaseId
    serviceName = $serviceName
    inspectionMode = 'UNPRIVILEGED_READ_ONLY'
    observedAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    servicePresent = [bool]$servicePresent
    serviceStatus = $serviceStatus
    originalProcessCandidateCount = $candidates
    relatedTaskCount = $relatedTaskCount
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
$result | ConvertTo-Json -Depth 4 -Compress
