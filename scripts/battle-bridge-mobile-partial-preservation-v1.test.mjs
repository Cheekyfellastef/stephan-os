import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
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

test('native read-only partial inventory rejects enrolled material, hardlinks, streams and redirection in temporary fixtures',
  { skip: process.platform !== 'win32', timeout: 40000 }, t => {
    const source = readFileSync(entry, 'utf8').split("$native=@'\n")[1]?.split("\n'@\n")[0];
    assert.ok(source);
    const root = mkdtempSync(join(tmpdir(), 'stephanos-partial-data-'));
    const native = join(root, 'adapter.cs'); writeFileSync(native, source);
    try {
      const script = String.raw`$ErrorActionPreference='Stop'
Add-Type -TypeDefinition ([IO.File]::ReadAllText(__NATIVE__)) -ReferencedAssemblies 'System','System.Core','Microsoft.CSharp' -ErrorAction Stop
$type=[Stephanos.Sovereign.MobilePartialPreservationV1]
$shape=$type.GetMethod('Shape',[Reflection.BindingFlags]'NonPublic,Static')
$base=__ROOT__;$fixture=[IO.Path]::Combine($base,'fixture');[void][IO.Directory]::CreateDirectory($fixture)
$state=[IO.Path]::Combine($fixture,'state');[void][IO.Directory]::CreateDirectory($state)
$helper=[IO.Path]::Combine($fixture,'installer.exe');[IO.File]::WriteAllText($helper,'opaque fixture bytes, never executable')
$rows=[Collections.Generic.List[object]]::new()
function Check([string]$name,[bool]$expected) {
 $ok=$false;try{[void]$shape.Invoke($null,@($fixture));$ok=$true}catch{if($_.Exception.InnerException -isnot [InvalidOperationException]){throw}}
 if($ok -ne $expected){throw ('WRONG_SHAPE_OUTCOME:'+ $name)};$rows.Add(@{name=$name;accepted=$ok})
}
Check 'exact pre-enrollment shape' $true
$initial=$shape.Invoke($null,@($fixture));[IO.File]::AppendAllText($helper,'changed');if($initial -ceq $shape.Invoke($null,@($fixture))){throw 'HELPER_CHANGE_UNSEEN'}
foreach($name in @('enrollment.json','enrollment-certificate.v1','runtime-package.json','unexpected')) {
 $path=[IO.Path]::Combine($fixture,$name);[IO.File]::WriteAllText($path,'synthetic');Check ('extra '+$name) $false;[IO.File]::Delete($path)
}
$wal=[IO.Path]::Combine($state,'approval-journal.wal');[IO.File]::WriteAllText($wal,'synthetic');Check 'journal exists' $false;[IO.File]::Delete($wal)
Set-Content -LiteralPath $helper -Stream hidden -Value 'synthetic';Check 'alternate stream' $false;Remove-Item -LiteralPath $helper -Stream hidden
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class PartialFixtureLinksV1{[DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern bool CreateHardLinkW(string name,string target,IntPtr security);}'
$link=[IO.Path]::Combine($base,'second-link');if(-not [PartialFixtureLinksV1]::CreateHardLinkW($link,$helper,[IntPtr]::Zero)){throw 'FIXTURE_LINK_FAILED'}
Check 'hardlinked helper' $false;[IO.File]::Delete($link)
[IO.File]::Delete($helper);[void][IO.Directory]::CreateDirectory($helper);Check 'helper directory' $false;[IO.Directory]::Delete($helper)
[IO.File]::WriteAllText($helper,'opaque')
$target=[IO.Path]::Combine($base,'target');[void][IO.Directory]::CreateDirectory($target);[IO.Directory]::Delete($state)
# Windows junctions require no symlink privilege. Only temporary fixture paths.
New-Item -ItemType Junction -Path $state -Target $target -ErrorAction Stop|Out-Null
Check 'redirected state' $false
[IO.Directory]::Delete($state)
[Console]::Write(($rows|ConvertTo-Json -Compress))
`.replace('__NATIVE__', literal(native)).replace('__ROOT__', literal(root));
      const result = run(script);
      assert.equal(result.status, 0, result.stderr);
      const rows = JSON.parse(result.stdout); assert.equal(rows.length, 10); assert.equal(rows.filter(row => row.accepted).length, 1);
      t.diagnostic('10 native inventory vectors; opaque helper hash changes detected; no production root/key/task/log mutation invoked');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

test('shipping manual adapter has a single fixed preservation effect and no enrollment or reset authority', () => {
  const text = readFileSync(entry, 'utf8');
  assert.equal((text.match(/Directory\.Move\(/g) ?? []).length, 1);
  assert.match(text, /if\(!String\.Equals\(fingerprint,expected,StringComparison\.Ordinal\)\)/);
  assert.match(text, /Snapshot\(destination,context\)!=fingerprint/);
  assert.match(text, /MOBILE_PARTIAL_RECEIPT_KEY_EXISTS/);
  assert.match(text, /MOBILE_PARTIAL_INSTALLER_TASK_EXISTS/);
  assert.match(text, /MOBILE_PARTIAL_RETAINED_GENESIS_EXISTS/);
  assert.doesNotMatch(text, /(?:File|Directory)\.Delete\(|Assembly\]::LoadFrom|NCryptCreatePersistedKey|RegisterTaskDefinition|ReportEventW|SetAccessControl/);
  assert.doesNotMatch(text.split('$native=')[0], /\[string\]\$(?:Root|Path|Destination|Command)/i);
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
  assert.ok(preserved.requiredGates.includes('EXACT_FINGERPRINT_PRESERVATION_APPROVAL'));
  for (const delta of [{ expectedMain: 'f'.repeat(40) }, { sourceTree: 'f'.repeat(40) }, { mode: 'Delete' },
    { fingerprint: 'b'.repeat(64) }, { operatorSid: 'other' }, { machineHash: 'wrong' }, { root: 'C:\\other' }, { approved: true }])
    assert.throws(() => prepare({ ...input, ...delta }));
  for (const fingerprint of [null, '', 'B'.repeat(64), '../other']) assert.throws(() => prepare({ ...input, mode: 'Preserve', fingerprint }));
  const changed = structuredClone(input); changed.sourceInput.records[0].contentBase64 = Buffer.from('changed').toString('base64');
  assert.throws(() => prepare(changed));
});
