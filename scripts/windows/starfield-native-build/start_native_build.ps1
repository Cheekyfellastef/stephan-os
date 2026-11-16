$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false, $true)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false, $true)
$owner = $self = $child = $pin = $null
$started = $false
$clock = [Diagnostics.Stopwatch]::StartNew()
$exitCode = 2
$phase = 'INPUT'
$profile = 'C:\Users\Stephan Callear'

function Deny { throw 'FIXED_LAUNCHER_REFUSED' }
function Plain-Path([string]$path) {
  if ($path -cnotmatch '^[A-Za-z]:\\' -or $path.Substring(2).Contains(':')) { Deny }
  $item = Get-Item -LiteralPath $path -Force
  if ($item.PSIsContainer) { Deny }
  $p = $item
  while ($null -ne $p) {
    if (($p.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Deny }
    $p = if ($p -is [IO.FileInfo]) { $p.Directory } else { $p.Parent }
  }
  return [IO.Path]::GetFullPath($item.FullName)
}
function Stream-Hash($stream) {
  $stream.Position = 0
  $h = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($h.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
  finally { $h.Dispose(); $stream.Position = 0 }
}
function Candidate-Paths {
  $list = [Collections.Generic.List[string]]::new()
  foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
    $base = $key = $null
    try {
      $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, [Microsoft.Win32.RegistryView]::Registry64)
      $key = $base.OpenSubKey('Software\Python\PythonCore', $false)
      if ($null -eq $key) { continue }
      foreach ($tag in @($key.GetSubKeyNames() | Sort-Object -Descending)) {
        if ($tag -cnotmatch '^3\.(?:1[0-9]|[2-9][0-9])(?:-(?:32|64))?$') { continue }
        $install = $null
        try {
          $install = $key.OpenSubKey($tag + '\InstallPath', $false)
          if ($null -eq $install) { continue }
          $directory = $install.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
          if ($directory -is [string] -and $directory.Length -lt 2048) {
            $list.Add([IO.Path]::Combine($directory, 'python.exe'))
          }
        } finally { if ($null -ne $install) { $install.Dispose() } }
      }
    } finally { if ($null -ne $key) { $key.Dispose() }; if ($null -ne $base) { $base.Dispose() } }
  }
  foreach ($minor in 15..10) {
    foreach ($root in @('C:\Program Files', ($profile + '\AppData\Local\Programs\Python'), 'C:\')) {
      $list.Add([IO.Path]::Combine($root, ('Python3' + $minor), 'python.exe'))
    }
  }
  return @($list | Select-Object -Unique)
}
function Pin-Python([string]$candidate) {
  $file = $null
  try {
    $path = Plain-Path $candidate
    if ([IO.Path]::GetFileName($path) -ine 'python.exe') { Deny }
    $file = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    if ($file.Length -lt 256 -or $file.Length -gt 16777216) { Deny }
    $reader = [IO.BinaryReader]::new($file, [Text.Encoding]::ASCII, $true)
    try {
      if ($reader.ReadUInt16() -ne 0x5a4d) { Deny }
      $file.Position = 60; $offset = $reader.ReadInt32()
      if ($offset -lt 64 -or $offset -gt ($file.Length - 26)) { Deny }
      $file.Position = $offset
      if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664) { Deny }
      $file.Position = $offset + 24
      if ($reader.ReadUInt16() -ne 0x20b) { Deny }
    } finally { $reader.Dispose() }
    $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($path)
    if ($version.FileMajorPart -ne 3 -or $version.FileMinorPart -lt 10) { Deny }
    $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $path
    if ([string]$signature.Status -cne 'Valid' -or $null -eq $signature.SignerCertificate -or
      $signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -cne 'Python Software Foundation') { Deny }
    $result = [pscustomobject]@{ Path=$path; Stream=$file; Hash=(Stream-Hash $file) }
    $file = $null
    return $result
  } finally { if ($null -ne $file) { $file.Dispose() } }
}

try {
  if ($args.Count -ne 0 -or [IntPtr]::Size -ne 8 -or $env:USERPROFILE -ine $profile) { Deny }
  $inputText = [Text.StringBuilder]::new()
  $buffer = [char[]]::new(4096)
  while (($n = [Console]::In.Read($buffer, 0, $buffer.Length)) -gt 0) {
    if (($inputText.Length + $n) -gt 3145728) { Deny }
    [void]$inputText.Append($buffer, 0, $n)
  }
  $packet = $inputText.ToString() | ConvertFrom-Json
  $keys = @($packet.PSObject.Properties.Name | Sort-Object)
  if (($keys -join ',') -cne 'files,parentPid,requestId,schemaVersion,sourceClosureSha256,sourceHead,stage' -or
    $packet.schemaVersion -cne 'stephanos.starfield-native-build-input.v1' -or $packet.stage -cne 'paired-source-observe-v1' -or
    $packet.sourceHead -cnotmatch '^[a-f0-9]{40}$' -or $packet.sourceClosureSha256 -cnotmatch '^[a-f0-9]{64}$' -or
    $packet.requestId -cnotmatch '^[a-z0-9][a-z0-9-]{7,95}$' -or
    ($packet.parentPid -isnot [int] -and $packet.parentPid -isnot [long]) -or $packet.parentPid -le 0 -or $packet.parentPid -gt 4294967295) { Deny }
  $phase = 'OWNER'
  $owner = [Diagnostics.Process]::GetProcessById($packet.parentPid)
  if ($owner.get_Handle() -eq [IntPtr]::Zero -or $owner.get_HasExited()) { Deny }
  $ownerImage = $owner.get_MainModule().FileName
  if ($ownerImage -ine 'C:\Program Files\nodejs\node.exe') { Deny }
  $born = $owner.get_StartTime()
  if ($born -isnot [DateTime]) { Deny }
  $self = [Diagnostics.Process]::GetCurrentProcess()
  [void]$self.get_Handle()
  if ($born -gt $self.get_StartTime()) { Deny }
  $packet | Add-Member -NotePropertyName parentBirthFileTime -NotePropertyValue ($born.ToUniversalTime().ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture))
  $packet | Add-Member -NotePropertyName launcherPid -NotePropertyValue $PID
  $packet | Add-Member -NotePropertyName launcherBirthFileTime -NotePropertyValue ($self.get_StartTime().ToUniversalTime().ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture))
  $phase = 'SELECTION'
  foreach ($candidate in @(Candidate-Paths)) {
    if ($clock.ElapsedMilliseconds -gt 30000 -or $owner.get_HasExited()) { Deny }
    try { $pin = Pin-Python $candidate; break } catch { $pin = $null }
  }
  if ($null -eq $pin) { Deny }
  $bootstrap = @'
import base64,hashlib,json,struct,sys,types
if sys.version_info<(3,10) or struct.calcsize('P')!=8 or not sys.flags.isolated or not sys.flags.no_site or not sys.dont_write_bytecode: raise SystemExit(2)
raw=sys.stdin.buffer.read(3145729)
if len(raw)>3145728: raise SystemExit(2)
p=json.loads(raw);r=p['files']['scripts/windows/starfield-native-build/native_build.py']
b=base64.b64decode(r['base64'],validate=True)
if len(b)>262144 or hashlib.sha256(b).hexdigest()!=r['sha256']: raise SystemExit(2)
m=types.ModuleType('_starfield_native_build');m.__file__='scripts/windows/starfield-native-build/native_build.py';sys.modules[m.__name__]=m
exec(compile(b,m.__file__,'exec'),m.__dict__)
raise SystemExit(m.main_packet(p))
'@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($bootstrap))
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $pin.Path
  $info.Arguments = '-I -S -B -c "import base64;exec(base64.b64decode(''' + $encoded + '''))"'
  $info.WorkingDirectory = 'C:\Windows\System32'
  $info.UseShellExecute = $false; $info.CreateNoWindow = $true; $info.ErrorDialog = $false
  $info.RedirectStandardInput = $true; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
  $info.StandardOutputEncoding = [Text.UTF8Encoding]::new($false, $true)
  $info.StandardErrorEncoding = [Text.UTF8Encoding]::new($false, $true)
  $info.EnvironmentVariables.Clear()
  foreach ($name in @('APPDATA','LOCALAPPDATA','PROGRAMDATA','PROGRAMFILES','PROGRAMFILES(X86)','SYSTEMDRIVE','SYSTEMROOT','USERDOMAIN','USERNAME','USERPROFILE','WINDIR','TEMP','TMP')) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($null -ne $value -and $value.Length -lt 4096 -and $value -notmatch '[\x00\r\n]') { $info.EnvironmentVariables[$name] = $value }
  }
  $info.EnvironmentVariables['PATH'] = 'C:\Windows\System32;C:\Windows'
  if ($owner.get_HasExited() -or (Stream-Hash $pin.Stream) -cne $pin.Hash) { Deny }
  $phase = 'START'
  $child = [Diagnostics.Process]::new(); $child.StartInfo = $info
  if (-not $child.Start()) { Deny }
  $started = $true
  [void]$child.get_Handle()
  $phase = 'IMAGE'
  $imageDeadline = $clock.ElapsedMilliseconds + 5000
  $actualImage = $null
  while ($clock.ElapsedMilliseconds -lt $imageDeadline -and -not $child.get_HasExited()) {
    try { $actualImage = $child.get_MainModule().FileName; if ($actualImage) { break } } catch { }
    Start-Sleep -Milliseconds 10
  }
  if (-not $actualImage -or (Plain-Path $actualImage) -ine $pin.Path) { Deny }
  $actual = [IO.File]::Open($actualImage, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try { if ((Stream-Hash $actual) -cne $pin.Hash) { Deny } } finally { $actual.Dispose() }
  $payload = $packet | ConvertTo-Json -Depth 12 -Compress
  if ([Text.Encoding]::UTF8.GetByteCount($payload) -gt 3145728) { Deny }
  $phase = 'EXECUTION'
  $child.StandardInput.Write($payload); $child.StandardInput.Close()
  $out = [Text.StringBuilder]::new()
  $ob = [char[]]::new(4096); $eb = [char[]]::new(1)
  $ot = $child.StandardOutput.ReadAsync($ob, 0, $ob.Length)
  $et = $child.StandardError.ReadAsync($eb, 0, $eb.Length)
  $outDone = $errDone = $false
  while (-not ($child.get_HasExited() -and $outDone -and $errDone)) {
    if ($owner.get_HasExited() -or $clock.ElapsedMilliseconds -gt 660000) { Deny }
    if (-not $outDone -and $ot.IsCompleted) {
      $n = $ot.GetAwaiter().GetResult(); if ($n -eq 0) { $outDone = $true }
      else { if (($out.Length + $n) -gt 65536) { Deny }; [void]$out.Append($ob, 0, $n); $ot = $child.StandardOutput.ReadAsync($ob, 0, $ob.Length) }
    }
    if (-not $errDone -and $et.IsCompleted) {
      if ($et.GetAwaiter().GetResult() -ne 0) { Deny }
      $errDone = $true
    }
    Start-Sleep -Milliseconds 10
  }
  $phase = 'TERMINAL'
  $code = $child.get_ExitCode()
  if ($code -isnot [int] -or $code -notin @(0,2,3) -or $owner.get_HasExited()) { Deny }
  $proof = $out.ToString() | ConvertFrom-Json
  $allowed = @('schemaVersion','sourceHead','requestId','stage','sourceClosureSha256','recipeSha256','finalVerdict','reason','originalSourceVerified','originalSourceUnchanged','sourceClosureVerified','isolatedBuildCreated','toolchainObserved','buildPassed','testsPassed','allJobsEmpty','executionCustodyReleased','outputComplete','terminalFinalized','stagesCompleted','artifacts','workerGoal','missionGoal','arbitraryShellAllowed','arbitraryPathAllowed','arbitraryExecutableAllowed','providerMutationAllowed','sourceMutationAllowed','launchAllowed','pixelsCaptured','gpuCommandsIssued','openXrSubmitted','headsetPlaytestReady')
  if (@($proof.PSObject.Properties.Name | Where-Object { $_ -cnotin $allowed }).Count -ne 0 -or
    $proof.schemaVersion -cne 'stephanos.starfield-native-build.v1' -or $proof.sourceHead -cne $packet.sourceHead -or
    $proof.requestId -cne $packet.requestId -or $proof.reason -cnotmatch '^[A-Z][A-Z0-9_]{0,95}$') { Deny }
  [Console]::Out.WriteLine(($proof | ConvertTo-Json -Depth 8 -Compress))
  $exitCode = $code
} catch {
  [Console]::Out.WriteLine(('{"schemaVersion":"stephanos.starfield-native-build-launcher.v1","finalVerdict":"STARFIELD_VR_NATIVE_BUILD_BLOCKED","reason":"FIXED_PYTHON_' + $phase + '_UNPROVEN","executionCustodyReleased":false}'))
  $exitCode = 3
} finally {
  if ($null -ne $child) {
    try { if ($started -and -not $child.get_HasExited()) { $child.Kill(); [void]$child.WaitForExit(5000) } } catch { }
    $child.Dispose()
  }
  if ($null -ne $pin) { $pin.Stream.Dispose() }
  if ($null -ne $owner) { $owner.Dispose() }
  if ($null -ne $self) { $self.Dispose() }
}
exit $exitCode
