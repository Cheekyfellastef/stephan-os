import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
} from './programmeAuthorityV1.mjs';
import {
  runDurableFlywheelStartupCycle,
} from './durableFlywheelControllerVNext.mjs';

const NOW = '2026-07-30T13:00:00.000Z';
const SOURCE_REVISION = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const LANE_ID = 'goal-1497-pr-1617';
const LEASE_ID = 'lease-goal-1497-pr-1617';
const OWNER_ID = 'mission-worker';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const BRANCH = 'feat/durable-flywheel-controller-vnext';

function terminalProjection() {
  return {
    schemaVersion: AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
    status: 'TERMINAL_RECONCILIATION_REQUIRED',
    observedAtUtc: NOW,
    blockers: [],
    chatMemoryAuthoritative: false,
    sourceConstructionMode: 'production-contracts',
    lane: {
      valid: true,
      active: false,
      terminal: true,
      laneId: LANE_ID,
      repository: REPOSITORY,
      issueNumber: 1497,
      prNumber: 1617,
      branch: BRANCH,
      headSha: HEAD,
    },
    mutationLease: {
      leaseId: LEASE_ID,
      laneId: LANE_ID,
      repository: REPOSITORY,
      issueNumber: 1497,
      prNumber: 1617,
      branch: BRANCH,
      headSha: HEAD,
      ownerId: OWNER_ID,
    },
    projectionReceipt: {
      receiptId: 'programme-projection-terminal',
      sourceConstructionMode: 'production-contracts',
    },
  };
}

function machinery(overrides = {}) {
  return {
    publishControllerHeartbeat: async () => ({ ok: true }),
    loadAuthoritativeProjection: async () => terminalProjection(),
    publishReceipt: async () => ({ ok: true }),
    finalizeTerminalLane: async () => ({ ok: true }),
    ensureBacklogMission: async () => {
      throw new Error('terminal reconciliation must not schedule work');
    },
    ...overrides,
  };
}

test('affirmative canonical terminal projection invokes the exact existing finalizer once', async () => {
  const finalizations = [];
  const result = await runDurableFlywheelStartupCycle(machinery({
    finalizeTerminalLane: async (input) => {
      finalizations.push(input);
      return {
        ok: true,
        releaseOnlyExactLease: true,
        schedulesWork: false,
        mergeAuthority: false,
      };
    },
  }), {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });

  assert.equal(finalizations.length, 1);
  assert.deepEqual(finalizations[0], {
    leaseId: LEASE_ID,
    laneId: LANE_ID,
    repository: REPOSITORY,
    issueNumber: 1497,
    prNumber: 1617,
    branch: BRANCH,
    headSha: HEAD,
    ownerId: OWNER_ID,
    nowUtc: NOW,
  });
  assert.equal(result.status, 'TERMINAL_RECONCILIATION_REQUIRED');
  assert.equal(result.allowWorkerTick, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.actionResult.releaseOnlyExactLease, true);
});

test('terminal finalizer rejection remains HOLD and cannot release or schedule indirectly', async () => {
  let calls = 0;
  const result = await runDurableFlywheelStartupCycle(machinery({
    finalizeTerminalLane: async () => {
      calls += 1;
      return {
        ok: false,
        reason: 'SOURCE_MUTATION_LEASE_RELEASE_IDENTITY_INCOMPLETE',
      };
    },
  }), {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });

  assert.equal(calls, 1);
  assert.equal(result.status, 'HOLD');
  assert.equal(result.allowWorkerTick, false);
  assert.ok(result.blockers.includes(
    'terminal-finalization:SOURCE_MUTATION_LEASE_RELEASE_IDENTITY_INCOMPLETE',
  ));
});

test('FINALIZING heartbeat must publish before terminal finalization', async () => {
  const order = [];
  const result = await runDurableFlywheelStartupCycle(machinery({
    publishControllerHeartbeat: async ({ cycleState }) => {
      order.push(cycleState);
      if (cycleState === 'FINALIZING') {
        return { ok: false, reason: 'finalizing-heartbeat-failed' };
      }
      return { ok: true };
    },
    finalizeTerminalLane: async () => {
      order.push('FINALIZER_CALLED');
      return { ok: true };
    },
  }), {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });

  assert.equal(result.status, 'HOLD');
  assert.equal(result.allowWorkerTick, false);
  assert.deepEqual(order, ['RECONCILING', 'FINALIZING', 'HOLD']);
  assert.ok(result.blockers.includes(
    'controller-heartbeat:finalizing-heartbeat-failed',
  ));
});
