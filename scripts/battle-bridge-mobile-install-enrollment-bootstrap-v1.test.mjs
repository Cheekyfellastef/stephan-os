import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { prepareMobileInstallSetupReviewV1, prepareMobileInstallBootstrapReviewV1,
  prepareMobileInstallFirstPairingReviewV1, prepareMobileInstallCapturedBootstrapReviewV1,
  MOBILE_SETUP_INPUT_V1, MOBILE_BOOTSTRAP_INPUT_V1, MOBILE_FIRST_PAIRING_INPUT_V1,
  MOBILE_CAPTURED_BOOTSTRAP_INPUT_V1 } from './battle-bridge-mobile-install-enrollment-bootstrap-v1.mjs';
import { makeMobileDevicePairingFixtureV1 } from './fixtures/mobile-device-pairing-v1.mjs';
import { mobileDevicePairingSetupDescriptorV1 } from '../shared/agents/battleBridgeMobileInstallationV1.mjs';
import { MOBILE_ENROLLMENT_REVIEW_INPUT_V1, prepareMobileInstallEnrollmentReviewV1 } from './battle-bridge-mobile-install-enrollment-review-v1.mjs';
import { FIXED_RUNTIME_SOURCE_PATHS_V1 } from './sovereign-fixed-runtime-installer-candidate-v1.mjs';
import { MOBILE_INSTALL_NATIVE_SOURCE_PATHS_V1 } from './fixtures/sovereign-mobile-installer-native-source-v1.mjs';
import { makeFixedRuntimeSourceProofFixtureV1 } from './fixtures/sovereign-fixed-runtime-source-proof-fixture-v1.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const nativePaths = [...MOBILE_INSTALL_NATIVE_SOURCE_PATHS_V1,
  'scripts/windows/install-battle-bridge-mobile-installer-v1.ps1', 'shared/agents/sovereignMobileInstallerNativeClosureV1.json'];
const paths = [...new Set([...FIXED_RUNTIME_SOURCE_PATHS_V1, ...nativePaths])];
const files = paths.map(path => ({ path, content: readFileSync(new URL('../' + path, import.meta.url)) }));
function sourceInput(selected) {
  const fixture = makeFixedRuntimeSourceProofFixtureV1({ files: files.filter(row => selected.includes(row.path)),
    extras: files.filter(row => !selected.includes(row.path)) });
  return { fixture, input: { schemaVersion: 'stephanos.fixed-runtime-source-package-input.v1', repository: 'Cheekyfellastef/stephan-os',
    commit: { sha: fixture.head, contentBase64: fixture.commit.bytes.toString('base64') },
    trees: [...fixture.trees].map(([sha, bytes]) => ({ sha, contentBase64: bytes.toString('base64') })),
    records: files.filter(row => selected.includes(row.path)).map(row => ({ path: row.path,
      blobSha: createHash('sha1').update('blob ' + row.content.length + '\0').update(row.content).digest('hex'),
      contentBase64: row.content.toString('base64') })) } };
}
const runtime = sourceInput(FIXED_RUNTIME_SOURCE_PATHS_V1), native = sourceInput(nativePaths);
assert.equal(runtime.fixture.head, native.fixture.head);
const now = Date.now(), key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const spki = key.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
const enrollment = { schemaVersion: 'stephanos.battle-bridge-mobile-installation-enrollment.v1', machineHash: 'a'.repeat(64),
  operatorSid: 'S-1-5-21-1-2-3-1001', generation: 1, rpId: 'stephanos.example', origin: 'https://bridge.stephanos.example',
  credentialId: Buffer.alloc(24, 7).toString('base64url'), publicKeySpki: spki,
  userHandle: Buffer.from('operator').toString('base64url'), lastSignCount: 0, revoked: false, receiptPublicKeySpki: spki };
const setupInput = { schemaVersion: MOBILE_SETUP_INPUT_V1, nativeSourceInput: native.input,
  proposedEnrollmentJson: JSON.stringify(enrollment), nonce: '1'.repeat(64),
  issuedAtUtc: new Date(now).toISOString(), expiresAtUtc: new Date(now + 600000).toISOString(),
  reviewInput: { schemaVersion: MOBILE_ENROLLMENT_REVIEW_INPUT_V1, sourceInput: runtime.input,
    expectedMain: runtime.fixture.head, sourceTree: runtime.fixture.tree, operatorSid: enrollment.operatorSid,
    machineHash: enrollment.machineHash, enrollmentGeneration: 1,
    releaseEvidenceBase64: Buffer.from('{"synthetic":true,"qualified":true}').toString('base64') } };
const setup = value => prepareMobileInstallSetupReviewV1(JSON.stringify(value));
const bootstrap = value => prepareMobileInstallBootstrapReviewV1(JSON.stringify(value));

test('real native preflight rejects expired/short-budget/wrong-target/invalid-proof captures before protected effects',
  { skip: process.platform !== 'win32', timeout: 45000 }, t => {
    const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    const literal = value => "'" + value.replaceAll("'", "''") + "'";
    const run = script => spawnSync(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { shell: false, windowsHide: true, encoding: 'utf8', timeout: 40000, maxBuffer: 32768 });
    const identity = run(String.raw`$ErrorActionPreference='Stop';$id=[Security.Principal.WindowsIdentity]::GetCurrent();try{$sid=$id.User.Value}finally{$id.Dispose()};$r=[Microsoft.Win32.RegistryKey]::OpenBaseKey('LocalMachine','Registry64');try{$k=$r.OpenSubKey('SOFTWARE\Microsoft\Cryptography',$false);try{$g=$k.GetValue('MachineGuid')}finally{$k.Dispose()}}finally{$r.Dispose()};$h=[Security.Cryptography.SHA256]::Create();try{$m=([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($g.ToLowerInvariant())))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()};[Console]::Write(($sid+' '+$m))`);
    assert.equal(identity.status, 0, identity.stderr);
    const [sid, machine] = identity.stdout.split(' ');
    assert.match(sid, /^S-1-5-21-/); assert.match(machine, /^[a-f0-9]{64}$/);
    const current = Date.now();
    const make = ({ issued = current - 1000, expires = current + 600000, wrongTarget = false, badSignature = false } = {}) => {
      const proposed = { ...enrollment, operatorSid: sid, machineHash: wrongTarget ? 'f'.repeat(64) : machine };
      const row = { ...structuredClone(setupInput), proposedEnrollmentJson: JSON.stringify(proposed),
        issuedAtUtc: new Date(issued).toISOString(), expiresAtUtc: new Date(expires).toISOString() };
      Object.assign(row.reviewInput, { operatorSid: sid, machineHash: proposed.machineHash });
      const prepared = setup(row);
      const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: prepared.publicKey.challenge, origin: proposed.origin }));
      const auth = Buffer.concat([createHash('sha256').update(proposed.rpId).digest(), Buffer.from([5, 0, 0, 0, 1])]);
      const signature = sign('sha256', Buffer.concat([auth, createHash('sha256').update(client).digest()]), key.privateKey);
      if (badSignature) signature[signature.length - 1] ^= 1;
      const assertion = { type: 'public-key', id: proposed.credentialId, rawId: proposed.credentialId,
        response: { clientDataJSON: client.toString('base64url'), authenticatorData: auth.toString('base64url'), signature: signature.toString('base64url'), userHandle: null } };
      return JSON.parse(Buffer.from(bootstrap({ schemaVersion: MOBILE_BOOTSTRAP_INPUT_V1, setupInput: row,
        deviceAssertionJson: JSON.stringify(assertion) }).privateCandidate.payloadBase64, 'base64'));
    };
    const cases = [{ name: 'valid actual-target capture', payload: make(), accepted: true },
      { name: 'expired capture', payload: make({ issued: current - 700000, expires: current - 1000 }), accepted: false },
      { name: 'insufficient remaining budget', payload: make({ expires: current + 30000 }), accepted: false },
      { name: 'different machine', payload: make({ wrongTarget: true }), accepted: false },
      { name: 'tampered device signature', payload: make({ badSignature: true }), accepted: false }];
    const root = mkdtempSync(join(tmpdir(), 'stephanos-preflight-data-'));
    try {
      const input = join(root, 'vectors.json'); writeFileSync(input, JSON.stringify(cases));
      const entry = fileURLToPath(new URL('./windows/install-battle-bridge-mobile-installer-v1.ps1', import.meta.url));
      const result = run(String.raw`$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null;$ast=[Management.Automation.Language.Parser]::ParseFile(__ENTRY__,[ref]$tokens,[ref]$errors);if($errors.Count){throw 'PARSE_FAILED'}
foreach($name in @('Get-MobileDigest','Confirm-MobileEnrollmentDevice')) {
 $node=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq $name},$true)
 . ([scriptblock]::Create($node.Extent.Text))
}
$vectors=([IO.File]::ReadAllText(__INPUT__))|ConvertFrom-Json
$first=$vectors[0].payload
$source=(@($first.Records|Where-Object{$_.Path.EndsWith('.cs')}|ForEach-Object{[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_.ContentBase64))})) -join [Environment]::NewLine
$parameters=[CodeDom.Compiler.CompilerParameters]::new();$parameters.GenerateExecutable=$true;$parameters.GenerateInMemory=$true;$parameters.TreatWarningsAsErrors=$true
$parameters.CompilerOptions='/target:exe /main:Stephanos.Sovereign.SovereignMobileInstallEntryV1 /optimize+'
foreach($reference in @('System.dll','System.Core.dll','System.Management.dll','System.Web.Extensions.dll')){[void]$parameters.ReferencedAssemblies.Add($reference)}
$provider=[Microsoft.CSharp.CSharpCodeProvider]::new();try{$compiled=$provider.CompileAssemblyFromSource($parameters,@($source));if($compiled.Errors.HasErrors){throw ($compiled.Errors|Out-String)};$assembly=$compiled.CompiledAssembly}finally{$provider.Dispose()}
[void][Reflection.Assembly]::Load('System.Web.Extensions, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35');$json=[Web.Script.Serialization.JavaScriptSerializer]::new()
$results=@()
foreach($vector in $vectors) {
 $bootstrap=$vector.payload;$ExpectedMain=$bootstrap.SourceHead;$records=@{};$releaseBytes=@{}
 foreach($record in $bootstrap.Records){$records[$record.Path]=$record}
 foreach($file in $bootstrap.ReleaseFiles){$releaseBytes[$file.name]=[Convert]::FromBase64String($file.contentBase64)}
 $accepted=$false;$code='';try{[void](Confirm-MobileEnrollmentDevice $assembly 120);$accepted=$true}catch{$capturedFailure=$_.Exception;while($null -ne $capturedFailure.InnerException){$capturedFailure=$capturedFailure.InnerException};$code=$capturedFailure.Message}
 $results+=@{name=$vector.name;accepted=$accepted;code=$code}
}
[Console]::Write(($results|ConvertTo-Json -Compress))`.replace('__ENTRY__', literal(entry)).replace('__INPUT__', literal(input)));
      assert.equal(result.status, 0, result.stderr);
      const rows = JSON.parse(result.stdout);
      for (const [index, row] of rows.entries()) assert.equal(row.accepted, cases[index].accepted, JSON.stringify(row));
      for (const index of [1, 2]) assert.equal(rows[index].code, 'MOBILE_ENROLLMENT_DESCRIPTOR_NOT_FRESH');
      t.diagnostic('5 native in-memory preflight vectors; no administrator gate, protected path creation, receipt key, task or journal mutation invoked');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

test('separate-domain setup challenge binds exact native/runtime source, device and descriptor without authority', () => {
  const result = setup(setupInput), descriptor = JSON.parse(result.descriptor);
  assert.equal(result.installability, 'NOT_INSTALLABLE');
  assert.deepEqual(Object.values(result.authority), Array(10).fill(false));
  assert.equal(descriptor.proposedEnrollmentSha256, hash(setupInput.proposedEnrollmentJson));
  assert.equal(descriptor.sourceHead, runtime.fixture.head); assert.equal(descriptor.sourceTree, runtime.fixture.tree);
  assert.equal(result.descriptorSha256, hash(result.descriptor));
  assert.equal(result.publicKey.challenge, createHash('sha256').update('stephanos.mobile-install-enrollment-proof.v1\0' + result.descriptor).digest('base64url'));
  assert.equal(result.publicKey.userVerification, 'required');
  assert.deepEqual(result.publicKey.allowCredentials, [{ type: 'public-key', id: enrollment.credentialId }]);
  assert.ok(Object.isFrozen(result.publicKey));
});

test('immutable captured bootstrap uses the same source evidence and fixed entry; synthetic review cannot qualify it', () => {
  const prepared = setup(setupInput);
  const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: prepared.publicKey.challenge, origin: enrollment.origin }));
  const auth = Buffer.concat([createHash('sha256').update(enrollment.rpId).digest(), Buffer.from([5, 0, 0, 0, 1])]);
  const assertion = { type: 'public-key', id: enrollment.credentialId, rawId: enrollment.credentialId,
    response: { clientDataJSON: client.toString('base64url'), authenticatorData: auth.toString('base64url'),
      signature: sign('sha256', Buffer.concat([auth, createHash('sha256').update(client).digest()]), key.privateKey).toString('base64url'), userHandle: null } };
  const result = bootstrap({ schemaVersion: MOBILE_BOOTSTRAP_INPUT_V1, setupInput, deviceAssertionJson: JSON.stringify(assertion) });
  assert.equal(result.installability, 'NOT_INSTALLABLE'); assert.deepEqual(Object.values(result.authority), Array(10).fill(false));
  const bytes = Buffer.from(result.privateCandidate.payloadBase64, 'base64'), payload = JSON.parse(bytes);
  assert.equal(hash(bytes), result.privateCandidate.payloadSha256); assert.equal(payload.Records.length, 19);
  assert.equal(payload.SetupDescriptor, prepared.descriptor); assert.equal(payload.SourceHead, runtime.fixture.head);
  assert.ok(payload.SourceProofWire.startsWith('STEPHANOS_FIXED_RUNTIME_SOURCE_V1 ' + runtime.fixture.head + ' '));
  assert.deepEqual(payload.ReleaseFiles.map(row => row.name), ['release.pin', 'runtime-package.json', 'runtime-bootstrap.ps1', 'release-evidence.json']);
  assert.ok(result.privateCandidate.script.includes('MOBILE_SETUP_PAYLOAD_CHANGED'));
  assert.ok(result.privateCandidate.script.includes('MOBILE_SETUP_ENTRY_CHANGED'));
  assert.ok(result.privateCandidate.script.includes('$script:MobileInstallerEnrollmentPinnedBootstrapV1=$data'));
  assert.ok(result.privateCandidate.script.includes('-OperatorApproved -ExpectedMain'));
  assert.ok(result.requiredGates.includes('WINDOWS_SECURITY_SPECIALIST_QUALIFICATION'));
});

test('wrong member bytes, source binding, descriptor fields, caller paths and fabricated authority are refused', () => {
  for (const change of [{ nonce: 'x'.repeat(64) }, { expiresAtUtc: new Date(now + 900001).toISOString() },
    { proposedEnrollmentJson: JSON.stringify({ ...enrollment, machineHash: 'b'.repeat(64) }) },
    { proposedEnrollmentJson: JSON.stringify({ ...enrollment, lastSignCount: 1 }) },
    { proposedEnrollmentJson: JSON.stringify({ ...enrollment, revoked: true }) }, { path: 'C:\\untrusted' }, { operatorApproved: true }])
    assert.throws(() => setup({ ...setupInput, ...change }));
  const changed = structuredClone(setupInput);
  changed.nativeSourceInput.records[0].contentBase64 = Buffer.from('different bytes').toString('base64');
  assert.throws(() => setup(changed));
  const missing = structuredClone(setupInput); missing.nativeSourceInput.records.pop(); assert.throws(() => setup(missing));
  assert.throws(() => bootstrap({ schemaVersion: MOBILE_BOOTSTRAP_INPUT_V1, setupInput,
    deviceAssertionJson: JSON.stringify({ type: 'public-key', id: 'different', response: {} }) }));
});

const firstPairingInput = {
  schemaVersion: MOBILE_FIRST_PAIRING_INPUT_V1, reviewInput: setupInput.reviewInput,
  nativeSourceInput: setupInput.nativeSourceInput, origin: enrollment.origin,
  rpId: new URL(enrollment.origin).hostname, userHandle: Buffer.alloc(32, 8).toString('base64url'),
  nonce: setupInput.nonce, issuedAtUtc: setupInput.issuedAtUtc, expiresAtUtc: setupInput.expiresAtUtc,
};
const pairingReview = value => prepareMobileInstallFirstPairingReviewV1(JSON.stringify(value), { nowMs: now });
const capturedBootstrap = (value, nowMs = now) => prepareMobileInstallCapturedBootstrapReviewV1(JSON.stringify(value), { nowMs });
function captureInput({ registrationCounter = 0, counter } = {}) {
  const prepared = pairingReview(firstPairingInput);
  const wire = makeMobileDevicePairingFixtureV1(prepared.context, { nowMs: now, registrationCounter });
  const descriptor = mobileDevicePairingSetupDescriptorV1(prepared.context, wire.registration, { nowMs: now });
  return { wire, prepared, input: {
    schemaVersion: MOBILE_CAPTURED_BOOTSTRAP_INPUT_V1, pairingReviewInput: firstPairingInput,
    capturedResult: { stage: 'COMPLETED', context: prepared.context, contextSha256: prepared.contextSha256,
      registration: wire.registration, assertion: wire.assertion(counter === undefined ? {} : { counter }),
      setupDescriptor: descriptor.setupDescriptor, proposedEnrollmentJson: descriptor.proposedEnrollmentJson,
      installability: 'NOT_INSTALLABLE', executionAuthorityGranted: false },
  } };
}

test('first-device preparation derives exact source/release context without credentials or authority', () => {
  const result = pairingReview(firstPairingInput);
  assert.equal(result.installability, 'NOT_INSTALLABLE'); assert.equal(result.context.sourceHead, runtime.fixture.head);
  assert.equal(result.context.sourceTree, runtime.fixture.tree); assert.equal(result.context.operatorSid, enrollment.operatorSid);
  assert.equal(result.context.rpId, new URL(enrollment.origin).hostname);
  const release = prepareMobileInstallEnrollmentReviewV1(JSON.stringify(firstPairingInput.reviewInput));
  assert.equal(result.context.packageSha256, release.privateFiles.find(file => file.name === 'runtime-package.json').sha256);
  assert.equal(result.context.releaseProofSha256, release.privateFiles.find(file => file.name === 'release-evidence.json').sha256);
  assert.deepEqual(Object.values(result.authority), Array(10).fill(false));
  assert.equal(Object.hasOwn(result.context, 'credentialId'), false); assert.equal(Object.isFrozen(result.context), true);
});

test('captured registration and real ES256 setup proof independently produce only an inert immutable bootstrap', () => {
  for (const registrationCounter of [0, 7]) {
    const { input, wire } = captureInput({ registrationCounter });
    const result = capturedBootstrap(input);
    assert.equal(result.installability, 'NOT_INSTALLABLE'); assert.deepEqual(Object.values(result.authority), Array(10).fill(false));
    const payload = JSON.parse(Buffer.from(result.privateCandidate.payloadBase64, 'base64'));
    assert.equal(payload.SetupDescriptor, input.capturedResult.setupDescriptor);
    assert.equal(payload.ProposedEnrollmentJson, input.capturedResult.proposedEnrollmentJson);
    assert.equal(payload.SourceHead, runtime.fixture.head); assert.equal(payload.Records.length, 19);
    assert.equal(JSON.parse(payload.ProposedEnrollmentJson).publicKeySpki, wire.publicKeySpki);
    assert.equal(JSON.parse(payload.ProposedEnrollmentJson).lastSignCount, 0);
  }
});

test('capture source/key/descriptor substitution, invented authority and registration counter rollback are refused offline', () => {
  const { input } = captureInput();
  const changes = [
    row => { row.capturedResult.context.sourceHead = 'f'.repeat(40); },
    row => { row.capturedResult.contextSha256 = 'f'.repeat(64); },
    row => { row.capturedResult.setupDescriptor += ' '; },
    row => { row.capturedResult.proposedEnrollmentJson += ' '; },
    row => { row.capturedResult.registration.rawId = Buffer.alloc(24, 9).toString('base64url'); },
    row => { row.capturedResult.assertion.response.signature = Buffer.alloc(70, 9).toString('base64url'); },
    row => { row.capturedResult.executionAuthorityGranted = true; },
    row => { row.capturedResult.stage = 'AWAITING_CONFIRMATION'; },
    row => { row.operatorApproved = true; },
  ];
  for (const change of changes) { const changed = structuredClone(input); change(changed); assert.throws(() => capturedBootstrap(changed)); }
  assert.throws(() => capturedBootstrap(captureInput({ registrationCounter: 7, counter: 7 }).input));
  assert.throws(() => capturedBootstrap(captureInput({ registrationCounter: 7, counter: 6 }).input));
  assert.throws(() => capturedBootstrap(input, now + 600001));
});
