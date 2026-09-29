import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const leaseService = readFileSync(
  new URL('../../stephanos-server/services/elasticPrHeadLeaseService.js', import.meta.url),
  'utf8',
);
const workerService = readFileSync(
  new URL('../../stephanos-server/services/missionOrchestratorWorkerService.js', import.meta.url),
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

test('native PR-head queue item persists immutable grant and lease binding for restart replay', () => {
  assert.match(workerService, /stephanos\.mission-worker-queue-execution-binding\.v1/,
    'queue publication must persist a typed execution binding');
  assert.match(workerService, /actionGrant/,
    'queue publication must persist the exact action grant rather than rely on process-local options');
  assert.match(workerService, /leaseKey/,
    'queue publication must durably bind the canonical source-mutation lease');
  assert.match(workerService, /executionBinding/,
    'queue publication must place the immutable binding inside the queue item');
  assert.match(workerConsumer, /EXECUTION_RECEIPT_QUEUE_BINDING_INCOMPLETE/,
    'native bound queue items must fail closed when persisted binding evidence is incomplete');
  assert.match(workerConsumer, /EXECUTION_RECEIPT_QUEUE_BINDING_IDENTITY_MISMATCH/,
    'consumer must reject queue binding that disagrees with canonical queued receipt truth');
  assert.match(workerConsumer, /EXECUTION_RECEIPT_RUNTIME_GRANT_MISMATCH/,
    'a process-local grant must not be allowed to disagree with persisted restart truth');
  assert.match(workerConsumer, /leaseKey:\s*persisted\.binding\.leaseKey/,
    'receipt history lookup must be constrained by the persisted canonical lease');
});

test('Mission Worker claim and execution append accepted started progress and terminal receipts', () => {
  assert.match(workerConsumer, /executionReceiptV1\.mjs/,
    'Mission Worker consumer must reuse the canonical execution receipt subsystem');
  assert.match(workerConsumer, /appendExecutionReceipt/,
    'Mission Worker consumer must durably append lifecycle receipts');
  for (const state of ['accepted', 'started', 'progress']) {
    assert.match(workerConsumer, new RegExp(`appendReceiptTransition\\([\\s\\S]*?['"]${state}['"]`),
      `Mission Worker consumer must append canonical ${state} receipt semantics through the transition helper`);
  }
  assert.match(workerConsumer, /execution\.success\s*===\s*true\s*\?\s*['"]completed['"]\s*:\s*['"]failed['"]/,
    'normal terminal execution must resolve deterministically to completed or failed');
  assert.match(workerConsumer, /appendReceiptTransition\([^)]*['"]failed['"]/s,
    'exceptional execution must append failed terminal truth');
  assert.match(workerConsumer, /['"]cancelled['"]/,
    'the canonical terminal-state policy must continue to recognize cancelled truth');
  assert.match(workerConsumer, /heartbeat/i,
    'claim/execution composition must publish fresh heartbeat truth rather than infer liveness');
});

test('native lifecycle composition stays on existing lease, queue and receipt planes', () => {
  assert.match(leaseService, /claimSourceMutationLease/);
  assert.match(leaseService, /publishNextMissionWorkerAction/);
  assert.match(workerConsumer, /claimNextMissionWorkerItem/);
  assert.doesNotMatch(`${leaseService}\n${workerService}\n${workerConsumer}`, /leaseSeizureAllowed\s*:\s*true/,
    'receipt composition must never widen lease-seizure authority');
});
