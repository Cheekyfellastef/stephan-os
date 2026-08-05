import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INTEGRATION_BURST_DECISION,
  INTEGRATION_BURST_URGENCY,
  planIntegrationBurstRevalidation,
} from './integrationBurstCoalescerV1.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const HEAD = 'd'.repeat(40);
const NOW = '2026-08-05T03:20:00Z';

function observation(head, observedAt, urgency = INTEGRATION_BURST_URGENCY.ROUTINE) {
  return { head, observedAt, urgency, source: 'github-main' };
}

function candidate(overrides = {}) {
  return {
    prNumber: 1701,
    goalId: '#1619',
    branch: 'feat/example-lane',
    head: HEAD,
    baseSha: A,
    lastRevalidatedMainHead: A,
    state: 'READY_FOR_INTEGRATION',
    priority: 20,
    urgency: INTEGRATION_BURST_URGENCY.ROUTINE,
    ...overrides,
  };
}

function plan(overrides = {}) {
  return planIntegrationBurstRevalidation({
    now: NOW,
    settleWindowMs: 120_000,
    maxBurstAgeMs: 600_000,
    mainObservations: [
      observation(A, '2026-08-05T03:18:00Z'),
      observation(B, '2026-08-05T03:19:00Z'),
    ],
    candidates: [candidate()],
    ...overrides,
  });
}

test('fails closed on malformed inventory and duplicated candidates', () => {
  assert.equal(planIntegrationBurstRevalidation().decision, INTEGRATION_BURST_DECISION.INVALID_INPUT);
  const duplicate = plan({ candidates: [candidate(), candidate({ branch: 'feat/other' })] });
  assert.equal(duplicate.decision, INTEGRATION_BURST_DECISION.INVALID_INPUT);
  const sparse = [];
  sparse[1] = candidate();
  assert.equal(plan({ candidates: sparse }).decision, INTEGRATION_BURST_DECISION.INVALID_INPUT);
});

test('waits while routine main movement is inside the settle window', () => {
  const result = plan();
  assert.equal(result.decision, INTEGRATION_BURST_DECISION.WAIT_FOR_SETTLE_WINDOW);
  assert.equal(result.targetMainHead, B);
  assert.equal(result.revalidationCount, 0);
});

test('releases one batch after the burst settles', () => {
  const result = plan({ now: '2026-08-05T03:22:01Z' });
  assert.equal(result.decision, INTEGRATION_BURST_DECISION.RELEASE_REVALIDATION_BATCH);
  assert.equal(result.targetMainHead, B);
  assert.deepEqual(result.candidates.map((row) => row.prNumber), [1701]);
});

test('coalesces duplicate observations and preserves the final transition count', () => {
  const result = plan({
    now: '2026-08-05T03:25:00Z',
    mainObservations: [
      observation(A, '2026-08-05T03:10:00Z'),
      observation(A, '2026-08-05T03:11:00Z'),
      observation(B, '2026-08-05T03:12:00Z'),
      observation(B, '2026-08-05T03:13:00Z'),
      observation(C, '2026-08-05T03:14:00Z'),
    ],
  });
  assert.equal(result.targetMainHead, C);
  assert.equal(result.burst.observationCount, 5);
  assert.equal(result.burst.distinctHeadCount, 3);
  assert.equal(result.burst.transitionCount, 2);
});

test('maximum burst age prevents indefinite starvation', () => {
  const result = plan({
    mainObservations: [
      observation(A, '2026-08-05T03:00:00Z'),
      observation(B, '2026-08-05T03:19:30Z'),
    ],
  });
  assert.equal(result.decision, INTEGRATION_BURST_DECISION.RELEASE_REVALIDATION_BATCH);
  assert.match(result.reason, /maximum burst age/i);
});

test('operator and security gates bypass routine coalescing', () => {
  const operator = plan({
    mainObservations: [
      observation(A, '2026-08-05T03:10:00Z'),
      observation(B, '2026-08-05T03:19:50Z', INTEGRATION_BURST_URGENCY.OPERATOR_GATE),
    ],
  });
  assert.equal(operator.decision, INTEGRATION_BURST_DECISION.URGENT_REVALIDATION);

  const security = plan({
    candidates: [candidate({ urgency: INTEGRATION_BURST_URGENCY.SECURITY_FINDING })],
  });
  assert.equal(security.decision, INTEGRATION_BURST_DECISION.URGENT_REVALIDATION);
});

test('does not revalidate candidates already bound to current main', () => {
  const result = plan({
    now: '2026-08-05T03:25:00Z',
    candidates: [candidate({ baseSha: B, lastRevalidatedMainHead: B })],
  });
  assert.equal(result.decision, INTEGRATION_BURST_DECISION.NO_MAIN_MOVEMENT);
  assert.equal(result.revalidationCount, 0);
});

test('selects each stale candidate once in deterministic priority order', () => {
  const result = plan({
    now: '2026-08-05T03:25:00Z',
    candidates: [
      candidate({ prNumber: 1703, branch: 'feat/third', priority: 50 }),
      candidate({ prNumber: 1702, branch: 'feat/second', priority: 10 }),
      candidate({ prNumber: 1701, branch: 'feat/first', priority: 10 }),
      candidate({
        prNumber: 1704,
        branch: 'feat/current',
        priority: 1,
        baseSha: B,
        lastRevalidatedMainHead: B,
      }),
    ],
  });
  assert.deepEqual(result.candidates.map((row) => row.prNumber), [1701, 1702, 1703]);
});

test('future observations beyond bounded skew fail closed', () => {
  const result = plan({
    mainObservations: [observation(B, '2026-08-05T03:22:00Z')],
  });
  assert.equal(result.decision, INTEGRATION_BURST_DECISION.INVALID_INPUT);
});

test('every result explicitly denies mutation and merge authority', () => {
  for (const result of [plan(), plan({ now: '2026-08-05T03:25:00Z' })]) {
    assert.equal(result.sourceMutationAllowed, false);
    assert.equal(result.mergeAuthority, false);
    assert.equal(result.deploymentAuthority, false);
    assert.equal(result.runtimeMutationAllowed, false);
    assert.equal(result.destructiveGitAllowed, false);
    assert.match(result.receiptId, /^integration-burst-[0-9a-f]{24}$/);
  }
});
