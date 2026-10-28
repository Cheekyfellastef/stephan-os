param([switch]$OperatorApproved,[switch]$Fixture,[string]$ExpectedMain='')
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
. ([IO.Path]::Combine($PSScriptRoot,'sovereign-maintenance-journal-policy-v2.ps1'))
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
    $canonical = 'C:\Users\Stephan Callear\Documents\GitHub\stephan-os'
    if ([IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot,'..','..')) -ine $canonical) {
        throw 'JOURNAL_INSTALL_CANONICAL_SOURCE_REQUIRED'
    }
    # Invoke the unchanged closed source collector, not ordinary Git or a caller probe.
    $process = [Diagnostics.Process]::new()
    try {
        $process.StartInfo = New-MaintenanceSourceProbeStartInfoV2
        if (-not $process.Start()) { throw 'JOURNAL_INSTALL_SOURCE_UNPROVEN' }
        if (-not $process.WaitForExit(10000)) {
            $process.Kill()
            throw 'JOURNAL_INSTALL_SOURCE_UNPROVEN'
        }
        $observed = $process.StandardOutput.ReadToEnd().Trim()
        if ($process.ExitCode -ne 0 -or $observed -cne $ExpectedMain) { throw 'JOURNAL_INSTALL_SOURCE_UNPROVEN' }
    } finally { $process.Dispose() }
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
