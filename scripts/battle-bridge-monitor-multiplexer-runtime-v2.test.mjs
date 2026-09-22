import test from 'node:test';
import assert from 'node:assert/strict';

import { runBattleBridgeMonitorMultiplexerRuntimeV2 } from './battle-bridge-monitor-multiplexer-runtime-v2.mjs';

const HEAD = 'a'.repeat(40);
const PATHS = Object.freeze({
  repoRoot: '/canonical/stephan-os',
  workspaceRoot: '/canonical/stephanos-workspace',
});

function healthyContinuity(calls = []) {
  return async (input) => {
    calls.push(['continuity', input]);
    return {
      ok: true,
      controllerId: 'builder-continuity',
      desiredState: 'RUNNING',
      continuityState: 'RUNNING',
      blocker: '',
      sourceHead: HEAD,
      sourceMutationAllowed: false,
      gitMutationAllowed: false,
      mergeAuthority: false,
      arbitraryShellAllowed: false,
      finalVerdict: 'MONITOR_CONTROLLER_CONTINUITY_RUNNING',
    };
  };
}

function clearSiding(calls = []) {
  return async (input) => {
    calls.push(['siding', input]);
    return {
      ok: true,
      classification: 'NO_STALLED_LEGACY_SOURCE_MISSION',
      transitioned: false,
      parked: false,
      missionId: '',
    };
  };
}

test('builder continuity, stale-mission siding and flywheel patrol share the existing multiplexer clock without another external task slot', async () => {
  const calls = [];
  const result = await runBattleBridgeMonitorMultiplexerRuntimeV2({
    platform: 'win32',
    paths: PATHS,
    nowMs: Date.parse('2026-09-20T13:00:00.000Z'),
    runMonitorControllerContinuitySupervisorV1Impl: healthyContinuity(calls),
    reconcileStalledLegacyMissionToSidingImpl: clearSiding(calls),
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
  assert.equal(result.controllerContinuity.controllerId, 'builder-continuity');
  assert.equal(result.stalledLegacySiding.classification, 'NO_STALLED_LEGACY_SOURCE_MISSION');
  assert.equal(result.flywheelRepairPatrolState, 'REPAIR_REQUIRED');
  assert.equal(result.flywheelRepairFindingCount, 2);
  assert.equal(result.flywheelRepairPatrolChanged, true);
  assert.equal(result.flywheelRepairHandoffId, 'flywheel-repair-1234');
  assert.deepEqual(calls.map(([kind]) => kind), ['continuity', 'siding', 'patrol', 'multiplexer']);
  assert.equal(calls[0][1].repoRoot, PATHS.repoRoot);
  assert.equal(calls[1][1].repoRoot, PATHS.repoRoot);
  assert.equal(calls[1][1].workspaceRoot, PATHS.workspaceRoot);
  assert.equal(calls[1][1].sourceHead, HEAD);
  assert.equal(calls[2][1].repoRoot, PATHS.repoRoot);
  assert.equal(calls[2][1].workspaceRoot, PATHS.workspaceRoot);
  assert.equal(calls[3][1].repoRoot, PATHS.repoRoot);
  assert.equal(calls[3][1].root, PATHS.workspaceRoot);
});

test('patrol failure makes the shared task retry but does not suppress continuity, siding, or existing monitor runtime', async () => {
  const calls = [];
  const result = await runBattleBridgeMonitorMultiplexerRuntimeV2({
    platform: 'win32',
    paths: PATHS,
    runMonitorControllerContinuitySupervisorV1Impl: healthyContinuity(calls),
    reconcileStalledLegacyMissionToSidingImpl: clearSiding(calls),
    runFlywheelRepairPatrolImpl: async () => ({
      ok: false,
      reason: 'CONSTRAINT_LIFECYCLE_AUDIT_FAILED',
    }),
    runMonitorAdmissionRuntimeV2Impl: async () => {
      calls.push(['multiplexer', {}]);
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

  assert.deepEqual(calls.map(([kind]) => kind), ['continuity', 'siding', 'multiplexer']);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CONSTRAINT_LIFECYCLE_AUDIT_FAILED');
  assert.equal(result.externalTaskSlotsRequired, 1);
  assert.equal(result.finalVerdict, 'BATTLE_BRIDGE_MONITOR_MULTIPLEXER_RUNTIME_BLOCKED');
});

test('siding proof failure blocks the shared task without suppressing patrol or monitor work', async () => {
  const calls = [];
  const result = await runBattleBridgeMonitorMultiplexerRuntimeV2({
    platform: 'win32',
    paths: PATHS,
    runMonitorControllerContinuitySupervisorV1Impl: healthyContinuity(calls),
    reconcileStalledLegacyMissionToSidingImpl: async () => ({
      ok: false,
      blocker: 'SOURCE_MUTATION_LEASE_UNVERIFIABLE',
      classification: 'SOURCE_MUTATION_LEASE_UNVERIFIABLE',
    }),
    runFlywheelRepairPatrolImpl: async () => {
      calls.push(['patrol', {}]);
      return { ok: true, state: 'CLEAR', findingCount: 0 };
    },
    runMonitorAdmissionRuntimeV2Impl: async () => {
      calls.push(['multiplexer', {}]);
      return { ok: true, reason: 'MONITOR_ADMISSION_RUNTIME_TICK_PASS' };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SOURCE_MUTATION_LEASE_UNVERIFIABLE');
  assert.deepEqual(calls.map(([kind]) => kind), ['continuity', 'patrol', 'multiplexer']);
});

test('builder continuity failure is reported but does not suppress patrol or monitor work', async () => {
  const calls = [];
  const result = await runBattleBridgeMonitorMultiplexerRuntimeV2({
    platform: 'win32',
    paths: PATHS,
    runMonitorControllerContinuitySupervisorV1Impl: async () => ({
      ok: false,
      blocker: 'CONTINUITY_CANONICAL_HEAD_UNPROVEN',
      controllerId: 'builder-continuity',
    }),
    runFlywheelRepairPatrolImpl: async () => {
      calls.push('patrol');
      return { ok: true, state: 'CLEAR', findingCount: 0 };
    },
    runMonitorAdmissionRuntimeV2Impl: async () => {
      calls.push('multiplexer');
      return { ok: true, reason: 'MONITOR_ADMISSION_RUNTIME_TICK_PASS' };
    },
  });

  assert.deepEqual(calls, ['patrol', 'multiplexer']);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CONTINUITY_CANONICAL_HEAD_UNPROVEN');
});

test('non-Windows runtime still blocks before continuity siding patrol or monitor work is attempted', async () => {
  let calls = 0;
  const result = await runBattleBridgeMonitorMultiplexerRuntimeV2({
    platform: 'linux',
    paths: PATHS,
    runMonitorControllerContinuitySupervisorV1Impl: async () => { calls += 1; return { ok: true }; },
    reconcileStalledLegacyMissionToSidingImpl: async () => { calls += 1; return { ok: true }; },
    runFlywheelRepairPatrolImpl: async () => { calls += 1; return { ok: true }; },
    runMonitorAdmissionRuntimeV2Impl: async () => { calls += 1; return { ok: true }; },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'WINDOWS_BATTLE_BRIDGE_REQUIRED');
  assert.equal(calls, 0);
});
