import test from 'node:test';
import assert from 'node:assert/strict';

import { runBattleBridgeMonitorMultiplexerRuntimeV2 } from './battle-bridge-monitor-multiplexer-runtime-v2.mjs';

const PATHS = Object.freeze({
  repoRoot: '/canonical/stephan-os',
  workspaceRoot: '/canonical/stephanos-workspace',
});

test('flywheel patrol runs from the existing multiplexer clock without consuming another external task slot', async () => {
  const calls = [];
  const result = await runBattleBridgeMonitorMultiplexerRuntimeV2({
    platform: 'win32',
    paths: PATHS,
    nowMs: Date.parse('2026-09-20T13:00:00.000Z'),
    runFlywheelRepairPatrolImpl: async (input) => {
      calls.push(['patrol', input]);
      return {
        ok: true,
        state: 'REPAIR_REQUIRED',
        findingCount: 2,
        changed: true,
        handoffId: 'flywheel-repair-1234',
        nextDueUtc: '2026-09-20T13:15:00.000Z',
      };
    },
    runMonitorAdmissionRuntimeV2Impl: async (input) => {
      calls.push(['multiplexer', input]);
      return {
        ok: true,
        reason: 'MONITOR_ADMISSION_RUNTIME_TICK_PASS',
        monitorCount: 7,
        logicalControllerCount: 5,
        externalTaskSlotsRequired: 1,
        notificationSurface: 'chatgpt-task-outbox',
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.externalTaskSlotsRequired, 1);
  assert.equal(result.monitorCount, 7);
  assert.equal(result.flywheelRepairPatrolState, 'REPAIR_REQUIRED');
  assert.equal(result.flywheelRepairFindingCount, 2);
  assert.equal(result.flywheelRepairPatrolChanged, true);
  assert.equal(result.flywheelRepairHandoffId, 'flywheel-repair-1234');
  assert.deepEqual(calls.map(([kind]) => kind), ['patrol', 'multiplexer']);
  assert.equal(calls[0][1].repoRoot, PATHS.repoRoot);
  assert.equal(calls[0][1].workspaceRoot, PATHS.workspaceRoot);
  assert.equal(calls[1][1].repoRoot, PATHS.repoRoot);
  assert.equal(calls[1][1].root, PATHS.workspaceRoot);
});

test('patrol failure makes the shared task retry but does not suppress the existing monitor runtime', async () => {
  let monitorRan = false;
  const result = await runBattleBridgeMonitorMultiplexerRuntimeV2({
    platform: 'win32',
    paths: PATHS,
    runFlywheelRepairPatrolImpl: async () => ({
      ok: false,
      reason: 'CONSTRAINT_LIFECYCLE_AUDIT_FAILED',
    }),
    runMonitorAdmissionRuntimeV2Impl: async () => {
      monitorRan = true;
      return {
        ok: true,
        reason: 'MONITOR_ADMISSION_RUNTIME_TICK_PASS',
        monitorCount: 5,
        logicalControllerCount: 5,
        externalTaskSlotsRequired: 1,
        notificationSurface: 'chatgpt-task-outbox',
      };
    },
  });

  assert.equal(monitorRan, true);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CONSTRAINT_LIFECYCLE_AUDIT_FAILED');
  assert.equal(result.externalTaskSlotsRequired, 1);
  assert.equal(result.finalVerdict, 'BATTLE_BRIDGE_MONITOR_MULTIPLEXER_RUNTIME_BLOCKED');
});

test('non-Windows runtime still blocks before either patrol or monitor work is attempted', async () => {
  let calls = 0;
  const result = await runBattleBridgeMonitorMultiplexerRuntimeV2({
    platform: 'linux',
    paths: PATHS,
    runFlywheelRepairPatrolImpl: async () => { calls += 1; return { ok: true }; },
    runMonitorAdmissionRuntimeV2Impl: async () => { calls += 1; return { ok: true }; },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'WINDOWS_BATTLE_BRIDGE_REQUIRED');
  assert.equal(calls, 0);
});
