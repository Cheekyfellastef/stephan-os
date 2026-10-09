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
    buildableGapCount: 0,
    boundaryHoldCount: 0,
    finalVerdict: 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_GREEN',
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
  assert.equal(result.capabilityParityBuildableGapCount, 0);
  assert.equal(result.zeroGapInvariantSatisfied, true);
  assert.equal(result.daemonMayReportGreen, true);
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
  assert.equal(result.zeroGapInvariantSatisfied, false);
  assert.equal(result.capabilityParityClosureRequired, true);
  assert.equal(result.daemonMayReportGreen, false);
  assert.equal(result.mustContinueUntilZero, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_PARITY_PENDING');
  assert.equal(result.duplicateSchedulerAllowed, false);
  assert.equal(result.sourceMutationDelegatedToMissionWorker, true);
});

test('parked backlog with all selected goals proven held routes exact repair causes, never false green', async () => {
  const result = await runSupervisor({
    conveyor: async () => conveyorResult({
      classification: 'PARKED_BLOCKERS_ONLY',
      elasticAdmission: {
        ok: true,
        classification: 'ELASTIC_GOAL_MISSIONS_HELD',
        activeMissions: [],
        runnableMissions: [],
        held: [
          { issueNumber: 1383, reason: 'EXISTING_GOAL_MISSION_TERMINAL_AWAITING_GOAL_RECONCILIATION' },
          { issueNumber: 1645, reason: 'EXISTING_GOAL_MISSION_AWAITING_OPERATOR_APPROVAL' },
        ],
      },
      elasticIgnition: null,
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'ELASTIC_GOALS_ALL_HELD_REPAIR_REQUIRED');
  assert.equal(result.heldGoalCount, 2);
  assert.deepEqual(result.heldIssues.map((issue) => issue.issueNumber), [1383, 1645]);
  assert.equal(result.duplicateSchedulerAllowed, false);
  assert.equal(result.mergeAuthority, false);
});

test('parked backlog without elastic admission is blocked, never falsely idle green', async () => {
  const result = await runSupervisor({
    conveyor: async () => conveyorResult({
      classification: 'PARKED_BLOCKERS_ONLY',
      elasticAdmission: null,
      elasticIgnition: null,
      programmeStatus: 'HOLD',
      programmeBlockers: ['phase-lease-reconciliation-blocked', 'source-mutation-proof-missing'],
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'ELASTIC_GOAL_ADMISSION_NOT_PROVEN');
  assert.equal(result.programmeStatus, 'HOLD');
  assert.deepEqual(result.programmeBlockers, ['phase-lease-reconciliation-blocked', 'source-mutation-proof-missing']);
  assert.equal(result.elasticAdmissionPresent, false);
  assert.equal(result.elasticIgnitionPresent, false);
  assert.equal(result.daemonMayReportGreen, false);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_BLOCKED');
});

test('one-minute supervisor never calls an authoritative programme HOLD healthy idle', async () => {
  const result = await runSupervisor({
    conveyor: async () => conveyorResult({
      programmeStatus: 'HOLD',
      programmeBlockers: ['SOURCE_MUTATION_LEASE_HELD'],
      elasticAdmission: { activeMissions: [], runnableMissions: [] },
      elasticIgnition: { availableSlots: 4, dispatchCount: 0, dispatched: [], held: [] },
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.daemonMayReportGreen, false);
  assert.equal(result.blocker, 'CANONICAL_PROGRAMME_HOLD_REPAIR_REQUIRED');
  assert.deepEqual(result.programmeBlockers, ['SOURCE_MUTATION_LEASE_HELD']);
  assert.equal(result.duplicateSchedulerAllowed, false);
  assert.equal(result.mergeAuthority, false);
});

test('one-minute supervisor never treats unavailable Commander parity as zero known gaps', async () => {
  const result = await runSupervisor({
    reconcileCommanderParity: async () => ({
      ok: false,
      blocker: 'SOVEREIGN_PARITY_LEDGER_STALE',
      buildableGapCount: 0,
    }),
    conveyor: async () => conveyorResult({
      elasticAdmission: { activeMissions: [], runnableMissions: [] },
      elasticIgnition: { availableSlots: 4, dispatchCount: 0, dispatched: [], held: [] },
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.daemonMayReportGreen, false);
  assert.equal(result.blocker, 'SOVEREIGN_PARITY_LEDGER_STALE');
  assert.equal(result.commanderParityHealthy, false);
  assert.equal(result.duplicateLeaseAllowed, false);
});
