# The installer and normal starter share this per-user, cross-session lock.
# A nested call in the same PowerShell thread may acquire it recursively.
function Enter-SpatialWindowInstallLock {
    param([Parameter(Mandatory=$true)][string]$RepositoryRoot)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $material = [IO.Path]::GetFullPath($RepositoryRoot).TrimEnd('\').ToLowerInvariant() + '|' + $sid
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $suffix = ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($material)))).Replace('-','').ToLowerInvariant() }
    finally { $hasher.Dispose() }
    $mutex = $null
    try {
        $mutex = New-Object Threading.Mutex($false, ('Global\Stephanos.SpatialWindow.Install.' + $suffix))
        try { $acquired = $mutex.WaitOne(0) }
        catch [Threading.AbandonedMutexException] { $acquired = $true }
        if (-not $acquired) { throw 'SPATIAL_PREPARE_LOCK_BUSY' }
        return $mutex
    } catch {
        if ($mutex) { $mutex.Dispose() }
        throw 'SPATIAL_PREPARE_LOCK_BUSY'
    }
}

function Exit-SpatialWindowInstallLock {
    param($Mutex)
    if ($Mutex) { try { $Mutex.ReleaseMutex() } finally { $Mutex.Dispose() } }
}

function Get-SpatialWindowListeners {
    # Enumerating first distinguishes an empty port from failed observation.
    return @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq 4180 })
}

function Assert-SpatialWindowPortUnused {
    if (@(Get-SpatialWindowListeners).Count -ne 0) { throw 'SPATIAL_PREPARE_PORT_OCCUPIED' }
}

function Assert-SpatialWindowPlainPath {
    param([Parameter(Mandatory=$true)][string]$Path)
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'SPATIAL_PREPARE_INSTALLATION_INVALID' }
        }
        $parent = [IO.Path]::GetDirectoryName($current.TrimEnd('\'))
        if ($parent -eq $current) { break }
        $current = $parent
    }
}

function Get-SpatialWindowStreamSha256 {
    param([Parameter(Mandatory=$true)][IO.Stream]$Stream)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        $Stream.Position = 0
        return ([BitConverter]::ToString($hasher.ComputeHash($Stream))).Replace('-','').ToLowerInvariant()
    } finally { $Stream.Position = 0; $hasher.Dispose() }
}

function Close-SpatialWindowBuildHandles {
    param($Value)
    if (-not $Value) { return }
    foreach ($name in @('NativeHandle','ReceiptHandle')) {
        if ($Value.PSObject.Properties[$name] -and $Value.$name) { $Value.$name.Dispose() }
    }
}

function Assert-SpatialWindowPinnedInstallation {
    param([Parameter(Mandatory=$true)]$Value)
    Assert-SpatialWindowPlainPath -Path $Value.Binary
    Assert-SpatialWindowPlainPath -Path (Join-Path ([IO.Path]::GetDirectoryName($Value.Binary)) 'build.json')
    Assert-SpatialWindowInstallationDirectory -Directory ([IO.Path]::GetDirectoryName($Value.Binary))
    if ($Value.BuildId -cnotmatch '^[a-f0-9]{64}$' -or $Value.NativeSha256 -cnotmatch '^[a-f0-9]{64}$' -or $Value.ReceiptSha256 -cnotmatch '^[a-f0-9]{64}$' -or
        -not $Value.NativeHandle -or -not $Value.ReceiptHandle -or
        (Get-SpatialWindowStreamSha256 -Stream $Value.NativeHandle) -cne $Value.NativeSha256 -or
        (Get-SpatialWindowStreamSha256 -Stream $Value.ReceiptHandle) -cne $Value.ReceiptSha256) { throw 'SPATIAL_PREPARE_INSTALLATION_INVALID' }
    Assert-SpatialWindowPlainPath -Path $Value.Binary
    Assert-SpatialWindowPlainPath -Path (Join-Path ([IO.Path]::GetDirectoryName($Value.Binary)) 'build.json')
    Assert-SpatialWindowInstallationDirectory -Directory ([IO.Path]::GetDirectoryName($Value.Binary))
}

function Assert-SpatialWindowInstallationDirectory {
    param([Parameter(Mandatory=$true)][string]$Directory)
    Assert-SpatialWindowPlainPath -Path $Directory
    if (-not (Test-Path -LiteralPath $Directory)) { return }
    if (-not (Test-Path -LiteralPath $Directory -PathType Container)) { throw 'SPATIAL_PREPARE_INSTALLATION_INVALID' }
    foreach ($entry in @(Get-ChildItem -LiteralPath $Directory -Force -ErrorAction Stop)) {
        if ($entry.PSIsContainer -or $entry.Name -notin @('SpatialWindow.exe','build.json') -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'SPATIAL_PREPARE_INSTALLATION_INVALID' }
    }
}

function Open-SpatialWindowPinnedInstallation {
    param([Parameter(Mandatory=$true)][string]$Directory, [Parameter(Mandatory=$true)]$FreshBuild)
    $pinned = [pscustomobject]@{
        BuildId=$FreshBuild.BuildId; NativeSha256=$FreshBuild.NativeSha256
        ReceiptSha256=$FreshBuild.ReceiptSha256; Binary=(Join-Path $Directory 'SpatialWindow.exe')
        NativeHandle=$null; ReceiptHandle=$null
    }
    try {
        $receiptPath = Join-Path $Directory 'build.json'
        Assert-SpatialWindowPlainPath -Path $pinned.Binary
        Assert-SpatialWindowPlainPath -Path $receiptPath
        # These final-path handles deny writes AND deletion/rename until the
        # native probe exits. Expected digests come from this invocation's build.
        $pinned.NativeHandle = [IO.File]::Open($pinned.Binary,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
        $pinned.ReceiptHandle = [IO.File]::Open($receiptPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
        Assert-SpatialWindowPinnedInstallation -Value $pinned
        return $pinned
    } catch {
        Close-SpatialWindowBuildHandles -Value $pinned
        throw 'SPATIAL_PREPARE_INSTALLATION_INVALID'
    }
}
