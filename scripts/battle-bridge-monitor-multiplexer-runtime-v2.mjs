#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { runMonitorAdmissionRuntimeV2 } from '../shared/agents/monitorAdmissionRuntimeV2.mjs';
import { runMonitorControllerContinuitySupervisorV1 } from '../shared/agents/monitorControllerContinuitySupervisorV1.mjs';
import { runFlywheelRepairPatrol } from './flywheel-repair-patrol.mjs';

export const BATTLE_BRIDGE_MONITOR_MULTIPLEXER_RUNTIME_SCHEMA = 'stephanos.battle-bridge-monitor-multiplexer-runtime.v2';

export function resolveBattleBridgeMonitorMultiplexerPathsV2({ env = process.env, home = os.homedir() } = {}) {
  const userHome = path.resolve(env.USERPROFILE || env.HOME || home);
  return Object.freeze({
    repoRoot: path.resolve(userHome, 'Documents', 'GitHub', 'stephan-os'),
    workspaceRoot: path.resolve(userHome, 'Documents', 'Stephanos-openclaw-workspace'),
  });
}

export async function runBattleBridgeMonitorMultiplexerRuntimeV2(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32' && options.allowNonWindowsForTest !== true) {
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_MONITOR_MULTIPLEXER_RUNTIME_SCHEMA,
      ok: false,
      reason: 'WINDOWS_BATTLE_BRIDGE_REQUIRED',
      finalVerdict: 'BATTLE_BRIDGE_MONITOR_MULTIPLEXER_RUNTIME_BLOCKED',
    });
  }
  const paths = options.paths || resolveBattleBridgeMonitorMultiplexerPathsV2(options);
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const runControllerContinuity = options.runMonitorControllerContinuitySupervisorV1Impl
    || runMonitorControllerContinuitySupervisorV1;
  const runPatrol = options.runFlywheelRepairPatrolImpl || runFlywheelRepairPatrol;
  const runMonitorRuntime = options.runMonitorAdmissionRuntimeV2Impl || runMonitorAdmissionRuntimeV2;

  const controllerContinuity = platform === 'win32'
    ? await runControllerContinuity({
        repoRoot: paths.repoRoot,
        platform,
        now: new Date(nowMs),
      })
    : Object.freeze({
        schemaVersion: 'stephanos.monitor-controller-continuity-supervisor.v1',
        ok: true,
        controllerId: 'builder-continuity',
        desiredState: 'RUNNING',
        continuityState: 'TEST_BYPASS',
        blocker: '',
        sourceMutationAllowed: false,
        gitMutationAllowed: false,
        mergeAuthority: false,
        arbitraryShellAllowed: false,
        finalVerdict: 'MONITOR_CONTROLLER_CONTINUITY_TEST_BYPASS',
      });
  const patrol = await runPatrol({
    repoRoot: paths.repoRoot,
    workspaceRoot: paths.workspaceRoot,
    nowMs,
    timestampUtc: options.timestampUtc,
  });
  const result = await runMonitorRuntime({
    root: paths.workspaceRoot,
    repoRoot: paths.repoRoot,
    relatedIssue: '#1585',
    nowMs,
    timestampUtc: options.timestampUtc,
    concurrency: options.concurrency,
  });
  const ok = result.ok === true && patrol.ok === true && controllerContinuity.ok === true;
  const reason = controllerContinuity.ok !== true
    ? controllerContinuity.blocker || 'CONTROLLER_CONTINUITY_BLOCKED'
    : patrol.ok !== true
      ? patrol.reason || 'FLYWHEEL_REPAIR_PATROL_BLOCKED'
      : result.reason;
  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_MONITOR_MULTIPLEXER_RUNTIME_SCHEMA,
    ok,
    reason,
    monitorCount: result.monitorCount || 0,
    logicalControllerCount: result.logicalControllerCount || 0,
    externalTaskSlotsRequired: result.externalTaskSlotsRequired || 0,
    notificationSurface: result.notificationSurface || 'chatgpt-task-outbox',
    controllerContinuity,
    flywheelRepairPatrolState: patrol.state || 'UNKNOWN',
    flywheelRepairFindingCount: Number(patrol.findingCount || 0),
    flywheelRepairPatrolChanged: patrol.changed === true,
    flywheelRepairHandoffId: patrol.handoffId || '',
    flywheelRepairNextDueUtc: patrol.nextDueUtc || '',
    finalVerdict: ok
      ? 'BATTLE_BRIDGE_MONITOR_MULTIPLEXER_RUNTIME_PASS'
      : 'BATTLE_BRIDGE_MONITOR_MULTIPLEXER_RUNTIME_BLOCKED',
  });
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('battle-bridge-monitor-multiplexer-runtime-v2.mjs')) {
  const result = await runBattleBridgeMonitorMultiplexerRuntimeV2();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
