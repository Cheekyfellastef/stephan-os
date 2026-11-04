import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { MAILBOX_NATIVE_EVIDENCE_DOMAIN_V2 as domain, decodeMailboxNativeEvidenceV2 as decode,
  encodeMailboxNativeEvidenceV2 as encode, mailboxNativeEvidenceSignatureInputV2 as input } from './canonicalMailboxNativeEvidenceCodecV2.mjs';

// Ephemeral process-local crypto fixtures: no native identity, enrollment,
// producer, private-key file or runtime commissioning is established here.
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const sha = char => char.repeat(64);
const git = char => char.repeat(40);
function payload() {
  return { kind: 'CONTROL_TERMINAL', repository: 'Cheekyfellastef/stephan-os', deviceIdSha256: sha('a'),
    producerId: 'fixture-producer', producerPrincipalSha256: sha('b'), producerProfileSha256: sha('c'),
    requestId: 'fixture-request-1', transitionId: 'fixture-transition-1', phase: 'FROZEN', result: 'DONE',
    origin: { kind: 'ACTIVATION_PR_OWNER_CONTROL_V2', prNumber: 3268, commentId: 123,
      commentBodySha256: sha('d'), createdAtUtc: '2026-10-29T21:00:00.000Z' },
    source: { protectedMainHead: git('a'), protectedMainTreeSha: git('b'), installedHead: git('a'),
      installedTreeSha: git('b'), installedClosureSha256: sha('e'), sourceRole: 'PREPARATION' },
    activation: { prNumber: 3268, headSha: git('c'), baseSha: git('a'), treeSha: git('d'), mergeCommitSha: null },
    epoch: { predecessorIssue: 3149, successorIssue: 3258 },
    barrier: { highestCommandCommentId: 99, inventorySha256: sha('f'), commentCount: 2500 },
    guard: { generationId: 'fixture-generation', ownerInstanceId: 'fixture-owner', transactionSha256: sha('1') },
    drain: { acceptedCount: 0, inlinePublicationCount: 0, segmentedPublicationCount: 0, ordinaryReceiptDebtCount: 0,
      historyPendingBeforeCount: 0, historyPendingAfterCount: 0, orphanAcceptedCount: 0,
      outboxInventorySha256: sha('2'), actionsInventorySha256: sha('3'), actionsObservedAtUtc: '2026-10-29T21:00:00.000Z',
      actionPendingAggregateCount: 0, actionBlockingCount: 0 },
    originalTerminalSha256: sha('4'), proofArtifactSha256: sha('5'), observedAtUtc: '2026-10-29T21:00:00.000Z',
    expiresAtUtc: '2026-10-29T21:02:00.000Z' };
}
function envelope(value = payload()) {
  return { schemaVersion: domain, algorithm: 'Ed25519', enrollmentId: 'fixture-enrollment', keyId: 'fixture-key',
    payload: value, signatureBase64: sign(null, input(value), privateKey).toString('base64') };
}
const clone = value => JSON.parse(JSON.stringify(value));
function invalid(value, code) { assert.throws(() => encode(value), code ? { code } : undefined); }

test('exact canonical artifact round-trips without claiming trust', () => {
  const original = envelope(), bytes = encode(original), result = decode(bytes);
  assert.deepEqual(JSON.parse(JSON.stringify(result.envelope)), original);
  assert.equal(result.artifactSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.encodingValid, true);
  assert.equal(result.signatureVerified, false);
  assert.equal(result.nativeAuthorityVerified, false);
  assert(Object.isFrozen(result.envelope.payload.drain));
  assert.deepEqual(encode(result.envelope), bytes);
});
test('signature input uses the exact domain followed by one NUL', () => {
  const value = payload(), bytes = input(value), prefix = Buffer.from(domain, 'ascii');
  assert.deepEqual(bytes.subarray(0, prefix.length), prefix);
  assert.equal(bytes[prefix.length], 0);
  assert.equal(bytes[prefix.length + 1], '{'.charCodeAt(0));
  const signature = sign(null, bytes, privateKey);
  assert(verify(null, bytes, publicKey, signature));
  assert.equal(verify(null, Buffer.concat([prefix, Buffer.from('\\0'), bytes.subarray(prefix.length + 1)]), publicKey, signature), false);
  assert.equal(verify(null, Buffer.concat([Buffer.from('other-domain\0'), bytes.subarray(prefix.length + 1)]), publicKey, signature), false);
  const changed = clone(value); changed.guard.transactionSha256 = sha('9');
  assert.equal(verify(null, input(changed), publicKey, signature), false);
});
test('input order cannot alter canonical bytes', () => {
  const original = envelope();
  const reverse = value => value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverse(child)])) : value;
  assert.deepEqual(encode(reverse(original)), encode(original));
});
test('duplicate decoded keys are rejected rather than lost by JSON.parse', () => {
  const bytes = encode(envelope()).toString('utf8');
  for (const duplicate of ['"algorithm":"Ed25519",', '"algori\\u0074hm":"Ed25519",']) {
    assert.throws(() => decode(Buffer.from('{' + duplicate + bytes.slice(1))), { code: 'MAILBOX_NATIVE_EVIDENCE_DUPLICATE_KEY' });
  }
  const duplicateNested = bytes.replace('"acceptedCount":0', '"acceptedCount":0,"acceptedCount":1');
  assert.throws(() => decode(Buffer.from(duplicateNested)), { code: 'MAILBOX_NATIVE_EVIDENCE_DUPLICATE_KEY' });
});
for (const [name, change] of [
  ['unknown envelope field', v => { v.verified = true; }],
  ['missing field', v => { delete v.payload.origin.commentId; }],
  ['unknown nested field', v => { v.payload.guard.nativeZero = true; }],
  ['self-referential artifact digest', v => { v.payload.artifactSha256 = sha('1'); }],
  ['V1 schema substitution', v => { v.schemaVersion = 'stephanos.canonical-mailbox-rotation.v1'; }],
  ['capacity signature domain', v => { v.schemaVersion = 'stephanos.native-capacity.v1'; }],
  ['wrong algorithm', v => { v.algorithm = 'HS256'; }],
  ['wrong repository', v => { v.payload.repository = 'other/stephan-os'; }],
  ['wrong origin kind', v => { v.payload.origin.kind = 'PREDECESSOR_COMMAND'; }],
  ['retired epoch order', v => { v.payload.epoch.successorIssue = 2808; }],
  ['unknown source role', v => { v.payload.source.sourceRole = 'CURRENT'; }],
  ['unsafe integer', v => { v.payload.barrier.commentCount = Number.MAX_SAFE_INTEGER + 1; }],
  ['fractional count', v => { v.payload.drain.acceptedCount = 0.5; }],
  ['negative count', v => { v.payload.drain.ordinaryReceiptDebtCount = -1; }],
  ['negative zero', v => { v.payload.drain.acceptedCount = -0; }],
  ['coerced count', v => { v.payload.drain.acceptedCount = '0'; }],
  ['nonfinite number', v => { v.payload.barrier.commentCount = Infinity; }],
  ['invalid calendar date', v => { v.payload.observedAtUtc = '2026-02-30T21:00:00.000Z'; }],
  ['noncanonical timestamp', v => { v.payload.observedAtUtc = '2026-10-29T21:00:00Z'; }],
  ['uppercase digest', v => { v.payload.deviceIdSha256 = sha('A'); }],
  ['raw path instead of ID', v => { v.payload.producerId = 'C:/secret/key.pem'; }],
  ['raw URL instead of ID', v => { v.keyId = 'https://example.test/key'; }],
  ['oversized ID', v => { v.payload.requestId = 'x'.repeat(129); }],
  ['unpaired surrogate', v => { v.payload.result = '\ud800'; }],
  ['array substitution', v => { v.payload.drain = []; }],
  ['null substitution', v => { v.payload.origin = null; }],
  ['unsigned envelope', v => { v.signatureBase64 = ''; }],
  ['noncanonical base64', v => { v.signatureBase64 = v.signatureBase64.slice(0, -2); }],
  ['oversized signature', v => { v.signatureBase64 = Buffer.alloc(65).toString('base64'); }],
]) test(name, () => { const value = envelope(); change(value); invalid(value); });

test('no getter, proxy, inherited data, symbol or toJSON is invoked', () => {
  let touched = 0;
  const getter = envelope(); Object.defineProperty(getter, 'payload', { enumerable: true, get() { touched++; throw Error(); } });
  invalid(getter);
  const proxy = new Proxy(envelope(), { ownKeys() { touched++; throw Error(); } }); invalid(proxy);
  const nested = envelope(); nested.payload.guard = new Proxy(nested.payload.guard, { getPrototypeOf() { touched++; throw Error(); } }); invalid(nested);
  const inherited = Object.assign(Object.create({ trusted: true }), envelope()); invalid(inherited);
  const symbol = envelope(); symbol[Symbol('hidden')] = true; invalid(symbol);
  const hidden = envelope(); Object.defineProperty(hidden, 'hidden', { value: true, enumerable: false }); invalid(hidden);
  const json = envelope(); json.toJSON = () => { touched++; return envelope(); }; invalid(json);
  assert.equal(touched, 0);
});
test('noncanonical byte spellings are rejected', () => {
  const value = envelope(), text = encode(value).toString('utf8');
  const variants = [JSON.stringify(value), JSON.stringify(value, null, 2), text + '\n', ' ' + text,
    text.replace('"acceptedCount":0', '"acceptedCount":0.0'), text.replace('"acceptedCount":0', '"acceptedCount":-0'),
    text.replace('"commentCount":2500', '"commentCount":25e2'), text.replace('"algorithm"', '"algori\\u0074hm"'),
    '\ufeff' + text, text + '{}', text.replace('"acceptedCount":0', '"acceptedCount":NaN'),
    text.replace('"acceptedCount":0', '"acceptedCount":9007199254740993'),
    text.replace('"acceptedCount":0', '"acceptedCount":00')];
  for (const variant of variants) assert.throws(() => decode(Buffer.from(variant)));
});
test('malformed/bounded input cannot turn into evidence', () => {
  for (const value of [Buffer.alloc(0), Buffer.alloc(16385), Buffer.from([0xff]), Buffer.from('{'),
    Buffer.from('{"x":['), Buffer.from('{"x":"bad\\q"}'), Buffer.from('{"x":"unterminated}'),
    Buffer.from('{"x":' + '{"x":'.repeat(13) + 'null' + '}'.repeat(14))]) assert.throws(() => decode(value));
  assert.throws(() => decode('{}'), { code: 'MAILBOX_NATIVE_EVIDENCE_BYTES_REQUIRED' });
});
test('byte input cannot invoke caller getters or race through shared backing', () => {
  let touched = 0;
  const bytes = encode(envelope());
  Object.defineProperty(bytes, 'length', { get() { touched++; return 1; } });
  assert.throws(() => decode(bytes), { code: 'MAILBOX_NATIVE_EVIDENCE_BYTES_REQUIRED' });
  assert.equal(touched, 0);
  assert.throws(() => decode(new Proxy(encode(envelope()), {})), { code: 'MAILBOX_NATIVE_EVIDENCE_BYTES_REQUIRED' });
  assert.throws(() => decode(Object.create(Buffer.prototype)), { code: 'MAILBOX_NATIVE_EVIDENCE_BYTES_REQUIRED' });
  const shared = Buffer.from(new SharedArrayBuffer(128));
  assert.throws(() => decode(shared), { code: 'MAILBOX_NATIVE_EVIDENCE_BYTES_REQUIRED' });
});
test('valid encoding still permits untrusted signatures and stale/debt claims only as data', () => {
  const value = envelope(); value.signatureBase64 = Buffer.alloc(64).toString('base64');
  value.payload.drain.acceptedCount = 1;
  value.payload.expiresAtUtc = '2026-10-29T21:00:00.000Z';
  const result = decode(encode(value));
  assert.equal(result.signatureVerified, false);
  assert.equal(result.nativeAuthorityVerified, false);
  assert.equal(result.envelope.payload.drain.acceptedCount, 1);
});
