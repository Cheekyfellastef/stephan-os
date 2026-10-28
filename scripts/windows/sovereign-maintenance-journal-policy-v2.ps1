# Fixed native policy for the existing custody adapter. No caller-chosen channel.
$PSModuleAutoLoadingPreference = 'None'
function Get-MaintenanceJournalPolicyV2([bool]$Fixture = $false) {
    if ($Fixture) {
        return @{Log='StphCustodyFixture';Source='StphCustodyFixtureV2';Maximum=[long]1048576;Id='retained-v2-fixture'}
    }
    return @{Log='Stephanos Maintenance Custody';Source='StephanosMaintenanceCustody';Maximum=[long]67108864;Id='retained-v2-production'}
}
function Get-MaintenanceJournalSddlV2 {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try { $sid = $identity.User.Value } finally { $identity.Dispose() }
    return 'O:BAG:SYD:P(A;;0xf0007;;;SY)(A;;0xf0007;;;BA)(A;;0x3;;;' + $sid + ')'
}
function Assert-MaintenanceJournalRegistryV2($policy) {
    $base = 'SYSTEM\CurrentControlSet\Services\EventLog\' + $policy.Log
    foreach ($suffix in @('', '\' + $policy.Source)) {
        $key = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($base + $suffix, $false)
        if ($null -eq $key) { throw 'JOURNAL_SOURCE_MAPPING_UNPROVEN' }
        try {
            $security = $key.GetAccessControl()
            $owner = $security.GetOwner([Security.Principal.SecurityIdentifier]).Value
            if ($owner -notin @('S-1-5-18','S-1-5-32-544')) { throw 'JOURNAL_REGISTRY_OWNER_UNSAFE' }
            foreach ($rule in $security.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
                if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
                    (([int]$rule.RegistryRights -band 0xC0006) -ne 0) -and
                    $rule.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')) {
                    throw 'JOURNAL_REGISTRY_WRITE_AUTHORITY_UNSAFE'
                }
            }
        } finally { $key.Dispose() }
    }
}
function Assert-MaintenanceJournalPolicyV2($policy) {
    Assert-MaintenanceJournalRegistryV2 $policy
    $info = [Diagnostics.Eventing.Reader.EventLogConfiguration]::new($policy.Log)
    try {
        if (-not $info.IsEnabled -or $info.LogMode -ne [Diagnostics.Eventing.Reader.EventLogMode]::Retain -or
            $info.MaximumSizeInBytes -ne $policy.Maximum -or $info.IsClassicLog -ne $true) {
            throw 'JOURNAL_RETENTION_UNPROVEN'
        }
        $actual = [Security.AccessControl.RawSecurityDescriptor]::new($info.SecurityDescriptor)
        $expected = [Security.AccessControl.RawSecurityDescriptor]::new((Get-MaintenanceJournalSddlV2))
        if ($actual.GetSddlForm([Security.AccessControl.AccessControlSections]::All) -cne
            $expected.GetSddlForm([Security.AccessControl.AccessControlSections]::All)) {
            throw 'JOURNAL_ACCESS_UNPROVEN'
        }
    } finally { $info.Dispose() }
}


function Assert-MaintenanceJournalBootstrapV2($policy) {
    $query = [Diagnostics.Eventing.Reader.EventLogQuery]::new($policy.Log,[Diagnostics.Eventing.Reader.PathType]::LogName,
        ("*[System[(EventID=62516) and Provider[@Name='" + $policy.Source + "']]]"))
    $reader = [Diagnostics.Eventing.Reader.EventLogReader]::new($query)
    try {
        $row = $reader.ReadEvent()
        if ($null -eq $row) { throw 'JOURNAL_BOOTSTRAP_UNPROVEN' }
        try {
            if ($row.RecordId -ne 1 -or [string]$row.Properties[0].Value -cne
                'SOVEREIGN_MAINTENANCE_BOOTSTRAP_V2=NON_AUTHORITY') { throw 'JOURNAL_BOOTSTRAP_UNPROVEN' }
        } finally { $row.Dispose() }
    } finally { $reader.Dispose() }
}

