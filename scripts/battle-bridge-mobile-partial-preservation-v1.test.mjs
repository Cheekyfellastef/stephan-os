import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { makeFixedRuntimeSourceProofFixtureV1 } from './fixtures/sovereign-fixed-runtime-source-proof-fixture-v1.mjs';
import { MOBILE_PARTIAL_PRESERVATION_INPUT_V1, prepareMobilePartialPreservationReviewV1 }
  from './battle-bridge-mobile-partial-preservation-review-v1.mjs';

const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const entry = fileURLToPath(new URL('./windows/preserve-battle-bridge-mobile-partial-v1.ps1', import.meta.url));
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const run = script => spawnSync(PS, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
  { shell: false, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 20000 });

test('manual partial preservation refuses an unbound caller before observation or privileged mutation', { skip: process.platform !== 'win32' }, () => {
  const result = run(`$ErrorActionPreference='Stop';$t=$null;$e=$null;[void][Management.Automation.Language.Parser]::ParseFile(${literal(entry)},[ref]$t,[ref]$e);if($e.Count){throw 'PARSE_FAILED'};try{& ([scriptblock]::Create([IO.File]::ReadAllText(${literal(entry)}))) -Mode Preserve -OperatorApproved -ExpectedMain ('a'*40) -ExpectedFingerprint ('b'*64);throw 'UNBOUND_ACCEPTED'}catch{if($_.Exception.Message -cne 'MOBILE_PARTIAL_IMMUTABLE_GATE_REQUIRED'){throw}};[Console]::Write('UNBOUND_REFUSED')`);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, 'UNBOUND_REFUSED');
});


test('opaque NTFS object quarantine preserves concurrent children, streams and links without trusting or traversing them',
  { skip: process.platform !== 'win32', timeout: 40000 }, t => {
    const source=readFileSync(entry,'utf8').split("$native=@'\n")[1]?.split("\n'@\n")[0];
    assert.ok(source);
    const base=realpathSync.native(mkdtempSync(join(tmpdir(),'stephanos-opaque-data-'))), native=join(base,'adapter.cs');
    writeFileSync(native,source);
    try {
      const script=String.raw`$ErrorActionPreference='Stop'
Add-Type -TypeDefinition ([IO.File]::ReadAllText(__NATIVE__)) -ReferencedAssemblies 'System','System.Core','Microsoft.CSharp' -ErrorAction Stop
Add-Type -TypeDefinition 'using System;using System.IO;using System.Runtime.InteropServices;using Microsoft.Win32.SafeHandles;public static class OpaqueStreamFixtureV1{[DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern SafeFileHandle CreateFileW(string n,uint a,uint s,IntPtr d,uint c,uint f,IntPtr t);public static void Write(string p){using(var h=CreateFileW(p,0x40000000,7,IntPtr.Zero,2,0,IntPtr.Zero)){if(h.IsInvalid)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());using(var w=new FileStream(h,FileAccess.Write)){var b=System.Text.Encoding.UTF8.GetBytes("opaque concurrent stream");w.Write(b,0,b.Length);}}}public static string Read(string p){using(var h=CreateFileW(p,0x80000000,7,IntPtr.Zero,3,0,IntPtr.Zero)){if(h.IsInvalid)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());using(var r=new StreamReader(new FileStream(h,FileAccess.Read)))return r.ReadToEnd();}}}'
$type=[Stephanos.Sovereign.MobilePartialPreservationV1];$static=[Reflection.BindingFlags]'NonPublic,Static';$instance=[Reflection.BindingFlags]'NonPublic,Instance'
$pin=$type.GetMethod('PinDirectory',$static);$open=$type.GetMethod('RelativeOpen',$static);$kernel=$type.GetMethod('KernelRename',$static)
$rootType=$type.GetNestedType('RootObject',[Reflection.BindingFlags]'NonPublic')
$ctor=$rootType.GetConstructor($instance,$null,[type[]]@([Microsoft.Win32.SafeHandles.SafeFileHandle],[string]),$null)
$quarantine=$rootType.GetMethod('Quarantine',$instance);$identity=$rootType.GetField('RootIdentity',$instance);$handle=$rootType.GetField('Handle',$instance)
$base=__BASE__;$rows=[Collections.Generic.List[string]]::new()
for($trial=0;$trial -lt 3;$trial++) {
 $parentPath=[IO.Path]::Combine($base,'parent-'+$trial);[void][IO.Directory]::CreateDirectory($parentPath)
 $sourcePath=[IO.Path]::Combine($parentPath,'root');[void][IO.Directory]::CreateDirectory($sourcePath)
 [void][IO.Directory]::CreateDirectory([IO.Path]::Combine($sourcePath,'state'))
 [IO.File]::WriteAllText([IO.Path]::Combine($sourcePath,'installer.exe'),'opaque helper never executed')
 $outside=[IO.Path]::Combine($base,'outside-'+$trial);[void][IO.Directory]::CreateDirectory($outside);[IO.File]::WriteAllText([IO.Path]::Combine($outside,'sentinel'),'outside unchanged')
 $parent=$pin.Invoke($null,@($parentPath));$held=$ctor.Invoke(@($parent,'root'))
 try {
  $original=$identity.GetValue($held)
  foreach($operation in @('replace-source','replace-parent')) {
   $denied=$false;try{if($operation -ceq 'replace-source'){[IO.Directory]::Move($sourcePath,$sourcePath+'-replaced')}else{[IO.Directory]::Move($parentPath,$parentPath+'-replaced')}}catch{if($_.Exception.InnerException -is [IO.IOException] -or $_.Exception.InnerException -is [UnauthorizedAccessException]){$denied=$true}else{throw}}
   if(-not $denied){throw ('IDENTITY_PIN_FAILED:'+ $operation)};$rows.Add($operation)
  }
  # This is permitted by Windows and explicitly INCLUDED in whole-object
  # quarantine authority. It is never represented as immutable content CAS.
  [IO.File]::WriteAllText([IO.Path]::Combine($sourcePath,'new-child'),'new child preserved')
  foreach($stream in @(($sourcePath+':new-stream'),([IO.Path]::Combine($sourcePath,'state')+':new-stream'),([IO.Path]::Combine($sourcePath,'installer.exe')+':new-stream'))){[OpaqueStreamFixtureV1]::Write($stream)}
  New-Item -ItemType Junction -Path ([IO.Path]::Combine($sourcePath,'opaque-link')) -Target $outside -ErrorAction Stop|Out-Null
  $fingerprint=('a'*63)+$trial.ToString();$name='SovereignMobileInstallerV1.failed-'+$fingerprint
  $result=$quarantine.Invoke($held,@($fingerprint));$destination=[IO.Path]::Combine($parentPath,$name)
  if($result -cne $name -or [IO.Directory]::Exists($sourcePath) -or $identity.GetValue($held) -cne $original){throw 'OBJECT_QUARANTINE_IDENTITY_UNPROVEN'}
  if([IO.File]::ReadAllText([IO.Path]::Combine($destination,'installer.exe')) -cne 'opaque helper never executed' -or [IO.File]::ReadAllText([IO.Path]::Combine($destination,'new-child')) -cne 'new child preserved'){throw 'OPAQUE_CHILD_NOT_PRESERVED'}
  foreach($stream in @(($destination+':new-stream'),([IO.Path]::Combine($destination,'state')+':new-stream'),([IO.Path]::Combine($destination,'installer.exe')+':new-stream'))){if([OpaqueStreamFixtureV1]::Read($stream) -cne 'opaque concurrent stream'){throw 'OPAQUE_STREAM_NOT_PRESERVED'}}
  if([IO.File]::ReadAllText([IO.Path]::Combine($outside,'sentinel')) -cne 'outside unchanged'){throw 'OUTSIDE_LINK_TARGET_AFFECTED'}
  $missing=$open.Invoke($null,@($parent,'root',[uint32]0x00100080,[uint32]7,$true));if($null -ne $missing){$missing.Dispose();throw 'SOURCE_ABSENCE_UNPROVEN'}
  $refused=$false;try{[void]$quarantine.Invoke($held,@($fingerprint))}catch{if($_.Exception.InnerException.Message -ceq 'MOBILE_PARTIAL_REQUEST_ALREADY_USED_OR_INVALID'){$refused=$true}else{throw}}
  if(-not $refused){throw 'DUPLICATE_EFFECT_ACCEPTED'}
  $rows.Add('all-opaque-contents-preserved');$rows.Add('duplicate-refused')
 }finally{$held.Dispose();$parent.Dispose()}
}
# Collision after a target-missing observation is refused by the actual native
# no-replace primitive; a junction is never opened as a destination directory.
foreach($collision in @('file','junction')) {
 $parentPath=[IO.Path]::Combine($base,'collision-'+$collision);[void][IO.Directory]::CreateDirectory($parentPath)
 $sourcePath=[IO.Path]::Combine($parentPath,'root');[void][IO.Directory]::CreateDirectory($sourcePath);[IO.File]::WriteAllText([IO.Path]::Combine($sourcePath,'evidence'),'untouched')
 $parent=$pin.Invoke($null,@($parentPath));$held=$ctor.Invoke(@($parent,'root'));$name='SovereignMobileInstallerV1.failed-'+('b'*64);$destination=[IO.Path]::Combine($parentPath,$name)
 try {
  if($null -ne $open.Invoke($null,@($parent,$name,[uint32]0x00100080,[uint32]7,$true))){throw 'FIXTURE_TARGET_NOT_MISSING'}
  if($collision -ceq 'file'){[IO.File]::WriteAllText($destination,'existing target')}else{New-Item -ItemType Junction -Path $destination -Target $base -ErrorAction Stop|Out-Null}
  $denied=$false;try{[void]$kernel.Invoke($null,@($handle.GetValue($held),$name))}catch{if($_.Exception.InnerException -is [ComponentModel.Win32Exception]){$denied=$true}else{throw}}
  if(-not $denied -or [IO.File]::ReadAllText([IO.Path]::Combine($sourcePath,'evidence')) -cne 'untouched'){throw 'NATIVE_NO_REPLACE_FAILED'}
  if($collision -ceq 'file' -and [IO.File]::ReadAllText($destination) -cne 'existing target'){throw 'EXISTING_TARGET_CHANGED'}
  $rows.Add('concurrent-'+$collision+'-collision-refused')
 }finally{$held.Dispose();$parent.Dispose()}
 if($collision -ceq 'junction'){[IO.Directory]::Delete($destination)}
}
# Unknown and denied native opens must not be translated into NAME_NOT_FOUND.
$parentPath=[IO.Path]::Combine($base,'absence');[void][IO.Directory]::CreateDirectory($parentPath);$deniedPath=[IO.Path]::Combine($parentPath,'denied');[IO.File]::WriteAllText($deniedPath,'exists')
$saved=[IO.File]::GetAccessControl($deniedPath);$acl=[IO.File]::GetAccessControl($deniedPath);$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'ReadData','Deny'));[IO.File]::SetAccessControl($deniedPath,$acl)
$parent=$pin.Invoke($null,@($parentPath));try{
 $refused=$false;try{$unexpected=$open.Invoke($null,@($parent,'denied',[uint32]0x00120089,[uint32]7,$true));if($null -ne $unexpected){$unexpected.Dispose()}}catch{if($_.Exception.InnerException -is [ComponentModel.Win32Exception]){$refused=$true}else{throw}}
 if(-not $refused){throw 'DENIED_WAS_TREATED_AS_ABSENT'};$rows.Add('denied-is-not-absent')
}finally{[IO.File]::SetAccessControl($deniedPath,$saved);$parent.Dispose()}
# A redirected source root/parent is refused before any rename.
$redirectParent=[IO.Path]::Combine($base,'redirect-parent');[void][IO.Directory]::CreateDirectory($redirectParent)
$redirectSource=[IO.Path]::Combine($redirectParent,'root');New-Item -ItemType Junction -Path $redirectSource -Target $base -ErrorAction Stop|Out-Null
$parent=$pin.Invoke($null,@($redirectParent));try{
 $refused=$false;try{$unexpected=$ctor.Invoke(@($parent,'root'));$unexpected.Dispose()}catch{if($_.Exception.InnerException.Message -ceq 'MOBILE_PARTIAL_DIRECTORY_IDENTITY_UNPROVEN'){$refused=$true}else{throw}}
 if(-not $refused){throw 'REDIRECTED_SOURCE_ACCEPTED'};$rows.Add('redirected-source-refused')
}finally{$parent.Dispose();[IO.Directory]::Delete($redirectSource)}
$redirectAlias=[IO.Path]::Combine($base,'redirect-alias');New-Item -ItemType Junction -Path $redirectAlias -Target $redirectParent -ErrorAction Stop|Out-Null
try{$refused=$false;try{$unexpected=$pin.Invoke($null,@($redirectAlias));$unexpected.Dispose()}catch{if($_.Exception.InnerException.Message -ceq 'MOBILE_PARTIAL_DIRECTORY_IDENTITY_UNPROVEN'){$refused=$true}else{throw}};if(-not $refused){throw 'REDIRECTED_PARENT_ACCEPTED'};$rows.Add('redirected-parent-refused')}finally{[IO.Directory]::Delete($redirectAlias)}
[Console]::Write(($rows|ConvertTo-Json -Compress))`.replace('__NATIVE__',literal(native)).replace('__BASE__',literal(base));
      const result=run(script);assert.equal(result.status,0,result.stderr);
      const rows=JSON.parse(result.stdout);assert.equal(rows.length,17);
      t.diagnostic('17 native object-scope vectors: children/three stream namespaces preserved opaquely, no link-target mutation, concurrent collision refusal, denied-versus-absent distinction and source/parent redirection refusal');
    } finally {rmSync(base,{recursive:true,force:true});}
  });

test('manual quarantine has no deletion, destination creation/traversal or all-stream immutability grant',()=>{
  const text=readFileSync(entry,'utf8');
  assert.match(text,/QUARANTINE_EXACT_DIRECTORY_OBJECT_ALL_CONTENTS_OPAQUE/);
  assert.match(text,/NtSetInformationFile\(source,out ios,pin\.AddrOfPinnedObject\(\),\(uint\)rename\.Length,10\)/);
  assert.match(text,/if\(missing && status==NameMissing\)return null/);
  assert.match(text,/MOBILE_PARTIAL_EXACT_OBJECT_APPROVAL_MISMATCH/);
  assert.ok(text.includes("allContentsAndStreamsOpaque"));
  assert.doesNotMatch(text,/(?:File|Directory)\.Delete\(|Directory\.Move\(|CreateDirectoryW|SetFileInformationByHandle|DeleteEmptyPinned|Assembly\]::LoadFrom|NCryptCreatePersistedKey|RegisterTaskDefinition|ReportEventW|SetAccessControl/);
  assert.doesNotMatch(text.split('$native=')[0],/\[string\]\$(?:Root|Path|Destination|Command)/i);
});

test('manual preservation preparation pins Git membership, actual-target data and exact operation without granting authority', () => {
  const path = 'scripts/windows/preserve-battle-bridge-mobile-partial-v1.ps1';
  const content = readFileSync(entry), fixture = makeFixedRuntimeSourceProofFixtureV1({ files: [{ path, content }] });
  const sourceInput = { schemaVersion: 'stephanos.fixed-runtime-source-package-input.v1', repository: 'Cheekyfellastef/stephan-os',
    commit: { sha: fixture.head, contentBase64: fixture.commit.bytes.toString('base64') },
    trees: [...fixture.trees].map(([sha, bytes]) => ({ sha, contentBase64: bytes.toString('base64') })),
    records: [{ path, blobSha: createHash('sha1').update('blob ' + content.length + '\0').update(content).digest('hex'), contentBase64: content.toString('base64') }] };
  const input = { schemaVersion: MOBILE_PARTIAL_PRESERVATION_INPUT_V1, sourceInput, expectedMain: fixture.head,
    sourceTree: fixture.tree, operatorSid: 'S-1-5-21-1-2-3-1001', machineHash: 'a'.repeat(64), mode: 'Observe', fingerprint: null };
  const prepare = value => prepareMobilePartialPreservationReviewV1(JSON.stringify(value));
  const observed = prepare(input), preserved = prepare({ ...input, mode: 'Preserve', fingerprint: 'b'.repeat(64) });
  assert.equal(preserved.operation, 'QUARANTINE_EXACT_DIRECTORY_OBJECT_ALL_CONTENTS_OPAQUE');
  for (const row of [observed, preserved]) {
    assert.equal(row.installability, 'NOT_INSTALLABLE'); assert.deepEqual(Object.values(row.authority), Array(5).fill(false));
    const payload = Buffer.from(row.privateCandidate.payloadBase64, 'base64');
    assert.equal(createHash('sha256').update(payload).digest('hex'), row.privateCandidate.payloadSha256);
    assert.equal(JSON.parse(payload).EntrySha256, createHash('sha256').update(content).digest('hex'));
    assert.ok(Object.isFrozen(row.privateCandidate));
    assert.equal(Buffer.from(row.privateCandidate.encodedCommand, 'base64').toString('utf16le'), row.privateCandidate.script);
  }
  assert.doesNotMatch(observed.privateCandidate.script, / -OperatorApproved /);
  assert.match(preserved.privateCandidate.script, / -OperatorApproved /);
  assert.ok(preserved.requiredGates.includes('EXACT_DIRECTORY_OBJECT_ALL_CONTENTS_QUARANTINE_APPROVAL'));
  for (const delta of [{ expectedMain: 'f'.repeat(40) }, { sourceTree: 'f'.repeat(40) }, { mode: 'Delete' },
    { fingerprint: 'b'.repeat(64) }, { operatorSid: 'other' }, { machineHash: 'wrong' }, { root: 'C:\\other' }, { approved: true }])
    assert.throws(() => prepare({ ...input, ...delta }));
  for (const fingerprint of [null, '', 'B'.repeat(64), '../other']) assert.throws(() => prepare({ ...input, mode: 'Preserve', fingerprint }));
  const changed = structuredClone(input); changed.sourceInput.records[0].contentBase64 = Buffer.from('changed').toString('base64');
  assert.throws(() => prepare(changed));
});
