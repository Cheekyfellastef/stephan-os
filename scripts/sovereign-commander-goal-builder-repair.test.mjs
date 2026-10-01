import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runSovereignCommanderGoalBuilderRepair,
} from './sovereign-commander-goal-builder-repair.mjs';

test('goal builder repair is a no-op when the canonical supervisor is already green', () => {
  const calls = [];
  const result = runSovereignCommanderGoalBuilderRepair({
    runStep(step) {
      calls.push(step.id);
      return { ok: true, status: 0 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.repairApplied, false);
  assert.deepEqual(calls, ['fleet-goal-supervisor']);
  assert.equal(result.finalVerdict, 'SOVEREIGN_GOAL_BUILDER_FLOW_ALREADY_GREEN');
});

test('goal builder repair heals control plane, worker and heartbeat before re-dispatching', () => {
  const calls = [];
  let supervisorCalls = 0;
  const result = runSovereignCommanderGoalBuilderRepair({
    runStep(step) {
      calls.push(step.id);
      if (step.id === 'fleet-goal-supervisor') {
        supervisorCalls += 1;
        return supervisorCalls === 1 ? { ok: false, status: 2 } : { ok: true, status: 0 };
      }
      return { ok: true, status: 0 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.repairApplied, true);
  assert.deepEqual(calls, [
    'fleet-goal-supervisor',
    'repair-control-plane',
    'start-mission-orchestrator-worker',
    'goal-discovery-heartbeat',
    'fleet-goal-supervisor',
  ]);
  assert.equal(result.finalVerdict, 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_GREEN');
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.arbitraryShellAllowed, false);
});

test('goal builder repair stops at the first failed bounded recovery step', () => {
  const calls = [];
  const result = runSovereignCommanderGoalBuilderRepair({
    runStep(step) {
      calls.push(step.id);
      if (step.id === 'fleet-goal-supervisor') return { ok: false, status: 2 };
      if (step.id === 'start-mission-orchestrator-worker') return { ok: false, status: 1, errorCode: 'WORKER_START_FAILED' };
      return { ok: true, status: 0 };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'START_MISSION_ORCHESTRATOR_WORKER_FAILED');
  assert.deepEqual(calls, [
    'fleet-goal-supervisor',
    'repair-control-plane',
    'start-mission-orchestrator-worker',
  ]);
});
