# Pin module resolution again after Windows PowerShell rebuilds startup paths.
$env:PSModulePath = 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false, $true)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false, $true)
$scope = $null
$attempted = $false
try {
    $raw = [Console]::In.ReadToEnd()
    if ($raw.Length -gt 65536) { throw 'SOVEREIGN_DIRECTORY_TARGET_INVALID' }
    $request = $raw | ConvertFrom-Json
    $keys = @($request.PSObject.Properties.Name)
    if ($keys.Count -ne 2 -or 'path' -cnotin $keys -or 'nativeSource' -cnotin $keys -or
        $request.path -isnot [string] -or $request.nativeSource -isnot [string]) {
        throw 'SOVEREIGN_DIRECTORY_TARGET_INVALID'
    }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $nativeHash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($request.nativeSource)))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
    if ($nativeHash -cne 'f522113d39222214dfe89c3ff8d9248d25584aecc66e1ce5ff1c83324344526b') { throw 'SOVEREIGN_DIRECTORY_SOURCE_MISMATCH' }
    Add-Type -TypeDefinition $request.nativeSource
    $scope = New-Object SovereignDirectoryCreateV1 -ArgumentList $request.path
    $attempted = $true
    $identity = $scope.Create()
    # Capture the handle identities before releasing any ancestor or leaf pin.
    @{schemaVersion='stephanos.sovereign-directory-create.v1';ok=$true;path=$request.path;
      created=$true;recursive=$false;parentIdentity=$scope.ParentIdentity;
      identity=$identity;mutationState='CREATED'} | ConvertTo-Json -Compress
} catch {
    $cause = $_.Exception
    while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
    $blocker = 'SOVEREIGN_DIRECTORY_CREATE_FAILED'
    if ($cause.Message -cmatch '^SOVEREIGN_DIRECTORY_[A-Z_]+$') { $blocker = $cause.Message }
    if ($cause -is [ComponentModel.Win32Exception]) {
        switch ($cause.NativeErrorCode) {
            80  { $blocker = 'SOVEREIGN_DIRECTORY_TARGET_EXISTS'; $attempted = $false }
            183 { $blocker = 'SOVEREIGN_DIRECTORY_TARGET_EXISTS'; $attempted = $false }
            2   { $blocker = 'SOVEREIGN_DIRECTORY_PARENT_MISSING' }
            3   { $blocker = 'SOVEREIGN_DIRECTORY_PARENT_MISSING' }
            5   { $blocker = 'SOVEREIGN_DIRECTORY_ACCESS_DENIED' }
            32  { $blocker = 'SOVEREIGN_DIRECTORY_PARENT_BUSY' }
        }
    }
    @{schemaVersion='stephanos.sovereign-directory-create.v1';ok=$false;blocker=$blocker;
      mutationState=$(if ($attempted) {'UNKNOWN'} else {'NOT_STARTED'})} | ConvertTo-Json -Compress
    exit 1
} finally {
    if ($null -ne $scope) { $scope.Dispose() }
}
