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
function Runtime-DirectoryPin($state, [string]$path, [bool]$writer) {
  $path = [IO.Path]::GetFullPath($path)
  $key = $path.TrimEnd('\').ToLowerInvariant()
  if ($state.DirectoryKeys.Contains($key)) { return }
  $native = Runtime-Native
  # An exclusive writer on the fresh leaf excludes existing directory write
  # handles. Ancestors remain shared for normal use but cannot be renamed.
  $access = if ($writer) { [uint32]3221684224 } else { [uint32]128 }
  $share = if ($writer) { [uint32]1 } else { [uint32]3 }
  $handle = $native::CreateFileW($path, $access, $share, [IntPtr]::Zero, 3, 0x02200000, [IntPtr]::Zero)
  if ($handle -eq [IntPtr]::Zero -or $handle -eq [IntPtr](-1)) { Runtime-Deny }
  try {
    $identity = Runtime-Info $handle $true
    Runtime-Path $handle $path
    $saved = if ($writer) { [IO.Directory]::GetAccessControl($path).GetSecurityDescriptorBinaryForm() } else { $null }
    $state.Directories.Add([pscustomobject]@{ Handle=$handle; Path=$path; Identity=$identity; OriginalAcl=$saved; Sealed=$false })
    [void]$state.DirectoryKeys.Add($key)
    $handle = [IntPtr]::Zero
  } finally { if ($handle -ne [IntPtr]::Zero) { [void]$native::CloseHandle($handle) } }
}
function New-RuntimeCustody([string]$path, [bool]$fresh, [bool]$writer=$true) {
  if ($path -cnotmatch '^[A-Za-z]:\\' -or $path.Substring(2).Contains(':')) { Runtime-Deny }
  $path = [IO.Path]::GetFullPath($path)
  $state = [pscustomobject]@{ Path=$path; Directories=[Collections.Generic.List[object]]::new();
    DirectoryKeys=[Collections.Generic.HashSet[string]]::new(); Files=[Collections.Generic.List[object]]::new();
    Python=$null; PythonHash=$null; Sealed=$false; Closed=$false; LeafWritable=$writer; ArchiveSha256=$script:RuntimeSha256 }
  try {
    $parents = [Collections.Generic.List[string]]::new()
    $parent = [IO.DirectoryInfo]::new($path).Parent
    while ($null -ne $parent) { $parents.Add($parent.FullName); $parent = $parent.Parent }
    for ($i=$parents.Count-1; $i -ge 0; $i--) { Runtime-DirectoryPin $state $parents[$i] $false }
    $native = Runtime-Native
    if ($fresh -and -not $native::CreateDirectoryW($path, [IntPtr]::Zero)) { Runtime-Deny }
    Runtime-DirectoryPin $state $path $writer
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
    if ($native::SetSecurityInfo($handle, 1, $flags, [IntPtr]::Zero, [IntPtr]::Zero, $memory, [IntPtr]::Zero) -ne 0) { Runtime-Deny }
  } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($memory) }
}
function Close-RuntimeCustody($state, [bool]$restore) {
  if ($null -eq $state -or $state.Closed) { return }
  $native = Runtime-Native
  # Restoration is used only after no interpreter was started, or after its
  # retained handle positively signaled. Unknown child lifetime stays sealed.
  foreach ($file in $state.Files) {
    if ($restore -and $file.Sealed) { try { Runtime-SetAcl $file.Handle $file.OriginalAcl } catch { } }
    $file.Stream.Dispose()
  }
  for ($i=$state.Directories.Count-1; $i -ge 0; $i--) {
    $directory = $state.Directories[$i]
    if ($restore -and $directory.Sealed) { try { Runtime-SetAcl $directory.Handle $directory.OriginalAcl } catch { } }
    [void]$native::CloseHandle($directory.Handle)
  }
  $state.Closed = $true
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
        $file = [IO.File]::Open([IO.Path]::Combine($state.Path, $entry.FullName), 'CreateNew', 'Write', 'None')
        try { $data.Position = 0; $data.CopyTo($file); $file.Flush($true) } finally { $file.Dispose() }
      } finally { $source.Dispose(); $data.Dispose() }
    }
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
  if ($state.Closed -or $state.Sealed -or -not $state.LeafWritable -or $state.Files.Count -ne 0) { Runtime-Deny }
  Assert-RuntimeManifest $manifest
  Assert-RuntimeNamespace $state $manifest
  $native = Runtime-Native
  foreach ($expected in $manifest.files) {
    Runtime-Alive $continue
    $path = [IO.Path]::Combine($state.Path, $expected.name)
    $handle = $native::CreateFileW($path, [uint32]2147876864, 1, [IntPtr]::Zero, 3, 0x00200000, [IntPtr]::Zero)
    if ($handle -eq [IntPtr]::Zero -or $handle -eq [IntPtr](-1)) { Runtime-Deny }
    $stream = $null; $safe = $null
    try {
      $identity = Runtime-Info $handle $false
      Runtime-Path $handle $path
      $saved = [IO.File]::GetAccessControl($path).GetSecurityDescriptorBinaryForm()
      $safe = [Microsoft.Win32.SafeHandles.SafeFileHandle]::new($handle, $true)
      $stream = [IO.FileStream]::new($safe, [IO.FileAccess]::Read)
      if ($stream.Length -ne $expected.bytes -or (Runtime-Hash $stream) -cne $expected.sha256) { Runtime-Deny }
      $state.Files.Add([pscustomobject]@{ Name=$expected.name; Handle=$handle; Stream=$stream;
        OriginalAcl=$saved; Sealed=$false; Identity=$identity; Hash=$expected.sha256 })
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
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $security = [Security.AccessControl.DirectorySecurity]::new()
  $security.SetSecurityDescriptorSddlForm(('D:P(A;;FA;;;SY)(A;;FRFX;;;' + $sid + ')(A;;RC;;;OW)'))
  $bytes = $security.GetSecurityDescriptorBinaryForm()
  foreach ($file in $state.Files) { Runtime-SetAcl $file.Handle $bytes; $file.Sealed=$true }
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
