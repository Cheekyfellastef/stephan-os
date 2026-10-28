param([ValidateSet('Acl','Circular','Restore','Fill')][string]$Mode)
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows' -or
    $env:GITHUB_REPOSITORY -cne 'Cheekyfellastef/stephan-os') { throw 'FIXTURE_HOST_NOT_ADMITTED' }
Import-Module 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop
. ([IO.Path]::Combine($PSScriptRoot,'sovereign-maintenance-journal-policy-v2.ps1'))
$policy = Get-MaintenanceJournalPolicyV2 $true
# This harness has no production target argument and never reads a signing key.
if ($Mode -eq 'Restore') {
    $c = [Diagnostics.Eventing.Reader.EventLogConfiguration]::new($policy.Log)
    try { $c.LogMode=[Diagnostics.Eventing.Reader.EventLogMode]::Retain; $c.SaveChanges() } finally { $c.Dispose() }
    Assert-MaintenanceJournalPolicyV2 $policy
    [Console]::WriteLine('{"ok":true,"restored":true}')
    exit 0
}
Assert-MaintenanceJournalPolicyV2 $policy
if ($Mode -eq 'Circular') {
    $c = [Diagnostics.Eventing.Reader.EventLogConfiguration]::new($policy.Log)
    try { $c.LogMode=[Diagnostics.Eventing.Reader.EventLogMode]::Circular; $c.SaveChanges() } finally { $c.Dispose() }
    [Console]::WriteLine('{"ok":true,"fixtureOnly":true}')
} elseif ($Mode -eq 'Acl') {
    Add-Type -Path ([IO.Path]::Combine($PSScriptRoot,'MaintenanceJournalAclFixtureV2.cs'))
    [MaintenanceJournalAclFixtureV2]::Run() | ConvertTo-Json -Compress
} elseif ($Mode -eq 'Fill') {
    $writer = [Diagnostics.EventLog]::new($policy.Log)
    $writer.Source = $policy.Source
    $count = 0; $full = $false
    try {
        for ($i=0;$i -lt 256;$i++) {
            try { $writer.WriteEntry(('FIXTURE_NON_AUTHORITY_FILL_' + ('x' * 28000)),[Diagnostics.EventLogEntryType]::Information,62518); $count++ }
            catch {
                $errorItem = $_.Exception
                while ($null -ne $errorItem) {
                    if (($errorItem -is [ComponentModel.Win32Exception] -and $errorItem.NativeErrorCode -eq 1502) -or
                        $errorItem.HResult -eq -2147023394) { $full=$true; break }
                    $errorItem = $errorItem.InnerException
                }
                if (-not $full) { throw }
                break
            }
        }
    } finally { $writer.Dispose() }
    if (-not $full -or $count -lt 1) { throw 'FIXTURE_CAPACITY_REFUSAL_NOT_PROVEN' }
    [Console]::WriteLine('{"ok":true,"full":true,"fixtureOnly":true}')
}
