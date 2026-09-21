import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcileStalledLegacyMissionToSiding } from './stalledLegacyMissionSidingService.js';

const HEAD = 'a'.repeat(40);
const NOW = new Date('2026-09-21T03:30:00.000Z');

function mission(overrides = {}) {
  return {
    missionId: 'critical-1291-worker-watchdog-repair',
    revision: 12,
    currentPhase: 'AGENT_IMPLEMENTATION',
    updatedAt: '2026-09-20T00:00:00.000Z',
    dispatch: { status: 'pending' },
    continuity: { parkingStatus: 'ACTIVE' },
    ...overrides,
  };
}

function heartbeat(overrides = {}) {
  return {
    lastTickVerdict: 'MISSION_WORKER_TICK_PASS',
    ...overrides,
  };
}

function harness({ record = mission(), beat = heartbeat(), lease = null } = {}) {
  const events = [];
  let parkCalls = 0;
  return {
    events,
    get parkCalls() { return parkCalls; },
    options: {
      repoRoot: 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os',
      workspaceRoot: 'C:\\Users\\Stephan Callear\\Documents\\Stephanos-openclaw-workspace',
      sourceHead: HEAD,
      now: NOW,
      runtimePaths: { orchestratorRoot: 'orchestrator', snapshotRoot: 'snapshot' },
      listMissions: async () => [record],
      readJson: async (filePath) => filePath.endsWith('mission-orchestrator-worker-heartbeat.json') ? beat : lease,
      projectHeartbeat: () => ({ valid: true, fresh: true, timestampUtc: NOW.toISOString(), errors: [] }),
      validateLease: () => ({ valid: true, active: false, errors: [] }),
      appendEvent: async (missionId, event) => {
        events.push({ missionId, event });
        return { state: { ...record, revision: record.revision + 1, currentPhase: 'BLOCKED' } };
      },
      parkBlocked: async () => {
        parkCalls += 1;
        return { ok: true, parked: true, classification: 'BLOCKED_MISSION_PROOF_PARKED' };
      },
    },
  };
}

test('fresh exact-head idle worker contradiction blocks and parks stale legacy mission', async () => {
  const h = harness();
  const result = await reconcileStalledLegacyMissionToSiding(h.options);
  assert.equal(result.ok, true);
  assert.equal(result.transitioned, true);
  assert.equal(result.parked, true);
  assert.equal(result.missionId, 'critical-1291-worker-watchdog-repair');
  assert.equal(result.classification, 'STALLED_LEGACY_MISSION_PARKED_FOR_REPAIR');
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].event.eventType, 'MISSION_BLOCKED');
  assert.equal(h.events[0].event.expectedRevision, 12);
  assert.equal(h.events[0].event.expectedCurrentPhase, 'AGENT_IMPLEMENTATION');
  assert.equal(h.parkCalls, 1);
});

test('active worker claim prevents stale mission siding', async () => {
  const h = harness({ beat: heartbeat({
    lastTickVerdict: 'MISSION_WORKER_TICK_RUNNING',
    activeTaskId: 'task-1291',
    activeReceiptId: 'receipt-1291',
    executionPhase: 'AGENT_IMPLEMENTATION',
  }) });
  const result = await reconcileStalledLegacyMissionToSiding(h.options);
  assert.equal(result.classification, 'WORKER_NOT_PROVEN_IDLE');
  assert.equal(result.transitioned, false);
  assert.equal(h.events.length, 0);
  assert.equal(h.parkCalls, 0);
});

test('active mutation lease prevents stale mission siding', async () => {
  const h = harness({ lease: { leaseId: 'lease-active' } });
  h.options.validateLease = () => ({ valid: true, active: true, errors: [] });
  const result = await reconcileStalledLegacyMissionToSiding(h.options);
  assert.equal(result.classification, 'SOURCE_MUTATION_LEASE_ACTIVE');
  assert.equal(result.transitioned, false);
  assert.equal(h.events.length, 0);
  assert.equal(h.parkCalls, 0);
});

test('recent mission is never sent to the siding', async () => {
  const h = harness({ record: mission({ updatedAt: '2026-09-21T03:29:30.000Z' }) });
  const result = await reconcileStalledLegacyMissionToSiding(h.options);
  assert.equal(result.classification, 'NO_STALLED_LEGACY_SOURCE_MISSION');
  assert.equal(result.transitioned, false);
  assert.equal(h.events.length, 0);
  assert.equal(h.parkCalls, 0);
});

test('unverifiable lease fails closed', async () => {
  const h = harness({ lease: { leaseId: 'malformed' } });
  h.options.validateLease = () => ({ valid: false, active: false, errors: ['invalid-record'] });
  const result = await reconcileStalledLegacyMissionToSiding(h.options);
  assert.equal(result.classification, 'SOURCE_MUTATION_LEASE_UNVERIFIABLE');
  assert.equal(result.transitioned, false);
  assert.equal(h.events.length, 0);
  assert.equal(h.parkCalls, 0);
});
