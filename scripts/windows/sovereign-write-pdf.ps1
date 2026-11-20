# Fixed private transport. Only the descriptor-based Node recipe generates the
# bytes. This is not a public caller-supplied PDF/base64 or generic file-write API.
$env:PSModulePath = 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false, $true)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false, $true)
$scope = $null
$sha256 = $null
$targetSha256 = $null
$bytes = 0
$pageCount = 0
try {
    $raw = [Console]::In.ReadToEnd()
    if ([Text.Encoding]::UTF8.GetByteCount($raw) -gt 131072) { throw 'SOVEREIGN_PDF_REQUEST_LIMIT' }
    $request = $raw | ConvertFrom-Json
    $keys = @($request.PSObject.Properties.Name)
    if ($keys.Count -ne 5 -or 'path' -cnotin $keys -or 'contentBase64' -cnotin $keys -or
        'sha256' -cnotin $keys -or 'pageCount' -cnotin $keys -or 'nativeSource' -cnotin $keys -or
        $request.path -isnot [string] -or $request.contentBase64 -isnot [string] -or
        $request.sha256 -isnot [string] -or $request.nativeSource -isnot [string] -or
        ($request.pageCount -isnot [int] -and $request.pageCount -isnot [long]) -or
        $request.pageCount -lt 1 -or $request.pageCount -gt 8 -or
        $request.sha256 -cnotmatch '\A[a-f0-9]{64}\z' -or
        $request.contentBase64.Length -gt 87384 -or
        $request.contentBase64 -cnotmatch '\A(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?\z') {
        throw 'SOVEREIGN_PDF_REQUEST_INVALID'
    }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $nativeHash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($request.nativeSource)))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
    if ($nativeHash -cne 'fc92e762ab7d8d326b9d87f584200104bb314f9ed1ced37b2f7751c01a131aa9') { throw 'SOVEREIGN_PDF_SOURCE_MISMATCH' }
    $content = [Convert]::FromBase64String($request.contentBase64)
    if ($content.Length -gt 65536 -or [Convert]::ToBase64String($content) -cne $request.contentBase64) {
        throw 'SOVEREIGN_PDF_GENERATED_BYTES_INVALID'
    }
    $sha256 = $request.sha256
    $bytes = $content.Length
    $pageCount = [int]$request.pageCount
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $targetSha256 = ([BitConverter]::ToString($sha.ComputeHash([Text.UTF8Encoding]::new($false,$true).GetBytes($request.path)))).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
    Add-Type -TypeDefinition $request.nativeSource
    $scope = New-Object SovereignPdfWriteV1 -ArgumentList $request.path, $content, $sha256, $pageCount
    $scope.Write() | ConvertTo-Json -Compress -Depth 4
} catch {
    $cause = $_.Exception
    while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
    $blocker = 'SOVEREIGN_PDF_NATIVE_FAILED'
    if ($cause.Message -cmatch '\ASOVEREIGN_PDF_[A-Z_]{1,72}\z') { $blocker = $cause.Message }
    if ($cause -is [ComponentModel.Win32Exception]) {
        switch ($cause.NativeErrorCode) {
            2 { $blocker = 'SOVEREIGN_PDF_PARENT_MISSING' }
            3 { $blocker = 'SOVEREIGN_PDF_PARENT_MISSING' }
            5 { $blocker = 'SOVEREIGN_PDF_ACCESS_DENIED' }
            32 { $blocker = 'SOVEREIGN_PDF_SCOPE_BUSY' }
            80 { $blocker = 'SOVEREIGN_PDF_TARGET_EXISTS' }
            183 { $blocker = 'SOVEREIGN_PDF_TARGET_EXISTS' }
            267 { $blocker = 'SOVEREIGN_PDF_REPARSE_OR_NONREGULAR' }
        }
    }
    $attempted = $null -ne $scope -and $scope.MutationAttempted
    $state = if ($attempted) { 'UNKNOWN' } else { 'NOT_STARTED' }
    $stage = if ($null -ne $scope) { $scope.Stage } else { 'PRECONDITION' }
    $identity = if ($null -ne $scope) { $scope.Identity } else { $null }
    $parentIdentity = if ($null -ne $scope) { $scope.ParentIdentity } else { $null }
    @{schemaVersion='stephanos.sovereign-pdf-write.v1';ok=$false;blocker=$blocker;
      sha256=$sha256;bytes=$bytes;pageCount=$pageCount;targetSha256=$targetSha256;
      identity=$identity;parentIdentity=$parentIdentity;mutationState=$state;stage=$stage;
      mutationAttempted=$attempted;retryAllowed=$false;atomicDocumentPublication=$false} |
        ConvertTo-Json -Compress -Depth 4
    exit 2
} finally {
    if ($null -ne $scope) { $scope.Dispose() }
}
