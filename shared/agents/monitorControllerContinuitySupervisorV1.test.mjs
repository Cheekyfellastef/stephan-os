import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MONITOR_CONTROLLER_CONTINUITY_CONTROLLER_ID,
  runMonitorControllerContinuitySupervisorV1,
} from './monitorControllerContinuitySupervisorV1.mjs';

const HEAD = 'a'.repeat(40);

function gitHeadSpawn(calls = []) {
  return (command, args, options) => {
    calls.push({ command, args: [...args], options: { ...options } });
    return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
  };
}

function reconciliation(overrides = {}) {
  return {
    ok: true,
    taskName: 'Stephanos Battle Bridge GitHub Sync',
    taskHealthy: true,
    repairAttempted: false,
    mutationPerformed: false,
    sourceMutationAllowed: false,
    gitMutationAllowed: false,
    arbitraryTaskNameAllowed: false,
    arbitraryExecutableAllowed: false,
    arbitraryShellAllowed: false,
    pcRestartAllowed: false,
    finalVerdict: 'BATTLE_BRIDGE_GITHUB_SYNC_TASK_HEALTHY',
    ...overrides,
  };
}

test('healthy canonical builder heartbeat keeps the continuity controller RUNNING without mutation', () => {
  const calls = [];
  let observed = null;
  const result = runMonitorControllerContinuitySupervisorV1({
    repoRoot: 'C:/Users/Stephan/Documents/GitHub/stephan-os',
    platform: 'win32',
    spawnSyncFn: gitHeadSpawn(calls),
    reconcileSyncTask: (input) => {
      observed = input;
      return reconciliation();
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.controllerId, MONITOR_CONTROLLER_CONTINUITY_CONTROLLER_ID);
  assert.equal(result.desiredState, 'RUNNING');
  assert.equal(result.continuityState, 'RUNNING');
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.builderHeartbeatHealthy, true);
  assert.equal(result.repairAttempted, false);
  assert.equal(result.mutationPerformed, false);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.gitMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(observed.expectedHead, HEAD);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(-2), ['rev-parse', 'HEAD']);
  assert.equal(calls[0].options.shell, false);
});

test('stale canonical builder heartbeat is recovered through only the fixed GitHub Sync self-repair adapter', () => {
  const result = runMonitorControllerContinuitySupervisorV1({
    repoRoot: 'C:/Users/Stephan/Documents/GitHub/stephan-os',
    platform: 'win32',
    spawnSyncFn: gitHeadSpawn(),
    reconcileSyncTask: () => reconciliation({
      taskHealthy: false,
      repairAttempted: true,
      mutationPerformed: true,
      mutationScope: 'canonical-scheduled-task-registration-and-start-only',
      finalVerdict: 'BATTLE_BRIDGE_GITHUB_SYNC_TASK_REPAIRED',
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.continuityState, 'RECOVERED');
  assert.equal(result.repairAttempted, true);
  assert.equal(result.mutationPerformed, true);
  assert.equal(result.mutationScope, 'canonical-scheduled-task-registration-and-start-only');
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.finalVerdict, 'MONITOR_CONTROLLER_CONTINUITY_RECOVERED');
});

test('unproven canonical source head fails closed before any task repair attempt', () => {
  let reconciliationCalls = 0;
  const result = runMonitorControllerContinuitySupervisorV1({
    repoRoot: 'C:/repo',
    platform: 'win32',
    spawnSyncFn: () => ({ status: 1, stdout: '', stderr: 'no head' }),
    reconcileSyncTask: () => {
      reconciliationCalls += 1;
      return reconciliation();
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CONTINUITY_CANONICAL_HEAD_UNPROVEN');
  assert.equal(reconciliationCalls, 0);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
});

test('self-repair blocker remains a blocker rather than being painted as healthy continuity', () => {
  const result = runMonitorControllerContinuitySupervisorV1({
    repoRoot: 'C:/repo',
    platform: 'win32',
    spawnSyncFn: gitHeadSpawn(),
    reconcileSyncTask: () => ({
      ok: false,
      blocker: 'GITHUB_SYNC_SELF_REPAIR_SOURCE_DIRT_BLOCKED',
      repairAttempted: false,
      mutationPerformed: false,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.continuityState, 'BLOCKED');
  assert.equal(result.blocker, 'GITHUB_SYNC_SELF_REPAIR_SOURCE_DIRT_BLOCKED');
  assert.equal(result.builderHeartbeatHealthy, false);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.gitMutationAllowed, false);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.mergeAuthority, false);
});

test('non-Windows execution cannot mutate or claim continuity', () => {
  const result = runMonitorControllerContinuitySupervisorV1({
    repoRoot: '/repo',
    platform: 'linux',
    spawnSyncFn: gitHeadSpawn(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'WINDOWS_BATTLE_BRIDGE_REQUIRED');
  assert.equal(result.mutationPerformed, false);
});
