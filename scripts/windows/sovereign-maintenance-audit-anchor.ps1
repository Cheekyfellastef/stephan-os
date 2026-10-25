param([ValidateSet('Read', 'Append')][string]$Mode = 'Read')
$ErrorActionPreference = 'Stop'
$logName = 'Windows PowerShell'
$eventId = 62517
$marker = 'SOVEREIGN_MAINTENANCE_ANCHOR_V1='
try {
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
    $logInfo = Get-WinEvent -ListLog $logName
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
    function Read-Anchor {
        try { $rows = @(Get-WinEvent -FilterHashtable @{LogName=$logName;ProviderName='PowerShell';Id=$eventId} -MaxEvents 256 -ErrorAction Stop) }
        catch {
            if ($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*') { return $null }
            throw
        }
        foreach ($row in $rows) {
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
        }
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
            $nextId = [long](Get-WinEvent -LogName $logName -MaxEvents 1).RecordId + 1
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
