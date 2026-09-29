import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STEPHANOS_PROSPECTIVE_MEMORY_SCHEMA_VERSION,
  buildStephanosProspectiveMemoryV1,
} from './stephanosProspectiveMemoryV1.mjs';

const OBSERVED_AT = '2026-08-17T16:00:00.000Z';

function openLoop(overrides = {}) {
  return {
    schemaVersion: STEPHANOS_PROSPECTIVE_MEMORY_SCHEMA_VERSION,
    loopId: 'loop-review-recovery',
    continuityKey: 'review-recovery',
    loopClass: 'FOLLOW_UP',
    origin: 'GOAL_STATE',
    promotionState: 'CONFIRMED',
    summary: 'Revisit the affected product lane after independent review machinery recovers.',
    whyItMatters: 'The product head should remain preserved until normal review proof can complete.',
    state: 'OPEN',
    authorityClass: 'SHARED_AUTHORITY',
    freshness: 'FRESH',
    openedAtUtc: '2026-08-17T12:00:00.000Z',
    dueAtUtc: null,
    closedAtUtc: null,
    triggerKind: 'ON_RECEIPT',
    triggerRefs: ['receipt://review-machinery-recovered'],
    ownerRef: 'goal://1637',
    sourceRefs: ['goal://1645'],
    proofRefs: ['evidence://checkpoint-001'],
    supersedesLoopId: null,
    supersededByLoopId: null,
    ...overrides,
  };
}

test('projects confirmed shared open loops without granting scheduling or dispatch authority', () => {
  const result = buildStephanosProspectiveMemoryV1({ observedAtUtc: OBSERVED_AT, openLoops: [openLoop()] });
  assert.equal(result.valid, true);
  assert.equal(result.verdict, 'PROSPECTIVE_MEMORY_PROJECTED');
  assert.deepEqual(result.activeOpenLoops.map((item) => item.loopId), ['loop-review-recovery']);
  assert.equal(result.authority.scheduleCreationAllowed, false);
  assert.equal(result.authority.autoDispatchAllowed, false);
});

test('model proposals remain inferred candidates and cannot self-confirm', () => {
  const candidate = openLoop({
    loopId: 'loop-model-candidate',
    continuityKey: 'model-candidate',
    origin: 'MODEL_PROPOSAL',
    promotionState: 'CANDIDATE',
    authorityClass: 'INFERRED',
  });
  const result = buildStephanosProspectiveMemoryV1({ observedAtUtc: OBSERVED_AT, openLoops: [candidate] });
  assert.equal(result.valid, true);
  assert.equal(result.activeOpenLoops.length, 0);
  assert.deepEqual(result.candidateOpenLoops.map((item) => item.loopId), ['loop-model-candidate']);

  const selfConfirmed = { ...candidate, promotionState: 'CONFIRMED', authorityClass: 'SHARED_AUTHORITY' };
  const rejected = buildStephanosProspectiveMemoryV1({ observedAtUtc: OBSERVED_AT, openLoops: [selfConfirmed] });
  assert.equal(rejected.valid, false);
  assert(rejected.validationErrors.some((error) => error.includes('model-proposal')));
});

test('confirmed loops require shared authority', () => {
  const result = buildStephanosProspectiveMemoryV1({
    observedAtUtc: OBSERVED_AT,
    openLoops: [openLoop({ authorityClass: 'LOCAL_MIRROR' })],
  });
  assert.equal(result.valid, false);
  assert(result.validationErrors.some((error) => error.includes('confirmed-loop-requires-shared-authority')));
});

test('overdue state is observable but does not become an executable reminder', () => {
  const overdue = openLoop({
    loopId: 'loop-overdue',
    continuityKey: 'overdue',
    triggerKind: 'AT_TIME',
    triggerRefs: [],
    dueAtUtc: '2026-08-17T15:00:00.000Z',
  });
  const future = openLoop({
    loopId: 'loop-future',
    continuityKey: 'future',
    triggerKind: 'AT_TIME',
    triggerRefs: [],
    dueAtUtc: '2026-08-18T15:00:00.000Z',
  });
  const result = buildStephanosProspectiveMemoryV1({ observedAtUtc: OBSERVED_AT, openLoops: [overdue, future] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.overdueLoopIds, ['loop-overdue']);
  assert.equal(result.activeOpenLoops.find((item) => item.loopId === 'loop-future').overdue, false);
  assert.equal(result.authority.reminderCreationAllowed, false);
});

test('condition and receipt triggers require bounded references', () => {
  for (const triggerKind of ['ON_CONDITION', 'ON_RECEIPT']) {
    const result = buildStephanosProspectiveMemoryV1({
      observedAtUtc: OBSERVED_AT,
      openLoops: [openLoop({ triggerKind, triggerRefs: [] })],
    });
    assert.equal(result.valid, false);
    assert(result.validationErrors.some((error) => error.includes('reference-trigger-requires-triggerRefs')));
  }
});

test('closed, expired and cancelled loops are history rather than active work', () => {
  const loops = ['CLOSED', 'EXPIRED', 'CANCELLED'].map((state, index) => openLoop({
    loopId: `loop-terminal-${index}`,
    continuityKey: `terminal-${index}`,
    state,
    closedAtUtc: '2026-08-17T14:00:00.000Z',
    triggerKind: 'NONE',
    triggerRefs: [],
  }));
  const result = buildStephanosProspectiveMemoryV1({ observedAtUtc: OBSERVED_AT, openLoops: loops });
  assert.equal(result.valid, true);
  assert.equal(result.activeOpenLoops.length, 0);
  assert.equal(result.historicalOpenLoops.length, 3);
});

test('supersession preserves continuity history and must be reciprocal within one continuity key', () => {
  const oldLoop = openLoop({
    loopId: 'loop-old',
    state: 'CLOSED',
    closedAtUtc: '2026-08-17T13:00:00.000Z',
    supersededByLoopId: 'loop-new',
  });
  const newLoop = openLoop({
    loopId: 'loop-new',
    openedAtUtc: '2026-08-17T13:00:00.000Z',
    supersedesLoopId: 'loop-old',
  });
  const result = buildStephanosProspectiveMemoryV1({ observedAtUtc: OBSERVED_AT, openLoops: [oldLoop, newLoop] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.activeOpenLoops.map((item) => item.loopId), ['loop-new']);
  assert(result.historicalOpenLoops.some((item) => item.loopId === 'loop-old'));

  const wrongKey = { ...newLoop, continuityKey: 'another-key' };
  const rejected = buildStephanosProspectiveMemoryV1({ observedAtUtc: OBSERVED_AT, openLoops: [oldLoop, wrongKey] });
  assert.equal(rejected.valid, false);
  assert(rejected.validationErrors.some((error) => error.includes('different-continuity-key')));
});

test('multiple confirmed active records for one continuity key remain an explicit conflict', () => {
  const first = openLoop({ loopId: 'loop-a' });
  const second = openLoop({ loopId: 'loop-b', summary: 'A competing current representation of the same follow-up remains unresolved.' });
  const result = buildStephanosProspectiveMemoryV1({ observedAtUtc: OBSERVED_AT, openLoops: [first, second] });
  assert.equal(result.valid, true);
  assert.equal(result.verdict, 'PROSPECTIVE_MEMORY_PROJECTED_WITH_CONFLICTS');
  assert.deepEqual(result.continuityConflicts[0].loopIds, ['loop-a', 'loop-b']);
});

test('rejects sensitive text, local paths and hostile data shapes before authority use', () => {
  for (const summary of ['Remember the access token abc.', 'Follow up using C:\\Users\\Stephan\\private.txt.']) {
    const result = buildStephanosProspectiveMemoryV1({
      observedAtUtc: OBSERVED_AT,
      openLoops: [openLoop({ summary })],
    });
    assert.equal(result.valid, false);
    assert(result.validationErrors.some((error) => error.includes('summary-invalid')));
  }

  let reads = 0;
  const hostile = openLoop();
  Object.defineProperty(hostile, 'authorityClass', {
    enumerable: true,
    get() {
      reads += 1;
      return 'SHARED_AUTHORITY';
    },
  });
  const accessor = buildStephanosProspectiveMemoryV1({ observedAtUtc: OBSERVED_AT, openLoops: [hostile] });
  assert.equal(accessor.valid, false);
  assert.equal(reads, 0);

  const sparse = [];
  sparse.length = 2;
  sparse[1] = openLoop({ loopId: 'loop-sparse' });
  assert.equal(buildStephanosProspectiveMemoryV1({ observedAtUtc: OBSERVED_AT, openLoops: sparse }).valid, false);
});

test('projection identity is deterministic and all mutation/automation authority remains false', () => {
  const input = { observedAtUtc: OBSERVED_AT, openLoops: [openLoop()] };
  const first = buildStephanosProspectiveMemoryV1(input);
  const second = buildStephanosProspectiveMemoryV1(input);
  assert.equal(first.projectionId, second.projectionId);
  assert.match(first.projectionId, /^prospective-[0-9a-f]{32}$/);
  assert(Object.values(first.authority).every((allowed) => allowed === false));
  assert.equal(Object.isFrozen(first), true);
});
