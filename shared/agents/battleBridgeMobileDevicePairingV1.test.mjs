import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { makeMobileDevicePairingFixtureV1, encodeMobileDevicePairingCborFixtureV1 as cbor }
  from '../../scripts/fixtures/mobile-device-pairing-v1.mjs';
import {
  normalizeMobileDevicePairingContextV1, mobileDevicePairingCreateOptionsV1,
  verifyMobileDevicePairingRegistrationV1, buildMobileDevicePairingProposedEnrollmentV1,
  mobileDevicePairingSetupDescriptorV1, verifyMobileDevicePairingSetupAssertionV1,
} from './battleBridgeMobileInstallationV1.mjs';

const nowMs = Date.parse('2026-11-14T19:00:00.000Z');
const options = { nowMs };
const hash = value => createHash('sha256').update(value).digest();
const b64 = value => Buffer.from(value).toString('base64url');
const iso = offset => new Date(nowMs + offset).toISOString();
const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const id = Buffer.alloc(32, 7);
const context = Object.freeze({ schemaVersion: 'stephanos.mobile-installer-first-device-context.v1',
  repository: 'Cheekyfellastef/stephan-os', issueNumber: 1814, action: 'CAPTURE_MOBILE_INSTALLER_FIRST_DEVICE_V1',
  sourceHead: 'a'.repeat(40), sourceTree: 'b'.repeat(40), machineHash: '1'.repeat(64),
  operatorSid: 'S-1-5-21-1-2-3-1001', enrollmentGeneration: 1, packageSha256: '2'.repeat(64),
  closureSha256: '3'.repeat(64), releaseProofSha256: '4'.repeat(64), origin: 'https://bridge.example.com',
  rpId: 'bridge.example.com', userHandle: b64(Buffer.alloc(32, 8)), nonce: '5'.repeat(64),
  issuedAtUtc: iso(-1000), expiresAtUtc: iso(600_000) });

// Separate test-only producer builds genuine ES256/CBOR bytes. It does not use
// the production decoder to construct or validate its attestation payload.
const fixture = makeMobileDevicePairingFixtureV1(context, { nowMs, keyPair: device, credentialId: id });
function coseFor(pair = device) {
  const key = pair.publicKey.export({ format: 'jwk' });
  return new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(key.x, 'base64url')], [-3, Buffer.from(key.y, 'base64url')]]);
}
const registration = values => fixture.makeRegistration(values);
const setupAssertion = values => fixture.assertion(values);
const verifyReg = (value = registration(), ctx = context) => verifyMobileDevicePairingRegistrationV1(ctx, value, options);
const verifySetup = (proof = setupAssertion(), reg = registration(), ctx = context) => verifyMobileDevicePairingSetupAssertionV1(ctx, reg, proof, options);
function noAuthority(result) {
  assert.equal(result.installability, 'NOT_INSTALLABLE');
  assert.equal(result.requiresNativeReverification, true);
  for (const key of ['sourceAdmissionProven', 'releaseEligibilityProven', 'evidenceAuthenticationProven', 'enrollmentQualified',
    'operatorApprovalProven', 'approvalVerified', 'installationApprovalGranted', 'executionAuthorityGranted', 'dispatchAllowed',
    'elevationPerformed', 'installed', 'rebootAllowed']) {
    assert.equal(result[key], false, key); assert.equal(result.authority[key], false, key);
  }
}

test('context and create options bind exact original source/target/host with no authority', () => {
  const normalized = normalizeMobileDevicePairingContextV1(context, options), create = mobileDevicePairingCreateOptionsV1(context, options);
  assert.equal(normalized.ok, true); noAuthority(normalized); noAuthority(create);
  assert.equal(normalized.contextSha256, hash(JSON.stringify(context)).toString('hex'));
  assert.equal(create.publicKey.challenge, hash('stephanos.mobile-installer-first-device-create.v1\0' + JSON.stringify(context)).toString('base64url'));
  assert.equal(create.publicKey.rp.id, context.rpId); assert.equal(create.publicKey.user.id, context.userHandle);
  assert.deepEqual(create.publicKey.pubKeyCredParams, [{ type: 'public-key', alg: -7 }]);
  assert.deepEqual(create.publicKey.authenticatorSelection, { userVerification: 'required', residentKey: 'discouraged' });
  assert.equal(create.publicKey.attestation, 'none'); assert.equal(create.publicKey.timeout, 60_000);
  assert.equal(Object.hasOwn(create.publicKey, 'extensions'), false); assert.equal(Object.isFrozen(create.publicKey.user), true);
});

test('canonical context ignores field order while each bound scalar changes its create challenge', () => {
  const expected = mobileDevicePairingCreateOptionsV1(context, options).publicKey.challenge;
  const reverse = Object.fromEntries(Object.entries(context).reverse());
  assert.equal(mobileDevicePairingCreateOptionsV1(reverse, options).publicKey.challenge, expected);
  for (const [key, value] of Object.entries({ sourceHead: 'c'.repeat(40), sourceTree: 'd'.repeat(40), machineHash: '6'.repeat(64),
    operatorSid: 'S-1-5-21-1-2-3-1002', enrollmentGeneration: 2, packageSha256: '7'.repeat(64), closureSha256: '8'.repeat(64),
    releaseProofSha256: '9'.repeat(64), userHandle: b64(Buffer.alloc(32, 9)), nonce: '0'.repeat(64), issuedAtUtc: iso(-2000), expiresAtUtc: iso(500_000) }))
    assert.notEqual(mobileDevicePairingCreateOptionsV1({ ...context, [key]: value }, options).publicKey.challenge, expected, key);
});

for (const [name, patch] of Object.entries({
  'unknown field': { approved: true }, 'wrong schema': { schemaVersion: 'other' }, 'wrong repository': { repository: 'evil/repo' },
  'wrong issue': { issueNumber: 1 }, 'wrong action': { action: 'INSTALL_SOVEREIGN_FIXED_RUNTIME_V1' },
  'unsafe generation': { enrollmentGeneration: 2 ** 53 }, 'zero generation': { enrollmentGeneration: 0 },
  'future context': { issuedAtUtc: iso(1) }, 'expired context': { expiresAtUtc: iso(0) },
  'overlong window': { expiresAtUtc: iso(900_000) }, 'noncanonical date': { issuedAtUtc: '2026-11-14T19:00:00Z' },
  'short user handle': { userHandle: b64(Buffer.alloc(31)) }, 'long user handle': { userHandle: b64(Buffer.alloc(33)) },
  'padded user handle': { userHandle: context.userHandle + '=' }, 'wrong nonce': { nonce: 'a'.repeat(63) },
  'http origin': { origin: 'http://bridge.example.com' }, 'path origin': { origin: context.origin + '/' },
  'parent rp': { rpId: 'example.com' }, 'wrong rp': { rpId: 'elsewhere.example.com' },
  'uppercase origin': { origin: 'https://BRIDGE.example.com' }, 'default port spelling': { origin: context.origin + ':443' },
  'zero port': { origin: context.origin + ':0' }, 'userinfo origin': { origin: 'https://operator@bridge.example.com' },
})) test(`context refuses ${name}`, () => { const result = normalizeMobileDevicePairingContextV1({ ...context, ...patch }, options); assert.equal(result.ok, false); noAuthority(result); });

test('closed context refuses missing/inherited/accessor/nonprimitive input without conversion', () => {
  let reads = 0; const getter = { ...context }; Object.defineProperty(getter, 'sourceHead', { enumerable: true, get() { reads++; return context.sourceHead; } });
  const missing = { ...context }; delete missing.nonce;
  for (const value of [getter, missing, Object.create(context), { ...context, sourceHead: { toString() { reads++; return context.sourceHead; } } },
    { ...context, issueNumber: '1814' }, { ...context, rpId: [context.rpId] }]) assert.equal(normalizeMobileDevicePairingContextV1(value, options).ok, false);
  assert.equal(reads, 0); assert.equal(normalizeMobileDevicePairingContextV1(context, { nowMs: NaN }).ok, false);
});

test('real P256 COSE registration derives canonical SPKI without browser key trust or hardware provenance', () => {
  const result = verifyReg(); assert.equal(result.ok, true); noAuthority(result);
  assert.equal(result.publicKeySpki, device.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'));
  assert.equal(result.credentialId, b64(id)); assert.equal(result.registrationSignCount, 0);
  assert.equal(result.registrationVerified, true); assert.equal(result.devicePossessionVerified, false);
  assert.equal(result.authenticatorProvenanceVerified, false); assert.equal(result.attestationType, 'none');
  assert.equal(Object.isFrozen(result.registration.response), true);
});

for (const flags of [0x45, 0x4d, 0x5d]) test(`registration permits valid backup flags ${flags}`, () => assert.equal(verifyReg(registration({ flags })).ok, true));
for (const flags of [0, 0x40, 0x41, 0x44, 5, 0x47, 0x65, 0xc5, 0x55])
  test(`registration refuses invalid flags ${flags}`, () => assert.equal(verifyReg(registration({ flags })).ok, false));

for (const [name, client] of Object.entries({ 'wrong ceremony': { type: 'webauthn.get' }, 'wrong challenge': { challenge: b64(Buffer.alloc(32)) },
  'wrong origin': { origin: 'https://evil.example.com' }, 'cross origin': { crossOrigin: true }, 'unknown client field': { approved: true } }))
  test(`registration refuses ${name}`, () => assert.equal(verifyReg(registration({ client })).ok, false));

test('registration client JSON refuses duplicate escaped keys, trailing data, invalid UTF8 and BOM', () => {
  const base = JSON.stringify({ type: 'webauthn.create', challenge: mobileDevicePairingCreateOptionsV1(context, options).publicKey.challenge, origin: context.origin });
  for (const rawClient of [base.replace('"type":', '"type":"webauthn.create","ty\\u0070e":'), base + '{}', base.replace('"origin":', '"origin":false,"origin":'), '\ufeff' + base])
    assert.equal(verifyReg(registration({ rawClient })).ok, false);
  const invalid = registration(); invalid.response.clientDataJSON = b64(Buffer.from([0xc0, 0xaf])); assert.equal(verifyReg(invalid).ok, false);
});

for (const [name, make] of Object.entries({
  'wrong RP hash': () => registration({ rp: 'evil.example.com' }),
  'unsupported attestation': () => registration({ fmt: 'packed' }),
  'nonempty none statement': () => registration({ attStmt: new Map([['sig', Buffer.alloc(8)]]) }),
  'unknown top map key': () => registration({ attestationExtra: [['approved', 1]] }),
  'wrong COSE kty': () => { const cose = coseFor(); cose.set(1, 3); return registration({ cose }); },
  'wrong COSE alg': () => { const cose = coseFor(); cose.set(3, -257); return registration({ cose }); },
  'wrong COSE curve': () => { const cose = coseFor(); cose.set(-1, 2); return registration({ cose }); },
  'short coordinate': () => { const cose = coseFor(); cose.set(-2, Buffer.alloc(31)); return registration({ cose }); },
  'nonbyte coordinate': () => { const cose = coseFor(); cose.set(-2, 'x'.repeat(32)); return registration({ cose }); },
  'invalid curve point': () => { const cose = coseFor(); cose.set(-2, Buffer.alloc(32)); cose.set(-3, Buffer.alloc(32)); return registration({ cose }); },
  'unknown COSE label': () => { const cose = coseFor(); cose.set(2, Buffer.alloc(1)); return registration({ cose }); },
  'COSE trailing bytes': () => registration({ authSuffix: Buffer.from([0]) }),
  'truncated COSE': () => registration({ coseWire: cbor(coseFor()).subarray(0, -1) }),
  'short credential': () => registration({ credential: Buffer.alloc(15) }),
  'long credential': () => registration({ credential: Buffer.alloc(1024) }),
  'attestation trailing bytes': () => { const good = registration(); good.response.attestationObject = b64(Buffer.concat([Buffer.from(good.response.attestationObject, 'base64url'), Buffer.from([0])])); return good; },
})) test(`registration refuses ${name}`, () => { const result = verifyReg(make()); assert.equal(result.ok, false); noAuthority(result); });

test('registration refuses duplicate CBOR/COSE labels and nonminimal encoding', () => {
  const good = registration(), raw = Buffer.from(good.response.attestationObject, 'base64url');
  // Outer map claims four entries and repeats fmt. No JSON decoding can hide it.
  const duplicate = Buffer.concat([Buffer.from([0xa4]), raw.subarray(1), cbor('fmt'), cbor('none')]);
  assert.equal(verifyReg(registration({ attestation: duplicate })).ok, false);
  const key = cbor(coseFor()), duplicateCose = Buffer.concat([Buffer.from([0xa6]), key.subarray(1), cbor(3), cbor(-7)]);
  assert.equal(verifyReg(registration({ coseWire: duplicateCose })).ok, false);
  assert.equal(verifyReg(registration({ coseWire: Buffer.concat([Buffer.from([0xb8, 5]), key.subarray(1)]) })).ok, false);
  for (const attestation of [Buffer.from([0xbf, 0xff]), Buffer.from([0xd8, 1, 0xa0]), Buffer.from([0x9f, 0xff]),
    Buffer.from([0x5a, 0xff, 0xff, 0xff, 0xff]), Buffer.from([0xbb, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), Buffer.from([0xfa, 0, 0, 0, 0])])
    assert.equal(verifyReg(registration({ attestation })).ok, false);
});

test('registration envelope refuses key injection, mismatched IDs, padding, excessive bytes and accessors', () => {
  let reads = 0; const accessor = registration(); Object.defineProperty(accessor.response, 'attestationObject', { enumerable: true, get() { reads++; return ''; } });
  for (const mutate of [r => { r.publicKeySpki = other.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'); },
    r => { r.id = b64(Buffer.alloc(32, 9)); }, r => { r.rawId += '='; }, r => { r.response.attestationObject += '='; },
    r => { r.response.attestationObject = b64(Buffer.alloc(8193)); }, r => { r.response.clientDataJSON = b64(Buffer.alloc(4097)); },
    r => { r.response.approved = true; }, r => { r.type = 'password'; }]) {
    const value = registration(); mutate(value); assert.equal(verifyReg(value).ok, false);
  }
  assert.equal(verifyReg(accessor).ok, false); assert.equal(reads, 0);
});

test('proposal receipt key is explicitly provisional and descriptor equals existing offline/native format', () => {
  const reg = registration({ count: 17 }), proposed = buildMobileDevicePairingProposedEnrollmentV1(context, reg, options);
  assert.equal(proposed.ok, true); noAuthority(proposed); assert.equal(proposed.receiptKeyStatus, 'PROVISIONAL_NOT_TRUSTED');
  assert.equal(proposed.proposedEnrollment.lastSignCount, 0); assert.equal(proposed.registrationSignCount, 17);
  assert.equal(proposed.proposedEnrollment.receiptPublicKeySpki, proposed.proposedEnrollment.publicKeySpki);
  const result = mobileDevicePairingSetupDescriptorV1(context, reg, options), descriptor = JSON.stringify({
    schemaVersion: 'stephanos.mobile-installer-setup-descriptor.v1', repository: context.repository, sourceHead: context.sourceHead,
    sourceTree: context.sourceTree, machineHash: context.machineHash, operatorSid: context.operatorSid, enrollmentGeneration: 1,
    packageSha256: context.packageSha256, releaseProofSha256: context.releaseProofSha256,
    proposedEnrollmentSha256: hash(proposed.proposedEnrollmentJson).toString('hex'), nonce: context.nonce,
    issuedAtUtc: context.issuedAtUtc, expiresAtUtc: context.expiresAtUtc });
  assert.equal(result.setupDescriptor, descriptor); assert.equal(result.setupDescriptorSha256, hash(descriptor).toString('hex'));
  assert.equal(result.publicKey.challenge, hash('stephanos.mobile-install-enrollment-proof.v1\0' + descriptor).toString('base64url'));
  assert.deepEqual(result.publicKey.allowCredentials, [{ type: 'public-key', id: reg.id }]); noAuthority(result);
});

test('real GET proof verifies derived SPKI and setup domain without approving installation', () => {
  const reg = registration(), proof = setupAssertion({ reg }), result = verifySetup(proof, reg);
  assert.equal(result.ok, true); noAuthority(result); assert.equal(result.devicePossessionVerified, true); assert.equal(result.signCount, 0);
  assert.equal(verifySetup(setupAssertion({ reg, userHandle: null }), reg).ok, true);
  const backedUp = registration({ flags: 0x5d });
  assert.equal(verifySetup(setupAssertion({ reg: backedUp, flags: 0x1d }), backedUp).ok, true);
  const create = mobileDevicePairingCreateOptionsV1(context, options).publicKey.challenge;
  assert.equal(verifySetup(setupAssertion({ reg, client: { challenge: create } }), reg).ok, false);
});

test('backup eligibility stays bound across creation and signed proof while backup state may change', () => {
  const ordinary = registration(), eligible = registration({ flags: 0x4d });
  assert.equal(verifySetup(setupAssertion({ reg: ordinary, flags: 0x0d }), ordinary).ok, false);
  assert.equal(verifySetup(setupAssertion({ reg: eligible, flags: 5 }), eligible).ok, false);
  assert.equal(verifySetup(setupAssertion({ reg: eligible, flags: 0x1d }), eligible).ok, true);
  assert.equal(verifySetup(setupAssertion({ reg: eligible, flags: 0x0d }), eligible).ok, true);
});

for (const [registrationCount, assertionCount, okay] of [[0, 0, true], [0, 1, true], [7, 8, true], [7, 7, false], [7, 0, false], [7, 6, false], [0xffffffff, 0xffffffff, false]])
  test(`setup counter ${registrationCount}->${assertionCount} ${okay ? 'verifies' : 'holds'}`, () => {
    const reg = registration({ count: registrationCount }), proof = setupAssertion({ reg, count: assertionCount }), result = verifySetup(proof, reg);
    assert.equal(result.ok, okay); noAuthority(result);
  });

for (const [name, change] of Object.entries({
  'wrong signature key': { key: other.privateKey }, 'wrong origin': { client: { origin: 'https://evil.example.com' } },
  'wrong ceremony': { client: { type: 'webauthn.create' } }, 'cross origin': { client: { crossOrigin: true } },
  'wrong RP hash': { rp: 'evil.example.com' }, 'missing presence': { flags: 4 }, 'missing verification': { flags: 1 },
  'reserved flag': { flags: 7 }, 'attestation flag': { flags: 0x45 }, 'extension flag': { flags: 0x85 },
  'backup state without eligibility': { flags: 0x15 }, 'wrong user handle': { userHandle: b64(Buffer.alloc(32, 9)) },
})) test(`setup refuses ${name}`, () => { const result = verifySetup(setupAssertion(change)); assert.equal(result.ok, false); noAuthority(result); });

test('fresh valid signature cannot borrow changed source, target, nonce, registration or credential', () => {
  const reg = registration(), proof = setupAssertion({ reg });
  for (const patch of [{ sourceHead: 'c'.repeat(40) }, { machineHash: 'c'.repeat(64) }, { nonce: 'c'.repeat(64) }, { enrollmentGeneration: 2 }])
    assert.equal(verifySetup(proof, reg, { ...context, ...patch }).ok, false);
  const changedKey = registration({ cose: coseFor(other) }); assert.equal(verifySetup(proof, changedKey).ok, false);
  for (const mutate of [a => { a.rawId = b64(Buffer.alloc(32, 9)); }, a => { a.id = b64(Buffer.alloc(32, 9)); },
    a => { a.response.signature += '='; }, a => { a.response.authenticatorData += 'AA'; }, a => { a.response.approved = true; }]) {
    const changed = structuredClone(proof); mutate(changed); assert.equal(verifySetup(changed, reg).ok, false);
  }
  assert.equal(verifyMobileDevicePairingSetupAssertionV1(context, reg, proof, { nowMs: Date.parse(context.expiresAtUtc) }).ok, false);
});

test('result objects cannot mutate caller context/registration or manufacture a credential store', () => {
  const input = structuredClone(context), reg = registration(), before = JSON.stringify({ input, reg });
  const result = verifySetup(setupAssertion({ ctx: input, reg }), reg, input);
  assert.equal(JSON.stringify({ input, reg }), before); assert.equal(Object.isFrozen(input), false); assert.equal(Object.isFrozen(reg), false);
  assert.equal(Object.isFrozen(result.proposedEnrollment), true); assert.equal(Object.hasOwn(result, 'privateKey'), false);
  for (const field of ['enrollmentPath', 'taskName', 'installed', 'executionAuthorityGranted']) assert.notEqual(result[field], true);
  noAuthority(result);
});
