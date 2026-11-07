# Fixed private-MCP adapter. Paths and expected digest are stdin data; only the
# captured, byte-pinned C# helper is compiled. No installation or shell input.
$env:PSModulePath = 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false, $true)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false, $true)
$scope = $null
$request = $null
try {
    $raw = [Console]::In.ReadToEnd()
    if ($raw.Length -gt 131072) { throw 'SOVEREIGN_MOVE_REQUEST_INVALID' }
    $request = $raw | ConvertFrom-Json
    $keys = @($request.PSObject.Properties.Name)
    if ($keys.Count -ne 4 -or 'source' -cnotin $keys -or 'destination' -cnotin $keys -or
        'expectedSha256' -cnotin $keys -or 'nativeSource' -cnotin $keys -or
        $request.source -isnot [string] -or $request.destination -isnot [string] -or
        $request.expectedSha256 -isnot [string] -or $request.nativeSource -isnot [string]) {
        throw 'SOVEREIGN_MOVE_REQUEST_INVALID'
    }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $nativeHash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($request.nativeSource)))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
    if ($nativeHash -cne 'c0980126d050631d9788ceeee2631ecb78f0c4780c52baee6f9bb90f6c287bbf') {
        throw 'SOVEREIGN_MOVE_SOURCE_MISMATCH'
    }
    Add-Type -TypeDefinition $request.nativeSource
    $scope = New-Object SovereignFileMoveV1 -ArgumentList $request.source, $request.destination, $request.expectedSha256
    $scope.Move() | ConvertTo-Json -Compress -Depth 5
} catch {
    $cause = $_.Exception
    while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
    $blocker = 'SOVEREIGN_MOVE_NATIVE_FAILED'
    if ($cause.Message -cmatch '^SOVEREIGN_MOVE_[A-Z_]{1,72}$') { $blocker = $cause.Message }
    if ($cause -is [ComponentModel.Win32Exception]) {
        switch ($cause.NativeErrorCode) {
            2 { $blocker = 'SOVEREIGN_MOVE_SOURCE_MISSING' }
            3 { $blocker = 'SOVEREIGN_MOVE_PARENT_MISSING' }
            5 { $blocker = 'SOVEREIGN_MOVE_ACCESS_DENIED' }
            17 { $blocker = 'SOVEREIGN_MOVE_CROSS_VOLUME_UNQUALIFIED' }
            32 { $blocker = 'SOVEREIGN_MOVE_SCOPE_BUSY' }
            80 { $blocker = 'SOVEREIGN_MOVE_TARGET_EXISTS' }
            183 { $blocker = 'SOVEREIGN_MOVE_TARGET_EXISTS' }
            267 { $blocker = 'SOVEREIGN_MOVE_REPARSE_OR_NONREGULAR' }
        }
    }
    $attempted = $null -ne $scope -and $scope.MutationAttempted
    $state = if ($attempted) { 'UNKNOWN' } else { 'NOT_STARTED' }
    $stage = if ($null -ne $scope) { $scope.Stage } else { 'PRECONDITION' }
    $identity = if ($null -ne $scope) { $scope.Identity } else { $null }
    $from = if ($null -ne $request -and 'source' -cin @($request.PSObject.Properties.Name)) { $request.source } else { $null }
    $to = if ($null -ne $request -and 'destination' -cin @($request.PSObject.Properties.Name)) { $request.destination } else { $null }
    @{schemaVersion='stephanos.sovereign-file-move.v1';ok=$false;blocker=$blocker;
      source=$from;destination=$to;identity=$identity;mutationState=$state;stage=$stage;
      mutationAttempted=$attempted;retryAllowed=$false;
      hashSemantics='BOUNDED_PRE_POST_OBSERVATION_NOT_ATOMIC_CONTENT_CAS';mappedWriterExclusionProven=$false} |
        ConvertTo-Json -Compress -Depth 5
    exit 2
} finally {
    if ($null -ne $scope) { $scope.Dispose() }
}
