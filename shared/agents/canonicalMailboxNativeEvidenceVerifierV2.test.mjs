import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { encodeMailboxNativeEvidenceV2 as encode, mailboxNativeEvidenceSignatureInputV2 as input,
  MAILBOX_NATIVE_EVIDENCE_DOMAIN_V2 as domain } from './canonicalMailboxNativeEvidenceCodecV2.mjs';
import { verifyMailboxNativeEvidenceOriginV2 as productionVerify } from './canonicalMailboxNativeEvidenceVerifierV2.mjs';
import { MAILBOX_NATIVE_EVIDENCE_ENROLLMENTS_V2, MAILBOX_NATIVE_EVIDENCE_PUBLIC_ARTIFACTS_V2 } from './canonicalMailboxNativeEvidenceEnrollmentV2.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const sha = char => char.repeat(64), git = char => char.repeat(40);
const iso = milliseconds => new Date(milliseconds).toISOString();
function fixture() {
  const now = Date.now(), { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const record = { schemaVersion: 'stephanos.canonical-mailbox-native-enrollment.v2', enrollmentId: 'isolated-fixture-enrollment',
    repository: 'Cheekyfellastef/stephan-os', deviceIdSha256: sha('a'), producerId: 'isolated-fixture-producer',
    producerPrincipalSha256: sha('b'), producerProfileSha256: sha('c'), keyId: 'isolated-fixture-key', algorithm: 'Ed25519',
    verificationKeySpkiSha256: hash(publicKey.export({ type: 'spki', format: 'der' })), verificationKeyArtifactSha256: hash(pem),
    signatureDomain: domain, allowedEvidenceKinds: ['CONTROL_TERMINAL', 'DRAIN_OBSERVATION'],
    commissionedAtUtc: iso(now - 86400000), notBeforeUtc: iso(now - 86400000), revokedAtUtc: null,
    commissioningProofSha256: sha('d'), independentReviewArtifactSha256: sha('e'),
    operatorApprovalRef: 'https://github.com/Cheekyfellastef/stephan-os/issues/2315#issuecomment-123' };
  const payload = { kind: 'DRAIN_OBSERVATION', repository: record.repository, deviceIdSha256: record.deviceIdSha256,
    producerId: record.producerId, producerPrincipalSha256: record.producerPrincipalSha256, producerProfileSha256: record.producerProfileSha256,
    requestId: 'isolated-fixture-request', transitionId: 'isolated-fixture-transition', phase: 'FROZEN', result: 'DONE',
    origin: { kind: 'ACTIVATION_PR_OWNER_CONTROL_V2', prNumber: 3268, commentId: 123, commentBodySha256: sha('f'), createdAtUtc: iso(now - 2000) },
    source: { protectedMainHead: git('a'), protectedMainTreeSha: git('b'), installedHead: git('a'), installedTreeSha: git('b'),
      installedClosureSha256: sha('1'), sourceRole: 'PREPARATION' },
    activation: { prNumber: 3268, headSha: git('c'), baseSha: git('a'), treeSha: git('d'), mergeCommitSha: null },
    epoch: { predecessorIssue: 3149, successorIssue: 3258 }, barrier: { highestCommandCommentId: 1, inventorySha256: sha('2'), commentCount: 2500 },
    guard: { generationId: 'isolated-fixture-generation', ownerInstanceId: 'isolated-fixture-owner', transactionSha256: sha('3') },
    drain: { acceptedCount: 0, inlinePublicationCount: 0, segmentedPublicationCount: 0, ordinaryReceiptDebtCount: 0,
      historyPendingBeforeCount: 0, historyPendingAfterCount: 0, orphanAcceptedCount: 0, outboxInventorySha256: sha('4'),
      actionsInventorySha256: sha('5'), actionsObservedAtUtc: iso(now - 1000), actionPendingAggregateCount: 0, actionBlockingCount: 0 },
    originalTerminalSha256: sha('6'), proofArtifactSha256: sha('7'), observedAtUtc: iso(now - 1000), expiresAtUtc: iso(now + 119000) };
  return { now, record, records: [record], artifacts: { [record.keyId]: pem }, payload, privateKey };
}
function bytes(fixture, signingKey = fixture.privateKey) {
  return encode({ schemaVersion: domain, algorithm: 'Ed25519', enrollmentId: fixture.record.enrollmentId,
    keyId: fixture.record.keyId, payload: fixture.payload,
    signatureBase64: sign(null, input(fixture.payload), signingKey).toString('base64') });
}

// Positive crypto tests load the EXACT verifier implementation into an isolated
// data-URL module whose *source import* is an in-memory public fixture registry.
// Production has no injection parameter or enrollment write path. No private
// key is published, persisted, passed to that registry or installed on a host.
const originalSource = readFileSync(new URL('./canonicalMailboxNativeEvidenceVerifierV2.mjs', import.meta.url), 'utf8');
let fixtureNumber = 0;
async function isolatedVerify(fixture) {
  const registry = 'export const MAILBOX_NATIVE_EVIDENCE_ENROLLMENTS_V2 = ' + JSON.stringify(fixture.records)
    + '; export const MAILBOX_NATIVE_EVIDENCE_PUBLIC_ARTIFACTS_V2 = ' + JSON.stringify(fixture.artifacts) + ';';
  const registryUrl = 'data:text/javascript;base64,' + Buffer.from(registry).toString('base64');
  const source = originalSource
    .replace("'./canonicalMailboxNativeEvidenceEnrollmentV2.mjs'", JSON.stringify(registryUrl))
    .replace("'./canonicalMailboxNativeEvidenceCodecV2.mjs'", JSON.stringify(new URL('./canonicalMailboxNativeEvidenceCodecV2.mjs', import.meta.url).href));
  assert.notEqual(source, originalSource);
  const loaded = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64') + '#fixture-' + (++fixtureNumber));
  return loaded.verifyMailboxNativeEvidenceOriginV2;
}
function noAuthority(result) {
  for (const field of ['nativeAuthorityVerified', 'freezeCertified', 'mergeAuthorized', 'sourceSyncAuthorized']) assert.equal(result[field], false, field);
}
test('production empty enrollment fails closed even with a valid fixture signature and caller overrides', () => {
  assert.deepEqual(MAILBOX_NATIVE_EVIDENCE_ENROLLMENTS_V2, []);
  assert.deepEqual(MAILBOX_NATIVE_EVIDENCE_PUBLIC_ARTIFACTS_V2, {});
  assert(Object.isFrozen(MAILBOX_NATIVE_EVIDENCE_ENROLLMENTS_V2));
  const f = fixture();
  const result = productionVerify(bytes(f), { enrollment: f.record, publicKey: f.artifacts[f.record.keyId], now: f.now });
  assert.equal(result.blocker, 'NATIVE_ROTATION_PRODUCER_UNQUALIFIED');
  assert.equal(result.signatureVerified, false); noAuthority(result);
});
test('isolated pinned signature verifies origin only, never FROZEN/admission', async () => {
  const f = fixture(), verify = await isolatedVerify(f), result = verify(bytes(f));
  assert.equal(result.ok, true); assert.equal(result.signatureVerified, true); assert.equal(result.producerEnrollmentVerified, true);
  assert.equal(result.blocker, 'ORIGINAL_GUARDED_TRANSACTION_PROOF_REQUIRED'); noAuthority(result);
  assert.equal(result.artifactSha256, hash(bytes(f)));
});
for (const [name, change, expected] of [
  ['no enrollment', f => { f.records = []; }, 'NATIVE_ROTATION_PRODUCER_UNQUALIFIED'],
  ['duplicate enrollment', f => { f.records.push({ ...f.record }); }, 'NATIVE_ROTATION_PRODUCER_UNQUALIFIED'],
  ['unknown enrollment field', f => { f.record.trusted = true; }, 'NATIVE_ROTATION_ENROLLMENT_INVALID'],
  ['wrong enrollment domain', f => { f.record.signatureDomain = 'capacity'; }, 'NATIVE_ROTATION_ENROLLMENT_INVALID'],
  ['wrong enrollment schema', f => { f.record.schemaVersion = 'v1'; }, 'NATIVE_ROTATION_ENROLLMENT_INVALID'],
  ['wrong evidence kind grant', f => { f.record.allowedEvidenceKinds.push('SIGN_ANYTHING'); }, 'NATIVE_ROTATION_ENROLLMENT_INVALID'],
  ['missing review proof', f => { f.record.independentReviewArtifactSha256 = ''; }, 'NATIVE_ROTATION_ENROLLMENT_INVALID'],
  ['arbitrary approval URL', f => { f.record.operatorApprovalRef = 'https://example.test/approved'; }, 'NATIVE_ROTATION_ENROLLMENT_INVALID'],
  ['wrong producer device', f => { f.payload.deviceIdSha256 = sha('9'); }, 'NATIVE_ROTATION_PRODUCER_IDENTITY_MISMATCH'],
  ['wrong producer principal', f => { f.payload.producerPrincipalSha256 = sha('9'); }, 'NATIVE_ROTATION_PRODUCER_IDENTITY_MISMATCH'],
  ['wrong producer profile', f => { f.payload.producerProfileSha256 = sha('9'); }, 'NATIVE_ROTATION_PRODUCER_IDENTITY_MISMATCH'],
  ['wrong producer ID', f => { f.payload.producerId = 'other-producer'; }, 'NATIVE_ROTATION_PRODUCER_IDENTITY_MISMATCH'],
  ['revoked enrollment', f => { f.record.revokedAtUtc = iso(f.now - 100); }, 'NATIVE_ROTATION_ENROLLMENT_NOT_CURRENT'],
  ['future revocation still holds', f => { f.record.revokedAtUtc = iso(f.now + 100000); }, 'NATIVE_ROTATION_ENROLLMENT_NOT_CURRENT'],
  ['future commissioning', f => { f.record.commissionedAtUtc = iso(f.now + 100000); }, 'NATIVE_ROTATION_ENROLLMENT_NOT_CURRENT'],
  ['not yet valid key', f => { f.record.notBeforeUtc = iso(f.now + 100000); }, 'NATIVE_ROTATION_ENROLLMENT_NOT_CURRENT'],
  ['receipt predates commissioning', f => { f.record.commissionedAtUtc = iso(f.now - 500); }, 'NATIVE_ROTATION_ENROLLMENT_NOT_CURRENT'],
  ['future observation', f => { f.payload.observedAtUtc = iso(f.now + 100000); f.payload.expiresAtUtc = iso(f.now + 120000); }, 'NATIVE_ROTATION_OBSERVATION_NOT_FRESH'],
  ['expired receipt', f => { f.payload.expiresAtUtc = iso(f.now - 100); }, 'NATIVE_ROTATION_OBSERVATION_NOT_FRESH'],
  ['zero TTL', f => { f.payload.expiresAtUtc = f.payload.observedAtUtc; }, 'NATIVE_ROTATION_OBSERVATION_NOT_FRESH'],
  ['excess TTL', f => { f.payload.expiresAtUtc = iso(f.now + 119001); }, 'NATIVE_ROTATION_OBSERVATION_NOT_FRESH'],
  ['stale observation', f => { f.payload.observedAtUtc = iso(f.now - 120001); }, 'NATIVE_ROTATION_OBSERVATION_NOT_FRESH'],
  ['future Actions observation', f => { f.payload.drain.actionsObservedAtUtc = iso(f.now + 100000); }, 'NATIVE_ROTATION_OBSERVATION_NOT_FRESH'],
  ['stale Actions observation', f => { f.payload.drain.actionsObservedAtUtc = iso(f.now - 120001); }, 'NATIVE_ROTATION_OBSERVATION_NOT_FRESH'],
  ['missing key artifact', f => { f.artifacts = {}; }, 'NATIVE_ROTATION_PUBLIC_ARTIFACT_MISSING'],
  ['changed artifact bytes', f => { f.artifacts[f.record.keyId] += '\n'; }, 'NATIVE_ROTATION_PUBLIC_ARTIFACT_PIN_MISMATCH'],
  ['wrong SPKI pin', f => { f.record.verificationKeySpkiSha256 = sha('9'); }, 'NATIVE_ROTATION_PUBLIC_KEY_PIN_MISMATCH'],
]) test(name, async () => {
  const f = fixture(); change(f);
  const verify = await isolatedVerify(f), result = verify(bytes(f));
  assert.equal(result.ok, false); assert.equal(result.blocker, expected); noAuthority(result);
});
test('a different private key cannot attest an enrolled producer', async () => {
  const f = fixture(), verify = await isolatedVerify(f), other = generateKeyPairSync('ed25519');
  const result = verify(bytes(f, other.privateKey));
  assert.equal(result.blocker, 'NATIVE_ROTATION_SIGNATURE_INVALID'); noAuthority(result);
});
test('tampering signed bytes is distinct from signing a false claim', async () => {
  const f = fixture(), verify = await isolatedVerify(f);
  const tampered = Buffer.from(bytes(f).toString('utf8').replace('"acceptedCount":0', '"acceptedCount":1'));
  assert.equal(verify(tampered).blocker, 'NATIVE_ROTATION_SIGNATURE_INVALID');
  f.payload.drain.acceptedCount = 1;
  const signedClaim = verify(bytes(f));
  assert.equal(signedClaim.signatureVerified, true); noAuthority(signedClaim);
  assert.equal(signedClaim.blocker, 'ORIGINAL_GUARDED_TRANSACTION_PROOF_REQUIRED');
});
