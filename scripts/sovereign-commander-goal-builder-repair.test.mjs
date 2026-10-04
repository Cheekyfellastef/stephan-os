import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runSovereignCommanderGoalBuilderRepair,
} from './sovereign-commander-goal-builder-repair.mjs';

function laneStatus({
  finalVerdict = 'SOVEREIGN_CONTROLLER_LANE_STATUS_READY',
  refillHealth = 'GREEN',
  refillState = 'NO_SAFE_ELIGIBLE_WORK_REPORTED',
} = {}) {
  return {
    ok: true,
    status: 0,
    stdout: 'SOVEREIGN_COMMANDER_CONTROLLER_LANE_STATUS_RESULT=' + JSON.stringify({
      schemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
      ok: true,
      lanes: { refillHealth, refillState },
      finalVerdict,
    }) + '\n',
  };
}

test('goal builder repair is a no-op only when supervisor and real lane health are green', () => {
  const calls = [];
  const result = runSovereignCommanderGoalBuilderRepair({
    runStep(step) {
      calls.push(step.id);
      if (step.id === 'controller-lane-status') return laneStatus();
      return { ok: true, status: 0 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.repairApplied, false);
  assert.deepEqual(calls, ['fleet-goal-supervisor', 'controller-lane-status']);
  assert.equal(result.finalVerdict, 'SOVEREIGN_GOAL_BUILDER_FLOW_ALREADY_GREEN');
});

test('goal builder repair heals control plane, worker and heartbeat before re-dispatching', () => {
  const calls = [];
  let supervisorCalls = 0;
  let laneCalls = 0;
  const result = runSovereignCommanderGoalBuilderRepair({
    runStep(step) {
      calls.push(step.id);
      if (step.id === 'fleet-goal-supervisor') {
        supervisorCalls += 1;
        return supervisorCalls === 1 ? { ok: false, status: 2 } : { ok: true, status: 0 };
      }
      if (step.id === 'controller-lane-status') {
        laneCalls += 1;
        return laneCalls === 1
          ? laneStatus({
              finalVerdict: 'SOVEREIGN_CONTROLLER_LANE_STATUS_REFILL_OR_EVIDENCE_REQUIRED',
              refillHealth: 'AMBER',
              refillState: 'SAFE_WORK_WAITING_WITH_TARGET_CAPACITY_FREE',
            })
          : laneStatus();
      }
      return { ok: true, status: 0 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.repairApplied, true);
  assert.deepEqual(calls, [
    'fleet-goal-supervisor',
    'controller-lane-status',
    'repair-control-plane',
    'start-mission-orchestrator-worker',
    'goal-discovery-heartbeat',
    'fleet-goal-supervisor',
    'controller-lane-status',
  ]);
  assert.equal(result.finalVerdict, 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_GREEN');
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.arbitraryShellAllowed, false);
});

test('goal builder repair stops at the first failed bounded recovery step and preserves its blocker', () => {
  const calls = [];
  const result = runSovereignCommanderGoalBuilderRepair({
    runStep(step) {
      calls.push(step.id);
      if (step.id === 'fleet-goal-supervisor') return { ok: false, status: 2 };
      if (step.id === 'controller-lane-status') {
        return laneStatus({
          finalVerdict: 'SOVEREIGN_CONTROLLER_LANE_STATUS_ATTENTION_REQUIRED',
          refillHealth: 'RED',
          refillState: 'CONTROLLER_OR_LOGICAL_FABRIC_ATTENTION_REQUIRED',
        });
      }
      if (step.id === 'start-mission-orchestrator-worker') return { ok: false, status: 1, errorCode: 'WORKER_START_FAILED' };
      return { ok: true, status: 0 };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'WORKER_START_FAILED');
  assert.deepEqual(calls, [
    'fleet-goal-supervisor',
    'controller-lane-status',
    'repair-control-plane',
    'start-mission-orchestrator-worker',
  ]);
});

test('goal builder repair never false-greens while safe work still waits in free lanes', () => {
  const calls = [];
  const result = runSovereignCommanderGoalBuilderRepair({
    runStep(step) {
      calls.push(step.id);
      if (step.id === 'controller-lane-status') {
        return laneStatus({
          finalVerdict: 'SOVEREIGN_CONTROLLER_LANE_STATUS_REFILL_OR_EVIDENCE_REQUIRED',
          refillHealth: 'AMBER',
          refillState: 'SAFE_WORK_WAITING_WITH_TARGET_CAPACITY_FREE',
        });
      }
      return { ok: true, status: 0 };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.repairApplied, true);
  assert.equal(result.blocker, 'SAFE_WORK_WAITING_WITH_TARGET_CAPACITY_FREE');
  assert.deepEqual(calls, [
    'fleet-goal-supervisor',
    'controller-lane-status',
    'repair-control-plane',
    'start-mission-orchestrator-worker',
    'goal-discovery-heartbeat',
    'fleet-goal-supervisor',
    'controller-lane-status',
  ]);
  assert.equal(result.finalVerdict, 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_BLOCKED');
});
