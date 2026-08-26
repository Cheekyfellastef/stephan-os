import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
} from './programmeAuthorityV1.mjs';
import {
  reconcileDurableFlywheelController,
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
const RELEASE_MARKER = 'SOURCE_MUTATION_LEASE_RELEASE_MARKER_PRESENT';
const RELEASE_BLOCKER = `source:${RELEASE_MARKER}`;
const TERMINAL_AUTHORITY_BLOCKER = 'controller-heartbeat-terminal-lane-authority-unproven';

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

function interruptedReleaseProjection(blockers = [RELEASE_BLOCKER], overrides = {}) {
  const projection = terminalProjection();
  return {
    ...projection,
    status: 'HOLD',
    blockers,
    terminalReconciliationState: 'REQUIRED',
    sourceReads: {
      lease: RELEASE_MARKER,
    },
    ...overrides,
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
  assert.deepEqual(order, ['STARTING', 'FINALIZING', 'HOLD']);
  assert.ok(result.blockers.includes(
    'controller-heartbeat:finalizing-heartbeat-failed',
  ));
});

test('exact interrupted release marker reaches the existing terminal finalizer after bounded authority proof', async () => {
  let projectionReads = 0;
  const finalizations = [];
  const heartbeatStates = [];
  const result = await runDurableFlywheelStartupCycle(machinery({
    publishControllerHeartbeat: async ({ cycleState, boundedMutationSteps }) => {
      heartbeatStates.push([cycleState, boundedMutationSteps]);
      return { ok: true };
    },
    loadAuthoritativeProjection: async () => {
      projectionReads += 1;
      if (projectionReads === 1) {
        return interruptedReleaseProjection([
          RELEASE_BLOCKER,
          'controller-heartbeat-cycle-state-does-not-authorize-terminal-reconciliation',
          TERMINAL_AUTHORITY_BLOCKER,
        ]);
      }
      if (projectionReads === 2) {
        return interruptedReleaseProjection([
          RELEASE_BLOCKER,
          TERMINAL_AUTHORITY_BLOCKER,
        ]);
      }
      return interruptedReleaseProjection();
    },
    finalizeTerminalLane: async (input) => {
      finalizations.push(input);
      return {
        ok: true,
        finalized: true,
        recoveredInterruptedRelease: true,
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

  assert.equal(projectionReads, 3);
  assert.deepEqual(heartbeatStates.slice(0, 3), [
    ['STARTING', 0],
    ['FINALIZING', 0],
    ['FINALIZING', 1],
  ]);
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
  assert.equal(result.projectionStatus, 'HOLD');
  assert.equal(result.action, 'FINALIZE_EXACT_TERMINAL_LANE');
  assert.equal(result.actionResult.recoveredInterruptedRelease, true);
  assert.equal(result.allowWorkerTick, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.leaseSeizureAllowed, false);
});

test('interrupted release recovery remains fail closed for non-terminal, mismatched or additionally blocked truth', () => {
  const active = interruptedReleaseProjection([RELEASE_BLOCKER], {
    lane: {
      ...terminalProjection().lane,
      active: true,
      terminal: false,
    },
    terminalReconciliationState: 'NOT_REQUIRED',
  });
  const activeResult = reconcileDurableFlywheelController(active, {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
  });
  assert.equal(activeResult.status, 'HOLD');

  const mismatched = interruptedReleaseProjection([RELEASE_BLOCKER], {
    mutationLease: {
      ...terminalProjection().mutationLease,
      headSha: 'c'.repeat(40),
    },
  });
  const mismatchedResult = reconcileDurableFlywheelController(mismatched, {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
  });
  assert.equal(mismatchedResult.status, 'HOLD');

  const additionallyBlocked = interruptedReleaseProjection([
    RELEASE_BLOCKER,
    'source:github-pr-evidence-unavailable',
  ]);
  const additionallyBlockedResult = reconcileDurableFlywheelController(additionallyBlocked, {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
  });
  assert.equal(additionallyBlockedResult.status, 'HOLD');
  assert.ok(additionallyBlockedResult.blockers.includes(
    'authority:source:github-pr-evidence-unavailable',
  ));
});
