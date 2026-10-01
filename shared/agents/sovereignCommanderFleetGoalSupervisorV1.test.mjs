import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runSovereignCommanderFleetGoalSupervisor,
} from '../../scripts/sovereign-commander-fleet-goal-supervisor.mjs';

function conveyorResult(overrides = {}) {
  return {
    ok: true,
    classification: 'ELASTIC_GOAL_MISSION_SELECTED',
    finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_PASS',
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

function capacity(overrides = {}) {
  return { ok: true, available: true, ...overrides };
}

test('Sovereign fleet-goal supervisor refreshes capacity then delegates admission and dispatch to the canonical conveyor', async () => {
  const calls = [];
  const result = await runSovereignCommanderFleetGoalSupervisor({
    now: new Date('2026-10-01T11:00:00.000Z'),
    refreshGithubLifeboat: async () => {
      calls.push('github-lifeboat');
      return capacity({ sourceHead: 'a'.repeat(40) });
    },
    refreshGithubLifeboatClaimAck: async ({ sourceHead }) => {
      calls.push(`github-ack:${sourceHead}`);
      return { ok: true, published: true };
    },
    refreshForgeCapacity: async () => {
      calls.push('forge');
      return capacity();
    },
    refreshCommanderCapacity: async () => {
      calls.push('desktop-commander');
      return capacity();
    },
    conveyor: async (options) => {
      calls.push(options);
      return conveyorResult();
    },
  });

  assert.deepEqual(calls.slice(0, 4), [
    'github-lifeboat',
    `github-ack:${'a'.repeat(40)}`,
    'forge',
    'desktop-commander',
  ]);
  assert.deepEqual(calls[4], {
    allowLegacyMissionCreation: false,
    admissionOwner: 'sovereign-commander-fleet-goal-supervisor',
  });
  assert.equal(result.ok, true);
  assert.equal(result.dispatchCount, 1);
  assert.equal(result.runningMissionCount, 1);
  assert.equal(result.canonicalGoalFabricOnly, true);
  assert.equal(result.sourceMutationDelegatedToMissionWorker, true);
  assert.equal(result.duplicateSchedulerAllowed, false);
  assert.equal(result.duplicateLeaseAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_DISPATCHED');
});

test('Sovereign fleet-goal supervisor treats proven no-runnable-work as green idle', async () => {
  const result = await runSovereignCommanderFleetGoalSupervisor({
    refreshGithubLifeboat: async () => capacity(),
    refreshGithubLifeboatClaimAck: async () => ({ ok: true, published: true }),
    refreshForgeCapacity: async () => capacity(),
    refreshCommanderCapacity: async () => capacity(),
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
  const result = await runSovereignCommanderFleetGoalSupervisor({
    refreshGithubLifeboat: async () => capacity(),
    refreshGithubLifeboatClaimAck: async () => ({ ok: true, published: true }),
    refreshForgeCapacity: async () => capacity(),
    refreshCommanderCapacity: async () => capacity(),
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
  const result = await runSovereignCommanderFleetGoalSupervisor({
    refreshGithubLifeboat: async () => capacity(),
    refreshGithubLifeboatClaimAck: async () => ({ ok: true, published: true }),
    refreshForgeCapacity: async () => capacity(),
    refreshCommanderCapacity: async () => capacity(),
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

test('capacity refresh failures do not invent capacity and conveyor blockers still fail closed', async () => {
  const result = await runSovereignCommanderFleetGoalSupervisor({
    refreshGithubLifeboat: async () => { throw new Error('offline'); },
    refreshGithubLifeboatClaimAck: async () => { throw new Error('offline'); },
    refreshForgeCapacity: async () => { throw new Error('offline'); },
    refreshCommanderCapacity: async () => { throw new Error('offline'); },
    conveyor: async () => ({
      ok: false,
      reason: 'MISSION_WORKER_RUNTIME_NOT_READY',
      finalVerdict: 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_BLOCKED',
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'MISSION_WORKER_RUNTIME_NOT_READY');
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
  assert.equal(result.arbitraryShellAllowed, false);
});
