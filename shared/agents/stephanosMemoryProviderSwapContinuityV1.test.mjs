import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateStephanosMemoryProviderSwapContinuityV1,
  STEPHANOS_MEMORY_PROVIDER_SWAP_AUTHORITY,
  STEPHANOS_MEMORY_PROVIDER_SWAP_INPUT_SCHEMA_V1,
} from './stephanosMemoryProviderSwapContinuityV1.mjs';

const d = (char) => `sha256:${char.repeat(64)}`;

function observation(overrides = {}) {
  return {
    providerId: 'provider:alpha',
    providerClass: 'HOSTED',
    surface: 'CHATGPT_WEB',
    observedAtUtc: '2026-08-17T16:00:00Z',
    authorityConfirmed: true,
    memoryAuthorityClass: 'SHARED_AUTHORITY',
    stephanosIdentityVersion: 'stephanos:v1',
    operatorRelationshipContextRef: 'relationship:operator:v1',
    intentId: 'intent:42',
    missionId: 'mission:42',
    memoryAuthorityRef: 'memory-authority:shared:v1',
    surfaceThreadRef: 'thread:current:42',
    canonicalRecords: [
      { recordId: 'memory:a', digest: d('a'), state: 'CURRENT', authorityClass: 'SHARED_AUTHORITY' },
      { recordId: 'memory:b', digest: d('b'), state: 'TOMBSTONE', authorityClass: 'OPERATOR_CONFIRMED' },
    ],
    evidenceRefs: ['proof:provider-swap:before'],
    ...overrides,
  };
}

function evaluate(before = observation(), after = observation({
  providerId: 'provider:beta',
  providerClass: 'LOCAL',
  observedAtUtc: '2026-08-17T16:01:00Z',
  evidenceRefs: ['proof:provider-swap:after'],
})) {
  return evaluateStephanosMemoryProviderSwapContinuityV1({
    schemaVersion: STEPHANOS_MEMORY_PROVIDER_SWAP_INPUT_SCHEMA_V1,
    before,
    after,
  });
}

test('passes a genuine provider swap with invariant canonical memory and thread', () => {
  const result = evaluate();
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.providerChanged, true);
  assert.equal(result.identityStable, true);
  assert.equal(result.threadStable, true);
  assert.equal(result.memoryStable, true);
});

test('record order does not create false memory drift', () => {
  const before = observation();
  const after = observation({
    providerId: 'provider:beta',
    evidenceRefs: ['proof:provider-swap:after'],
    canonicalRecords: [...before.canonicalRecords].reverse(),
  });
  assert.equal(evaluate(before, after).verdict, 'PASS');
});

test('same provider is held because it does not prove a provider swap', () => {
  const after = observation({ evidenceRefs: ['proof:provider-swap:after'] });
  assert.equal(evaluate(observation(), after).verdict, 'HOLD_NOT_A_SWAP');
});

test('unconfirmed or local-mirror memory authority cannot prove continuity', () => {
  assert.equal(evaluate(observation({ authorityConfirmed: false })).verdict, 'HOLD_AUTHORITY');
  assert.equal(evaluate(observation({ memoryAuthorityClass: 'LOCAL_MIRROR' })).verdict, 'HOLD_AUTHORITY');
});

test('missing evidence holds rather than claiming continuity', () => {
  assert.equal(evaluate(observation({ evidenceRefs: [] })).verdict, 'HOLD_EVIDENCE');
});

test('identity drift fails even when provider and memory otherwise look healthy', () => {
  const result = evaluate(undefined, observation({
    providerId: 'provider:beta',
    stephanosIdentityVersion: 'stephanos:v2',
    evidenceRefs: ['proof:provider-swap:after'],
  }));
  assert.equal(result.verdict, 'FAIL_IDENTITY_DRIFT');
  assert.deepEqual(result.identityDriftFields, ['stephanosIdentityVersion']);
});

test('surface drift fails as identity drift', () => {
  const result = evaluate(undefined, observation({
    providerId: 'provider:beta',
    surface: 'PHONE',
    evidenceRefs: ['proof:provider-swap:after'],
  }));
  assert.equal(result.verdict, 'FAIL_IDENTITY_DRIFT');
});

test('thread drift fails separately from identity drift', () => {
  const result = evaluate(undefined, observation({
    providerId: 'provider:beta',
    surfaceThreadRef: 'thread:other:99',
    evidenceRefs: ['proof:provider-swap:after'],
  }));
  assert.equal(result.verdict, 'FAIL_THREAD_DRIFT');
});

test('changed canonical digest fails memory continuity', () => {
  const changed = observation().canonicalRecords.map((record) => ({ ...record }));
  changed[0].digest = d('c');
  const result = evaluate(undefined, observation({
    providerId: 'provider:beta',
    canonicalRecords: changed,
    evidenceRefs: ['proof:provider-swap:after'],
  }));
  assert.equal(result.verdict, 'FAIL_MEMORY_DRIFT');
  assert.deepEqual(result.memoryDrift, [{ recordId: 'memory:a', reason: 'METADATA_CHANGED' }]);
});

test('added or missing canonical memory fails continuity instead of silently accepting provider reality', () => {
  const result = evaluate(undefined, observation({
    providerId: 'provider:beta',
    canonicalRecords: [{ recordId: 'memory:a', digest: d('a'), state: 'CURRENT', authorityClass: 'SHARED_AUTHORITY' }],
    evidenceRefs: ['proof:provider-swap:after'],
  }));
  assert.equal(result.verdict, 'FAIL_MEMORY_DRIFT');
  assert.deepEqual(result.memoryDrift, [{ recordId: 'memory:b', reason: 'MISSING_AFTER' }]);
});

test('authority-class drift inside canonical records fails memory continuity', () => {
  const changed = observation().canonicalRecords.map((record) => ({ ...record }));
  changed[0].authorityClass = 'CANONICAL_PROJECT_EVIDENCE';
  assert.equal(evaluate(undefined, observation({
    providerId: 'provider:beta', canonicalRecords: changed, evidenceRefs: ['proof:provider-swap:after'],
  })).verdict, 'FAIL_MEMORY_DRIFT');
});

test('duplicate records and malformed digests fail closed', () => {
  const duplicate = observation().canonicalRecords[0];
  assert.throws(() => evaluate(observation({ canonicalRecords: [duplicate, { ...duplicate }] })), /DUPLICATE_RECORD/);
  assert.throws(() => evaluate(observation({ canonicalRecords: [{ ...duplicate, digest: 'bad' }] })), /INVALID_DIGEST/);
});

test('accessor-bearing and sparse hostile input fails closed', () => {
  const hostile = observation();
  Object.defineProperty(hostile, 'providerId', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.throws(() => evaluate(hostile), /ACCESSOR_REJECTED/);
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => evaluate(observation({ canonicalRecords: sparse })), /SPARSE_ARRAY_REJECTED/);
});

test('providers receive no canonical memory, identity, routing or execution authority', () => {
  for (const [key, value] of Object.entries(STEPHANOS_MEMORY_PROVIDER_SWAP_AUTHORITY)) {
    assert.equal(value, false, `${key} must remain false`);
  }
  assert.equal(evaluate().authority.providerCanonicalMemoryAuthority, false);
});
