import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SOVEREIGN_COMMANDER_FLEET_SWEEP_LIMIT,
  runSovereignCommanderFleetGoalSupervisor,
} from '../../scripts/sovereign-commander-fleet-goal-supervisor.mjs';

function heartbeatResult(overrides = {}) {
  return {
    ok: true,
    cycleId: 'goal-build-cycle-20261001110000000',
    finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_SOURCE_CHANGED_AND_TESTED',
    conveyorResult: {
      elasticAdmission: {
        activeMissions: [{ missionId: 'mission-a' }],
        runnableMissions: [{ missionId: 'mission-b' }],
      },
      elasticIgnition: {
        availableSlots: 1,
        dispatchCount: 1,
        dispatched: [{ missionId: 'mission-b' }],
      },
    },
    materialActionsSucceeded: 1,
    parkedLaneBlockers: [],
    noRunnableSourceWorkProven: false,
    controllerContinuity: 'CONTINUE_NEXT_SWEEP',
    elasticHold: null,
    ...overrides,
  };
}

test('Sovereign fleet-goal supervisor delegates one bounded tick to the canonical work-conserving heartbeat', async () => {
  let observed = null;
  const now = new Date('2026-10-01T11:00:00.000Z');
  const result = await runSovereignCommanderFleetGoalSupervisor({
    now,
    heartbeat: async (options) => {
      observed = options;
      return heartbeatResult();
    },
  });

  assert.equal(observed.maxWorkConservingAttempts, DEFAULT_SOVEREIGN_COMMANDER_FLEET_SWEEP_LIMIT);
  assert.equal(observed.now, now);
  assert.equal(result.ok, true);
  assert.equal(result.continuationRequired, true);
  assert.equal(result.runnableGoalCount, 1);
  assert.equal(result.availableSlotCount, 1);
  assert.equal(result.dispatchCount, 1);
  assert.equal(result.canonicalHeartbeatOnly, true);
  assert.equal(result.duplicateSchedulerAllowed, false);
  assert.equal(result.duplicateLeaseAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_CONTINUE');
});

test('Sovereign fleet-goal supervisor treats proven no-work as green idle rather than inventing work', async () => {
  const result = await runSovereignCommanderFleetGoalSupervisor({
    heartbeat: async () => heartbeatResult({
      finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_COMPLETE',
      conveyorResult: {
        elasticAdmission: { activeMissions: [], runnableMissions: [] },
        elasticIgnition: { availableSlots: 4, dispatchCount: 0, dispatched: [] },
      },
      materialActionsSucceeded: 0,
      noRunnableSourceWorkProven: true,
      controllerContinuity: 'RETURN_WORK_CONSERVING',
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.runnableGoalCount, 0);
  assert.equal(result.noRunnableSourceWorkProven, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_IDLE_GREEN');
});

test('Sovereign fleet-goal supervisor fails closed if safe work and proven capacity are stranded', async () => {
  const result = await runSovereignCommanderFleetGoalSupervisor({
    heartbeat: async () => heartbeatResult({
      conveyorResult: {
        elasticAdmission: {
          activeMissions: [],
          runnableMissions: [{ missionId: 'mission-ready' }],
        },
        elasticIgnition: {
          availableSlots: 2,
          dispatchCount: 0,
          dispatched: [],
        },
      },
      materialActionsSucceeded: 0,
      parkedLaneBlockers: [],
      noRunnableSourceWorkProven: false,
      controllerContinuity: 'RETURN_WORK_CONSERVING',
      elasticHold: null,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SAFE_RUNNABLE_WORK_AND_FREE_CAPACITY_STRANDED');
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_BLOCKED');
});

test('Sovereign fleet-goal supervisor preserves canonical heartbeat blockers without widening authority', async () => {
  const result = await runSovereignCommanderFleetGoalSupervisor({
    heartbeat: async () => ({
      ok: false,
      blocker: 'MISSION_WORKER_RUNTIME_NOT_READY',
      finalVerdict: 'GOAL_DISCOVERY_HEARTBEAT_BLOCKED',
      parkedLaneBlockers: ['mission-a:worker-not-ready'],
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'MISSION_WORKER_RUNTIME_NOT_READY');
  assert.equal(result.parkedLaneBlockerCount, 1);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
  assert.equal(result.arbitraryShellAllowed, false);
});
