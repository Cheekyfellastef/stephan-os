param([ValidateSet('Read', 'Append')][string]$Mode = 'Read')
$ErrorActionPreference = 'Stop'
$logName = 'Windows PowerShell'
$eventId = 62517
$marker = 'SOVEREIGN_MAINTENANCE_ANCHOR_V1='
try {
    [Console]::Error.WriteLine('SOVEREIGN_ANCHOR_STAGE=START')
    # Read the key through .NET only, never through a cmdlet/pipeline that
    # PowerShell module logging could record with expanded input values.
    $request = @{scope=[Console]::ReadLine()}
    if ($Mode -eq 'Append') {
        $request.stateBase64 = [Console]::ReadLine()
        $request.transitionId = [Console]::ReadLine()
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
            $envelope = $raw.Substring($marker.Length) | ConvertFrom-Json
            if ($envelope -isnot [pscustomobject] -or $envelope.scope -cnotmatch '^[a-f0-9]{64}$') {
                throw 'AUDIT_ENVELOPE_INVALID'
            }
            if ($envelope.scope -ceq $request.scope) {
                return @{found=$true;eventRecordId=[long]$row.RecordId;envelope=$envelope}
            }
            } finally { $row.Dispose() }
        } } finally { $reader.Dispose() }
        return $null
    }
    if ($Mode -eq 'Read') {
        $result = Read-Anchor
        if ($null -eq $result) { $result = @{found=$false} }
        $result | ConvertTo-Json -Compress -Depth 5
        exit 0
    }
    if ($request.authKey -isnot [string] -or $request.authKey.Length -lt 32 -or
        $request.stateBase64 -cnotmatch '^[A-Za-z0-9+/]+={0,2}$' -or $request.stateBase64.Length -gt 20000 -or
        $request.transitionId -cnotmatch '^[a-f0-9-]{36}$') { throw 'INVALID_APPEND' }
    $writer = [Diagnostics.EventLog]::new($logName)
    $writer.Source = 'PowerShell'
    try {
        for ($attempt=0; $attempt -lt 5; $attempt++) {
            $nextId = (Read-NewestRecordId) + 1
            $signingText = 'stephanos-maintenance-os-anchor-v1' + [char]0 + $request.scope + [char]0 +
                [string]$nextId + [char]0 + $request.transitionId + [char]0 + $request.stateBase64
            $hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($request.authKey))
            try { $signature = ([BitConverter]::ToString($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($signingText)))).Replace('-','').ToLowerInvariant() }
            finally { $hmac.Dispose() }
            $entry = [ordered]@{scope=$request.scope;recordId=$nextId;transitionId=$request.transitionId;stateBase64=$request.stateBase64;mac=$signature}
            $writer.WriteEntry($marker + ($entry | ConvertTo-Json -Compress), [Diagnostics.EventLogEntryType]::Information, $eventId)
            $result = Read-Anchor
            if ($null -ne $result -and $result.eventRecordId -eq $nextId -and
                $result.envelope.transitionId -ceq $request.transitionId) {
                $result | ConvertTo-Json -Compress -Depth 5
                exit 0
            }
        }
        throw 'AUDIT_APPEND_RACED'
    } finally { $writer.Dispose() }
} catch {
    [Console]::WriteLine('{"ok":false,"blocker":"MAINTENANCE_OS_ANCHOR_UNPROVEN"}')
    exit 2
}
