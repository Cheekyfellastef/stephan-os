import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runFixedGoalBuilderRepairStep,
  runSovereignCommanderGoalBuilderRepair,
} from './sovereign-commander-goal-builder-repair.mjs';

function laneStatus({
  finalVerdict = 'SOVEREIGN_CONTROLLER_LANE_STATUS_READY',
  refillHealth = 'GREEN',
  refillState = 'NO_SAFE_ELIGIBLE_WORK_REPORTED',
  currentPhysicalHardRedCount = 0,
  runnableBacklogCount = 0,
  logicalCurrent = true,
  logicalValid = true,
  logicalFinalVerdict = 'LOGICAL_GOAL_CONTROLLER_FABRIC_READY',
} = {}) {
  return {
    ok: true,
    status: 0,
    stdout: 'SOVEREIGN_COMMANDER_CONTROLLER_LANE_STATUS_RESULT=' + JSON.stringify({
      schemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
      ok: true,
      logical: {
        current: logicalCurrent,
        valid: logicalValid,
        finalVerdict: logicalFinalVerdict,
      },
      lanes: {
        refillHealth,
        refillState,
        currentPhysicalHardRedCount,
        runnableBacklogCount,
      },
      finalVerdict,
    }) + '\n',
  };
}

function supervisorStatus({
  finalVerdict = 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_IDLE_GREEN',
  daemonMayReportGreen = true,
  dispatchCount = 0,
  runningMissionCount = 0,
  heldGoalCount = 0,
  blocker = '',
} = {}) {
  return {
    ok: true,
    status: 0,
    stdout: 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_RESULT=' + JSON.stringify({
      schemaVersion: 'stephanos.sovereign-commander-fleet-goal-supervisor.v1',
      ok: true,
      blocker,
      daemonMayReportGreen,
      dispatchCount,
      runningMissionCount,
      heldGoalCount,
      finalVerdict,
    }) + '\n',
  };
}

test('fixed repair step preserves blocker from marker-prefixed child output', () => {
  const result = runFixedGoalBuilderRepairStep({
    id: 'marker-child',
    executable: process.execPath,
    args: [
      '-e',
      "process.stdout.write('CHILD_RESULT=' + JSON.stringify({ok:false,blocker:'CHILD_COMPONENT_BLOCKED'}) + '\\n'); process.exit(2);",
    ],
    timeoutMs: 5_000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 2);
  assert.equal(result.errorCode, 'CHILD_COMPONENT_BLOCKED');
});

test('goal builder repair is a no-op only when supervisor and real lane health are green', () => {
  const calls = [];
  const result = runSovereignCommanderGoalBuilderRepair({
    runStep(step) {
      calls.push(step.id);
      if (step.id === 'fleet-goal-supervisor') return supervisorStatus();
      if (step.id === 'controller-lane-status') return laneStatus();
      return { ok: true, status: 0 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.repairApplied, false);
  assert.deepEqual(calls, ['fleet-goal-supervisor', 'controller-lane-status']);
  assert.equal(result.finalVerdict, 'SOVEREIGN_GOAL_BUILDER_FLOW_ALREADY_GREEN');
});

test('goal builder stays green when only continuity-host telemetry is stale', () => {
  const calls = [];
  const result = runSovereignCommanderGoalBuilderRepair({
    runStep(step) {
      calls.push(step.id);
      if (step.id === 'fleet-goal-supervisor') return supervisorStatus();
      if (step.id === 'controller-lane-status') {
        return laneStatus({
          finalVerdict: 'SOVEREIGN_CONTROLLER_LANE_STATUS_REFILL_OR_EVIDENCE_REQUIRED',
          refillHealth: 'AMBER',
          refillState: 'TELEMETRY_STALE_OR_INCOMPLETE',
          currentPhysicalHardRedCount: 0,
          runnableBacklogCount: 0,
        });
      }
      return { ok: true, status: 0 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.repairApplied, false);
  assert.deepEqual(calls, ['fleet-goal-supervisor', 'controller-lane-status']);
  assert.equal(result.finalVerdict, 'SOVEREIGN_GOAL_BUILDER_FLOW_ALREADY_GREEN');
});

test('goal builder does not forgive a current hard-red host as stale evidence debt', () => {
  const result = runSovereignCommanderGoalBuilderRepair({
    runStep(step) {
      if (step.id === 'fleet-goal-supervisor') return supervisorStatus();
      if (step.id === 'controller-lane-status') {
        return laneStatus({
          finalVerdict: 'SOVEREIGN_CONTROLLER_LANE_STATUS_REFILL_OR_EVIDENCE_REQUIRED',
          refillHealth: 'AMBER',
          refillState: 'TELEMETRY_STALE_OR_INCOMPLETE',
          currentPhysicalHardRedCount: 1,
          runnableBacklogCount: 0,
        });
      }
      return { ok: true, status: 0 };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.repairApplied, true);
});

test('goal builder repair heals only worker and heartbeat before re-dispatching', () => {
  const calls = [];
  let supervisorCalls = 0;
  let laneCalls = 0;
  const result = runSovereignCommanderGoalBuilderRepair({
    runStep(step) {
      calls.push(step.id);
      if (step.id === 'fleet-goal-supervisor') {
        supervisorCalls += 1;
        return supervisorCalls === 1 ? { ok: false, status: 2 } : supervisorStatus();
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
    'start-mission-orchestrator-worker',
    'goal-discovery-heartbeat',
    'fleet-goal-supervisor',
    'controller-lane-status',
  ]);
  assert.equal(result.finalVerdict, 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_GREEN');
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.arbitraryShellAllowed, false);
});

test('goal builder repair never re-enters control-plane repair while running through the mailbox', () => {
  const calls = [];
  runSovereignCommanderGoalBuilderRepair({
    runStep(step) {
      calls.push(step.id);
      if (step.id === 'fleet-goal-supervisor') return supervisorStatus();
      if (step.id === 'controller-lane-status') {
        return laneStatus({
          finalVerdict: 'SOVEREIGN_CONTROLLER_LANE_STATUS_ATTENTION_REQUIRED',
          refillHealth: 'RED',
          refillState: 'CONTROLLER_OR_LOGICAL_FABRIC_ATTENTION_REQUIRED',
        });
      }
      return { ok: true, status: 0 };
    },
  });
  assert.equal(calls.includes('repair-control-plane'), false);
  assert.deepEqual(calls, [
    'fleet-goal-supervisor',
    'controller-lane-status',
    'start-mission-orchestrator-worker',
    'goal-discovery-heartbeat',
    'fleet-goal-supervisor',
    'controller-lane-status',
  ]);
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
    'start-mission-orchestrator-worker',
  ]);
});

test('goal builder repair never false-greens while safe work still waits in free lanes', () => {
  const calls = [];
  const result = runSovereignCommanderGoalBuilderRepair({
    runStep(step) {
      calls.push(step.id);
      if (step.id === 'fleet-goal-supervisor') return supervisorStatus();
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
    'start-mission-orchestrator-worker',
    'goal-discovery-heartbeat',
    'fleet-goal-supervisor',
    'controller-lane-status',
  ]);
  assert.equal(result.finalVerdict, 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_BLOCKED');
});

test('goal builder repair never false-greens pending autonomous uplift with no dispatch', () => {
  const calls = [];
  const result = runSovereignCommanderGoalBuilderRepair({
    runStep(step) {
      calls.push(step.id);
      if (step.id === 'fleet-goal-supervisor') {
        return supervisorStatus({
          finalVerdict: 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_PARITY_PENDING',
          daemonMayReportGreen: false,
        });
      }
      if (step.id === 'controller-lane-status') return laneStatus();
      return { ok: true, status: 0 };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.repairApplied, true);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_PARITY_PENDING');
  assert.deepEqual(calls, [
    'fleet-goal-supervisor',
    'controller-lane-status',
    'start-mission-orchestrator-worker',
    'goal-discovery-heartbeat',
    'fleet-goal-supervisor',
    'controller-lane-status',
  ]);
});

test('goal builder flow stays healthy while autonomous parity work is actively dispatched', () => {
  const calls = [];
  const result = runSovereignCommanderGoalBuilderRepair({
    runStep(step) {
      calls.push(step.id);
      if (step.id === 'fleet-goal-supervisor') {
        return supervisorStatus({
          finalVerdict: 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_PARITY_CLOSURE_ACTIVE',
          daemonMayReportGreen: false,
          dispatchCount: 1,
        });
      }
      if (step.id === 'controller-lane-status') return laneStatus();
      return { ok: true, status: 0 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.repairApplied, false);
  assert.deepEqual(calls, ['fleet-goal-supervisor', 'controller-lane-status']);
  assert.equal(result.finalVerdict, 'SOVEREIGN_GOAL_BUILDER_FLOW_ALREADY_GREEN');
});
