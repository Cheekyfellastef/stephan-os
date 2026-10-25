param([ValidateSet('Read', 'Append')][string]$Mode = 'Read')
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
$logName = 'Windows PowerShell'
$eventId = 62517
$marker = 'SOVEREIGN_MAINTENANCE_ANCHOR_V1='
$kernelMutex = $null
$ownsMutex = $false
try {
    [Console]::Error.WriteLine('SOVEREIGN_ANCHOR_STAGE=START')
    # Read the key through .NET only, never through a cmdlet/pipeline that
    # PowerShell module logging could record with expanded input values.
    $request = @{scope=[Console]::ReadLine()}
    if ($Mode -eq 'Append') {
        $request.stateBase64 = [Console]::ReadLine()
        $request.transitionId = [Console]::ReadLine()
        $request.expectedRecordId = [Console]::ReadLine()
        $keyLine = [Console]::ReadLine()
        if ($keyLine.Length -gt 5500) { throw 'INVALID_KEY' }
        $request.authKey = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($keyLine))
    }
    if ($request.scope -cnotmatch '^[a-f0-9]{64}$') { throw 'INVALID_SCOPE' }
    [Console]::Error.WriteLine('SOVEREIGN_ANCHOR_STAGE=INPUT')
    $logInfo = [Diagnostics.Eventing.Reader.EventLogConfiguration]::new($logName)
    [Console]::Error.WriteLine('SOVEREIGN_ANCHOR_STAGE=CONFIG')
    if (-not $logInfo.IsEnabled) { throw 'AUDIT_DISABLED' }
    # Reuse the existing OS channel. Do not register a source or modify its ACL.
    $acl = [Security.AccessControl.RawSecurityDescriptor]::new($logInfo.SecurityDescriptor)
    if ($null -eq $acl.DiscretionaryAcl -or $acl.DiscretionaryAcl.Count -eq 0 -or
        $acl.Owner.Value -notin @('S-1-5-18','S-1-5-32-544','S-1-5-32-549')) { throw 'AUDIT_OWNER_UNSAFE' }
    foreach ($ace in $acl.DiscretionaryAcl) {
        if ($ace.AceType -notin @([Security.AccessControl.AceType]::AccessAllowed,[Security.AccessControl.AceType]::AccessDenied)) {
            throw 'AUDIT_DACL_UNSUPPORTED'
        }
        if ($ace.AceType -eq [Security.AccessControl.AceType]::AccessAllowed -and
            (($ace.AccessMask -band 0xC0004) -ne 0) -and
            $ace.SecurityIdentifier.Value -notin @('S-1-5-18','S-1-5-32-544','S-1-5-32-549')) {
            throw 'AUDIT_CLEAR_AUTHORITY_UNSAFE'
        }
    }
    $logInfo.Dispose()
    [Console]::Error.WriteLine('SOVEREIGN_ANCHOR_STAGE=ACL')
    function Read-NewestRecordId {
        $query = [Diagnostics.Eventing.Reader.EventLogQuery]::new($logName, [Diagnostics.Eventing.Reader.PathType]::LogName, '*')
        $query.ReverseDirection = $true
        $reader = [Diagnostics.Eventing.Reader.EventLogReader]::new($query)
        [Console]::Error.WriteLine('SOVEREIGN_ANCHOR_STAGE=QUERY')
        try {
            $row = $reader.ReadEvent([TimeSpan]::FromSeconds(2))
            [Console]::Error.WriteLine('SOVEREIGN_ANCHOR_STAGE=NEXT')
            if ($null -eq $row) { throw 'AUDIT_SEQUENCE_UNKNOWN' }
            try { return [long]$row.RecordId } finally { $row.Dispose() }
        } finally { $reader.Dispose() }
    }
    function Read-Anchor {
        [Console]::Error.WriteLine('SOVEREIGN_ANCHOR_STAGE=QUERY_OPEN')
        $query = [Diagnostics.Eventing.Reader.EventLogQuery]::new($logName, [Diagnostics.Eventing.Reader.PathType]::LogName,
            "*[System[(EventID=62517) and Provider[@Name='PowerShell']]]")
        $query.ReverseDirection = $true
        $reader = [Diagnostics.Eventing.Reader.EventLogReader]::new($query)
        [Console]::Error.WriteLine('SOVEREIGN_ANCHOR_STAGE=QUERY')
        try { for ($index=0; $index -lt 256; $index++) {
            $row = $reader.ReadEvent([TimeSpan]::FromSeconds(2))
            [Console]::Error.WriteLine('SOVEREIGN_ANCHOR_STAGE=NEXT')
            if ($null -eq $row) { return $null }
            try {
            $raw = [string]$row.Properties[0].Value
            if (-not $raw.StartsWith($marker, [StringComparison]::Ordinal)) { continue }
            # Never skip malformed newer custody evidence in favor of old green.
            $envelopeRaw = $raw.Substring($marker.Length)
            $scopeMatch = [regex]::Match($envelopeRaw, '^\{"scope":"([a-f0-9]{64})",')
            if (-not $scopeMatch.Success) {
                throw 'AUDIT_ENVELOPE_INVALID'
            }
            if ($scopeMatch.Groups[1].Value -ceq $request.scope) {
                return @{found=$true;eventRecordId=[long]$row.RecordId;raw=$envelopeRaw}
            }
            } finally { $row.Dispose() }
        } } finally { $reader.Dispose() }
        return $null
    }
    function Write-AnchorResult($result) {
        if ($null -eq $result) { [Console]::WriteLine('{"found":false}'); return }
        # Frame untrusted event data as base64; it cannot inject or replace the
        # independently read native EventRecordId in the response envelope.
        $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($result.raw))
        [Console]::WriteLine('{"found":true,"eventRecordId":' + [string]$result.eventRecordId + ',"envelopeBase64":"' + $encoded + '"}')
    }
    if ($Mode -eq 'Read') {
        $result = Read-Anchor
        Write-AnchorResult $result
        exit 0
    }
    if ($request.authKey -isnot [string] -or $request.authKey.Length -lt 32 -or
        $request.stateBase64 -cnotmatch '^[A-Za-z0-9+/]+={0,2}$' -or $request.stateBase64.Length -gt 20000 -or
        $request.transitionId -cnotmatch '^[a-f0-9-]{36}$' -or
        $request.expectedRecordId -cnotmatch '^(NONE|[1-9][0-9]{0,15})$') { throw 'INVALID_APPEND' }
    # Global kernel namespace, never a workspace path. Its symbolic-link
    # creation boundary is privileged; an open mutex is not file-replaceable.
    $nameHmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($request.authKey))
    try { $nameHash = ([BitConverter]::ToString($nameHmac.ComputeHash([Text.Encoding]::UTF8.GetBytes('stephanos-maintenance-mutex-v1' + [char]0 + $request.scope)))).Replace('-','').ToLowerInvariant() }
    finally { $nameHmac.Dispose() }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try { $userSid = $identity.User } finally { $identity.Dispose() }
    $systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $security = [Security.AccessControl.MutexSecurity]::new()
    $security.SetAccessRuleProtection($true, $false)
    $security.SetOwner($userSid)
    foreach ($sid in @($userSid,$systemSid)) {
        $security.AddAccessRule([Security.AccessControl.MutexAccessRule]::new($sid,
            [Security.AccessControl.MutexRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
    }
    $created = $false
    $kernelMutex = [Threading.Mutex]::new($false, ('Global\Stephanos.Maintenance.' + $nameHash), [ref]$created, $security)
    $actualSecurity = $kernelMutex.GetAccessControl()
    $rules = @($actualSecurity.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
    if (-not $actualSecurity.AreAccessRulesProtected -or -not $actualSecurity.AreAccessRulesCanonical -or
        $actualSecurity.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $userSid.Value -or $rules.Count -ne 2) {
        throw 'MUTEX_SECURITY_UNPROVEN'
    }
    foreach ($rule in $rules) {
        if ($rule.IsInherited -or $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
            $rule.MutexRights -ne [Security.AccessControl.MutexRights]::FullControl -or
            $rule.IdentityReference.Value -notin @($userSid.Value,'S-1-5-18')) { throw 'MUTEX_SECURITY_UNPROVEN' }
    }
    try { $ownsMutex = $kernelMutex.WaitOne(2000) }
    catch [Threading.AbandonedMutexException] { $ownsMutex = $true; throw 'MUTEX_ABANDONED_RETAIN_CUSTODY' }
    if (-not $ownsMutex) { throw 'MUTEX_BUSY' }
    # This comparison and all append/readback work share the same kernel lock.
    $previous = Read-Anchor
    if ($request.expectedRecordId -ceq 'NONE') {
        if ($null -ne $previous) { throw 'ANCHOR_PREVIOUS_CHANGED' }
        $previousJson = 'null'
    } else {
        if ($null -eq $previous -or $previous.eventRecordId -ne [long]$request.expectedRecordId) { throw 'ANCHOR_PREVIOUS_CHANGED' }
        $previousJson = [string]$previous.eventRecordId
    }
    $writer = [Diagnostics.EventLog]::new($logName)
    $writer.Source = 'PowerShell'
    try {
        for ($attempt=0; $attempt -lt 5; $attempt++) {
            $nextId = (Read-NewestRecordId) + 1
            $signingText = 'stephanos-maintenance-os-anchor-v2' + [char]0 + $request.scope + [char]0 +
                [string]$nextId + [char]0 + $request.expectedRecordId + [char]0 + $request.transitionId + [char]0 + $request.stateBase64
            $hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($request.authKey))
            try { $signature = ([BitConverter]::ToString($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($signingText)))).Replace('-','').ToLowerInvariant() }
            finally { $hmac.Dispose() }
            # Every interpolated field is a fixed number or validated ASCII
            # token/base64 value. No general JSON/module dependency is loaded.
            $entry = '{"scope":"' + $request.scope + '","recordId":' + [string]$nextId +
                ',"previousRecordId":' + $previousJson + ',"transitionId":"' + $request.transitionId + '","stateBase64":"' + $request.stateBase64 + '","mac":"' + $signature + '"}'
            $writer.WriteEntry($marker + $entry, [Diagnostics.EventLogEntryType]::Information, $eventId)
            $result = Read-Anchor
            if ($null -ne $result -and $result.eventRecordId -eq $nextId -and
                $result.raw -ceq $entry) {
                Write-AnchorResult $result
                exit 0
            }
            if ($null -eq $result -or $result.raw -cne $entry) { throw 'ANCHOR_FOREIGN_WRITE' }
        }
        throw 'AUDIT_APPEND_RACED'
    } finally { $writer.Dispose() }
} catch {
    [Console]::WriteLine('{"ok":false,"blocker":"MAINTENANCE_OS_ANCHOR_UNPROVEN"}')
    exit 2
} finally {
    if ($ownsMutex -and $null -ne $kernelMutex) { $kernelMutex.ReleaseMutex() }
    if ($null -ne $kernelMutex) { $kernelMutex.Dispose() }
}
