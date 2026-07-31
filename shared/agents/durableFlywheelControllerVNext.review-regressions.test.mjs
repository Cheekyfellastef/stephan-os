import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
} from './programmeAuthorityV1.mjs';
import {
  runDurableFlywheelStartupCycle,
} from './durableFlywheelControllerVNext.mjs';
import {
  createMissionOrchestratorState,
} from './missionOrchestrator.mjs';

const NOW = '2026-07-30T13:00:00.000Z';
const SOURCE_REVISION = 'a'.repeat(40);

function projection(status, overrides = {}) {
  return {
    schemaVersion: AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
    status,
    observedAtUtc: NOW,
    blockers: [],
    chatMemoryAuthoritative: false,
    sourceConstructionMode: 'production-contracts',
    lane: null,
    mutationLease: null,
    projectionReceipt: {
      receiptId: 'programme-projection-20260730130000',
      sourceConstructionMode: 'production-contracts',
    },
    ...overrides,
  };
}

function baseMachinery(authoritativeProjection, calls, overrides = {}) {
  return {
    publishControllerHeartbeat: async (heartbeat) => {
      calls.push(['heartbeat', heartbeat.cycleState]);
      return { ok: true };
    },
    loadAuthoritativeProjection: async () => {
      calls.push(['canonical-projection']);
      return authoritativeProjection;
    },
    publishReceipt: async (receipt) => {
      calls.push(['receipt', receipt.action]);
      return { ok: true };
    },
    ensureBacklogMission: async () => {
      calls.push(['canonical-conveyor']);
      return {
        ok: true,
        createdMission: true,
        projection: {
          activeMission: {
            missionId: 'critical-1497-review-test',
            revision: 0,
            currentPhase: 'LIVE_RUNTIME_INVESTIGATION',
            repository: 'Cheekyfellastef/stephan-os',
          },
        },
      };
    },
    finalizeTerminalLane: async () => {
      calls.push(['canonical-finalizer']);
      return { ok: true };
    },
    ...overrides,
  };
}

test('READY work is admitted only through the existing Critical Backlog Conveyor', async () => {
  const calls = [];
  const result = await runDurableFlywheelStartupCycle(
    baseMachinery(projection('READY'), calls),
    { nowUtc: NOW, sourceRevision: SOURCE_REVISION, env: {} },
  );

  assert.equal(result.status, 'READY');
  assert.equal(result.action, 'CREATE_CANONICAL_CONVEYOR_MISSION');
  assert.equal(result.allowWorkerTick, true);
  assert.equal(result.workerActionGrant.missionId, 'critical-1497-review-test');
  assert.equal(result.workerActionGrant.boundedActionCount, 1);
  assert.equal(result.actionResult.createdMission, true);
  assert.equal(calls.filter(([name]) => name === 'canonical-conveyor').length, 1);
  assert.equal(result.createsReplacementMachinery, false);
  assert.equal(result.mergeAuthority, false);
});

test('conveyor rejection is a HOLD and never authorizes the Mission Worker', async () => {
  const calls = [];
  const result = await runDurableFlywheelStartupCycle(
    baseMachinery(projection('READY'), calls, {
      ensureBacklogMission: async () => {
        calls.push(['canonical-conveyor']);
        return {
          ok: false,
          classification: 'BLOCKED_BY_MULTIPLE_ACTIVE_MISSIONS',
        };
      },
    }),
    { nowUtc: NOW, sourceRevision: SOURCE_REVISION, env: {} },
  );

  assert.equal(result.status, 'HOLD');
  assert.equal(result.allowWorkerTick, false);
  assert.ok(result.blockers.includes(
    'critical-backlog:BLOCKED_BY_MULTIPLE_ACTIVE_MISSIONS',
  ));
});

test('cycle receipt publication failure revokes otherwise valid work authority', async () => {
  const calls = [];
  const result = await runDurableFlywheelStartupCycle(
    baseMachinery(projection('READY'), calls, {
      publishReceipt: async () => ({ ok: false, reason: 'disk-unavailable' }),
    }),
    { nowUtc: NOW, sourceRevision: SOURCE_REVISION, env: {} },
  );

  assert.equal(result.status, 'HOLD');
  assert.equal(result.allowWorkerTick, false);
  assert.ok(result.blockers.includes('cycle-receipt:disk-unavailable'));
});

test('controller heartbeat failure blocks projection reads and source work', async () => {
  let projectionReads = 0;
  let conveyorCalls = 0;
  const receipts = [];
  const result = await runDurableFlywheelStartupCycle({
    publishControllerHeartbeat: async () => ({
      ok: false,
      reason: 'controller-heartbeat-write-failed',
    }),
    loadAuthoritativeProjection: async () => {
      projectionReads += 1;
      return projection('READY');
    },
    ensureBacklogMission: async () => {
      conveyorCalls += 1;
      return { ok: true };
    },
    publishReceipt: async (receipt) => {
      receipts.push(receipt);
      return { ok: true };
    },
  }, {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });

  assert.equal(result.status, 'HOLD');
  assert.equal(result.allowWorkerTick, false);
  assert.equal(projectionReads, 0);
  assert.equal(conveyorCalls, 0);
  assert.equal(receipts.length, 1);
});

test('startup crash cannot publish success evidence for a receipt that does not exist', async () => {
  const heartbeats = [];
  await assert.rejects(
    runDurableFlywheelStartupCycle({
      publishControllerHeartbeat: async (heartbeat) => {
        heartbeats.push(heartbeat);
        return { ok: true };
      },
      loadAuthoritativeProjection: async () => {
        throw new Error('projection read crashed');
      },
      publishReceipt: async () => {
        throw new Error('receipt must not be fabricated after crash');
      },
    }, {
      nowUtc: NOW,
      sourceRevision: SOURCE_REVISION,
      env: {},
    }),
    /projection read crashed/,
  );

  assert.equal(heartbeats.length, 1);
  assert.equal(heartbeats[0].cycleState, 'STARTING');
  assert.equal(heartbeats[0].lastSuccessfulReconciliationUtc, '');
  assert.equal(heartbeats[0].lastPublishedReceiptId, '');
  assert.deepEqual(heartbeats[0].proofRefs, []);
  assert.equal(heartbeats[0].boundedMutationSteps, 0);
});

test('legacy injected snapshots and direct dispatch hooks cannot become authority', async () => {
  const calls = [];
  let legacySnapshotReads = 0;
  let directDispatches = 0;
  const result = await runDurableFlywheelStartupCycle({
    ...baseMachinery(projection('IDLE'), calls),
    loadDurableSnapshot: async () => {
      legacySnapshotReads += 1;
      return { injectedGoal: 9999 };
    },
    dispatchSelectedGoal: async () => {
      directDispatches += 1;
      return { ok: true };
    },
    advanceActiveLane: async () => {
      directDispatches += 1;
      return { ok: true };
    },
  }, {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });

  assert.equal(result.status, 'IDLE');
  assert.equal(result.allowWorkerTick, false);
  assert.equal(legacySnapshotReads, 0);
  assert.equal(directDispatches, 0);
  assert.equal(calls.filter(([name]) => name === 'canonical-projection').length, 1);
});

test('canonical projection is re-read after ACTIVE_LANE heartbeat before work is allowed', async () => {
  const lane = {
    valid: true,
    active: true,
    terminal: false,
    laneId: 'goal-1497-pr-1617',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1497,
    prNumber: 1617,
    branch: 'feat/durable-flywheel-controller-vnext',
    headSha: 'b'.repeat(40),
  };
  const first = projection('ACTIVE', { lane });
  const second = projection('HOLD', {
    lane,
    blockers: ['execution:sourceHead mismatch'],
  });
  let reads = 0;
  const calls = [];
  const result = await runDurableFlywheelStartupCycle({
    ...baseMachinery(first, calls),
    loadAuthoritativeProjection: async () => {
      reads += 1;
      return reads === 1 ? first : second;
    },
  }, {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });

  assert.equal(reads, 2);
  assert.equal(result.status, 'HOLD');
  assert.equal(result.allowWorkerTick, false);
  assert.ok(result.blockers.includes('authority:execution:sourceHead mismatch'));
});

test('active-lane mutation authority is exposed only after its durable transition receipt exists', async () => {
  const lane = {
    valid: true,
    active: true,
    terminal: false,
    laneId: 'goal-1497-pr-1617',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1497,
    prNumber: 1617,
    branch: 'feat/durable-flywheel-controller-vnext',
    headSha: 'b'.repeat(40),
  };
  const activeMission = createMissionOrchestratorState({
    missionId: 'goal-1497-pr-1617',
    operatorIntent: 'Implement one bounded unattended controller repair.',
    intendedOutcome: 'Advance the exact existing mission by one action.',
    missionKind: 'implementation',
    repository: 'Cheekyfellastef/stephan-os',
    repositoryRoot: 'C:\\repo',
    branch: 'openclaw/goal-1497-pr-1617',
    worktreePath: 'C:\\worktree',
    allowedFiles: ['shared/agents/**'],
    requiredEvidence: ['focused test output'],
    requiredTests: ['node --test focused.test.mjs'],
  }, { now: new Date(NOW) });
  const transitionBlocked = projection('HOLD', {
    lane,
    blockers: ['controller-heartbeat-active-lane-authority-unproven'],
    criticalBacklog: { activeMission },
  });
  const active = projection('ACTIVE', {
    lane,
    criticalBacklog: { activeMission },
  });
  let reads = 0;
  const events = [];
  const receipts = [];
  const heartbeats = [];
  const result = await runDurableFlywheelStartupCycle({
    publishControllerHeartbeat: async (heartbeat) => {
      events.push(`heartbeat:${heartbeat.cycleState}:${heartbeat.boundedMutationSteps}`);
      heartbeats.push(heartbeat);
      return { ok: true };
    },
    loadAuthoritativeProjection: async () => {
      reads += 1;
      return reads < 3 ? transitionBlocked : active;
    },
    publishReceipt: async (receipt) => {
      events.push(`receipt:${receipt.receiptId}`);
      receipts.push(receipt);
      return { ok: true };
    },
  }, {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });

  assert.equal(reads, 3);
  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.allowWorkerTick, true);
  assert.equal(receipts.length, 2);
  assert.match(receipts[0].receiptId, /-authority$/);
  assert.equal(receipts[0].boundedMutationSteps, 0);
  assert.equal(heartbeats[1].cycleState, 'ACTIVE_LANE');
  assert.equal(heartbeats[1].boundedMutationSteps, 0);
  assert.equal(heartbeats[1].lastPublishedReceiptId, '');
  assert.equal(heartbeats[2].cycleState, 'ACTIVE_LANE');
  assert.equal(heartbeats[2].boundedMutationSteps, 1);
  assert.equal(heartbeats[2].lastPublishedReceiptId, receipts[0].receiptId);
  assert.ok(
    events.indexOf(`receipt:${receipts[0].receiptId}`)
      < events.indexOf('heartbeat:ACTIVE_LANE:1'),
  );
});
