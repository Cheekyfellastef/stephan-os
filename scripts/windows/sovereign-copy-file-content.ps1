# Fixed private file-content adapter. Callers select no executable, helper code,
# arbitrary native operation, write bytes, deletion, replacement or cleanup path.
$env:PSModulePath = 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$PSModuleAutoLoadingPreference = 'None'
Import-Module 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop
Set-StrictMode -Version Latest
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false, $true)
$scope = $null
$operation = 'COPY_FILE_CONTENT'
$source = $null
$destination = $null
$path = $null
$nativeCodes = @(
    'SOVEREIGN_COPY_COPY_HASH_MISMATCH', 'SOVEREIGN_COPY_CREATE_UNPROVEN',
    'SOVEREIGN_COPY_DESTINATION_IDENTITY_UNPROVEN', 'SOVEREIGN_COPY_ENCRYPTED_FILE_UNQUALIFIED',
    'SOVEREIGN_COPY_FILE_SIZE_LIMIT', 'SOVEREIGN_COPY_FLUSH_UNPROVEN',
    'SOVEREIGN_COPY_HARD_LINK_REJECTED', 'SOVEREIGN_COPY_HASH_MISMATCH', 'SOVEREIGN_COPY_HASH_REQUIRED',
    'SOVEREIGN_COPY_LOCAL_FIXED_VOLUME_REQUIRED', 'SOVEREIGN_COPY_NTFS_REQUIRED',
    'SOVEREIGN_COPY_OPEN_UNPROVEN', 'SOVEREIGN_COPY_OPERATION_INVALID', 'SOVEREIGN_COPY_PARENT_CHANGED',
    'SOVEREIGN_COPY_PATH_EXCLUDED', 'SOVEREIGN_COPY_PATH_IDENTITY_UNPROVEN', 'SOVEREIGN_COPY_PATH_INVALID',
    'SOVEREIGN_COPY_POSTCONDITION_UNPROVEN', 'SOVEREIGN_COPY_READBACK_UNPROVEN',
    'SOVEREIGN_COPY_READ_LIMIT', 'SOVEREIGN_COPY_READ_UNPROVEN', 'SOVEREIGN_COPY_REPARSE_OR_NONREGULAR',
    'SOVEREIGN_COPY_REQUEST_ALREADY_USED', 'SOVEREIGN_COPY_REQUEST_INVALID', 'SOVEREIGN_COPY_REQUEST_LIMIT',
    'SOVEREIGN_COPY_SAME_PATH_OR_CASE_ALIAS', 'SOVEREIGN_COPY_SAME_VOLUME_REQUIRED',
    'SOVEREIGN_COPY_SOURCE_CHANGED', 'SOVEREIGN_COPY_SOURCE_IDENTITY_UNPROVEN', 'SOVEREIGN_COPY_SOURCE_MISMATCH',
    'SOVEREIGN_COPY_TARGET_EXISTS', 'SOVEREIGN_COPY_TIME_LIMIT', 'SOVEREIGN_COPY_WRITE_UNPROVEN'
)
try {
    # Read at most the fixed byte limit plus one refusal byte. ReadToEnd followed
    # by a size check would allocate unbounded input before enforcing the bound.
    $inputStream = [Console]::OpenStandardInput()
    $memory = New-Object IO.MemoryStream
    try {
        $buffer = New-Object byte[] 4096
        $total = 0
        while ($total -le 131072) {
            $count = $inputStream.Read($buffer, 0, [Math]::Min($buffer.Length, 131073 - $total))
            if ($count -eq 0) { break }
            $memory.Write($buffer, 0, $count)
            $total += $count
            if ($total -gt 131072) { throw 'SOVEREIGN_COPY_REQUEST_LIMIT' }
        }
        $raw = [Text.UTF8Encoding]::new($false, $true).GetString($memory.ToArray())
    } finally { $memory.Dispose() }
    $request = $raw | ConvertFrom-Json
    if ($request -isnot [pscustomobject]) { throw 'SOVEREIGN_COPY_REQUEST_INVALID' }
    $keys = @($request.PSObject.Properties.Name)
    if ('operation' -cnotin $keys -or 'nativeSource' -cnotin $keys -or
        $request.operation -isnot [string] -or $request.nativeSource -isnot [string]) {
        throw 'SOVEREIGN_COPY_REQUEST_INVALID'
    }
    if ($request.operation -ceq 'COPY_FILE_CONTENT') {
        if ($keys.Count -ne 5 -or 'source' -cnotin $keys -or 'destination' -cnotin $keys -or
            'expectedSha256' -cnotin $keys -or $request.source -isnot [string] -or
            $request.destination -isnot [string] -or $request.expectedSha256 -isnot [string]) {
            throw 'SOVEREIGN_COPY_REQUEST_INVALID'
        }
        $source = $request.source
        $destination = $request.destination
    } elseif ($request.operation -ceq 'GET_FILE_HASH') {
        $operation = 'GET_FILE_HASH'
        if ($keys.Count -ne 3 -or 'path' -cnotin $keys -or $request.path -isnot [string]) {
            throw 'SOVEREIGN_COPY_REQUEST_INVALID'
        }
        $path = $request.path
    } else { throw 'SOVEREIGN_COPY_OPERATION_INVALID' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $nativeHash = ([BitConverter]::ToString($sha.ComputeHash([Text.UTF8Encoding]::new($false, $true).GetBytes($request.nativeSource)))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
    if ($nativeHash -cne '4373015e4539884b84effffb93df0b03a06a6a63e76c81b3f299adceaf47a7dc') {
        throw 'SOVEREIGN_COPY_SOURCE_MISMATCH'
    }
    Add-Type -TypeDefinition $request.nativeSource
    if ($operation -ceq 'GET_FILE_HASH') {
        $scope = New-Object SovereignFileCopyV1 -ArgumentList $path
        $scope.Hash() | ConvertTo-Json -Compress -Depth 4
    } else {
        $scope = New-Object SovereignFileCopyV1 -ArgumentList $source, $destination, $request.expectedSha256
        $scope.Copy() | ConvertTo-Json -Compress -Depth 4
    }
} catch {
    $cause = $_.Exception
    while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
    $blocker = 'SOVEREIGN_COPY_NATIVE_FAILED'
    if ($cause.Message -cin $nativeCodes) { $blocker = $cause.Message }
    if ($cause -is [ComponentModel.Win32Exception]) {
        switch ($cause.NativeErrorCode) {
            2 { $blocker = 'SOVEREIGN_COPY_PATH_MISSING' }
            3 { $blocker = 'SOVEREIGN_COPY_PATH_MISSING' }
            5 { $blocker = 'SOVEREIGN_COPY_ACCESS_DENIED' }
            32 { $blocker = 'SOVEREIGN_COPY_SCOPE_BUSY' }
            80 { $blocker = 'SOVEREIGN_COPY_TARGET_EXISTS' }
            183 { $blocker = 'SOVEREIGN_COPY_TARGET_EXISTS' }
            267 { $blocker = 'SOVEREIGN_COPY_REPARSE_OR_NONREGULAR' }
        }
    }
    $stage = if ($null -ne $scope) { $scope.Stage } else { 'PRECONDITION' }
    $sourceIdentity = if ($null -ne $scope) { $scope.SourceIdentity } else { $null }
    if ($operation -ceq 'GET_FILE_HASH') {
        $parentIdentity = if ($null -ne $scope) { $scope.SourceParentIdentity } else { $null }
        @{schemaVersion='stephanos.sovereign-file-hash.v1';ok=$false;path=$path;
          identity=$sourceIdentity;parentIdentity=$parentIdentity;observationState='NOT_OBSERVED';stage=$stage;
          mutationAttempted=$false;sourceMutationAttempted=$false;
          hashSemantics='BOUNDED_PRE_POST_OBSERVATION_NOT_ATOMIC_CONTENT_CAS';
          mappedWriterExclusionProven=$false;retryAllowed=$false;hashScope='UNNAMED_DATA_STREAM_ONLY';blocker=$blocker} |
            ConvertTo-Json -Compress -Depth 4
    } else {
        $attempted = $null -ne $scope -and $scope.MutationAttempted
        $state = if ($attempted) { 'UNKNOWN' } else { 'NOT_STARTED' }
        $destinationIdentity = if ($null -ne $scope) { $scope.DestinationIdentity } else { $null }
        @{schemaVersion='stephanos.sovereign-file-copy.v1';ok=$false;source=$source;destination=$destination;
          sourceIdentity=$sourceIdentity;destinationIdentity=$destinationIdentity;mutationState=$state;stage=$stage;
          mutationAttempted=$attempted;hashSemantics='BOUNDED_PRE_POST_OBSERVATION_NOT_ATOMIC_CONTENT_CAS';
          mappedWriterExclusionProven=$false;retryAllowed=$false;sourceMutationAttempted=$false;
          copyScope='UNNAMED_DATA_STREAM_ONLY';blocker=$blocker} | ConvertTo-Json -Compress -Depth 4
    }
    exit 2
} finally {
    if ($null -ne $scope) { $scope.Dispose() }
}
