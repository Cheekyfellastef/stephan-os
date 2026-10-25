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
$publisherTaskPresent = $false
$publisherTaskState = 'UNKNOWN'
$publisherLastResultClass = 'UNKNOWN'

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
    $allProcesses = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
    # Some Win32_Process CommandLine fields are null or inaccessible. A zero
    # match count must not imply complete visibility into writer processes.
    if (@($allProcesses | Where-Object { [string]::IsNullOrWhiteSpace([string]$_.CommandLine) }).Count -gt 0) {
        $unknown += 'PROCESS_COMMANDLINE_VISIBILITY_INCOMPLETE'
    }
    $candidates = @($allProcesses | Where-Object { ([string]$_.CommandLine).Contains($leaseId) })
    $processCount = $candidates.Count
} catch { $unknown += 'PROCESS_ENUMERATION_UNAVAILABLE' }

try {
    $tasks = @(Get-ScheduledTask -ErrorAction Stop |
        Where-Object { ([string]$_.TaskName).StartsWith('Stephanos') })
    $taskCount = $tasks.Count
    # Exact task associated with #2962; never infer it owns the R7 lease.
    # Classifications only. Never emit task principal, action, path or PID.
    $publisherMatches = @($tasks | Where-Object { [string]$_.TaskName -eq 'Stephanos Native Capacity Publisher' })
    if ($publisherMatches.Count -eq 0) {
        $publisherTaskState = 'NOT_FOUND'
    } elseif ($publisherMatches.Count -ne 1) {
        $unknown += 'PUBLISHER_TASK_CONTEXT_UNAVAILABLE'
    } else {
        $publisherTaskPresent = $true
        $state = ([string]$publisherMatches[0].State).ToUpperInvariant()
        $publisherTaskState = if ($state -in @('READY', 'RUNNING', 'DISABLED', 'QUEUED')) { $state } else { 'UNKNOWN' }
        try {
            # Bind to the uniquely observed CimInstance, including its TaskPath.
            # Name-only Task Scheduler queries may select a different folder.
            $info = Get-ScheduledTaskInfo -InputObject $publisherMatches[0] -ErrorAction Stop
            if ($null -eq $info -or $null -eq $info.LastRunTime) {
                $unknown += 'PUBLISHER_TASK_CONTEXT_UNAVAILABLE'
            } elseif ([datetime]$info.LastRunTime -eq [datetime]::MinValue) {
                # Task Scheduler can return LastTaskResult=0 even for a task
                # that has NEVER executed. Never project that as success.
                $publisherLastResultClass = 'NEVER_RUN'
            } elseif ($null -ne $info.LastTaskResult) {
                $publisherLastResultClass = if ([long]$info.LastTaskResult -eq 0) { 'ZERO' } else { 'NONZERO' }
            } else { $unknown += 'PUBLISHER_TASK_CONTEXT_UNAVAILABLE' }
        } catch { $unknown += 'PUBLISHER_TASK_CONTEXT_UNAVAILABLE' }
    }
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
    publisherTaskPresent = [bool]$publisherTaskPresent
    publisherTaskState = $publisherTaskState
    publisherLastResultClass = $publisherLastResultClass
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
