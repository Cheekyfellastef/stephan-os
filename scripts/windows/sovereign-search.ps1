# This fixed script receives data and a captured, byte-pinned native helper.
# It never evaluates a query/path as PowerShell and performs no installation.
$env:PSModulePath = 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false, $true)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false, $true)
$scope = $null
try {
    $raw = [Console]::In.ReadToEnd()
    if ($raw.Length -gt 131072) { throw 'SOVEREIGN_SEARCH_REQUEST_INVALID' }
    $request = $raw | ConvertFrom-Json
    $keys = @($request.PSObject.Properties.Name)
    if ($keys.Count -ne 5 -or 'path' -cnotin $keys -or 'query' -cnotin $keys -or
        'mode' -cnotin $keys -or 'caseSensitive' -cnotin $keys -or 'nativeSource' -cnotin $keys -or
        $request.path -isnot [string] -or $request.query -isnot [string] -or
        $request.mode -isnot [string] -or $request.caseSensitive -isnot [bool] -or
        $request.nativeSource -isnot [string]) { throw 'SOVEREIGN_SEARCH_REQUEST_INVALID' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $nativeHash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($request.nativeSource)))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
    if ($nativeHash -cne '7e3d3308fbaea77f6eeab8315034961b27558c9deeec9d535b94e770e8f6e55b') { throw 'SOVEREIGN_SEARCH_SOURCE_MISMATCH' }
    Add-Type -TypeDefinition $request.nativeSource
    $scope = New-Object SovereignSearchV1 -ArgumentList $request.path, $request.query, $request.mode, $request.caseSensitive
    $scope.Run() | ConvertTo-Json -Compress -Depth 8
} catch {
    $cause = $_.Exception
    while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
    $blocker = 'SOVEREIGN_SEARCH_NATIVE_FAILED'
    if ($cause.Message -cmatch '^SOVEREIGN_SEARCH_[A-Z_]+$') { $blocker = $cause.Message }
    if ($cause -is [ComponentModel.Win32Exception]) {
        switch ($cause.NativeErrorCode) {
            2 { $blocker = 'SOVEREIGN_SEARCH_SCOPE_MISSING' }
            3 { $blocker = 'SOVEREIGN_SEARCH_SCOPE_MISSING' }
            5 { $blocker = 'SOVEREIGN_SEARCH_ACCESS_DENIED' }
            32 { $blocker = 'SOVEREIGN_SEARCH_SCOPE_BUSY' }
        }
    }
    @{schemaVersion='stephanos.sovereign-search-snapshot.v1';ok=$false;blocker=$blocker} | ConvertTo-Json -Compress
    exit 1
} finally {
    if ($null -ne $scope) { $scope.Dispose() }
}
