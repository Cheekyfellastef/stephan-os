import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MAILBOX_ROTATION_OWNER_CONTROL_SCHEMA_V2 as schema,
  encodeMailboxRotationOwnerControlV2 as encode, decodeMailboxRotationOwnerControlV2 as decode } from './canonicalMailboxNativeEvidenceCodecV2.mjs';
import { formatMailboxRotationOwnerControlV2 as format,
  parseMailboxRotationOwnerControlCandidateV2 as parse } from './canonicalMailboxRotationOwnerControlV2.mjs';
const git = char => char.repeat(40), sha = char => char.repeat(64);
const clone = value => JSON.parse(JSON.stringify(value));
function consent() {
  return { schemaVersion: schema, repository: 'Cheekyfellastef/stephan-os', operatorApproval: 'operator-approved',
    transitionId: 'fixture-transition-1', rotationAction: 'FREEZE', state: 'PRE_MERGE',
    source: { protectedMainHead: git('a'), protectedMainTreeSha: git('b'), installedHead: git('a'), installedTreeSha: git('b'),
      installedClosureSha256: sha('c'), sourceRole: 'PREPARATION' },
    activation: { prNumber: 3268, headSha: git('d'), baseSha: git('a'), treeSha: git('e'), mergeCommitSha: null, mergeTreeSha: null },
    epoch: { predecessorIssue: 3149, successorIssue: 3258 },
    barrier: { highestCommandCommentId: 100, inventorySha256: sha('f'), commentCount: 2500 },
    preparation: { headSha: git('a'), treeSha: git('b'), closureSha256: sha('c'), originalFrozenArtifactSha256: null },
    expiresAtUtc: new Date(Date.now() + 300000).toISOString(), probeRequestIds: [] };
}
function comment(value = consent()) {
  const created = new Date(Date.now() - 1000).toISOString();
  return { id: 12345, user: { login: 'Cheekyfellastef', id: 267490109, type: 'User' }, author_association: 'OWNER',
    created_at: created, updated_at: created, body: format(value),
    issue_url: 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/3268',
    html_url: 'https://github.com/Cheekyfellastef/stephan-os/pull/3268#issuecomment-12345' };
}
function noAuthority(result) {
  for (const key of ['ownerConsentAuthenticated', 'nativeExecutionAuthorized', 'freezeCertified',
    'protectedMergeAuthorized', 'sourceSyncAuthorized', 'epochAdoptionAuthorized']) assert.equal(result[key], false, key);
}
test('closed canonical owner-control document round-trips and preserves ordered probes', () => {
  const value = consent(); value.rotationAction = 'VERIFY'; value.probeRequestIds = ['fixture-probe-deployment', 'fixture-probe-capability'];
  const decoded = decode(encode(value));
  assert.deepEqual(clone(decoded), value);
  assert(Object.isFrozen(decoded.probeRequestIds));
  const reversed = clone(value); reversed.probeRequestIds.reverse();
  assert.notDeepEqual(encode(reversed), encode(value));
});
test('owner metadata produces a stable candidate, never a native admission token', () => {
  const original = comment(), first = parse(original), retry = parse(clone(original));
  assert.equal(first.ok, true); assert.equal(first.candidate, true);
  assert.match(first.requestId, /^rotation-v2-[a-f0-9]{64}$/);
  assert.equal(first.requestId, retry.requestId);
  assert.equal(first.origin.commentId, original.id);
  assert.equal(first.origin.kind, 'ACTIVATION_PR_OWNER_CONTROL_V2');
  assert.equal(first.origin.commentBodySha256, createHash('sha256').update(original.body).digest('hex'));
  assert.equal(first.blocker, 'ORIGINAL_NATIVE_ADMISSION_REQUIRED');
  assert(Object.isFrozen(first.origin)); assert(Object.isFrozen(first.consent.source)); noAuthority(first);
});
test('stable identity binds exact comment body and real origin, not caller request IDs', () => {
  const original = comment(), baseline = parse(original);
  const changed = clone(original), changedConsent = consent(); changedConsent.transitionId = 'fixture-other-transition';
  changed.body = format(changedConsent);
  assert.notEqual(parse(changed).requestId, baseline.requestId);
  const otherOrigin = clone(original); otherOrigin.id++;
  otherOrigin.html_url = otherOrigin.html_url.replace('12345', '12346');
  assert.notEqual(parse(otherOrigin).requestId, baseline.requestId);
  const injected = consent(); injected.requestId = baseline.requestId;
  assert.throws(() => format(injected));
});
test('GitHub second-resolution timestamps normalize only after exact unedited matching', () => {
  const value = comment(); value.created_at = value.created_at.replace(/\.\d{3}Z$/, 'Z'); value.updated_at = value.created_at;
  const parsed = parse(value); assert.equal(parsed.ok, true); assert.match(parsed.origin.createdAtUtc, /\.000Z$/);
  value.updated_at = value.updated_at.replace('Z', '.000Z');
  assert.equal(parse(value).blocker, 'OWNER_CONTROL_EDITED_COMMENT');
});
for (const [name, change] of [
  ['forged owner numeric identity', v => { v.user.id = 1; }],
  ['foreign owner login', v => { v.user.login = 'other'; }],
  ['bot owner', v => { v.user.type = 'Bot'; }],
  ['nonowner association', v => { v.author_association = 'CONTRIBUTOR'; }],
  ['edited comment', v => { v.updated_at = new Date(Date.now()).toISOString(); }],
  ['future comment', v => { v.created_at = v.updated_at = new Date(Date.now() + 60000).toISOString(); }],
  ['stale comment', v => { v.created_at = v.updated_at = new Date(Date.now() - 900001).toISOString(); }],
  ['invalid calendar timestamp', v => { v.created_at = v.updated_at = '2026-02-30T21:00:00Z'; }],
  ['missing metadata', v => { delete v.created_at; }],
  ['unsafe comment identity', v => { v.id = Number.MAX_SAFE_INTEGER + 1; }],
  ['string comment identity', v => { v.id = '12345'; }],
  ['wrong activation issue URL', v => { v.issue_url = v.issue_url.replace('3268', '3149'); }],
  ['wrong repository URL', v => { v.html_url = v.html_url.replace('stephan-os', 'another'); }],
  ['ordinary issue origin instead of activation PR', v => { v.html_url = v.html_url.replace('/pull/', '/issues/'); }],
  ['substituted comment locator', v => { v.html_url = v.html_url.replace('12345', '12346'); }],
  ['extra wrapper content', v => { v.body += 'approved'; }],
  ['leading wrapper content', v => { v.body = 'approved\n' + v.body; }],
  ['CRLF wrapper rewrite', v => { v.body = v.body.replaceAll('\n', '\r\n'); }],
  ['oversized body', v => { v.body += 'x'.repeat(16385); }],
  ['duplicate decoded schema key', v => { v.body = v.body.replace('{', '{"schemaVersion":"' + schema + '",'); }],
]) test(name, () => { const value = comment(); change(value); const result = parse(value); assert.equal(result.ok, false); noAuthority(result); });

for (const [name, change] of [
  ['unknown schema', v => { v.schemaVersion = 'stephanos.battle-bridge-github-command.v1'; }],
  ['ordinary command field', v => { v.operation = 'BUILD_NEXT_ELIGIBLE_GOAL'; }],
  ['unknown nested source field', v => { v.source.current = true; }],
  ['unknown phase', v => { v.rotationAction = 'MERGE'; }],
  ['unknown source state', v => { v.state = 'CURRENT'; }],
  ['unsafe barrier', v => { v.barrier.highestCommandCommentId = -1; }],
  ['wrong epoch order', v => { v.epoch.successorIssue = 2808; }],
  ['unpaired merge identities', v => { v.activation.mergeCommitSha = git('1'); }],
  ['unbounded preparation proof', v => { v.preparation.originalFrozenArtifactSha256 = 'https://example.test/receipt'; }],
  ['non-VERIFY probes', v => { v.probeRequestIds = ['probe-one', 'probe-two']; }],
  ['missing VERIFY probes', v => { v.rotationAction = 'VERIFY'; }],
  ['duplicate VERIFY probes', v => { v.rotationAction = 'VERIFY'; v.probeRequestIds = ['probe-one', 'probe-one']; }],
  ['oversized probe list', v => { v.rotationAction = 'VERIFY'; v.probeRequestIds = Array(17).fill('probe-one'); }],
  ['fractional count', v => { v.barrier.commentCount = 1.5; }],
]) test(name, () => { const value = consent(); change(value); assert.throws(() => encode(value)); });

test('expired and unbounded consent TTL never produce a fresh candidate', () => {
  for (const expiry of [Date.now() - 1, Date.now() + 900001]) {
    const value = consent(); value.expiresAtUtc = new Date(expiry).toISOString();
    const result = parse(comment(value)); assert.equal(result.ok, false); noAuthority(result);
  }
});
test('metadata and probe accessors/proxies cannot execute during parsing/encoding', () => {
  let called = 0;
  const value = comment(); Object.defineProperty(value, 'body', { get() { called++; return ''; } });
  assert.equal(parse(value).ok, false);
  assert.equal(parse(new Proxy(comment(), { get() { called++; throw Error(); } })).ok, false);
  const nested = comment(); nested.user = new Proxy(nested.user, { getOwnPropertyDescriptor() { called++; throw Error(); } });
  assert.equal(parse(nested).ok, false);
  const probes = consent(); probes.rotationAction = 'VERIFY'; probes.probeRequestIds = ['probe-one', 'probe-two'];
  Object.defineProperty(probes.probeRequestIds, '0', { enumerable: true, get() { called++; return 'probe-one'; } });
  assert.throws(() => encode(probes));
  const sparse = consent(); sparse.rotationAction = 'VERIFY'; sparse.probeRequestIds = Array(2); assert.throws(() => encode(sparse));
  const symbol = consent(); symbol.probeRequestIds[Symbol('untrusted')] = true; assert.throws(() => encode(symbol));
  assert.equal(called, 0);
});
test('parsed claims cannot prove phase, source generation, guard or API authenticity', () => {
  const value = consent(); value.rotationAction = 'VERIFY'; value.state = 'PRE_MERGE'; value.probeRequestIds = ['probe-one', 'probe-two'];
  // Semantically impossible execution remains bounded data. The real 5x5
  // canonical phase/source verifier must reject it before any native effect.
  const result = parse(comment(value)); assert.equal(result.candidate, true); noAuthority(result);
  assert.equal(Object.hasOwn(result, 'selectedCommentId'), false);
  assert.equal(Object.hasOwn(result.origin, 'barrierCommentId'), false);
});
