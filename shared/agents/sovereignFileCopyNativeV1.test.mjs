import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, stat, lstat, link, symlink, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  runSovereignFileCopyV1 as copy,
  runSovereignFileHashV1 as hashFile,
  SOVEREIGN_FILE_COPY_LIMITS_V1 as LIMITS,
} from './sovereignFileCopyV1.mjs';

const WINDOWS = { skip: process.platform !== 'win32' };
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const digest = value => createHash('sha256').update(value).digest('hex');
const nativeSource = () => readFileSync(new URL('../../scripts/windows/SovereignFileCopyV1.cs', import.meta.url), 'utf8');

async function withDirectory(action) {
  // Windows' temporary directory is commonly under excluded AppData. Disposable
  // fixtures use an explicit ordinary user directory, never loosen production.
  const root = await mkdtemp(join(homedir(), 'sovereign-file-copy-native-'));
  try { await action(root); } finally { await rm(root, { recursive: true, force: true }); }
}
function nativeFixture(program, data) {
  const input = String.raw`
$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false,$true)
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false,$true)
$r=[Console]::In.ReadToEnd()|ConvertFrom-Json
Add-Type -TypeDefinition $r.nativeSource
` + program;
  const result = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(input, 'utf16le').toString('base64')],
    { input: JSON.stringify({ ...data, nativeSource: nativeSource() }), encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 65_536 });
  assert.equal(result.status, 0, JSON.stringify({ error: result.error?.code, stdout: result.stdout, stderr: result.stderr }));
  return JSON.parse(result.stdout.trim());
}
function rawTransport(request) {
  const script = readFileSync(new URL('../../scripts/windows/sovereign-copy-file-content.ps1', import.meta.url), 'utf8');
  const result = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { input: typeof request === 'string' || Buffer.isBuffer(request) ? request : JSON.stringify(request),
      encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 65_536 });
  assert.equal(result.error, undefined, result.error?.message);
  return { status: result.status, receipt: JSON.parse(result.stdout.trim()) };
}

test('Windows hash then binary content copy crosses directories, preserves source identity/data, and omits alternate streams', WINDOWS, async () => {
  await withDirectory(async root => {
    const from = join(root, 'from'), to = join(root, 'to'); await mkdir(from); await mkdir(to);
    const source = join(from, 'José-测试-🚀.bin'), destination = join(to, 'copy-测试-🚀.bin');
    const bytes = Buffer.alloc(131073); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    await writeFile(source, bytes); await writeFile(`${source}:copy-fixture`, 'unnamed-stream-only-proof');
    const before = await stat(source, { bigint: true });
    const observed = await hashFile({ path: source });
    assert.equal(observed.ok, true, JSON.stringify(observed)); assert.equal(observed.observationState, 'HASHED');
    assert.equal(observed.sha256, digest(bytes)); assert.equal(observed.bytesRead, bytes.length * 2);
    assert.equal(observed.mutationAttempted, false); assert.equal(observed.sourceMutationAttempted, false);
    assert.equal(observed.mappedWriterExclusionProven, false);
    const result = await copy({ source, destination, expectedSha256: observed.sha256 });
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.mutationState, 'COPIED');
    assert.equal(result.copied, true); assert.equal(result.overwritten, false); assert.equal(result.bytes, bytes.length);
    assert.equal(result.bytesRead, bytes.length * 4); assert.equal(result.sha256, digest(bytes));
    assert.equal(result.sourceIdentity, observed.identity); assert.notEqual(result.destinationIdentity, result.sourceIdentity);
    assert.notEqual(result.sourceParentIdentity, result.destinationParentIdentity);
    assert.equal(result.sourceMutationAttempted, false); assert.equal(result.sourceContentObservedUnchanged, true);
    assert.equal(result.metadataPreserved, false); assert.equal(result.copyScope, 'UNNAMED_DATA_STREAM_ONLY');
    assert.equal(result.wholeFileAtomicityProven, false); assert.equal(result.mappedWriterExclusionProven, false);
    assert.deepEqual(await readFile(destination), bytes); assert.deepEqual(await readFile(source), bytes);
    assert.equal(await readFile(`${source}:copy-fixture`, 'utf8'), 'unnamed-stream-only-proof');
    await assert.rejects(readFile(`${destination}:copy-fixture`), { code: 'ENOENT' });
    const after = await stat(source, { bigint: true });
    assert.equal(after.ino, before.ino); assert.equal(after.size, before.size); assert.equal(after.mtimeNs, before.mtimeNs);
  });
});

test('Windows empty and maximum-size streams report exact two-read and four-read budgets', WINDOWS, async () => {
  await withDirectory(async root => {
    for (const size of [0, LIMITS.fileBytes]) {
      const source = join(root, `source-${size}.dat`), destination = join(root, `copied-${size}.dat`);
      const bytes = Buffer.alloc(size, 0xa5); await writeFile(source, bytes);
      const hashed = await hashFile({ path: source });
      assert.equal(hashed.ok, true, JSON.stringify(hashed)); assert.equal(hashed.sha256, digest(bytes));
      assert.equal(hashed.bytesRead, size * 2);
      const copied = await copy({ source, destination, expectedSha256: hashed.sha256 });
      assert.equal(copied.ok, true, JSON.stringify(copied)); assert.equal(copied.bytesRead, size * 4);
      assert.equal(copied.sourceParentIdentity, copied.destinationParentIdentity);
      assert.equal((await stat(source)).size, size); assert.equal(digest(await readFile(destination)), digest(bytes));
    }
  });
});

test('Windows existing targets, changed expected content, oversized sources, links and nonregular paths cannot create', WINDOWS, async () => {
  await withDirectory(async root => {
    const source = join(root, 'source.bin'); const content = Buffer.from('source-content'); await writeFile(source, content);
    const existing = join(root, 'existing.bin'), directory = join(root, 'existing-dir');
    const hard = join(root, 'hard.bin'); await writeFile(existing, 'incumbent'); await mkdir(directory); await link(source, hard);
    const linked = await copy({ source, destination: join(root, 'denied-link.bin'), expectedSha256: digest(content) });
    assert.equal(linked.mutationState, 'NOT_STARTED'); assert.equal(linked.blocker, 'SOVEREIGN_COPY_HARD_LINK_REJECTED');
    const hashedLink = await hashFile({ path: hard });
    assert.equal(hashedLink.ok, false); assert.equal(hashedLink.observationState, 'NOT_OBSERVED');
    await rm(hard);
    for (const destination of [existing, directory]) {
      const result = await copy({ source, destination, expectedSha256: digest(content) });
      assert.equal(result.ok, false); assert.equal(result.mutationState, 'NOT_STARTED');
    }
    assert.equal(await readFile(existing, 'utf8'), 'incumbent'); assert.equal((await stat(directory)).isDirectory(), true);
    const wrong = await copy({ source, destination: join(root, 'wrong-hash.bin'), expectedSha256: 'f'.repeat(64) });
    assert.equal(wrong.blocker, 'SOVEREIGN_COPY_HASH_MISMATCH'); assert.equal(wrong.mutationState, 'NOT_STARTED');
    const large = join(root, 'large.bin'); await writeFile(large, Buffer.alloc(LIMITS.fileBytes + 1));
    const tooLarge = await copy({ source: large, destination: join(root, 'large-copy.bin'), expectedSha256: digest('unused') });
    assert.equal(tooLarge.blocker, 'SOVEREIGN_COPY_FILE_SIZE_LIMIT'); assert.equal(tooLarge.mutationState, 'NOT_STARTED');
    const tooLargeHash = await hashFile({ path: large }); assert.equal(tooLargeHash.observationState, 'NOT_OBSERVED');
    const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'source.bin'), 'outside');
    const junction = join(root, 'junction'); await symlink(outside, junction, 'junction');
    for (const request of [
      { source: join(junction, 'source.bin'), destination: join(root, 'redirected-source.bin'), expectedSha256: digest('outside') },
      { source, destination: join(junction, 'redirected-target.bin'), expectedSha256: digest(content) },
      { source: directory, destination: join(root, 'directory-copy.bin'), expectedSha256: digest('') },
    ]) {
      const result = await copy(request); assert.equal(result.ok, false); assert.equal(result.mutationState, 'NOT_STARTED');
    }
    const hashJunction = await hashFile({ path: join(junction, 'source.bin') });
    assert.equal(hashJunction.ok, false); assert.equal(hashJunction.observationState, 'NOT_OBSERVED');
    for (const path of ['denied-link.bin', 'wrong-hash.bin', 'large-copy.bin', 'redirected-source.bin', 'directory-copy.bin'])
      await assert.rejects(lstat(join(root, path)), { code: 'ENOENT' });
    await assert.rejects(lstat(join(outside, 'redirected-target.bin')), { code: 'ENOENT' });
    assert.deepEqual(await readFile(source), content); assert.equal(await readFile(join(outside, 'source.bin'), 'utf8'), 'outside');
  });
});

test('Windows retained source has no write/delete rights, both parent chains stay pinned, and output is exclusive', WINDOWS, async () => {
  await withDirectory(async root => {
    const from = join(root, 'from'), to = join(root, 'to'); await mkdir(from); await mkdir(to);
    const source = join(from, 'source.bin'), destination = join(to, 'copy.bin'); await writeFile(source, 'source');
    const proof = nativeFixture(String.raw`
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
public static class CopyHandleFixture {
 [StructLayout(LayoutKind.Sequential)] struct IOS { public IntPtr Status; public UIntPtr Information; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern SafeFileHandle CreateFileW(string p,uint a,uint s,IntPtr x,uint c,uint f,IntPtr t);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool WriteFile(SafeFileHandle h,byte[] b,uint n,out uint w,IntPtr x);
 [DllImport("ntdll.dll")] static extern int NtSetInformationFile(SafeFileHandle h,out IOS s,IntPtr p,uint n,int c);
 public static SafeFileHandle Open(string p,uint a){return CreateFileW(p,a,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero);}
 public static bool WriteDenied(SafeFileHandle h){uint written;return !WriteFile(h,new byte[]{88},1,out written,IntPtr.Zero)&&Marshal.GetLastWin32Error()==5;}
 public static bool DeleteDenied(SafeFileHandle h){var p=Marshal.AllocHGlobal(1);try{Marshal.WriteByte(p,1);IOS s;return NtSetInformationFile(h,out s,p,1,13)==unchecked((int)0xc0000022);}finally{Marshal.FreeHGlobal(p);}}
}
'@
$scope=New-Object SovereignFileCopyV1 -ArgumentList $r.source,$r.destination,$r.expectedSha256
try {
 $constructorDidNotCreate=-not [IO.File]::Exists($r.destination)
 $fromRenameDenied=$false;$toRenameDenied=$false
 try{[IO.Directory]::Move($r.from,($r.from+'-changed'))}catch{$fromRenameDenied=$true}
 try{[IO.Directory]::Move($r.to,($r.to+'-changed'))}catch{$toRenameDenied=$true}
 $parentWritesDenied=$true
 foreach($parent in @($r.from,$r.to)){
  $writer=[CopyHandleFixture]::Open($parent,0x40000000)
  try{$parentWritesDenied=$parentWritesDenied -and $writer.IsInvalid}finally{$writer.Dispose()}
 }
 $sourceHandle=[SovereignFileCopyV1].GetField('source',[Reflection.BindingFlags]'NonPublic,Instance').GetValue($scope)
 $sourceWriteDenied=[CopyHandleFixture]::WriteDenied($sourceHandle)
 $sourceDeleteDenied=[CopyHandleFixture]::DeleteDenied($sourceHandle)
 $wrongMethodDenied=$false
 try{$scope.Hash()|Out-Null}catch{$wrongMethodDenied=$true}
 $result=$scope.Copy()
 $outputReadDenied=$false;$outputWriteDenied=$false
 $reader=[CopyHandleFixture]::Open($r.destination,2147483648)
 try{$outputReadDenied=$reader.IsInvalid}finally{$reader.Dispose()}
 $writer=[CopyHandleFixture]::Open($r.destination,0x40000000)
 try{$outputWriteDenied=$writer.IsInvalid}finally{$writer.Dispose()}
 $reuseDenied=$false
 try{$scope.Copy()|Out-Null}catch{$reuseDenied=$true}
}finally{$scope.Dispose()}
$hash=New-Object SovereignFileCopyV1 -ArgumentList $r.source
try{
 $hashCannotCopy=$false
 try{$hash.Copy()|Out-Null}catch{$hashCannotCopy=$true}
 $hashReceipt=$hash.Hash()
 $hashReuseDenied=$false
 try{$hash.Hash()|Out-Null}catch{$hashReuseDenied=$true}
 $hashNeverAttempted=$hash.MutationAttempted -eq $false
}finally{$hash.Dispose()}
@{constructorDidNotCreate=$constructorDidNotCreate;fromRenameDenied=$fromRenameDenied;toRenameDenied=$toRenameDenied;
parentWritesDenied=$parentWritesDenied;sourceWriteDenied=$sourceWriteDenied;sourceDeleteDenied=$sourceDeleteDenied;
wrongMethodDenied=$wrongMethodDenied;outputReadDenied=$outputReadDenied;outputWriteDenied=$outputWriteDenied;
reuseDenied=$reuseDenied;copied=$result.copied;hashCannotCopy=$hashCannotCopy;hashReuseDenied=$hashReuseDenied;
hashNeverAttempted=$hashNeverAttempted;hashed=($hashReceipt.observationState -ceq 'HASHED')}|ConvertTo-Json -Compress
`, { from, to, source, destination, expectedSha256: digest('source') });
    for (const value of Object.values(proof)) assert.equal(value, true, JSON.stringify(proof));
    assert.equal(await readFile(source, 'utf8'), 'source'); assert.equal(await readFile(destination, 'utf8'), 'source');
  });
});

test('Windows create attempt refuses a raced incumbent and never overwrites or deletes it', WINDOWS, async () => {
  await withDirectory(async root => {
    const source = join(root, 'source.bin'), destination = join(root, 'race.bin'); await writeFile(source, 'source');
    const proof = nativeFixture(String.raw`
$scope=New-Object SovereignFileCopyV1 -ArgumentList $r.source,$r.destination,$r.expectedSha256
try{
 [IO.File]::WriteAllText($r.destination,'raced incumbent')
 $refused=$false
 try{$scope.Copy()|Out-Null}catch{$refused=$true}
 @{refused=$refused;attempted=$scope.MutationAttempted;stage=$scope.Stage;sourceIdentity=$scope.SourceIdentity}|ConvertTo-Json -Compress
}finally{$scope.Dispose()}
`, { source, destination, expectedSha256: digest('source') });
    assert.equal(proof.refused, true); assert.equal(proof.attempted, true); assert.equal(proof.stage, 'NATIVE_CREATE');
    assert.match(proof.sourceIdentity, /^[a-f0-9]{8}:[a-f0-9]{16}$/);
    assert.equal(await readFile(source, 'utf8'), 'source'); assert.equal(await readFile(destination, 'utf8'), 'raced incumbent');
  });
});

test('Windows native validation rejects independent cross-drive, path-alias and malformed hash inputs', WINDOWS, async () => {
  await withDirectory(async root => {
    const source = join(root, 'source.bin'), destination = join(root, 'copy.bin'); await writeFile(source, 'source');
    const proof = nativeFixture(String.raw`
$checks=@();$prior=[Threading.Thread]::CurrentThread.CurrentCulture
try{
 foreach($culture in @('en-US','tr-TR')){
  [Threading.Thread]::CurrentThread.CurrentCulture=[Globalization.CultureInfo]::GetCultureInfo($culture)
  [SovereignFileCopyV1]::ValidateRequest($r.source,$r.destination,$r.expectedSha256)
  foreach($bad in @(([char]0xfeff+$r.source),($r.source+[char]0xfeff),($r.source+[char]0xd800),($r.source+':stream'))){
   $denied=$false
   try{[SovereignFileCopyV1]::ValidateRequest($bad,$r.destination,$r.expectedSha256)}catch{$denied=$true}
   $checks+=$denied
  }
 }
}finally{[Threading.Thread]::CurrentThread.CurrentCulture=$prior}
$alias=$false;$drive=$false;$hash=$false
try{[SovereignFileCopyV1]::ValidateRequest($r.source,($r.source.ToUpperInvariant()),$r.expectedSha256)}catch{$alias=$true}
$otherDrive=if($r.source.Substring(0,1).ToUpperInvariant() -ceq 'Z'){'Y'}else{'Z'}
try{[SovereignFileCopyV1]::ValidateRequest($r.source,($otherDrive+$r.destination.Substring(1)),$r.expectedSha256)}catch{$drive=$true}
try{[SovereignFileCopyV1]::ValidateRequest($r.source,$r.destination,'not-a-digest')}catch{$hash=$true}
@{checks=$checks;alias=$alias;drive=$drive;hash=$hash;absent=(-not [IO.File]::Exists($r.destination))}|ConvertTo-Json -Compress
`, { source, destination, expectedSha256: digest('source') });
    assert.equal(proof.checks.length, 8); assert.equal(proof.checks.every(Boolean), true);
    for (const key of ['alias', 'drive', 'hash', 'absent']) assert.equal(proof[key], true, JSON.stringify(proof));
  });
});

test('Windows fixed transport rejects changed helper bytes, extra fields and oversized input before access', WINDOWS, async () => {
  await withDirectory(async root => {
    const source = join(root, 'source.bin'), destination = join(root, 'copy.bin'); await writeFile(source, 'source');
    const packet = { operation: 'COPY_FILE_CONTENT', source, destination, expectedSha256: digest('source'), nativeSource: nativeSource() };
    for (const [request, code] of [
      [{ ...packet, nativeSource: `${packet.nativeSource}\n` }, 'SOVEREIGN_COPY_SOURCE_MISMATCH'],
      [{ ...packet, overwrite: true }, 'SOVEREIGN_COPY_REQUEST_INVALID'],
      [' '.repeat(131073), 'SOVEREIGN_COPY_REQUEST_LIMIT'],
    ]) {
      const result = rawTransport(request); assert.equal(result.status, 2); assert.equal(result.receipt.blocker, code);
      assert.equal(result.receipt.mutationState, 'NOT_STARTED'); assert.equal(result.receipt.mutationAttempted, false);
    }
    const hashed = rawTransport({ operation: 'GET_FILE_HASH', path: source, destination, nativeSource: nativeSource() });
    assert.equal(hashed.status, 2); assert.equal(hashed.receipt.observationState, 'NOT_OBSERVED');
    assert.equal(hashed.receipt.mutationAttempted, false);
    await assert.rejects(lstat(destination), { code: 'ENOENT' }); assert.equal(await readFile(source, 'utf8'), 'source');
  });
});

test('Windows a copied file with lost terminal remains UNKNOWN; a lost hash stays NOT_OBSERVED', WINDOWS, async () => {
  await withDirectory(async root => {
    const source = join(root, 'source.bin'), destination = join(root, 'copy.bin'); await writeFile(source, 'source');
    let spawns = 0;
    const loseTerminal = (...args) => {
      spawns++; const child = spawn(...args); child.stdout.on('data', chunk => chunk.fill(32)); return child;
    };
    const copied = await copy({ source, destination, expectedSha256: digest('source') }, { spawnFn: loseTerminal });
    assert.equal(copied.ok, false); assert.equal(copied.mutationState, 'UNKNOWN'); assert.equal(copied.retryAllowed, false);
    assert.equal(copied.sourceMutationAttempted, false); assert.equal(spawns, 1);
    assert.equal(await readFile(source, 'utf8'), 'source'); assert.equal(await readFile(destination, 'utf8'), 'source');
    const hashed = await hashFile({ path: source }, { spawnFn: loseTerminal });
    assert.equal(hashed.ok, false); assert.equal(hashed.observationState, 'NOT_OBSERVED');
    assert.equal(hashed.mutationAttempted, false); assert.equal(hashed.sourceMutationAttempted, false);
    assert.equal(spawns, 2); assert.equal(await readFile(source, 'utf8'), 'source');
  });
});

test('Windows metadata-only junction races cannot redirect retained-parent copy creation or an existing copy', WINDOWS, async () => {
  await withDirectory(async root => {
    const parent = join(root, 'empty-parent'), outside = join(root, 'outside');
    const laterParent = join(root, 'later-parent'), laterOutside = join(root, 'later-outside');
    const controlParent = join(root, 'control-parent'), controlOutside = join(root, 'control-outside');
    await Promise.all([parent, outside, laterParent, laterOutside, controlParent, controlOutside].map(path => mkdir(path)));
    const source = join(root, 'source.bin'), bytes = Buffer.from('retained-source-content'); await writeFile(source, bytes);
    const path = join(parent, 'copy.bin'), laterPath = join(laterParent, 'copy.bin');
    const proof = nativeFixture(String.raw`
Add-Type -TypeDefinition @'
using System; using System.Text; using System.ComponentModel;
using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
public static class CopyMetadataReparseFixture {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern SafeFileHandle CreateFileW(string p,uint a,uint s,IntPtr x,uint c,uint f,IntPtr t);
 [DllImport("kernel32.dll",SetLastError=true)]
 static extern bool DeviceIoControl(SafeFileHandle h,uint code,byte[] input,int inputBytes,
  IntPtr output,int outputBytes,out int returned,IntPtr overlapped);
 public static SafeFileHandle Metadata(string path) {
  // FILE_WRITE_ATTRIBUTES is deliberately narrower than GENERIC_WRITE. Its
  // sharing semantics cannot be inferred from the other writer fixture.
  var handle=CreateFileW(path,0x100,7,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
  if(handle.IsInvalid){int error=Marshal.GetLastWin32Error();handle.Dispose();throw new Win32Exception(error);}
  return handle;
 }
 public static int TrySet(SafeFileHandle handle,string target) {
  byte[] substitute=Encoding.Unicode.GetBytes(@"\??\"+target), print=Encoding.Unicode.GetBytes(target);
  byte[] buffer=new byte[16+substitute.Length+2+print.Length+2];
  BitConverter.GetBytes(0xA0000003u).CopyTo(buffer,0);
  BitConverter.GetBytes(checked((ushort)(buffer.Length-8))).CopyTo(buffer,4);
  BitConverter.GetBytes(checked((ushort)substitute.Length)).CopyTo(buffer,10);
  BitConverter.GetBytes(checked((ushort)(substitute.Length+2))).CopyTo(buffer,12);
  BitConverter.GetBytes(checked((ushort)print.Length)).CopyTo(buffer,14);
  substitute.CopyTo(buffer,16);print.CopyTo(buffer,18+substitute.Length);
  int returned;
  return DeviceIoControl(handle,0x900A4,buffer,buffer.Length,IntPtr.Zero,0,out returned,IntPtr.Zero)
   ? 0 : Marshal.GetLastWin32Error();
 }
 public static void Remove(SafeFileHandle handle) {
  byte[] buffer=new byte[8];BitConverter.GetBytes(0xA0000003u).CopyTo(buffer,0);int returned;
  if(!DeviceIoControl(handle,0x900AC,buffer,buffer.Length,IntPtr.Zero,0,out returned,IntPtr.Zero))
   throw new Win32Exception(Marshal.GetLastWin32Error());
 }
}
'@
$controlSetter=$null;$controlConverted=$false;$controlRedirected=$false
try {
 # The identical metadata-only FSCTL must work without production pins. An
 # invalid fixture buffer or unusable metadata handle is not a safe denial.
 $controlSetter=[CopyMetadataReparseFixture]::Metadata($r.controlParent)
 $controlSetError=[CopyMetadataReparseFixture]::TrySet($controlSetter,$r.controlOutside)
 if($controlSetError -ne 0){throw ('FIXTURE_METADATA_REPARSE_CONTROL_FAILED:'+ $controlSetError)}
 $controlConverted=$true
 $controlProbe=[IO.Path]::Combine($r.controlParent,'control-probe.txt')
 $controlOutsideProbe=[IO.Path]::Combine($r.controlOutside,'control-probe.txt')
 [IO.File]::WriteAllText($controlProbe,'control-outside')
 $controlRedirected=[IO.File]::ReadAllText($controlOutsideProbe) -ceq 'control-outside'
 [IO.File]::Delete($controlOutsideProbe)
} finally {
 try {if($controlConverted -and $null -ne $controlSetter){[CopyMetadataReparseFixture]::Remove($controlSetter)}}
 finally {if($null -ne $controlSetter){$controlSetter.Dispose()}}
}
$scope=$null;$setter=$null;$converted=$false;$relativeCreated=$false;$relativeRefused=$false
$productionRefused=$false;$productionCreated=$false;$pathnameRedirected=$false
$productionOutside=$false;$relativeOutside=$false
try {
 $scope=New-Object SovereignFileCopyV1 -ArgumentList $r.source,$r.path,$r.expectedSha256
 $setter=[CopyMetadataReparseFixture]::Metadata($r.parent)
 $setError=[CopyMetadataReparseFixture]::TrySet($setter,$r.outside)
 $converted=$setError -eq 0
 if($converted) {
  # Establish a real redirect, then remove only this disposable probe.
  $probe=[IO.Path]::Combine($r.parent,'pathname-probe.txt')
  $outsideProbe=[IO.Path]::Combine($r.outside,'pathname-probe.txt')
  [IO.File]::WriteAllText($probe,'outside-probe')
  $pathnameRedirected=[IO.File]::ReadAllText($outsideProbe) -ceq 'outside-probe'
  [IO.File]::Delete($outsideProbe)
 }
 try {$written=$scope.Copy();$productionCreated=$written.copied} catch {
  $cause=$_.Exception;while($null -ne $cause.InnerException){$cause=$cause.InnerException}
  if($cause.Message -cnotmatch '\ASOVEREIGN_COPY_[A-Z_]+\z' -and $cause -isnot [ComponentModel.Win32Exception]) {throw}
  $productionRefused=$true
 }
 $productionOutside=[IO.File]::Exists([IO.Path]::Combine($r.outside,'copy.bin'))
 # Invoke the exact production relative-create primitive while the parent
 # already carries the raced reparse, covering the check-to-create window.
 # No hook, bypass or sharing relaxation is added to production source.
 $flags=[Reflection.BindingFlags]'NonPublic,Instance'
 $parentField=[SovereignFileCopyV1].GetField('destinationParent',$flags)
 if($null -eq $parentField){throw 'FIXTURE_PARENT_FIELD_MISSING'}
 $pin=$parentField.GetValue($scope)
 $handleField=$pin.GetType().GetField('Handle')
 if($null -eq $handleField){throw 'FIXTURE_PARENT_HANDLE_MISSING'}
 $retained=$handleField.GetValue($pin)
 $relative=[SovereignFileCopyV1].GetMethod('RelativeOpen',[Reflection.BindingFlags]'NonPublic,Static')
 if($null -eq $relative){throw 'FIXTURE_RELATIVE_PRIMITIVE_MISSING'}
 $created=$null
 try {
  $created=$relative.Invoke($null,@($retained,'relative-only.bin',$true,$false,$false))
  $relativeCreated=-not $created.IsInvalid
 } catch {
  $cause=$_.Exception;while($null -ne $cause.InnerException){$cause=$cause.InnerException}
  if($cause -isnot [ComponentModel.Win32Exception] -and $cause.Message -cnotmatch '\ASOVEREIGN_COPY_[A-Z_]+\z') {throw}
  $relativeRefused=$true
 } finally {if($null -ne $created){$created.Dispose()}}
 $relativeOutside=[IO.File]::Exists([IO.Path]::Combine($r.outside,'relative-only.bin'))
} finally {
 try {if($converted -and $null -ne $setter){[CopyMetadataReparseFixture]::Remove($setter)}}
 finally {if($null -ne $setter){$setter.Dispose()};if($null -ne $scope){$scope.Dispose()}}
}
$relativeOriginal=[IO.File]::Exists([IO.Path]::Combine($r.parent,'relative-only.bin'))
$productionOriginal=[IO.File]::Exists($r.path)
# A second real FSCTL attempt is made after a created output exists. A directory
# normally must be empty for SET_REPARSE_POINT; test the call, do not infer it
# from a denied GENERIC_WRITE handle or from the earlier empty-directory result.
$laterScope=$null;$laterSetter=$null;$laterConverted=$false;$laterOutsideCreated=$false
try {
 $laterScope=New-Object SovereignFileCopyV1 -ArgumentList $r.source,$r.laterPath,$r.expectedSha256
 $laterReceipt=$laterScope.Copy()
 $laterSetter=[CopyMetadataReparseFixture]::Metadata($r.laterParent)
 $laterSetError=[CopyMetadataReparseFixture]::TrySet($laterSetter,$r.laterOutside)
 $laterConverted=$laterSetError -eq 0
 $laterOutsideCreated=[IO.File]::Exists([IO.Path]::Combine($r.laterOutside,'copy.bin'))
} finally {
 try {if($laterConverted -and $null -ne $laterSetter){[CopyMetadataReparseFixture]::Remove($laterSetter)}}
 finally {if($null -ne $laterSetter){$laterSetter.Dispose()};if($null -ne $laterScope){$laterScope.Dispose()}}
}
@{controlRedirected=$controlRedirected;setError=$setError;converted=$converted;pathnameRedirected=$pathnameRedirected;
productionRefused=$productionRefused;productionCreated=$productionCreated;productionOutside=$productionOutside;
relativeCreated=$relativeCreated;relativeRefused=$relativeRefused;relativeOutside=$relativeOutside;
relativeOriginal=$relativeOriginal;productionOriginal=$productionOriginal;
laterCreated=$laterReceipt.copied;laterSetError=$laterSetError;laterConverted=$laterConverted;
laterOutsideCreated=$laterOutsideCreated}|ConvertTo-Json -Compress
`, { source, path, expectedSha256: digest(bytes), parent, outside, laterParent, laterOutside, laterPath, controlParent, controlOutside });
    assert.equal(proof.controlRedirected, true, JSON.stringify(proof));
    assert.equal(Number.isInteger(proof.setError), true, JSON.stringify(proof));
    assert.equal(Number.isInteger(proof.laterSetError), true, JSON.stringify(proof));
    assert.equal(proof.converted, proof.setError === 0);
    if (proof.converted) {
      assert.equal(proof.pathnameRedirected, true, JSON.stringify(proof));
      assert.equal(proof.productionRefused, true, JSON.stringify(proof));
      assert.equal(proof.productionCreated, false, JSON.stringify(proof));
      assert.equal(proof.productionOriginal, false, JSON.stringify(proof));
    } else {
      assert.equal(proof.setError > 0, true, JSON.stringify(proof));
      assert.equal(proof.productionCreated, true, JSON.stringify(proof));
      assert.deepEqual(await readFile(path), bytes);
    }
    assert.equal(proof.relativeCreated || proof.relativeRefused, true, JSON.stringify(proof));
    if (proof.relativeCreated) assert.equal(proof.relativeOriginal, true, JSON.stringify(proof));
    assert.equal(proof.productionOutside, false, JSON.stringify(proof));
    assert.equal(proof.relativeOutside, false, JSON.stringify(proof));
    assert.equal(proof.laterCreated, true, JSON.stringify(proof));
    assert.deepEqual(await readFile(source), bytes);
    assert.equal(proof.laterOutsideCreated, false, JSON.stringify(proof));
    assert.deepEqual(await readFile(laterPath), bytes);
    for (const escaped of [join(outside, 'copy.bin'), join(outside, 'relative-only.bin'), join(laterOutside, 'copy.bin')])
      await assert.rejects(lstat(escaped), { code: 'ENOENT' });
  });
});

