import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MAILBOX_ROTATION_OWNER_CONTROL_SCHEMA_V2 as schema,
  encodeMailboxRotationOwnerControlV2 as encode, decodeMailboxRotationOwnerControlV2 as decode } from './canonicalMailboxNativeEvidenceCodecV2.mjs';
import { formatMailboxRotationOwnerControlV2 as format,
  parseMailboxRotationOwnerControlCandidateV2 as parse,
  bindMailboxRotationOwnerControlCandidateV2 as bind,
  MAILBOX_ROTATION_OWNER_OBSERVATION_SCHEMA_V2 as observationSchema } from './canonicalMailboxRotationOwnerControlV2.mjs';
import { ROTATION_V2_STATES, ROTATION_V2_OPERATIONS, ROTATION_V2_STRUCTURAL_MATRIX } from './canonicalMailboxSaturatedPhaseModelV2.mjs';
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

function observation(value = consent()) {
  return { schemaVersion: observationSchema, repository: value.repository,
    transitionId: value.transitionId, state: value.state, source: clone(value.source),
    activation: { ...value.activation, state: value.activation.mergeCommitSha ? 'MERGED' : 'OPEN' },
    epoch: { ...value.epoch, activeIssue: value.source.sourceRole === 'ADOPTED' ? 3258 : 3149,
      retiredPredecessor: value.source.sourceRole === 'ADOPTED' },
    barrier: clone(value.barrier), preparation: clone(value.preparation),
    observedAtUtc: new Date(Date.now() - 5).toISOString() };
}
test('one current phase binding retains the original stable request identity and grants no authority', () => {
  const value = consent(), input = comment(value), actual = observation(value), result = bind(input, actual);
  assert.equal(result.ok, true); assert.equal(result.observationFieldsMatch, true);
  assert.equal(result.requestId, parse(input).requestId);
  assert.equal(result.structuralMode, 'PRE_MERGE_EFFECT_CANDIDATE');
  noAuthority(result);
  for (const key of ['apiTransportAuthenticated', 'nativeProducerQualified', 'originalGuardHeld']) assert.equal(result[key], false);
  actual.source.installedHead = git('f');
  assert.equal(result.consent.source.installedHead, git('a'));
});
for (const [section, keys] of Object.entries({
  source: ['protectedMainHead', 'protectedMainTreeSha', 'installedHead', 'installedTreeSha', 'installedClosureSha256', 'sourceRole'],
  activation: ['prNumber', 'headSha', 'baseSha', 'treeSha', 'mergeCommitSha', 'mergeTreeSha'],
  epoch: ['predecessorIssue', 'successorIssue'],
  barrier: ['highestCommandCommentId', 'inventorySha256', 'commentCount'],
  preparation: ['headSha', 'treeSha', 'closureSha256', 'originalFrozenArtifactSha256'],
})) for (const key of keys) test(`fresh owner consent cannot substitute observed ${section}.${key}`, () => {
  const value = consent(), actual = observation(value), previous = actual[section][key];
  actual[section][key] = typeof previous === 'number' ? previous + 1 : previous === null ? sha('1') : previous + 'x';
  const result = bind(comment(value), actual);
  assert.equal(result.blocker, 'OWNER_CONTROL_' + section.toUpperCase() + '_BINDING_MISMATCH'); noAuthority(result);
});
for (const [name, change, blocker] of [
  ['future observation', v => { v.observedAtUtc = new Date(Date.now() + 60000).toISOString(); }, 'OWNER_CONTROL_OBSERVATION_NOT_FRESH'],
  ['stale observation', v => { v.observedAtUtc = new Date(Date.now() - 120001).toISOString(); }, 'OWNER_CONTROL_OBSERVATION_NOT_FRESH'],
  ['wrong schema', v => { v.schemaVersion += '-other'; }, 'OWNER_CONTROL_TRANSITION_IDENTITY_MISMATCH'],
  ['different repository', v => { v.repository = 'other/repo'; }, 'OWNER_CONTROL_TRANSITION_IDENTITY_MISMATCH'],
  ['different transition', v => { v.transitionId += '-other'; }, 'OWNER_CONTROL_TRANSITION_IDENTITY_MISMATCH'],
  ['different claimed phase', v => { v.state = 'ADOPTED_NOT_VERIFIED'; }, 'OWNER_CONTROL_TRANSITION_IDENTITY_MISMATCH'],
  ['retired predecessor before merge', v => { v.epoch.retiredPredecessor = true; }, 'SOURCE_STATE_UNPROVEN'],
  ['inactive predecessor', v => { v.epoch.activeIssue = 3258; }, 'SOURCE_STATE_UNPROVEN'],
  ['coerced retirement', v => { v.epoch.retiredPredecessor = 'false'; }, 'OWNER_CONTROL_OBSERVATION_INVALID'],
  ['merged state without merge identity', v => { v.activation.state = 'MERGED'; }, 'SOURCE_STATE_UNPROVEN'],
  ['injected authority', v => { v.nativeProducerQualified = true; }, 'OWNER_CONTROL_OBSERVATION_INVALID'],
  ['injected frozen proof boolean', v => { v.preparation.originalFrozenAuthenticated = true; }, 'OWNER_CONTROL_OBSERVATION_INVALID'],
]) test(name, () => {
  const value = consent(), actual = observation(value); change(actual);
  const result = bind(comment(value), actual); assert.equal(result.blocker, blocker); noAuthority(result);
});
test('only the existing activation PR can enter the observation binding', () => {
  const value = consent(); value.activation.prNumber = 9999;
  const input = comment(value);
  input.issue_url = input.issue_url.replace('3268', '9999'); input.html_url = input.html_url.replace('3268', '9999');
  assert.equal(parse(input).candidate, true);
  assert.equal(bind(input, observation(value)).blocker, 'OWNER_CONTROL_TRANSITION_IDENTITY_MISMATCH');
});
for (const state of ROTATION_V2_STATES) for (const operation of ROTATION_V2_OPERATIONS) test(`bound ${state}/${operation} cannot bypass native proof or the phase matrix`, () => {
  const value = consent(); value.state = state; value.rotationAction = operation;
  if (operation === 'VERIFY') value.probeRequestIds = ['fixture-probe-deployment', 'fixture-probe-capability'];
  const postMerge = ['MERGED_NOT_ADOPTED', 'ADOPTED_NOT_VERIFIED', 'VERIFIED'].includes(state);
  if (postMerge) {
    value.activation.mergeCommitSha = value.source.protectedMainHead = git('f');
    value.activation.mergeTreeSha = value.source.protectedMainTreeSha = git('1');
    value.preparation.originalFrozenArtifactSha256 = sha('2');
    if (state !== 'MERGED_NOT_ADOPTED') {
      value.source.installedHead = git('f'); value.source.installedTreeSha = git('1'); value.source.sourceRole = 'ADOPTED';
    }
  }
  const result = bind(comment(value), observation(value)), mode = ROTATION_V2_STRUCTURAL_MATRIX[state][operation];
  if (mode === 'DENY') assert.equal(result.blocker, 'ROTATION_OPERATION_DENIED_FOR_PHASE');
  else if (postMerge) assert.equal(result.blocker, 'ORIGINAL_FROZEN_NATIVE_PROOF_REQUIRED');
  else { assert.equal(result.ok, true); assert.equal(result.structuralMode, mode); }
  noAuthority(result);
});
test('observation accessors and proxies execute no code and cannot change identity between reads', () => {
  let effects = 0;
  const input = comment();
  for (const section of [null, 'source', 'activation', 'epoch', 'barrier', 'preparation']) {
    const actual = observation(), target = section ? actual[section] : actual;
    const key = Object.keys(target)[0];
    Object.defineProperty(target, key, { enumerable: true, get() { effects++; throw Error(); } });
    assert.equal(bind(input, actual).ok, false);
    const wrapped = observation();
    if (section) wrapped[section] = new Proxy(wrapped[section], { ownKeys() { effects++; throw Error(); } });
    else { assert.equal(bind(input, new Proxy(wrapped, { ownKeys() { effects++; throw Error(); } })).ok, false); continue; }
    assert.equal(bind(input, wrapped).ok, false);
  }
  assert.equal(effects, 0);
});
