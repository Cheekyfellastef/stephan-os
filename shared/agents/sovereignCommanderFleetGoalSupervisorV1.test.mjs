import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  runSovereignCommanderFleetGoalSupervisor,
} from '../../scripts/sovereign-commander-fleet-goal-supervisor.mjs';

const supervisorSource = await readFile(
  new URL('../../scripts/sovereign-commander-fleet-goal-supervisor.mjs', import.meta.url),
  'utf8',
);

function conveyorResult(overrides = {}) {
  return {
    ok: true,
    classification: 'ELASTIC_GOAL_MISSION_SELECTED',
    finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_PASS',
    programmeStatus: 'READY',
    programmeBlockers: [],
    elasticAdmission: {
      activeMissions: [{ missionId: 'mission-a', dispatch: { status: 'running' } }],
      runnableMissions: [{ missionId: 'mission-b' }],
    },
    elasticIgnition: {
      availableSlots: 1,
      dispatchCount: 1,
      dispatched: [{ missionId: 'mission-b' }],
      held: [],
    },
    workerRuntimeHold: false,
    ...overrides,
  };
}
function parityResult(overrides = {}) {
  return {
    ok: true,
    canonicalOwnerGoal: '#2573',
    retainedCapabilityCount: 1,
    parityPresentCount: 0,
    buildableGapCount: 1,
    boundaryHoldCount: 0,
    finalVerdict: 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_GAPS_TRACKED',
    ...overrides,
  };
}

function runSupervisor(options = {}) {
  return runSovereignCommanderFleetGoalSupervisor({
    reconcileCommanderParity: async () => parityResult(),
    ...options,
  });
}


test('Sovereign fleet-goal supervisor delegates directly to canonical scheduler/conveyor truth', async () => {
  const calls = [];
  const result = await runSupervisor({
    now: new Date('2026-10-01T11:00:00.000Z'),
    conveyor: async (options) => {
      calls.push(options);
      return conveyorResult();
    },
  });

  assert.deepEqual(calls, [{
    allowLegacyMissionCreation: false,
    admissionOwner: 'sovereign-commander-fleet-goal-supervisor',
  }]);
  assert.equal(result.ok, true);
  assert.equal(result.dispatchCount, 1);
  assert.equal(result.runningMissionCount, 1);
  assert.equal(result.programmeStatus, 'READY');
  assert.equal(result.commanderParityHealthy, true);
  assert.equal(result.capabilityParityOwnerGoal, '#2573');
  assert.equal(result.capabilityParityBuildableGapCount, 1);
  assert.equal(result.capacityObservationSource, 'canonical-programme-and-provider-receipts');
  assert.equal(result.synchronousProviderRefreshAllowed, false);
  assert.equal(result.canonicalGoalFabricOnly, true);
  assert.equal(result.sourceMutationDelegatedToMissionWorker, true);
  assert.equal(result.duplicateSchedulerAllowed, false);
  assert.equal(result.duplicateLeaseAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_DISPATCHED');
});

test('one-minute supervisor contains no synchronous provider refresh or source-build execution path', () => {
  for (const forbidden of [
    'refreshGitHubLifeboatLane7Capacity',
    'runGitHubLifeboatLane7',
    'refreshGitHubLifeboatLane7ClaimAck',
    'refreshForgeLifeboatCapacity',
    'refreshDesktopCommanderCapacity',
    'processNextProviderNeutralSourceBuild',
    'runBattleBridgeGoalDiscoveryHeartbeat',
  ]) {
    assert.equal(supervisorSource.includes(forbidden), false, forbidden);
  }
  assert.match(supervisorSource, /ensureCriticalBacklogMission/);
  assert.match(supervisorSource, /synchronousProviderRefreshAllowed: false/);
});

test('Sovereign fleet-goal supervisor treats proven no-runnable-work as green idle', async () => {
  const result = await runSupervisor({
    conveyor: async () => conveyorResult({
      elasticAdmission: { activeMissions: [], runnableMissions: [] },
      elasticIgnition: { availableSlots: 4, dispatchCount: 0, dispatched: [], held: [] },
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.runnableGoalCount, 0);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_IDLE_GREEN');
});

test('Sovereign fleet-goal supervisor fails closed if safe work and proven capacity are stranded', async () => {
  const result = await runSupervisor({
    conveyor: async () => conveyorResult({
      elasticAdmission: {
        activeMissions: [],
        runnableMissions: [{ missionId: 'mission-ready' }],
      },
      elasticIgnition: {
        availableSlots: 2,
        dispatchCount: 0,
        dispatched: [],
        held: [],
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SAFE_RUNNABLE_WORK_AND_FREE_CAPACITY_STRANDED');
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_BLOCKED');
});

test('explained holds stay visible without pretending a free lane is usable', async () => {
  const result = await runSupervisor({
    conveyor: async () => conveyorResult({
      elasticAdmission: {
        activeMissions: [],
        runnableMissions: [{ missionId: 'mission-held' }],
      },
      elasticIgnition: {
        availableSlots: 2,
        dispatchCount: 0,
        dispatched: [],
        held: [{ missionId: 'mission-held', reason: 'RESOURCE_SCOPE_CONFLICT' }],
      },
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.heldGoalCount, 1);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_HELD_EXPLAINED');
});

test('canonical conveyor blockers remain visible and fail closed', async () => {
  const result = await runSupervisor({
    conveyor: async () => ({
      ok: false,
      reason: 'MISSION_WORKER_RUNTIME_NOT_READY',
      finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_BLOCKED',
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'MISSION_WORKER_RUNTIME_NOT_READY');
  assert.equal(result.capacityObservationSource, 'canonical-programme-and-provider-receipts');
  assert.equal(result.synchronousProviderRefreshAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
  assert.equal(result.arbitraryShellAllowed, false);
});


test('one-minute supervisor reconciles Remote Commander capability parity before canonical dispatch', async () => {
  const calls = [];
  const result = await runSovereignCommanderFleetGoalSupervisor({
    reconcileCommanderParity: async ({ now }) => {
      calls.push(now.toISOString());
      return parityResult({ buildableGapCount: 2, boundaryHoldCount: 1 });
    },
    conveyor: async () => conveyorResult({
      elasticAdmission: { activeMissions: [], runnableMissions: [] },
      elasticIgnition: { availableSlots: 4, dispatchCount: 0, dispatched: [], held: [] },
    }),
    now: new Date('2026-10-01T11:05:00.000Z'),
  });

  assert.deepEqual(calls, ['2026-10-01T11:05:00.000Z']);
  assert.equal(result.commanderParityHealthy, true);
  assert.equal(result.capabilityParityBuildableGapCount, 2);
  assert.equal(result.capabilityParityBoundaryHoldCount, 1);
  assert.equal(result.duplicateSchedulerAllowed, false);
  assert.equal(result.sourceMutationDelegatedToMissionWorker, true);
});
