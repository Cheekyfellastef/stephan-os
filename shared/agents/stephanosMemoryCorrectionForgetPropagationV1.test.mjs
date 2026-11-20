import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStephanosMemoryCorrectionForgetPropagationPlanV1,
  STEPHANOS_MEMORY_CHANGE_AUTHORITY,
  STEPHANOS_MEMORY_CHANGE_INPUT_SCHEMA_V1,
} from './stephanosMemoryCorrectionForgetPropagationV1.mjs';

const d = (ch) => `sha256:${ch.repeat(64)}`;

function receipt(overrides = {}) {
  return {
    changeId: 'change:1',
    operation: 'CORRECT',
    recordId: 'memory:operator-preference',
    authorityConfirmed: true,
    authorityClass: 'OPERATOR_CONFIRMED',
    occurredAtUtc: '2026-08-17T16:00:00Z',
    oldDigest: d('a'),
    newDigest: d('b'),
    sourceRefs: ['memory:operator-preference'],
    proofRefs: ['receipt:1'],
    ...overrides,
  };
}

function derivative(overrides = {}) {
  return {
    derivativeId: 'derived:1',
    derivativeType: 'RETRIEVAL_INDEX',
    sourceRecordId: 'memory:operator-preference',
    sourceDigest: d('a'),
    state: 'ACTIVE',
    authorityClass: 'SHARED_AUTHORITY',
    influenceAllowed: true,
    surface: 'shared-retrieval',
    sourceRefs: ['memory:operator-preference'],
    ...overrides,
  };
}

function plan(changeReceipt = receipt(), derivatives = [derivative()]) {
  return buildStephanosMemoryCorrectionForgetPropagationPlanV1({
    schemaVersion: STEPHANOS_MEMORY_CHANGE_INPUT_SCHEMA_V1,
    changeReceipt,
    derivatives,
  });
}

test('correction marks old-digest derivatives for rebuild', () => {
  const result = plan();
  assert.equal(result.items[0].disposition, 'REBUILD_REQUIRED');
  assert.equal(result.summary.REBUILD_REQUIRED, 1);
});

test('correction accepts a derivative already on the new digest', () => {
  const result = plan(receipt(), [derivative({ sourceDigest: d('b') })]);
  assert.equal(result.items[0].disposition, 'CURRENT_OK');
});

test('correction holds an unrelated digest conflict rather than guessing', () => {
  const result = plan(receipt(), [derivative({ sourceDigest: d('c') })]);
  assert.equal(result.items[0].disposition, 'HOLD_CONFLICT');
});

test('forget invalidates every still-influential derivative of forgotten content', () => {
  const forgotten = receipt({ operation: 'FORGET', newDigest: undefined });
  const result = plan(forgotten, [
    derivative({ derivativeId: 'derived:retrieval' }),
    derivative({ derivativeId: 'derived:relationship', derivativeType: 'RELATIONSHIP_PROJECTION' }),
    derivative({ derivativeId: 'derived:provider', derivativeType: 'PROVIDER_SUMMARY_CACHE' }),
  ]);
  assert.deepEqual(result.items.map((item) => item.disposition), [
    'INVALIDATE_REQUIRED', 'INVALIDATE_REQUIRED', 'INVALIDATE_REQUIRED',
  ]);
});

test('forget produces a minimal audit tombstone with no content', () => {
  const result = plan(receipt({ operation: 'FORGET', newDigest: undefined }));
  assert.equal(result.auditTombstone.contentRetained, false);
  assert.equal(result.auditTombstone.futureInfluenceAllowed, false);
  assert.equal(result.auditTombstone.recordId, 'memory:operator-preference');
  assert.ok(result.auditTombstone.tombstoneDigest.startsWith('sha256:'));
  assert.equal('payload' in result.auditTombstone, false);
  assert.equal('content' in result.auditTombstone, false);
  assert.equal(result.summary.TOMBSTONE_REQUIRED, 1);
});

test('unconfirmed or non-canonical change authority cannot drive propagation', () => {
  for (const changeReceipt of [
    receipt({ authorityConfirmed: false }),
    receipt({ authorityClass: 'LOCAL_MIRROR' }),
    receipt({ authorityClass: 'INFERRED' }),
  ]) {
    assert.equal(plan(changeReceipt).items[0].disposition, 'HOLD_AUTHORITY');
  }
});

test('forget refuses a derivative whose digest does not match forgotten truth', () => {
  const result = plan(receipt({ operation: 'FORGET', newDigest: undefined }), [derivative({ sourceDigest: d('c') })]);
  assert.equal(result.items[0].disposition, 'HOLD_CONFLICT');
});

test('already non-influential derivatives do not require duplicate invalidation', () => {
  const forgotten = receipt({ operation: 'FORGET', newDigest: undefined });
  assert.equal(plan(forgotten, [derivative({ influenceAllowed: false })]).items[0].disposition, 'NO_INFLUENCE');
  assert.equal(plan(forgotten, [derivative({ state: 'INVALIDATED' })]).items[0].disposition, 'NO_INFLUENCE');
});

test('derivatives of other canonical records are left alone', () => {
  const result = plan(receipt(), [derivative({ sourceRecordId: 'memory:other' })]);
  assert.equal(result.items[0].disposition, 'NO_INFLUENCE');
});

test('CORRECT requires a new digest and FORGET forbids one', () => {
  assert.throws(() => plan(receipt({ newDigest: undefined })), /MISSING_NEW_DIGEST/);
  assert.throws(() => plan(receipt({ operation: 'FORGET' })), /FORGET_HAS_NEW_CONTENT/);
});

test('rejects duplicate derivative identity', () => {
  assert.throws(() => plan(receipt(), [derivative(), derivative()]), /DUPLICATE_DERIVATIVE/);
});

test('rejects accessor-bearing and sparse hostile inputs', () => {
  const hostile = derivative();
  Object.defineProperty(hostile, 'surface', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.throws(() => plan(receipt(), [hostile]), /ACCESSOR_REJECTED/);
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => plan(receipt(), sparse), /SPARSE_ARRAY_REJECTED/);
});

test('plan is deterministic regardless of derivative input order', () => {
  const a = derivative({ derivativeId: 'derived:a' });
  const z = derivative({ derivativeId: 'derived:z', derivativeType: 'CONTEXT_PACK_CACHE' });
  const first = plan(receipt(), [z, a]);
  const second = plan(receipt(), [a, z]);
  assert.equal(first.planDigest, second.planDigest);
  assert.deepEqual(first.items.map((item) => item.derivativeId), ['derived:a', 'derived:z']);
});

test('all mutation and execution authority remains false', () => {
  for (const [key, value] of Object.entries(STEPHANOS_MEMORY_CHANGE_AUTHORITY)) {
    assert.equal(value, false, `${key} must remain false`);
  }
  assert.equal(plan().authority.derivativeMutationAllowed, false);
});
