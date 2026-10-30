import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveElasticMailboxResourceEvidence } from './elasticBattleBridgeMailboxResourceEvidenceV1.mjs';

const HEAD = 'bff514af59d7580917a665a06140a8eaebca2add';
const NOW = new Date('2026-09-04T16:40:00Z');

function snapshot(overrides = {}) {
  return {
    sourceHead: HEAD,
    observedAtUtc: '2026-09-04T16:39:30Z',
    exactSourceBound: true,
    mutationAuthority: false,
    activeResourceIds: ['file:owned-a'],
    commandClaims: [
      { requestId: 'req-a', laneId: 'lane-a', resourceIds: ['file:a'] },
      { requestId: 'req-b', laneId: 'lane-b', resourceIds: ['file:b'], approvalGated: true },
    ],
    ...overrides,
  };
}

test('projects exact scheduler-owned resources and command metadata', () => {
  const result = deriveElasticMailboxResourceEvidence({ schedulerSnapshot: snapshot(), currentHead: HEAD, now: NOW });
  assert.equal(result.ok, true);
  assert.deepEqual(result.activeResourceIds, ['file:owned-a']);
  assert.deepEqual(result.commandMetadata['req-a'].resources, ['file:a']);
  assert.equal(result.commandMetadata['req-b'].approvalGated, true);
  assert.equal(result.mutationAuthority, false);
});

test('rejects stale and wrong-head resource evidence', () => {
  assert.equal(deriveElasticMailboxResourceEvidence({ schedulerSnapshot: snapshot({ observedAtUtc: '2026-09-04T16:00:00Z' }), currentHead: HEAD, now: NOW }).ok, false);
  assert.equal(deriveElasticMailboxResourceEvidence({ schedulerSnapshot: snapshot({ sourceHead: '0'.repeat(40) }), currentHead: HEAD, now: NOW }).blocker, 'MAILBOX_RESOURCE_HEAD_MISMATCH');
});

test('rejects authority-bearing resource evidence', () => {
  const result = deriveElasticMailboxResourceEvidence({ schedulerSnapshot: snapshot({ mutationAuthority: true }), currentHead: HEAD, now: NOW });
  assert.equal(result.blocker, 'MAILBOX_RESOURCE_AUTHORITY_INVALID');
});

test('requires closed resource scopes and unique request claims', () => {
  assert.equal(deriveElasticMailboxResourceEvidence({ schedulerSnapshot: snapshot({ commandClaims: [{ requestId: 'req-a', resourceIds: [] }] }), currentHead: HEAD, now: NOW }).blocker, 'MAILBOX_COMMAND_RESOURCE_SCOPE_REQUIRED');
  assert.equal(deriveElasticMailboxResourceEvidence({ schedulerSnapshot: snapshot({ commandClaims: [{ requestId: 'req-a', resourceIds: ['file:a'] }, { requestId: 'req-a', resourceIds: ['file:b'] }] }), currentHead: HEAD, now: NOW }).blocker, 'MAILBOX_COMMAND_CLAIM_ID_INVALID');
});
