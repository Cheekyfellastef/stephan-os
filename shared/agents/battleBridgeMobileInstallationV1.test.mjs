import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  MOBILE_INSTALLATION_CANDIDATE_SCHEMA, MOBILE_INSTALLATION_ENROLLMENT_SCHEMA,
  MOBILE_INSTALLATION_RECEIPT_SCHEMA, MOBILE_INSTALLATION_ACTION,
  normalizeMobileInstallationCandidateV1, mobileInstallationCandidateDigestV1,
  mobileInstallationChallengeV1, mobileInstallationRequestOptionsV1,
  verifyMobileInstallationAssertionV1, canonicalMobileInstallationReceiptV1, projectMobileInstallationV1,
} from './battleBridgeMobileInstallationV1.mjs';

const now = Date.parse('2026-11-14T13:00:00.000Z');
const iso = offset => new Date(now + offset).toISOString();
const digest = value => createHash('sha256').update(value).digest();
const b64 = value => Buffer.from(value).toString('base64url');
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const receiptKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKey = pair => pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
const candidate = Object.freeze({
  schemaVersion: MOBILE_INSTALLATION_CANDIDATE_SCHEMA, repository: 'Cheekyfellastef/stephan-os',
  issueNumber: 1814, action: MOBILE_INSTALLATION_ACTION, requestId: 'mobile-install-request-0001',
  nonce: 'a'.repeat(64), machineHash: 'b'.repeat(64), operatorSid: 'S-1-5-21-1-2-3-1001',
  sourceHead: 'c'.repeat(40), sourceTree: 'd'.repeat(40), packageSha256: 'e'.repeat(64),
  closureSha256: 'f'.repeat(64), releaseProofSha256: '1'.repeat(64), enrollmentGeneration: 1,
  requestedAtUtc: iso(0), expiresAtUtc: iso(240_000),
});
const enrollment = Object.freeze({
  schemaVersion: MOBILE_INSTALLATION_ENROLLMENT_SCHEMA, machineHash: candidate.machineHash,
  operatorSid: candidate.operatorSid, generation: 1, rpId: 'battlebridge.example.com',
  origin: 'https://battlebridge.example.com', credentialId: b64(Buffer.alloc(32, 7)),
  publicKeySpki: publicKey(keys), userHandle: b64('operator-1'), lastSignCount: 0,
  revoked: false, receiptPublicKeySpki: publicKey(receiptKeys),
});

function assertion({ c = candidate, client = {}, rawClient, rpId = enrollment.rpId, flags = 5, count = 0,
  privateKey = keys.privateKey, userHandle = enrollment.userHandle } = {}) {
  const clientBytes = Buffer.from(rawClient ?? JSON.stringify({ type: 'webauthn.get',
    challenge: mobileInstallationChallengeV1(c), origin: enrollment.origin, crossOrigin: false, ...client }));
  const auth = Buffer.alloc(37); digest(rpId).copy(auth); auth[32] = flags; auth.writeUInt32BE(count, 33);
  return { type: 'public-key', id: enrollment.credentialId, rawId: enrollment.credentialId, response: {
    clientDataJSON: b64(clientBytes), authenticatorData: b64(auth),
    signature: sign('sha256', Buffer.concat([auth, digest(clientBytes)]), privateKey).toString('base64url'), userHandle,
  } };
}
const check = (a = assertion(), c = candidate, e = enrollment) =>
  verifyMobileInstallationAssertionV1({ candidate: c, enrollment: e, assertion: a }, { nowMs: now });

function receipt(fields = {}, privateKey = receiptKeys.privateKey) {
  const payload = { schemaVersion: MOBILE_INSTALLATION_RECEIPT_SCHEMA,
    requestId: candidate.requestId, candidateSha256: mobileInstallationCandidateDigestV1(candidate),
    machineHash: candidate.machineHash, enrollmentGeneration: 1, sequence: 1,
    state: 'AWAITING_APPROVAL', observedAtUtc: iso(0), sourceHead: candidate.sourceHead,
    packageSha256: candidate.packageSha256, retainedProcessId: null, executionStartedAtUtc: null,
    installedHelperSha256: null, installationBootId: null, qualifiedBootId: null,
    reasonCode: 'RELEASE_ELIGIBLE', ...fields };
  return { payload, signature: sign('sha256', Buffer.from(canonicalMobileInstallationReceiptV1(payload)), privateKey).toString('base64url') };
}
const project = (r = receipt(), options = {}) =>
  projectMobileInstallationV1({ candidate, enrollment, receipt: r }, { nowMs: now, ...options });

test('real P-256 approval verifies while granting no execution authority', () => {
  const result = check(); assert.equal(result.ok, true); assert.equal(result.approvalVerified, true);
  assert.equal(result.executionAuthorityGranted, false); assert.equal(result.requiresNativeReverification, true);
  assert.equal(result.candidateSha256, mobileInstallationCandidateDigestV1(candidate));
  assert.equal(check(assertion({ userHandle: null })).ok, true);
});

test('options expose only browser request values; enrollment remains private', () => {
  const result = mobileInstallationRequestOptionsV1(candidate, enrollment, { nowMs: now });
  assert.equal(result.ok, true); assert.equal(result.publicKey.userVerification, 'required');
  assert.equal(result.publicKey.challenge, mobileInstallationChallengeV1(candidate));
  for (const secret of ['operatorSid', 'publicKeySpki', 'userHandle', 'receiptPublicKeySpki']) {
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test('canonical candidate is field-order independent and every bound scalar changes its digest', () => {
  assert.equal(mobileInstallationCandidateDigestV1(Object.fromEntries(Object.entries(candidate).reverse())), mobileInstallationCandidateDigestV1(candidate));
  for (const field of ['sourceHead', 'sourceTree', 'packageSha256', 'closureSha256', 'releaseProofSha256', 'nonce', 'machineHash']) {
    const changed = { ...candidate, [field]: '2'.repeat(candidate[field].length) };
    assert.notEqual(mobileInstallationChallengeV1(changed), mobileInstallationChallengeV1(candidate), field);
    assert.equal(check(assertion(), changed).ok, false, field);
  }
});

test('closed candidate refuses extra/missing/accessor/nonprimitive members and invalid time', () => {
  let accessed = false;
  const accessor = { ...candidate }; Object.defineProperty(accessor, 'sourceHead', { enumerable: true, get() { accessed = true; return candidate.sourceHead; } });
  const missing = { ...candidate }; delete missing.sourceTree;
  for (const c of [{ ...candidate, command: 'whoami' }, missing, accessor,
    { ...candidate, sourceHead: [candidate.sourceHead] }, { ...candidate, issueNumber: '1814' },
    { ...candidate, requestedAtUtc: iso(1) }, { ...candidate, expiresAtUtc: iso(0) },
    { ...candidate, expiresAtUtc: iso(300_001) }, { ...candidate, action: 'REBOOT' }]) {
    assert.equal(normalizeMobileInstallationCandidateV1(c, { nowMs: now }).ok, false);
  }
  assert.equal(accessed, false);
});

test('every string binding rejects arrays and coercible objects without invoking conversion', () => {
  let converted = false;
  const representations = value => [[value], { toString() { converted = true; return value; } }];
  for (const [key, value] of Object.entries(candidate)) {
    if (typeof value !== 'string') continue;
    for (const other of representations(value)) assert.equal(normalizeMobileInstallationCandidateV1({ ...candidate, [key]: other }, { nowMs: now }).ok, false, key);
  }
  for (const [key, value] of Object.entries(enrollment)) {
    if (typeof value !== 'string') continue;
    for (const other of representations(value)) assert.equal(check(assertion(), candidate, { ...enrollment, [key]: other }).ok, false, key);
  }
  for (const [key, value] of Object.entries(receipt().payload)) {
    if (typeof value !== 'string') continue;
    for (const other of representations(value)) {
      const bad = receipt(); bad.payload[key] = other;
      // Even a genuine signer cannot turn a nonprimitive contract into authority.
      if (Array.isArray(other)) bad.signature = sign('sha256', Buffer.from(JSON.stringify(bad.payload)), receiptKeys.privateKey).toString('base64url');
      assert.equal(project(bad).state, 'UNKNOWN', key);
    }
  }
  assert.equal(converted, false);
});

for (const [label, args] of [
  ['wrong origin', { client: { origin: 'https://evil.example.com' } }],
  ['wrong ceremony', { client: { type: 'webauthn.create' } }],
  ['cross-origin', { client: { crossOrigin: true } }],
  ['wrong challenge', { client: { challenge: b64('another-challenge') } }],
  ['wrong RP hash', { rpId: 'evil.example.com' }],
  ['missing presence', { flags: 4 }], ['missing verification', { flags: 1 }],
  ['reserved flag', { flags: 7 }], ['attestation flag', { flags: 69 }],
  ['extension flag', { flags: 133 }], ['invalid backup state', { flags: 21 }],
  ['wrong user handle', { userHandle: b64('other-user') }],
  ['wrong signing key', { privateKey: receiptKeys.privateKey }],
]) test(`authentic signed assertion still refuses ${label}`, () => assert.equal(check(assertion(args)).ok, false));

test('client JSON rejects duplicate keys, trailing garbage, invalid UTF8 and unknown fields', () => {
  const raw = JSON.stringify({ type: 'webauthn.get', challenge: mobileInstallationChallengeV1(candidate), origin: enrollment.origin });
  for (const rawClient of [raw.replace('{', '{"type":"webauthn.get",'), raw + '{}', raw.replace('}', ',"unknown":false}'), raw.replace('}', ',}'), '\ufeff' + raw]) {
    assert.equal(check(assertion({ rawClient })).ok, false);
  }
  const bad = assertion(); bad.response.clientDataJSON = b64(Buffer.from([0xff, 0xfe, 0xff]));
  assert.equal(check(bad).ok, false);
});

test('strict bounded wire encoding refuses oversized data, padding, signature changes and extra fields', () => {
  const variants = [];
  for (const [key, value] of [['clientDataJSON', b64(Buffer.alloc(4097))], ['authenticatorData', b64(Buffer.alloc(38))], ['signature', b64(Buffer.alloc(73))]]) {
    const a = assertion(); a.response[key] = value; variants.push(a);
  }
  const padded = assertion(); padded.response.signature += '='; variants.push(padded);
  const tampered = assertion(); const bytes = Buffer.from(tampered.response.signature, 'base64url'); bytes[bytes.length - 1] ^= 1; tampered.response.signature = b64(bytes); variants.push(tampered);
  const extra = assertion(); extra.response.approved = true; variants.push(extra);
  for (const a of variants) assert.equal(check(a).ok, false);
});

test('counter zero is supported, nonzero rollback is refused and result is not a replay journal', () => {
  assert.equal(check(assertion({ count: 0 })).ok, true);
  assert.equal(check(assertion({ count: 2 }), candidate, { ...enrollment, lastSignCount: 1 }).ok, true);
  for (const count of [0, 1]) assert.equal(check(assertion({ count }), candidate, { ...enrollment, lastSignCount: 1 }).ok, false);
  const a = assertion(); assert.equal(check(a).ok, true); assert.equal(check(a).ok, true);
  assert.equal(check(a).executionAuthorityGranted, false); // Protected journal owns one-use admission.
});

test('revoked, wrong machine/operator/generation and unsupported public key enrollments fail', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  for (const e of [{ ...enrollment, revoked: true }, { ...enrollment, machineHash: '0'.repeat(64) },
    { ...enrollment, operatorSid: 'S-1-5-21-1-2-3-1002' }, { ...enrollment, generation: 2 },
    { ...enrollment, publicKeySpki: publicKey(rsa) }, { ...enrollment, origin: 'http://battlebridge.example.com' }]) {
    assert.equal(check(assertion(), candidate, e).ok, false);
  }
});

test('projection requires authenticated native receipt; ready boolean or signed label is insufficient', () => {
  assert.equal(projectMobileInstallationV1().state, 'SETUP_REQUIRED');
  assert.equal(project({ payload: { ready: true }, signature: '' }).state, 'UNKNOWN');
  assert.equal(project(receipt({}, keys.privateKey)).state, 'UNKNOWN');
  assert.equal(project(receipt({ state: 'READY' })).state, 'UNKNOWN');
  assert.equal(project(receipt({ state: 'INSTALLING' })).state, 'UNKNOWN');
  assert.equal(project(receipt({ state: 'STARTING' })).state, 'STARTING');
  assert.equal(project().canApprove, true); assert.equal(project().executionAuthorityGranted, false);
});

test('receipt rejects wrong binding, stale/future observations and sequence rollback', () => {
  for (const fields of [{ requestId: 'mobile-install-request-0002' }, { candidateSha256: '0'.repeat(64) },
    { machineHash: '0'.repeat(64) }, { enrollmentGeneration: 2 }, { observedAtUtc: iso(-1) },
    { observedAtUtc: iso(1) }, { packageSha256: '0'.repeat(64) }, { sourceHead: '0'.repeat(40) }]) {
    assert.equal(project(receipt(fields)).state, 'UNKNOWN');
  }
  assert.equal(project(receipt(), { nowMs: now + 120_001 }).state, 'UNKNOWN');
  assert.equal(project(receipt(), { minimumSequence: 2 }).state, 'UNKNOWN');
});

test('real start and installation evidence are distinct; later boot is mandatory for ready', () => {
  const started = { retainedProcessId: 1234, executionStartedAtUtc: iso(0) };
  assert.equal(project(receipt({ state: 'INSTALLING', ...started })).state, 'INSTALLING');
  const installed = { ...started, installedHelperSha256: '3'.repeat(64), installationBootId: '4'.repeat(64) };
  assert.equal(project(receipt({ state: 'INSTALLED_PENDING_BOOT', ...installed })).state, 'INSTALLED_PENDING_BOOT');
  assert.equal(project(receipt({ state: 'READY', ...installed, qualifiedBootId: '4'.repeat(64) })).state, 'UNKNOWN');
  assert.equal(project(receipt({ state: 'READY', ...installed, qualifiedBootId: '5'.repeat(64) })).state, 'READY');
});

test('fresh historical terminal survives approval expiry, while expired approval is disabled', () => {
  const observedAtUtc = iso(600_000);
  const fields = { observedAtUtc, state: 'INSTALLED_PENDING_BOOT', retainedProcessId: 1234,
    executionStartedAtUtc: iso(10_000), installedHelperSha256: '3'.repeat(64), installationBootId: '4'.repeat(64) };
  assert.equal(project(receipt(fields), { nowMs: now + 600_000 }).state, 'INSTALLED_PENDING_BOOT');
  assert.equal(project(receipt({ observedAtUtc }), { nowMs: now + 600_000 }).canApprove, false);
  assert.equal(project(receipt({ observedAtUtc }), { nowMs: now + 600_000 }).state, 'BLOCKED');
});
