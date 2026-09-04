import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_BRIDGE_ELASTIC_MAILBOX_MAX_WIDTH,
  deriveBattleBridgeElasticMailboxWidth,
  planBattleBridgeElasticMailboxDispatch,
} from './battleBridgeElasticMailboxPlannerV1.mjs';

const head = 'a'.repeat(40);
const now = new Date('2026-09-04T16:30:00.000Z');

function capacity(overrides = {}) {
  return {
    ok: true,
    sourceHead: head,
    observedAtUtc: '2026-09-04T16:29:00.000Z',
    expiresAtUtc: '2026-09-04T16:35:00.000Z',
    provenWidth: 5,
    ...overrides,
  };
}

function candidate(requestId, resources, overrides = {}) {
  return {
    requestId,
    resources,
    state: 'READY',
    approvalRequired: false,
    approvalSatisfied: false,
    providerAvailable: true,
    leaseAvailable: true,
    ...overrides,
  };
}

test('fresh exact-head capacity can widen only to the hard ceiling', () => {
  assert.equal(deriveBattleBridgeElasticMailboxWidth(capacity(), { now, expectedHead: head }), 5);
  assert.equal(deriveBattleBridgeElasticMailboxWidth(capacity({ provenWidth: 999 }), { now, expectedHead: head }), BATTLE_BRIDGE_ELASTIC_MAILBOX_MAX_WIDTH);
});

test('missing stale malformed or wrong-head capacity degrades to width one', () => {
  const cases = [
    {},
    capacity({ ok: false }),
    capacity({ sourceHead: 'b'.repeat(40) }),
    capacity({ observedAtUtc: 'not-a-time' }),
    capacity({ expiresAtUtc: '2026-09-04T16:29:59.000Z' }),
    capacity({ provenWidth: 0 }),
  ];
  for (const input of cases) {
    assert.equal(deriveBattleBridgeElasticMailboxWidth(input, { now, expectedHead: head }), 1);
  }
});

test('blocked approval and provider lanes are parked while disjoint work keeps moving', () => {
  const result = planBattleBridgeElasticMailboxDispatch({
    expectedHead: head,
    now,
    capacity: capacity({ provenWidth: 3 }),
    candidates: [
      candidate('request-a', ['resource/a'], { priority: 100, approvalRequired: true }),
      candidate('request-b', ['resource/b'], { priority: 90, providerAvailable: false }),
      candidate('request-c', ['resource/c'], { priority: 80 }),
      candidate('request-d', ['resource/d'], { priority: 70 }),
      candidate('request-e', ['resource/e'], { priority: 60 }),
    ],
  });
  assert.deepEqual(result.selected.map((entry) => entry.requestId), ['request-c', 'request-d', 'request-e']);
  assert.deepEqual(result.parked.map((entry) => [entry.requestId, entry.reason]), [
    ['request-a', 'APPROVAL_GATE'],
    ['request-b', 'PROVIDER_UNAVAILABLE'],
  ]);
  assert.equal(result.selectedCount, 3);
});

test('resource conflicts serialize one writer while unrelated work fills capacity', () => {
  const result = planBattleBridgeElasticMailboxDispatch({
    expectedHead: head,
    now,
    capacity: capacity({ provenWidth: 3 }),
    activeLeases: ['resource/already-owned'],
    candidates: [
      candidate('request-a', ['resource/shared'], { priority: 100 }),
      candidate('request-b', ['resource/shared'], { priority: 90 }),
      candidate('request-c', ['resource/already-owned'], { priority: 80 }),
      candidate('request-d', ['resource/d'], { priority: 70 }),
      candidate('request-e', ['resource/e'], { priority: 60 }),
    ],
  });
  assert.deepEqual(result.selected.map((entry) => entry.requestId), ['request-a', 'request-d', 'request-e']);
  assert.equal(result.parked.find((entry) => entry.requestId === 'request-b')?.reason, 'RESOURCE_OR_LEASE_CONFLICT');
  assert.equal(result.parked.find((entry) => entry.requestId === 'request-c')?.reason, 'RESOURCE_OR_LEASE_CONFLICT');
});

test('duplicate and consumed request IDs cannot multiply execution owners', () => {
  const result = planBattleBridgeElasticMailboxDispatch({
    expectedHead: head,
    now,
    capacity: capacity({ provenWidth: 5 }),
    consumedRequestIds: ['request-old'],
    candidates: [
      candidate('request-old', ['resource/old']),
      candidate('request-new', ['resource/a']),
      candidate('request-new', ['resource/b']),
    ],
  });
  assert.deepEqual(result.selected.map((entry) => entry.requestId), ['request-new']);
  assert.equal(result.parked.filter((entry) => entry.reason === 'DUPLICATE_OR_CONSUMED').length, 2);
});

test('capacity overflow is deferred, not dropped, and planner creates no authority surfaces', () => {
  const result = planBattleBridgeElasticMailboxDispatch({
    expectedHead: head,
    now,
    capacity: capacity({ provenWidth: 2 }),
    candidates: [
      candidate('request-a', ['resource/a']),
      candidate('request-b', ['resource/b']),
      candidate('request-c', ['resource/c']),
    ],
  });
  assert.deepEqual(result.selected.map((entry) => entry.requestId), ['request-a', 'request-b']);
  assert.deepEqual(result.deferred.map((entry) => entry.requestId), ['request-c']);
  assert.equal(result.duplicateMailboxAllowed, false);
  assert.equal(result.createsScheduler, false);
  assert.equal(result.createsWorker, false);
  assert.equal(result.createsQueue, false);
  assert.equal(result.createsMailbox, false);
  assert.equal(result.authorityWidened, false);
});
