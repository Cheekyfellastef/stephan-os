import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { prepareMobileInstallSetupReviewV1, prepareMobileInstallBootstrapReviewV1,
  MOBILE_SETUP_INPUT_V1, MOBILE_BOOTSTRAP_INPUT_V1 } from './battle-bridge-mobile-install-enrollment-bootstrap-v1.mjs';
import { MOBILE_ENROLLMENT_REVIEW_INPUT_V1 } from './battle-bridge-mobile-install-enrollment-review-v1.mjs';
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
  assert.equal(hash(bytes), result.privateCandidate.payloadSha256); assert.equal(payload.Records.length, 18);
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
