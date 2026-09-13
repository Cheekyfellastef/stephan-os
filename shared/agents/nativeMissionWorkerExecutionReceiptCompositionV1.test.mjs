import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const leaseService = readFileSync(
  new URL('../../stephanos-server/services/elasticPrHeadLeaseService.js', import.meta.url),
  'utf8',
);
const workerConsumer = readFileSync(
  new URL('../../stephanos-server/services/missionOrchestratorWorkerConsumer.js', import.meta.url),
  'utf8',
);

test('native PR-head dispatch durably composes canonical execution receipts around queue publication', () => {
  assert.match(leaseService, /executionReceiptV1\.mjs/,
    'PR-head lease dispatch must reuse the canonical execution receipt subsystem');
  assert.match(leaseService, /createExecutionReceipt/,
    'PR-head lease dispatch must construct a canonical queued receipt');
  assert.match(leaseService, /appendExecutionReceipt/,
    'PR-head lease dispatch must durably append the queued receipt');
  assert.match(leaseService, /state\s*:\s*['"]queued['"]/,
    'queue publication must be represented by a canonical queued lifecycle state');
  assert.match(leaseService, /publishWorkerAction/,
    'receipt composition must remain on the existing Mission Worker publication path');
});

test('Mission Worker claim and execution append accepted started progress and terminal receipts', () => {
  assert.match(workerConsumer, /executionReceiptV1\.mjs/,
    'Mission Worker consumer must reuse the canonical execution receipt subsystem');
  assert.match(workerConsumer, /appendExecutionReceipt/,
    'Mission Worker consumer must durably append lifecycle receipts');
  for (const state of ['accepted', 'started', 'progress', 'completed', 'failed', 'cancelled']) {
    assert.match(workerConsumer, new RegExp(`state\\s*:\\s*['"]${state}['"]`),
      `Mission Worker consumer must preserve canonical ${state} receipt semantics`);
  }
  assert.match(workerConsumer, /heartbeat/i,
    'claim/execution composition must publish fresh heartbeat truth rather than infer liveness');
});

test('native lifecycle composition stays on existing lease, queue and receipt planes', () => {
  assert.match(leaseService, /claimSourceMutationLease/);
  assert.match(leaseService, /publishNextMissionWorkerAction/);
  assert.match(workerConsumer, /claimNextMissionWorkerItem/);
  assert.doesNotMatch(`${leaseService}\n${workerConsumer}`, /leaseSeizureAllowed\s*:\s*true/,
    'receipt composition must never widen lease-seizure authority');
});
