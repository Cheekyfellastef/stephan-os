param([switch]$OperatorApproved,[switch]$Fixture,[string]$ExpectedMain='')
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
if ($Fixture) {
    if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows' -or
        $env:GITHUB_REPOSITORY -cne 'Cheekyfellastef/stephan-os') { throw 'FIXTURE_HOST_NOT_ADMITTED' }
    . ([IO.Path]::Combine($PSScriptRoot,'sovereign-maintenance-journal-policy-v2.ps1'))
} elseif ($null -eq $script:MaintenanceInstallerPinnedBootstrapV3 -or
    $script:MaintenanceInstallerPinnedBootstrapV3.ExpectedMain -cne $ExpectedMain -or
    $script:MaintenanceInstallerPinnedBootstrapV3.SourceTree -cnotmatch '^[a-f0-9]{40}$' -or
    $script:MaintenanceInstallerPinnedBootstrapV3.ClosureCount -ne 39 -or
    $script:MaintenanceInstallerPinnedBootstrapV3.Handles.Count -lt 39 -or
    $script:MaintenanceInstallerPinnedBootstrapV3.Directories.Count -lt 1) {
    # Direct mutable workspace invocation cannot authenticate itself for elevation.
    throw 'JOURNAL_INSTALL_IMMUTABLE_BOOTSTRAP_REQUIRED'
}
# Registration/configuration is explicit, never performed by normal startup.
if (-not $OperatorApproved) { throw 'JOURNAL_INSTALL_OPERATOR_APPROVAL_REQUIRED' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
try {
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'JOURNAL_INSTALL_ADMINISTRATOR_REQUIRED'
    }
} finally { $identity.Dispose() }
if ($Fixture) {
    if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows' -or
        $env:GITHUB_REPOSITORY -cne 'Cheekyfellastef/stephan-os') { throw 'FIXTURE_HOST_NOT_ADMITTED' }
} else {
    if ($ExpectedMain -cnotmatch '^[a-f0-9]{40}$') { throw 'JOURNAL_INSTALL_EXACT_SOURCE_REQUIRED' }
    # The authenticated bootstrap pins all source bytes and directories before
    # compiling the host. Only this fixed native API launches the source probe.
    $sourceProof = [Stephanos.Sovereign.CoreJobCustodyV1]::ReadMaintenanceCanonicalSource($ExpectedMain)
    if (-not $sourceProof.Passed -or -not $sourceProof.AssignedBeforeExecution -or
        -not $sourceProof.NormalRootExit -or $sourceProof.CancellationRequested -or
        -not $sourceProof.ZeroActiveProcessesObserved -or -not $sourceProof.CustodyReleased -or
        $sourceProof.ActiveProcesses -ne 0 -or $sourceProof.ExitCode -ne 0 -or
        -not $sourceProof.SourceHeadMatched -or $sourceProof.ObservedSourceHead -cne $ExpectedMain) {
        [Console]::Error.WriteLine('SOURCE_PROBE_REASON=' + $sourceProof.Reason)
        throw 'JOURNAL_INSTALL_SOURCE_UNPROVEN'
    }
}
$policy = Get-MaintenanceJournalPolicyV2 ([bool]$Fixture)
$base = 'SYSTEM\CurrentControlSet\Services\EventLog\' + $policy.Log
$existing = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($base,$false)
if ($null -ne $existing) {
    $existing.Dispose()
    # Idempotent inspection only. Never repair an unexpected existing configuration.
    Assert-MaintenanceJournalPolicyV2 $policy
} else {
    # Source names are fixed; refuse registration collisions rather than remapping.
    if ([Diagnostics.EventLog]::SourceExists($policy.Source)) { throw 'JOURNAL_SOURCE_ALREADY_REGISTERED' }
    $creation = [Diagnostics.EventSourceCreationData]::new($policy.Source,$policy.Log)
    [Diagnostics.EventLog]::CreateEventSource($creation)
    $config = [Diagnostics.Eventing.Reader.EventLogConfiguration]::new($policy.Log)
    try {
        $config.LogMode = [Diagnostics.Eventing.Reader.EventLogMode]::Retain
        $config.MaximumSizeInBytes = $policy.Maximum
        $config.SecurityDescriptor = Get-MaintenanceJournalSddlV2
        $config.SaveChanges()
    } finally { $config.Dispose() }
    Assert-MaintenanceJournalPolicyV2 $policy
}
$query = [Diagnostics.Eventing.Reader.EventLogQuery]::new($policy.Log,[Diagnostics.Eventing.Reader.PathType]::LogName,'*')
$query.ReverseDirection = $true
$reader = [Diagnostics.Eventing.Reader.EventLogReader]::new($query)
try { $row = $reader.ReadEvent() } finally { $reader.Dispose() }
if ($null -eq $row) {
    # Only establishes a physical native sequence. No custody envelope/IDLE/reservation.
    [Diagnostics.EventLog]::WriteEntry($policy.Source,'SOVEREIGN_MAINTENANCE_BOOTSTRAP_V2=NON_AUTHORITY',
        [Diagnostics.EventLogEntryType]::Information,62516)
} else { $row.Dispose() }
Assert-MaintenanceJournalPolicyV2 $policy
Assert-MaintenanceJournalBootstrapV2 $policy
[Console]::WriteLine('{"ok":true,"installed":true,"retained":true,"bootstrapProven":true,"custodyReleased":false,"restartPerformed":false}')
