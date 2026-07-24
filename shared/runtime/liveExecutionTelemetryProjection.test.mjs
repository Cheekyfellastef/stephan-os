import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLiveExecutionTelemetryProjection,
  LIVE_EXECUTION_HEARTBEAT_TTL_MS,
} from './liveExecutionTelemetryProjection.mjs';

const NOW = '2026-07-24T17:30:00.000Z';
const HEAD = 'a'.repeat(40);

function receipt(overrides = {}) {
  return {
    receiptId: 'receipt-3001',
    taskId: 'task-1556-m1',
    goal: '#1556',
    pr: 1600,
    owner: 'github-first-chatgpt',
    provider: 'openai',
    phase: 'portfolio read model',
    state: 'BUILDING',
    sourceHead: HEAD,
    remoteHead: HEAD,
    heartbeatAt: '2026-07-24T17:29:00.000Z',
    nextAction: 'Continue implementation.',
    ...overrides,
  };
}

test('unverified telemetry source proves no active build', () => {
  const projection = buildLiveExecutionTelemetryProjection({ now: NOW, receipts: [receipt()] });
  assert.equal(projection.sourceVerified, false);
  assert.equal(projection.authoritative, false);
  assert.equal(projection.activeBuilderCount, 0);
  assert.equal(projection.answer, 'NO_ACTIVE_BUILD_PROVEN');
});

test('fresh verified heartbeat proves one active builder', () => {
  const projection = buildLiveExecutionTelemetryProjection({
    now: NOW,
    source: { verified: true },
    receipts: [receipt()],
  });
  assert.equal(projection.authoritative, true);
  assert.equal(projection.activeBuilderCount, 1);
  assert.equal(projection.activeBuilders[0].effectiveState, 'BUILDING');
  assert.equal(projection.activeBuilders[0].heartbeatCurrent, true);
  assert.equal(projection.answer, 'ACTIVE_BUILD_PROVEN');
});

test('expired active heartbeat becomes stale instead of remaining building', () => {
  const projection = buildLiveExecutionTelemetryProjection({
    now: NOW,
    source: { verified: true },
    receipts: [receipt({ heartbeatAt: '2026-07-24T17:20:00.000Z' })],
  });
  assert.equal(projection.heartbeatTtlMs, LIVE_EXECUTION_HEARTBEAT_TTL_MS);
  assert.equal(projection.activeBuilderCount, 0);
  assert.equal(projection.staleBuilderCount, 1);
  assert.equal(projection.receipts[0].effectiveState, 'STALE');
  assert.equal(projection.answer, 'NO_ACTIVE_BUILD_PROVEN');
});

test('local completion remains distinct from remote publication', () => {
  const projection = buildLiveExecutionTelemetryProjection({
    now: NOW,
    source: { verified: true },
    receipts: [receipt({ state: 'LOCAL_BUILD_COMPLETE', remoteHead: null })],
  });
  assert.equal(projection.activeBuilders[0].localOnly, true);
  assert.equal(projection.activeBuilders[0].effectiveState, 'LOCAL_BUILD_COMPLETE');
});

test('duplicate active task identities fail closed as state divergence', () => {
  const projection = buildLiveExecutionTelemetryProjection({
    now: NOW,
    source: { verified: true },
    receipts: [receipt(), receipt({ receiptId: 'receipt-3002', owner: 'remote-codex' })],
  });
  assert.equal(projection.stateDivergence, true);
  assert.equal(projection.authoritative, false);
  assert.equal(projection.activeBuilderCount, 0);
  assert.deepEqual(projection.activeBuilders, []);
  assert.equal(projection.answer, 'STATE_DIVERGENCE');
});

test('malformed identities and heads are normalized fail closed', () => {
  const projection = buildLiveExecutionTelemetryProjection({
    now: NOW,
    source: { verified: true },
    receipts: [receipt({ taskId: '../unsafe', sourceHead: 'not-a-sha', remoteHead: ['bad'] })],
  });
  assert.equal(projection.receipts[0].taskId, null);
  assert.equal(projection.receipts[0].sourceHead, null);
  assert.equal(projection.receipts[0].remoteHead, null);
});
