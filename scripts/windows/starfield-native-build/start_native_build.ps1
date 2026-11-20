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
function Verified-Source([string]$name) {
  $entry = $packet.files.PSObject.Properties[$name]
  if ($null -eq $entry) { Deny }
  $record = $entry.Value
  $raw = [Convert]::FromBase64String($record.base64)
  if ($raw.Length -gt 262144 -or $raw.Length -ne $record.bytes) { Deny }
  $memory = [IO.MemoryStream]::new($raw, $false)
  try { if ((Stream-Hash $memory) -cne $record.sha256) { Deny } } finally { $memory.Dispose() }
  return [Text.UTF8Encoding]::new($false,$true).GetString($raw)
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
  $phase = 'RUNTIME'
  $module = Verified-Source 'scripts/windows/starfield-native-build/pinned_python_runtime.ps1'
  . ([scriptblock]::Create($module))
  $manifest = (Verified-Source 'scripts/windows/starfield-native-build/python_runtime_v1.json') | ConvertFrom-Json
  $continue = { -not $owner.get_HasExited() -and $clock.ElapsedMilliseconds -lt 60000 }
  $pin = New-FixedPythonRuntime $packet.requestId $manifest $continue
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
  $info.FileName = $pin.Python
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
  if ($owner.get_HasExited() -or -not $pin.Sealed -or $pin.Files.Count -ne 37) { Deny }
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
  if (-not $actualImage -or (Plain-Path $actualImage) -ine $pin.Python) { Deny }
  $actual = [IO.File]::Open($actualImage, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try { if ((Stream-Hash $actual) -cne $pin.PythonHash) { Deny } } finally { $actual.Dispose() }
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
  $childGone = -not $started
  if ($null -ne $child) {
    try { if ($started -and -not $child.get_HasExited()) { $child.Kill(); [void]$child.WaitForExit(5000) } } catch { }
    try { $childGone = $child.get_HasExited() } catch { $childGone = $false }
    $child.Dispose()
  }
  if ($null -ne $pin) { Close-RuntimeCustody $pin $childGone }
  if ($null -ne $owner) { $owner.Dispose() }
  if ($null -ne $self) { $self.Dispose() }
}
exit $exitCode
