# Fixed private PSF runtime; definitions only. The launcher authenticates these
# bytes from its exact Git source packet before evaluating this module.
$script:RuntimeNative = $null
$script:RuntimeUrl = 'https://www.python.org/ftp/python/3.14.10/python-3.14.10-embed-amd64.zip'
$script:RuntimeSha256 = '90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159'
$script:RuntimeArchiveBytes = 12619664

function Runtime-Deny { throw 'FIXED_RUNTIME_UNPROVEN' }
function Runtime-Alive($continue) {
  if ($continue -isnot [scriptblock]) { Runtime-Deny }
  $alive = & $continue
  if ($alive -isnot [bool] -or -not $alive) { Runtime-Deny }
}
function Runtime-Hash($stream) {
  $stream.Position = 0
  $hash = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
  finally { $hash.Dispose(); $stream.Position = 0 }
}
function Runtime-Native {
  if ($null -ne $script:RuntimeNative) { return $script:RuntimeNative }
  if ([IntPtr]::Size -ne 8) { Runtime-Deny }
  $assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly(
    [Reflection.AssemblyName]::new('StarfieldRuntimePins_' + [Guid]::NewGuid().ToString('N')),
    [Reflection.Emit.AssemblyBuilderAccess]::Run)
  $module = $assembly.DefineDynamicModule('FixedRuntimePins')
  $type = $module.DefineType('FixedRuntimePins', 'Public, Abstract, Sealed')
  # Only fixed OS entry points are emitted. No source compiler or subprocess.
  $specs = @(
    @('CreateFileW','kernel32.dll',[IntPtr],@([string],[uint32],[uint32],[IntPtr],[uint32],[uint32],[IntPtr])),
    @('CreateDirectoryW','kernel32.dll',[bool],@([string],[IntPtr])),
    @('NtCreateFile','ntdll.dll',[int],@([IntPtr],[uint32],[IntPtr],[IntPtr],[IntPtr],[uint32],[uint32],[uint32],[uint32],[IntPtr],[uint32])),
    @('GetFileInformationByHandle','kernel32.dll',[bool],@([IntPtr],[IntPtr])),
    @('GetFinalPathNameByHandleW','kernel32.dll',[uint32],@([IntPtr],[Text.StringBuilder],[uint32],[uint32])),
    @('CloseHandle','kernel32.dll',[bool],@([IntPtr])),
    @('SetSecurityInfo','advapi32.dll',[uint32],@([IntPtr],[int],[uint32],[IntPtr],[IntPtr],[IntPtr],[IntPtr]))
  )
  foreach ($spec in $specs) {
    $method = $type.DefinePInvokeMethod($spec[0], ('C:\Windows\System32\' + $spec[1]), $spec[0],
      [Reflection.MethodAttributes]'Public, Static, PinvokeImpl', [Reflection.CallingConventions]::Standard,
      $spec[2], [type[]]$spec[3], [Runtime.InteropServices.CallingConvention]::Winapi,
      [Runtime.InteropServices.CharSet]::Unicode)
    $method.SetImplementationFlags($method.GetMethodImplementationFlags() -bor [Reflection.MethodImplAttributes]::PreserveSig)
  }
  $script:RuntimeNative = $type.CreateType()
  return $script:RuntimeNative
}
function Runtime-Security([string]$mode) {
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $rights = switch ($mode) { 'provision' { '0x1200ab' }; 'sealed' { 'FRFX' }; 'cleanup' { 'FA' }; default { Runtime-Deny } }
  $security = [Security.AccessControl.DirectorySecurity]::new()
  $security.SetSecurityDescriptorSddlForm(('D:P(A;;FA;;;SY)(A;;' + $rights + ';;;' + $sid + ')(A;;RC;;;OW)'))
  return ,$security.GetSecurityDescriptorBinaryForm()
}
function Runtime-CreateDirectory([string]$path) {
  $native = Runtime-Native
  $buffers = [Collections.Generic.List[IntPtr]]::new()
  $handle = [IntPtr]::Zero
  try {
    $name = '\??\' + $path
    $text = [Runtime.InteropServices.Marshal]::StringToHGlobalUni($name); $buffers.Add($text)
    $unicode = [Runtime.InteropServices.Marshal]::AllocHGlobal(16); $buffers.Add($unicode)
    $attributes = [Runtime.InteropServices.Marshal]::AllocHGlobal(48); $buffers.Add($attributes)
    $statusBlock = [Runtime.InteropServices.Marshal]::AllocHGlobal(16); $buffers.Add($statusBlock)
    $output = [Runtime.InteropServices.Marshal]::AllocHGlobal(8); $buffers.Add($output)
    foreach ($pair in @(@($unicode,16),@($attributes,48),@($statusBlock,16),@($output,8))) {
      [Runtime.InteropServices.Marshal]::Copy([byte[]]::new($pair[1]), 0, $pair[0], $pair[1])
    }
    $security = Runtime-Security 'provision'
    $descriptor = [Runtime.InteropServices.Marshal]::AllocHGlobal($security.Length); $buffers.Add($descriptor)
    [Runtime.InteropServices.Marshal]::Copy($security, 0, $descriptor, $security.Length)
    if ($name.Length -gt 16000) { Runtime-Deny }
    [Runtime.InteropServices.Marshal]::WriteInt16($unicode, 0, [int16]($name.Length*2))
    [Runtime.InteropServices.Marshal]::WriteInt16($unicode, 2, [int16](($name.Length+1)*2))
    [Runtime.InteropServices.Marshal]::WriteIntPtr($unicode, 8, $text)
    [Runtime.InteropServices.Marshal]::WriteInt32($attributes, 0, 48)
    [Runtime.InteropServices.Marshal]::WriteIntPtr($attributes, 16, $unicode)
    [Runtime.InteropServices.Marshal]::WriteInt32($attributes, 24, 0x40)
    [Runtime.InteropServices.Marshal]::WriteIntPtr($attributes, 32, $descriptor)
    # FILE_CREATE + FILE_DIRECTORY_FILE atomically supplies the creation DACL
    # and returns the creator's private rights. Later WRITE_DAC/WRITE_OWNER
    # opens are denied from birth; FILE_ADD_FILE handle opens conflict with
    # the retained creator's share mode. No writable-to-sealed permission gap.
    $status = $native::NtCreateFile($output, 0x1700ab, $attributes, $statusBlock,
      [IntPtr]::Zero, 0x10, 1, 2, 0x21, [IntPtr]::Zero, 0)
    $handle = [Runtime.InteropServices.Marshal]::ReadIntPtr($output)
    if ($status -ne 0 -or $handle -eq [IntPtr]::Zero -or $handle -eq [IntPtr](-1) -or
      [Runtime.InteropServices.Marshal]::ReadIntPtr($statusBlock,8).ToInt64() -ne 2) { Runtime-Deny }
    $result=$handle; $handle=[IntPtr]::Zero; return $result
  } finally {
    if ($handle -ne [IntPtr]::Zero -and $handle -ne [IntPtr](-1)) { [void]$native::CloseHandle($handle) }
    foreach ($memory in $buffers) { [Runtime.InteropServices.Marshal]::FreeHGlobal($memory) }
  }
}
function Runtime-Info([IntPtr]$handle, [bool]$directory) {
  $native = Runtime-Native
  $memory = [Runtime.InteropServices.Marshal]::AllocHGlobal(52)
  try {
    if (-not $native::GetFileInformationByHandle($handle, $memory)) { Runtime-Deny }
    $attributes = [Runtime.InteropServices.Marshal]::ReadInt32($memory, 0)
    if (($attributes -band 0x400) -ne 0 -or (($attributes -band 0x10) -ne 0) -ne $directory) { Runtime-Deny }
    if (-not $directory -and [Runtime.InteropServices.Marshal]::ReadInt32($memory, 40) -ne 1) { Runtime-Deny }
    return @([Runtime.InteropServices.Marshal]::ReadInt32($memory, 28),
      [Runtime.InteropServices.Marshal]::ReadInt32($memory, 44), [Runtime.InteropServices.Marshal]::ReadInt32($memory, 48)) -join ':'
  } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($memory) }
}
function Runtime-Path([IntPtr]$handle, [string]$expected) {
  $native = Runtime-Native
  $text = [Text.StringBuilder]::new(32768)
  $count = $native::GetFinalPathNameByHandleW($handle, $text, 32768, 0)
  if ($count -le 0 -or $count -ge 32768 -or $text.ToString().TrimEnd('\') -ine ('\\?\' + $expected.TrimEnd('\'))) { Runtime-Deny }
}
function Runtime-DirectoryPin($state, [string]$path) {
  $path = [IO.Path]::GetFullPath($path)
  $key = $path.TrimEnd('\').ToLowerInvariant()
  if ($state.DirectoryKeys.Contains($key)) { return }
  $native = Runtime-Native
  # FILE_LIST_DIRECTORY participates in sharing; metadata-only access does
  # not. Normal readers/writers are shared, while ancestor rename is refused.
  $handle = $native::CreateFileW($path, 0x81, 3, [IntPtr]::Zero, 3, 0x02200000, [IntPtr]::Zero)
  if ($handle -eq [IntPtr]::Zero -or $handle -eq [IntPtr](-1)) { Runtime-Deny }
  try {
    $identity = Runtime-Info $handle $true
    Runtime-Path $handle $path
    $state.Directories.Add([pscustomobject]@{ Handle=$handle; Path=$path; Identity=$identity; OriginalAcl=$null; Sealed=$false })
    [void]$state.DirectoryKeys.Add($key)
    $handle = [IntPtr]::Zero
  } finally { if ($handle -ne [IntPtr]::Zero) { [void]$native::CloseHandle($handle) } }
}
function New-RuntimeCustody([string]$path, [bool]$fresh, [bool]$writer=$true) {
  if (($fresh -and -not $writer) -or (-not $fresh -and $writer)) { Runtime-Deny }
  if ($path -cnotmatch '^[A-Za-z]:\\' -or $path.Substring(2).Contains(':')) { Runtime-Deny }
  $path = [IO.Path]::GetFullPath($path)
  $state = [pscustomobject]@{ Path=$path; Directories=[Collections.Generic.List[object]]::new();
    DirectoryKeys=[Collections.Generic.HashSet[string]]::new(); Files=[Collections.Generic.List[object]]::new();
    Python=$null; PythonHash=$null; Sealed=$false; Closed=$false; Expanded=$false; LeafWritable=$writer; ArchiveSha256=$script:RuntimeSha256 }
  try {
    $parents = [Collections.Generic.List[string]]::new()
    $parent = [IO.DirectoryInfo]::new($path).Parent
    while ($null -ne $parent) { $parents.Add($parent.FullName); $parent = $parent.Parent }
    for ($i=$parents.Count-1; $i -ge 0; $i--) { Runtime-DirectoryPin $state $parents[$i] }
    $native = Runtime-Native
    if ($fresh) {
      $handle = Runtime-CreateDirectory $path
      try {
        $identity = Runtime-Info $handle $true
        Runtime-Path $handle $path
        $state.Directories.Add([pscustomobject]@{ Handle=$handle; Path=$path; Identity=$identity;
          OriginalAcl=(Runtime-Security 'cleanup'); Sealed=$true })
        [void]$state.DirectoryKeys.Add($path.TrimEnd('\').ToLowerInvariant())
        $handle=[IntPtr]::Zero
      } finally { if ($handle -ne [IntPtr]::Zero) { [void]$native::CloseHandle($handle) } }
    } else { Runtime-DirectoryPin $state $path }
    return $state
  } catch { Close-RuntimeCustody $state $true; throw }
}
function Runtime-SetAcl([IntPtr]$handle, [byte[]]$bytes) {
  $native = Runtime-Native
  $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($bytes, 0)
  if ($null -eq $descriptor.DiscretionaryAcl) { Runtime-Deny }
  $acl = [byte[]]::new($descriptor.DiscretionaryAcl.BinaryLength)
  $descriptor.DiscretionaryAcl.GetBinaryForm($acl, 0)
  $memory = [Runtime.InteropServices.Marshal]::AllocHGlobal($acl.Length)
  try {
    [Runtime.InteropServices.Marshal]::Copy($acl, 0, $memory, $acl.Length)
    $flags = if (($descriptor.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -ne 0) { [uint32]2147483652 } else { [uint32]536870916 }
    $status = $native::SetSecurityInfo($handle, 1, $flags, [IntPtr]::Zero, [IntPtr]::Zero, $memory, [IntPtr]::Zero)
    if ($status -ne 0) {
      $failure = [InvalidOperationException]::new('FIXED_RUNTIME_UNPROVEN')
      $failure.Data['RuntimePhase'] = 'SET_ACL'; $failure.Data['RuntimeNativeCode'] = $status
      throw $failure
    }
  } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($memory) }
}
function Close-RuntimeCustody($state, [bool]$restore, [bool]$reportFailure=$false) {
  if ($null -eq $state -or $state.Closed) { return }
  $native = Runtime-Native
  # Restoration is used only after no interpreter was started, or after its
  # retained handle positively signaled. Unknown child lifetime stays sealed.
  foreach ($file in $state.Files) {
    $file.Stream.Dispose()
  }
  $failure = $null
  for ($i=$state.Directories.Count-1; $i -ge 0; $i--) {
    $directory = $state.Directories[$i]
    if ($restore -and $directory.Sealed) { try { Runtime-SetAcl $directory.Handle $directory.OriginalAcl } catch { if ($null -eq $failure) { $failure = $_ } } }
    [void]$native::CloseHandle($directory.Handle)
  }
  $state.Closed = $true
  if ($reportFailure -and $null -ne $failure) { throw $failure }
}
function Assert-RuntimeManifest($manifest) {
  if ($manifest.schemaVersion -cne 'stephanos.starfield-python-runtime.v1' -or $manifest.version -cne '3.14.10' -or
    $manifest.archiveUrl -cne $script:RuntimeUrl -or $manifest.archiveSha256 -cne $script:RuntimeSha256 -or
    $manifest.archiveBytes -ne $script:RuntimeArchiveBytes -or $manifest.expandedBytes -ne 24450611 -or
    @($manifest.files).Count -ne 37) { Runtime-Deny }
  $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  [long]$total = 0
  foreach ($file in $manifest.files) {
    if ($file.name -cnotmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$' -or $file.name -match '\.\.' -or
      $file.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $file.bytes -le 0 -or $file.bytes -gt 16777216 -or
      -not $names.Add($file.name)) { Runtime-Deny }
    $total += $file.bytes
  }
  if ($total -ne 24450611) { Runtime-Deny }
  foreach ($name in @('python.exe','python314.dll','python3.dll','python314.zip','python314._pth','_ctypes.pyd','vcruntime140.dll')) {
    if (-not $names.Contains($name)) { Runtime-Deny }
  }
}
function Get-RuntimeArchive($manifest, $continue) {
  Assert-RuntimeManifest $manifest
  Runtime-Alive $continue
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $request = [Net.HttpWebRequest]::Create($script:RuntimeUrl)
  $request.AllowAutoRedirect = $false; $request.Proxy = $null; $request.Credentials = $null
  $request.UseDefaultCredentials = $false; $request.Timeout = 15000; $request.ReadWriteTimeout = 5000
  $request.Method = 'GET'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $response = $stream = $null
  $buffered = [IO.MemoryStream]::new()
  try {
    $response = $request.GetResponse()
    if ([int]$response.StatusCode -ne 200 -or $response.ResponseUri.AbsoluteUri -cne $script:RuntimeUrl -or
      ($response.ContentLength -ne -1 -and $response.ContentLength -ne $script:RuntimeArchiveBytes)) { Runtime-Deny }
    $stream = $response.GetResponseStream(); $buffer = [byte[]]::new(65536)
    while (($count = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      Runtime-Alive $continue
      if ($clock.ElapsedMilliseconds -gt 45000 -or $buffered.Length + $count -gt $script:RuntimeArchiveBytes) { Runtime-Deny }
      $buffered.Write($buffer, 0, $count)
    }
    if ($buffered.Length -ne $script:RuntimeArchiveBytes -or (Runtime-Hash $buffered) -cne $script:RuntimeSha256) { Runtime-Deny }
    Runtime-Alive $continue
    return ,$buffered.ToArray()
  } finally { if ($null -ne $stream) { $stream.Dispose() }; if ($null -ne $response) { $response.Dispose() }; $buffered.Dispose() }
}
function Expand-RuntimeArchive([byte[]]$archiveBytes, $manifest, $state, $continue) {
  if ($state.Closed -or $state.Expanded -or -not $state.LeafWritable) { Runtime-Deny }
  Assert-RuntimeManifest $manifest
  $memory = [IO.MemoryStream]::new($archiveBytes, $false)
  $zip = $null
  try {
    if ($memory.Length -ne $script:RuntimeArchiveBytes -or (Runtime-Hash $memory) -cne $script:RuntimeSha256) { Runtime-Deny }
    [void][Reflection.Assembly]::Load('System.IO.Compression, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089')
    $zip = [IO.Compression.ZipArchive]::new($memory, [IO.Compression.ZipArchiveMode]::Read, $true)
    if ($zip.Entries.Count -ne 37) { Runtime-Deny }
    $expected = @{}; foreach ($file in $manifest.files) { $expected[$file.name] = $file }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $zip.Entries) {
      Runtime-Alive $continue
      if (-not $expected.ContainsKey($entry.FullName) -or -not $seen.Add($entry.FullName) -or
        $entry.Name -cne $entry.FullName -or $entry.Length -ne $expected[$entry.FullName].bytes) { Runtime-Deny }
      $source = $entry.Open(); $data = [IO.MemoryStream]::new()
      try {
        $buffer = [byte[]]::new(65536)
        while (($count = $source.Read($buffer, 0, $buffer.Length)) -gt 0) {
          Runtime-Alive $continue
          if ($data.Length + $count -gt $entry.Length) { Runtime-Deny }
          $data.Write($buffer, 0, $count)
        }
        if ($data.Length -ne $entry.Length -or (Runtime-Hash $data) -cne $expected[$entry.FullName].sha256) { Runtime-Deny }
        # Restricted creation security also prevents a pre-pin metadata-only
        # WRITE_DAC handle on a member. The creator alone receives this write
        # handle; after it closes, admission opens only read access.
        $native = Runtime-Native
        $security = Runtime-Security 'sealed'
        $descriptor = [Runtime.InteropServices.Marshal]::AllocHGlobal($security.Length)
        $attributes = [Runtime.InteropServices.Marshal]::AllocHGlobal(24)
        $handle=[IntPtr]::Zero; $safe=$file=$null
        try {
          [Runtime.InteropServices.Marshal]::Copy($security, 0, $descriptor, $security.Length)
          [Runtime.InteropServices.Marshal]::Copy([byte[]]::new(24), 0, $attributes, 24)
          [Runtime.InteropServices.Marshal]::WriteInt32($attributes,0,24)
          [Runtime.InteropServices.Marshal]::WriteIntPtr($attributes,8,$descriptor)
          $handle=$native::CreateFileW([IO.Path]::Combine($state.Path,$entry.FullName),[uint32]3221225472,1,$attributes,1,0x00200000,[IntPtr]::Zero)
          if ($handle -eq [IntPtr]::Zero -or $handle -eq [IntPtr](-1)) { Runtime-Deny }
          [void](Runtime-Info $handle $false)
          $safe=[Microsoft.Win32.SafeHandles.SafeFileHandle]::new($handle,$true)
          $file=[IO.FileStream]::new($safe,[IO.FileAccess]::Write)
          $data.Position=0; $data.CopyTo($file); $file.Flush($true)
        } finally {
          if ($null -ne $file) { $file.Dispose() } elseif ($null -ne $safe) { $safe.Dispose() }
          elseif ($handle -ne [IntPtr]::Zero -and $handle -ne [IntPtr](-1)) { [void]$native::CloseHandle($handle) }
          [Runtime.InteropServices.Marshal]::FreeHGlobal($attributes)
          [Runtime.InteropServices.Marshal]::FreeHGlobal($descriptor)
        }
      } finally { $source.Dispose(); $data.Dispose() }
    }
    $state.Expanded=$true
  } finally { if ($null -ne $zip) { $zip.Dispose() }; $memory.Dispose() }
}
function Assert-RuntimeNamespace($state, $manifest) {
  $actual = @([IO.Directory]::GetFileSystemEntries($state.Path))
  if ($actual.Count -ne @($manifest.files).Count) { Runtime-Deny }
  $names = @{}; foreach ($file in $manifest.files) { $names[$file.name] = $true }
  foreach ($path in $actual) {
    if (-not $names.ContainsKey([IO.Path]::GetFileName($path))) { Runtime-Deny }
  }
}
function Pin-VerifiedRuntime($state, $manifest, $continue) {
  if ($state.Closed -or $state.Sealed -or -not $state.Expanded -or -not $state.LeafWritable -or $state.Files.Count -ne 0) { Runtime-Deny }
  Assert-RuntimeManifest $manifest
  Assert-RuntimeNamespace $state $manifest
  $native = Runtime-Native
  foreach ($expected in $manifest.files) {
    Runtime-Alive $continue
    $path = [IO.Path]::Combine($state.Path, $expected.name)
    $handle = $native::CreateFileW($path, [uint32]2147483648, 1, [IntPtr]::Zero, 3, 0x00200000, [IntPtr]::Zero)
    if ($handle -eq [IntPtr]::Zero -or $handle -eq [IntPtr](-1)) { Runtime-Deny }
    $stream = $null; $safe = $null
    try {
      $identity = Runtime-Info $handle $false
      Runtime-Path $handle $path
      $safe = [Microsoft.Win32.SafeHandles.SafeFileHandle]::new($handle, $true)
      $stream = [IO.FileStream]::new($safe, [IO.FileAccess]::Read)
      if ($stream.Length -ne $expected.bytes -or (Runtime-Hash $stream) -cne $expected.sha256) { Runtime-Deny }
      $state.Files.Add([pscustomobject]@{ Name=$expected.name; Handle=$handle; Stream=$stream;
        Identity=$identity; Hash=$expected.sha256 })
      if ($expected.name -ceq 'python.exe') { $state.Python=$path; $state.PythonHash=$expected.sha256 }
      $handle = [IntPtr]::Zero; $stream=$safe=$null
    } finally {
      if ($null -ne $stream) { $stream.Dispose() }
      elseif ($null -ne $safe) { $safe.Dispose() }
      elseif ($handle -ne [IntPtr]::Zero) { [void]$native::CloseHandle($handle) }
    }
  }
  # OWNER RIGHTS suppresses an owner's implicit WRITE_DAC permission. No
  # unprivileged identity receives write/delete/create or permission-changing
  # rights; SYSTEM remains the trusted operating-system boundary.
  $bytes = Runtime-Security 'sealed'
  $leaf = $state.Directories[$state.Directories.Count-1]
  Runtime-SetAcl $leaf.Handle $bytes; $leaf.Sealed=$true; $state.Sealed=$true
  Assert-RuntimeNamespace $state $manifest
  Runtime-Alive $continue
  if ($null -eq $state.Python -or $state.Files.Count -ne 37) { Runtime-Deny }
  return $state
}
function New-FixedPythonRuntime([string]$requestId, $manifest, $continue) {
  if ($requestId -cnotmatch '^[a-z0-9][a-z0-9-]{7,95}$') { Runtime-Deny }
  $root = 'C:\Users\Stephan Callear\Documents\Codex\2026-11-05\starfield-vr-did-not-start-and\work'
  $base = [IO.Path]::Combine($root, 'native-paired-observer-runtimes-v1')
  # The existing work parent is pinned before creating the separate runtime
  # base. An existing base is verified; an existing request is never reused.
  $basePins = $null; $state = $null
  try {
    $basePins = New-RuntimeCustody $root $false $false
    $native = Runtime-Native
    if (-not [IO.Directory]::Exists($base) -and -not $native::CreateDirectoryW($base, [IntPtr]::Zero)) { Runtime-Deny }
    $state = New-RuntimeCustody ([IO.Path]::Combine($base, $requestId)) $true
    $archive = Get-RuntimeArchive $manifest $continue
    Expand-RuntimeArchive $archive $manifest $state $continue
    $result = Pin-VerifiedRuntime $state $manifest $continue
    $state=$null
    return $result
  } finally { Close-RuntimeCustody $basePins $true; Close-RuntimeCustody $state $true }
}
