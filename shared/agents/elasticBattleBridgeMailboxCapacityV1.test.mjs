import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveElasticBattleBridgeMailboxWidth,
  planElasticBattleBridgeMailboxDispatch,
} from './elasticBattleBridgeMailboxCapacityV1.mjs';

const now = new Date('2026-09-04T16:30:00Z');

function capacity(provenWidth = 5, observedAtUtc = '2026-09-04T16:29:30Z') {
  return { ok: true, exactSourceBound: true, provenWidth, observedAtUtc };
}

function lane(requestId, resources, extra = {}) {
  return { requestId, laneId: requestId, resources, providerAvailable: true, ...extra };
}

test('defaults safely to width one without fresh exact-source capacity evidence', () => {
  assert.deepEqual(
    deriveElasticBattleBridgeMailboxWidth({ now }),
    { width: 1, proven: false, blocker: 'MAILBOX_ELASTIC_CAPACITY_UNPROVEN' },
  );
  assert.equal(deriveElasticBattleBridgeMailboxWidth({ capacityEvidence: capacity(5, '2026-09-04T16:00:00Z'), now }).width, 1);
});

test('caps proven width at the hard five-lane ceiling', () => {
  const result = deriveElasticBattleBridgeMailboxWidth({ capacityEvidence: capacity(99), now });
  assert.equal(result.width, 5);
  assert.equal(result.proven, true);
});

test('parks approval and provider gates while filling disjoint runnable capacity', () => {
  const result = planElasticBattleBridgeMailboxDispatch({
    now,
    capacityEvidence: capacity(4),
    candidates: [
      lane('approval-lane', ['repo:approval'], { approvalGated: true }),
      lane('provider-lane', ['repo:provider'], { providerAvailable: false }),
      lane('source-lane', ['file:a']),
      lane('review-lane', ['file:b']),
      lane('proof-lane', ['file:c']),
      lane('delivery-lane', ['file:d']),
    ],
  });

  assert.deepEqual(result.selected.map((item) => item.requestId), [
    'source-lane',
    'review-lane',
    'proof-lane',
    'delivery-lane',
  ]);
  assert.deepEqual(result.parked.map((item) => item.requestId), ['approval-lane', 'provider-lane']);
  assert.equal(result.selectedCount, 4);
  assert.equal(result.workConserving, true);
});

test('serializes resource conflicts without blocking unrelated lanes', () => {
  const result = planElasticBattleBridgeMailboxDispatch({
    now,
    capacityEvidence: capacity(3),
    candidates: [
      lane('writer-a', ['file:shared']),
      lane('writer-b', ['file:shared']),
      lane('writer-c', ['file:other']),
    ],
  });

  assert.deepEqual(result.selected.map((item) => item.requestId), ['writer-a', 'writer-c']);
  assert.equal(result.deferred.find((item) => item.requestId === 'writer-b')?.reason, 'MAILBOX_ELASTIC_RESOURCE_CONFLICT');
});

test('deduplicates consumed and repeated request ids', () => {
  const result = planElasticBattleBridgeMailboxDispatch({
    now,
    capacityEvidence: capacity(5),
    consumedRequestIds: new Set(['already-done']),
    candidates: [
      lane('already-done', ['file:a']),
      lane('repeat-me', ['file:b']),
      lane('repeat-me', ['file:c']),
      lane('fresh-one', ['file:d']),
    ],
  });

  assert.deepEqual(result.selected.map((item) => item.requestId), ['repeat-me', 'fresh-one']);
  assert.equal(result.deferred.filter((item) => item.reason === 'MAILBOX_ELASTIC_DUPLICATE_REQUEST').length, 2);
});

test('capacity pressure defers excess work rather than widening authority', () => {
  const result = planElasticBattleBridgeMailboxDispatch({
    now,
    capacityEvidence: capacity(2),
    candidates: [lane('one-lane', ['a']), lane('two-lane', ['b']), lane('three-lane', ['c'])],
  });
  assert.deepEqual(result.selected.map((item) => item.requestId), ['one-lane', 'two-lane']);
  assert.equal(result.deferred.find((item) => item.requestId === 'three-lane')?.reason, 'MAILBOX_ELASTIC_CAPACITY_FULL');
  assert.equal(result.runtimeMutationAuthority, false);
  assert.equal(result.sourceMutationAuthority, false);
  assert.equal(result.approvalAuthority, false);
  assert.equal(result.protectedMergeAuthority, false);
  assert.equal(result.duplicateMailboxAllowed, false);
});
