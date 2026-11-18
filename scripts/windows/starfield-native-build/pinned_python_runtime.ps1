# Fixed PSF runtime in a trusted machine installation. Normal build admission
# is read-only; provisioning is a separate, explicitly elevated fixed installer.
$script:RuntimeNative = $null
$script:RuntimeUrl = 'https://www.python.org/ftp/python/3.14.10/python-3.14.10-embed-amd64.zip'
$script:RuntimeSha256 = '90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159'
$script:RuntimeArchiveBytes = 12619664
$script:RuntimeInstallRoot = 'C:\Program Files\Stephanos\BuildRuntimes\Python-3.14.10-amd64-v1'
$script:RuntimeTrustedSids = @('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')

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
  $specs = @(
    @('CreateFileW','kernel32.dll',[IntPtr],@([string],[uint32],[uint32],[IntPtr],[uint32],[uint32],[IntPtr])),
    @('CreateDirectoryW','kernel32.dll',[bool],@([string],[IntPtr])),
    @('GetFileInformationByHandle','kernel32.dll',[bool],@([IntPtr],[IntPtr])),
    @('GetFinalPathNameByHandleW','kernel32.dll',[uint32],@([IntPtr],[Text.StringBuilder],[uint32],[uint32])),
    @('GetSecurityInfo','advapi32.dll',[uint32],@([IntPtr],[int],[uint32],[IntPtr],[IntPtr],[IntPtr],[IntPtr],[IntPtr])),
    @('GetSecurityDescriptorLength','advapi32.dll',[uint32],@([IntPtr])),
    @('LocalFree','kernel32.dll',[IntPtr],@([IntPtr])),
    @('MoveFileExW','kernel32.dll',[bool],@([string],[string],[uint32])),
    @('CloseHandle','kernel32.dll',[bool],@([IntPtr]))
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
function Runtime-InstallSecurity {
  # Fixed machine identities, independent of the elevated user's profile/SID.
  $security = [Security.AccessControl.DirectorySecurity]::new()
  $security.SetSecurityDescriptorSddlForm('O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FRFX;;;BU)')
  return ,$security.GetSecurityDescriptorBinaryForm()
}
function Runtime-CheckSecurity([IntPtr]$handle, [bool]$managed) {
  $native = Runtime-Native
  $output = [Runtime.InteropServices.Marshal]::AllocHGlobal(8)
  $descriptor = [IntPtr]::Zero
  try {
    [Runtime.InteropServices.Marshal]::WriteIntPtr($output,[IntPtr]::Zero)
    if ($native::GetSecurityInfo($handle,1,5,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero,$output) -ne 0) { Runtime-Deny }
    $descriptor = [Runtime.InteropServices.Marshal]::ReadIntPtr($output)
    if ($descriptor -eq [IntPtr]::Zero) { Runtime-Deny }
    $length = $native::GetSecurityDescriptorLength($descriptor)
    if ($length -lt 20 -or $length -gt 65536) { Runtime-Deny }
    $bytes = [byte[]]::new($length)
    [Runtime.InteropServices.Marshal]::Copy($descriptor,$bytes,0,$length)
    $security = [Security.AccessControl.RawSecurityDescriptor]::new($bytes,0)
    if ($null -eq $security.Owner -or $null -eq $security.DiscretionaryAcl -or
      $security.DiscretionaryAcl.Count -eq 0 -or $script:RuntimeTrustedSids -cnotcontains $security.Owner.Value) { Runtime-Deny }
    if ($managed -and (($security.Owner.Value -cne 'S-1-5-18' -and $security.Owner.Value -cne 'S-1-5-32-544') -or
      ($security.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -eq 0)) { Runtime-Deny }
    # Ancestors may allow creating unrelated subdirectories (the normal C:\
    # ACL). Neither role permits changing this object or deleting its children.
    [uint32]$forbidden = if ($managed) { 0x500d0156 } else { 0x500d0152 }
    foreach ($ace in $security.DiscretionaryAcl) {
      if ((([int]$ace.AceFlags) -band ([int][Security.AccessControl.AceFlags]::InheritOnly)) -ne 0) { continue }
      if ($ace -isnot [Security.AccessControl.CommonAce]) { Runtime-Deny }
      if ($ace.AceQualifier -eq [Security.AccessControl.AceQualifier]::AccessDenied) { continue }
      if ($ace.AceQualifier -ne [Security.AccessControl.AceQualifier]::AccessAllowed -or $ace.IsCallback) { Runtime-Deny }
      if ($script:RuntimeTrustedSids -ccontains $ace.SecurityIdentifier.Value -or $ace.SecurityIdentifier.Value -ceq 'S-1-3-4') { continue }
      $mask = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$ace.AccessMask),0)
      if (($mask -band $forbidden) -ne 0) { Runtime-Deny }
    }
  } finally {
    if ($descriptor -ne [IntPtr]::Zero) { [void]$native::LocalFree($descriptor) }
    [Runtime.InteropServices.Marshal]::FreeHGlobal($output)
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
  # FILE_LIST_DIRECTORY|FILE_READ_ATTRIBUTES participates in share exclusion;
  # READ_CONTROL also permits checking the same retained object's owner/DACL.
  $handle = $native::CreateFileW($path,0x20081,3,[IntPtr]::Zero,3,0x02200000,[IntPtr]::Zero)
  if ($handle -eq [IntPtr]::Zero -or $handle -eq [IntPtr](-1)) { Runtime-Deny }
  try {
    $identity = Runtime-Info $handle $true
    Runtime-Path $handle $path
    $managed = $path.TrimEnd('\') -ieq 'C:\Program Files\Stephanos' -or $path.StartsWith('C:\Program Files\Stephanos\',[StringComparison]::OrdinalIgnoreCase)
    Runtime-CheckSecurity $handle $managed
    $state.Directories.Add([pscustomobject]@{ Handle=$handle; Path=$path; Identity=$identity })
    [void]$state.DirectoryKeys.Add($key)
    $handle=[IntPtr]::Zero
  } finally { if ($handle -ne [IntPtr]::Zero) { [void]$native::CloseHandle($handle) } }
}
function New-RuntimeCustody([string]$path) {
  if ($path -cnotmatch '^[A-Za-z]:\\' -or $path.Substring(2).Contains(':')) { Runtime-Deny }
  $path = [IO.Path]::GetFullPath($path)
  $state = [pscustomobject]@{ Path=$path; Directories=[Collections.Generic.List[object]]::new();
    DirectoryKeys=[Collections.Generic.HashSet[string]]::new(); Files=[Collections.Generic.List[object]]::new();
    Python=$null; PythonHash=$null; Sealed=$false; Closed=$false; ArchiveSha256=$script:RuntimeSha256 }
  try {
    $parents = [Collections.Generic.List[string]]::new()
    $parent = [IO.DirectoryInfo]::new($path)
    while ($null -ne $parent) { $parents.Add($parent.FullName); $parent=$parent.Parent }
    for ($i=$parents.Count-1; $i -ge 0; $i--) { Runtime-DirectoryPin $state $parents[$i] }
    return $state
  } catch { Close-RuntimeCustody $state; throw }
}
function Close-RuntimeCustody($state, [bool]$unusedRestore=$false) {
  if ($null -eq $state -or $state.Closed) { return }
  $native = Runtime-Native
  # Read-only consumers never change, restore or delete installation state.
  foreach ($file in $state.Files) { $file.Stream.Dispose() }
  for ($i=$state.Directories.Count-1; $i -ge 0; $i--) { [void]$native::CloseHandle($state.Directories[$i].Handle) }
  $state.Closed=$true
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
function New-ProtectedRuntimeDirectory([string]$path) {
  $native = Runtime-Native
  $security = Runtime-InstallSecurity
  $descriptor = [Runtime.InteropServices.Marshal]::AllocHGlobal($security.Length)
  $attributes = [Runtime.InteropServices.Marshal]::AllocHGlobal(24)
  try {
    [Runtime.InteropServices.Marshal]::Copy($security,0,$descriptor,$security.Length)
    [Runtime.InteropServices.Marshal]::Copy([byte[]]::new(24),0,$attributes,24)
    [Runtime.InteropServices.Marshal]::WriteInt32($attributes,0,24)
    [Runtime.InteropServices.Marshal]::WriteIntPtr($attributes,8,$descriptor)
    if (-not $native::CreateDirectoryW($path,$attributes)) { Runtime-Deny }
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($attributes)
    [Runtime.InteropServices.Marshal]::FreeHGlobal($descriptor)
  }
}
function Expand-RuntimeArchive([byte[]]$archiveBytes, $manifest, $state, $continue) {
  if ($state.Closed -or $state.Sealed -or $state.Files.Count -ne 0) { Runtime-Deny }
  Assert-RuntimeManifest $manifest
  $memory = [IO.MemoryStream]::new($archiveBytes,$false); $zip=$null
  try {
    if ($memory.Length -ne $script:RuntimeArchiveBytes -or (Runtime-Hash $memory) -cne $script:RuntimeSha256) { Runtime-Deny }
    [void][Reflection.Assembly]::Load('System.IO.Compression, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089')
    $zip=[IO.Compression.ZipArchive]::new($memory,[IO.Compression.ZipArchiveMode]::Read,$true)
    if ($zip.Entries.Count -ne 37) { Runtime-Deny }
    $expected=@{}; foreach ($row in $manifest.files) { $expected[$row.name]=$row }
    $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $zip.Entries) {
      Runtime-Alive $continue
      if (-not $expected.ContainsKey($entry.FullName) -or -not $seen.Add($entry.FullName) -or
        $entry.Name -cne $entry.FullName -or $entry.Length -ne $expected[$entry.FullName].bytes) { Runtime-Deny }
      $source=$entry.Open(); $data=[IO.MemoryStream]::new()
      try {
        $buffer=[byte[]]::new(65536)
        while (($count=$source.Read($buffer,0,$buffer.Length)) -gt 0) {
          Runtime-Alive $continue
          if ($data.Length+$count -gt $entry.Length) { Runtime-Deny }
          $data.Write($buffer,0,$count)
        }
        if ($data.Length -ne $entry.Length -or (Runtime-Hash $data) -cne $expected[$entry.FullName].sha256) { Runtime-Deny }
        $native=Runtime-Native; $security=Runtime-InstallSecurity
        $descriptor=[Runtime.InteropServices.Marshal]::AllocHGlobal($security.Length)
        $attributes=[Runtime.InteropServices.Marshal]::AllocHGlobal(24)
        $handle=[IntPtr]::Zero; $safe=$file=$null
        try {
          [Runtime.InteropServices.Marshal]::Copy($security,0,$descriptor,$security.Length)
          [Runtime.InteropServices.Marshal]::Copy([byte[]]::new(24),0,$attributes,24)
          [Runtime.InteropServices.Marshal]::WriteInt32($attributes,0,24)
          [Runtime.InteropServices.Marshal]::WriteIntPtr($attributes,8,$descriptor)
          $path=[IO.Path]::Combine($state.Path,$entry.FullName)
          $handle=$native::CreateFileW($path,[uint32]3221225472,1,$attributes,1,0x00200000,[IntPtr]::Zero)
          if ($handle -eq [IntPtr]::Zero -or $handle -eq [IntPtr](-1)) { Runtime-Deny }
          [void](Runtime-Info $handle $false); Runtime-Path $handle $path; Runtime-CheckSecurity $handle $true
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
  } finally { if ($null -ne $zip) { $zip.Dispose() }; $memory.Dispose() }
}
function Assert-RuntimeNamespace($state,$manifest) {
  $actual=@([IO.Directory]::GetFileSystemEntries($state.Path))
  if ($actual.Count -ne @($manifest.files).Count) { Runtime-Deny }
  $names=@{}; foreach ($row in $manifest.files) { $names[$row.name]=$true }
  foreach ($path in $actual) { if (-not $names.ContainsKey([IO.Path]::GetFileName($path))) { Runtime-Deny } }
}
function Pin-VerifiedRuntime($state,$manifest,$continue) {
  if ($state.Closed -or $state.Sealed -or $state.Files.Count -ne 0) { Runtime-Deny }
  Assert-RuntimeManifest $manifest; Assert-RuntimeNamespace $state $manifest
  $native=Runtime-Native
  foreach ($expected in $manifest.files) {
    Runtime-Alive $continue
    $path=[IO.Path]::Combine($state.Path,$expected.name)
    $handle=$native::CreateFileW($path,[uint32]2147483648,1,[IntPtr]::Zero,3,0x00200000,[IntPtr]::Zero)
    if ($handle -eq [IntPtr]::Zero -or $handle -eq [IntPtr](-1)) { Runtime-Deny }
    $stream=$safe=$null
    try {
      $identity=Runtime-Info $handle $false
      Runtime-Path $handle $path; Runtime-CheckSecurity $handle $true
      $safe=[Microsoft.Win32.SafeHandles.SafeFileHandle]::new($handle,$true)
      $stream=[IO.FileStream]::new($safe,[IO.FileAccess]::Read)
      if ($stream.Length -ne $expected.bytes -or (Runtime-Hash $stream) -cne $expected.sha256) { Runtime-Deny }
      $state.Files.Add([pscustomobject]@{Name=$expected.name;Handle=$handle;Stream=$stream;Identity=$identity;Hash=$expected.sha256})
      if ($expected.name -ceq 'python.exe') { $state.Python=$path; $state.PythonHash=$expected.sha256 }
      $handle=[IntPtr]::Zero; $stream=$safe=$null
    } finally {
      if ($null -ne $stream) { $stream.Dispose() } elseif ($null -ne $safe) { $safe.Dispose() }
      elseif ($handle -ne [IntPtr]::Zero) { [void]$native::CloseHandle($handle) }
    }
  }
  Assert-RuntimeNamespace $state $manifest; Runtime-Alive $continue
  if ($null -eq $state.Python -or $state.Files.Count -ne 37) { Runtime-Deny }
  $state.Sealed=$true
  return $state
}
function New-FixedPythonRuntime([string]$requestId,$manifest,$continue) {
  if ($requestId -cnotmatch '^[a-z0-9][a-z0-9-]{7,95}$') { Runtime-Deny }
  Runtime-Alive $continue
  $state=$null
  try {
    $state=New-RuntimeCustody $script:RuntimeInstallRoot
    $result=Pin-VerifiedRuntime $state $manifest $continue
    $state=$null; return $result
  } finally { Close-RuntimeCustody $state }
}
function Install-FixedPythonRuntime($manifest) {
  Assert-RuntimeManifest $manifest
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  try {
    $principal=[Security.Principal.WindowsPrincipal]::new($identity)
    if ([IntPtr]::Size -ne 8 -or -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Runtime-Deny }
  } finally { $identity.Dispose() }
  $installationClock=[Diagnostics.Stopwatch]::StartNew()
  $continue={ $installationClock.Elapsed.TotalSeconds -lt 150 }.GetNewClosure()
  $parents=$stage=$verified=$null
  $staging=$script:RuntimeInstallRoot+'.installing'
  try {
    $parents=New-RuntimeCustody 'C:\Program Files'
    foreach ($path in @('C:\Program Files\Stephanos','C:\Program Files\Stephanos\BuildRuntimes')) {
      if (-not [IO.Directory]::Exists($path)) { New-ProtectedRuntimeDirectory $path }
      Runtime-DirectoryPin $parents $path
    }
    if ([IO.Directory]::Exists($script:RuntimeInstallRoot)) {
      $verified=New-FixedPythonRuntime 'installer-existing-v1' $manifest $continue
      return [pscustomobject]@{schemaVersion='stephanos.starfield-python-install.v1';status='ALREADY_VERIFIED';runtimeVersion='3.14.10';archiveSha256=$script:RuntimeSha256;verifiedFiles=37}
    }
    # A partial/conflicting target or staging path is never repaired/reclaimed.
    if ([IO.File]::Exists($script:RuntimeInstallRoot) -or [IO.File]::Exists($staging) -or [IO.Directory]::Exists($staging)) { Runtime-Deny }
    $archive=Get-RuntimeArchive $manifest $continue
    New-ProtectedRuntimeDirectory $staging
    $stage=New-RuntimeCustody $staging
    Expand-RuntimeArchive $archive $manifest $stage $continue
    $stage=Pin-VerifiedRuntime $stage $manifest $continue
    $identity=$stage.Directories[$stage.Directories.Count-1].Identity
    # Staging and both parents remain administrator/SYSTEM-owned. Drop only
    # staging read pins for an atomic no-replace rename; parent pins stay held.
    Close-RuntimeCustody $stage; $stage=$null
    Runtime-Alive $continue
    $native=Runtime-Native
    if (-not $native::MoveFileExW($staging,$script:RuntimeInstallRoot,0)) { Runtime-Deny }
    $verified=New-FixedPythonRuntime 'installer-published-v1' $manifest $continue
    if ($verified.Directories[$verified.Directories.Count-1].Identity -cne $identity) { Runtime-Deny }
    return [pscustomobject]@{schemaVersion='stephanos.starfield-python-install.v1';status='INSTALLED';runtimeVersion='3.14.10';archiveSha256=$script:RuntimeSha256;verifiedFiles=37}
  } finally { Close-RuntimeCustody $verified; Close-RuntimeCustody $stage; Close-RuntimeCustody $parents }
}
