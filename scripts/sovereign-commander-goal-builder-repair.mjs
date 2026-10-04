#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_SCHEMA =
  'stephanos.sovereign-commander-goal-builder-repair.v1';
export const SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_MARKER =
  'SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_RESULT=';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

const STEPS = Object.freeze({
  supervisor: Object.freeze({
    id: 'fleet-goal-supervisor',
    executable: node,
    args: Object.freeze([resolve(repoRoot, 'scripts', 'sovereign-commander-fleet-goal-supervisor.mjs')]),
    timeoutMs: 25_000,
  }),
  repairControlPlane: Object.freeze({
    id: 'repair-control-plane',
    executable: node,
    args: Object.freeze([resolve(repoRoot, 'scripts', 'sovereign-commander-control-plane-repair.mjs')]),
    timeoutMs: 60_000,
  }),
  startMissionWorker: Object.freeze({
    id: 'start-mission-orchestrator-worker',
    executable: powershell,
    args: Object.freeze([
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      resolve(repoRoot, 'scripts', 'windows', 'start-mission-orchestrator-worker-task.ps1'),
    ]),
    timeoutMs: 20_000,
  }),
  goalHeartbeat: Object.freeze({
    id: 'goal-discovery-heartbeat',
    executable: node,
    args: Object.freeze([resolve(repoRoot, 'scripts', 'battle-bridge-goal-discovery-heartbeat.mjs')]),
    timeoutMs: 25_000,
  }),
});

function text(value) {
  return String(value ?? '').trim();
}

function compactStep(step, result) {
  return Object.freeze({
    actionId: step.id,
    ok: result?.ok === true,
    status: Number.isInteger(result?.status) ? result.status : null,
    errorCode: text(result?.errorCode).slice(0, 120),
  });
}

export function runFixedGoalBuilderRepairStep(step) {
  const result = spawnSync(step.executable, [...step.args], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: step.timeoutMs,
    maxBuffer: 256 * 1024,
  });
  return Object.freeze({
    ok: !result?.error && Number(result?.status) === 0,
    status: Number.isInteger(result?.status) ? result.status : null,
    stdout: String(result?.stdout || ''),
    errorCode: text(result?.error?.code || result?.error?.message),
  });
}

export function runSovereignCommanderGoalBuilderRepair({
  runStep = runFixedGoalBuilderRepairStep,
} = {}) {
  const steps = [];
  const initial = runStep(STEPS.supervisor);
  steps.push(compactStep(STEPS.supervisor, initial));

  if (initial?.ok === true) {
    return Object.freeze({
      ok: true,
      schemaVersion: SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_SCHEMA,
      repairApplied: false,
      steps: Object.freeze(steps),
      canonicalGoalFabricOnly: true,
      sourceMutationDelegatedToMissionWorker: true,
      duplicateSchedulerAllowed: false,
      mergeAuthority: false,
      arbitraryShellAllowed: false,
      finalVerdict: 'SOVEREIGN_GOAL_BUILDER_FLOW_ALREADY_GREEN',
    });
  }

  for (const step of [STEPS.repairControlPlane, STEPS.startMissionWorker, STEPS.goalHeartbeat]) {
    const result = runStep(step);
    steps.push(compactStep(step, result));
    if (result?.ok !== true) {
      return Object.freeze({
        ok: false,
        schemaVersion: SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_SCHEMA,
        repairApplied: true,
        blocker: `${step.id.toUpperCase().replace(/-/g, '_')}_FAILED`,
        steps: Object.freeze(steps),
        canonicalGoalFabricOnly: true,
        sourceMutationDelegatedToMissionWorker: true,
        duplicateSchedulerAllowed: false,
        mergeAuthority: false,
        arbitraryShellAllowed: false,
        finalVerdict: 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_BLOCKED',
      });
    }
  }

  const final = runStep(STEPS.supervisor);
  steps.push(compactStep(STEPS.supervisor, final));
  return Object.freeze({
    ok: final?.ok === true,
    schemaVersion: SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_SCHEMA,
    repairApplied: true,
    blocker: final?.ok === true ? '' : 'GOAL_BUILDER_FLOW_STILL_BLOCKED',
    steps: Object.freeze(steps),
    canonicalGoalFabricOnly: true,
    sourceMutationDelegatedToMissionWorker: true,
    duplicateSchedulerAllowed: false,
    mergeAuthority: false,
    arbitraryShellAllowed: false,
    finalVerdict: final?.ok === true
      ? 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_GREEN'
      : 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_BLOCKED',
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runSovereignCommanderGoalBuilderRepair();
  process.stdout.write(
    `${SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_MARKER}${JSON.stringify(result)}\n`,
  );
  process.exitCode = result.ok ? 0 : 2;
}
