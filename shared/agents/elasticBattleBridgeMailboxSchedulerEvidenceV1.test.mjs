import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveElasticBuildWidth } from './elasticBuildCapacityV1.mjs';
import { deriveMailboxCapacityEvidenceFromScheduler } from './elasticBattleBridgeMailboxSchedulerEvidenceV1.mjs';

const HEAD = 'bff514af59d7580917a665a06140a8eaebca2add';
const NOW = new Date('2026-09-04T16:40:00Z');

function scheduler(overrides = {}) {
  return deriveElasticBuildWidth({
    activeLaneCount: 2,
    readyIndependentWorkCount: 4,
    availableExecutorSlots: 8,
    ...overrides,
  });
}

function evidence(overrides = {}) {
  return deriveMailboxCapacityEvidenceFromScheduler({
    schedulerCapacity: scheduler(),
    schedulerHead: HEAD,
    currentHead: HEAD,
    observedAtUtc: '2026-09-04T16:39:30Z',
    now: NOW,
    ...overrides,
  });
}

test('projects exact-current scheduler capacity into bounded mailbox width', () => {
  const result = evidence();
  assert.equal(result.ok, true);
  assert.equal(result.exactSourceBound, true);
  assert.equal(result.provenWidth, 5);
  assert.equal(result.schedulerDesiredWidth, 6);
  assert.equal(result.mutationAuthority, false);
});

test('fails closed on scheduler head mismatch', () => {
  const result = evidence({ schedulerHead: '0'.repeat(40) });
  assert.equal(result.ok, false);
  assert.equal(result.provenWidth, 1);
  assert.equal(result.blocker, 'MAILBOX_SCHEDULER_HEAD_MISMATCH');
});

test('fails closed on stale scheduler evidence', () => {
  const result = evidence({ observedAtUtc: '2026-09-04T16:30:00Z' });
  assert.equal(result.ok, false);
  assert.equal(result.provenWidth, 1);
  assert.equal(result.blocker, 'MAILBOX_SCHEDULER_EVIDENCE_STALE');
});

test('does not treat degraded scheduler capacity as elastic proof', () => {
  const degraded = deriveElasticBuildWidth({
    activeLaneCount: 1,
    readyIndependentWorkCount: 4,
    availableExecutorSlots: 2,
  });
  const result = evidence({ schedulerCapacity: degraded });
  assert.equal(result.ok, false);
  assert.equal(result.provenWidth, 1);
  assert.equal(result.blocker, 'MAILBOX_SCHEDULER_CAPACITY_NOT_RUNNING');
});

test('caps scheduler width to mailbox hard ceiling and executor evidence', () => {
  const wide = deriveElasticBuildWidth({
    activeLaneCount: 5,
    readyIndependentWorkCount: 10,
    availableExecutorSlots: 16,
  });
  const result = evidence({ schedulerCapacity: wide });
  assert.equal(result.ok, true);
  assert.equal(result.provenWidth, 5);
});

test('rejects authority-bearing forged scheduler projection', () => {
  const forged = { ...scheduler(), mutationAuthority: true };
  const result = evidence({ schedulerCapacity: forged });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'MAILBOX_SCHEDULER_AUTHORITY_INVALID');
  assert.equal(result.provenWidth, 1);
});
