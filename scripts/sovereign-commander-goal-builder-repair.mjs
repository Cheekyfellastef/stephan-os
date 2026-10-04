#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_SCHEMA =
  'stephanos.sovereign-commander-goal-builder-repair.v1';
export const SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_MARKER =
  'SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_RESULT=';
const CONTROLLER_LANE_STATUS_MARKER =
  'SOVEREIGN_COMMANDER_CONTROLLER_LANE_STATUS_RESULT=';
const SAFE_BLOCKER = /^[A-Z0-9][A-Z0-9._:-]{0,159}$/;

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
  controllerLaneStatus: Object.freeze({
    id: 'controller-lane-status',
    executable: node,
    args: Object.freeze([resolve(repoRoot, 'scripts', 'sovereign-controller-lane-status.mjs')]),
    timeoutMs: 15_000,
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

function safeStructuredBlocker(stdout) {
  const raw = text(stdout);
  if (!raw) return '';
  const lines = [raw, ...raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse()];
  for (const line of lines) {
    const candidates = line.includes('=') ? [line, line.slice(line.indexOf('=') + 1)] : [line];
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        const blocker = text(parsed?.blocker);
        if (SAFE_BLOCKER.test(blocker)) return blocker;
      } catch {}
    }
  }
  return '';
}

function parseControllerLaneStatus(result) {
  if (result?.ok !== true) return null;
  const stdout = text(result?.stdout);
  const markerIndex = stdout.lastIndexOf(CONTROLLER_LANE_STATUS_MARKER);
  if (markerIndex < 0) return null;
  const payload = stdout.slice(markerIndex + CONTROLLER_LANE_STATUS_MARKER.length).trim().split(/\r?\n/)[0];
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function laneStatusGreen(result) {
  const status = parseControllerLaneStatus(result);
  return status?.ok === true
    && status?.finalVerdict === 'SOVEREIGN_CONTROLLER_LANE_STATUS_READY'
    && status?.lanes?.refillHealth === 'GREEN';
}

function laneStatusBlocker(result) {
  const status = parseControllerLaneStatus(result);
  const refillState = text(status?.lanes?.refillState);
  if (SAFE_BLOCKER.test(refillState) && refillState !== 'NO_SAFE_ELIGIBLE_WORK_REPORTED') return refillState;
  const verdict = text(status?.finalVerdict);
  if (SAFE_BLOCKER.test(verdict) && verdict !== 'SOVEREIGN_CONTROLLER_LANE_STATUS_READY') return verdict;
  return result?.ok === true ? 'CONTROLLER_LANE_STATUS_UNPROVEN' : text(result?.errorCode) || 'CONTROLLER_LANE_STATUS_READ_FAILED';
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
  // The worker-start and goal-heartbeat steps may launch descendants on Windows.
  // If those descendants inherit the synchronous caller's stdout/stderr pipes,
  // Node can remain blocked waiting for pipe EOF even after the bounded direct
  // child has timed out. Keep proof-producing observation steps captured, but
  // make the two mutating repair steps pipe-free so timeout always terminalizes.
  const captureOutput = step === STEPS.supervisor || step === STEPS.controllerLaneStatus;
  const result = spawnSync(step.executable, [...step.args], {
    ...(captureOutput ? { encoding: 'utf8' } : {}),
    stdio: captureOutput
      ? ['ignore', 'pipe', 'pipe']
      : ['ignore', 'ignore', 'ignore'],
    shell: false,
    windowsHide: true,
    timeout: step.timeoutMs,
    maxBuffer: 256 * 1024,
  });
  return Object.freeze({
    ok: !result?.error && Number(result?.status) === 0,
    status: Number.isInteger(result?.status) ? result.status : null,
    stdout: captureOutput ? String(result?.stdout || '') : '',
    errorCode: text(
      result?.error?.code
      || result?.error?.message
      || (captureOutput ? safeStructuredBlocker(result?.stdout) : ''),
    ),
  });
}

export function runSovereignCommanderGoalBuilderRepair({
  runStep = runFixedGoalBuilderRepairStep,
} = {}) {
  const steps = [];
  const initialSupervisor = runStep(STEPS.supervisor);
  steps.push(compactStep(STEPS.supervisor, initialSupervisor));
  const initialLaneStatus = runStep(STEPS.controllerLaneStatus);
  steps.push(compactStep(STEPS.controllerLaneStatus, initialLaneStatus));

  if (initialSupervisor?.ok === true && laneStatusGreen(initialLaneStatus)) {
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

  // This action executes through the canonical mailbox, so it must never try to
  // repair or reinstall that same control plane while holding the mailbox lease.
  // Independent lifeboat/recovery routes own control-plane recovery. This repair
  // is intentionally scoped to the builder fabric it can safely heal in-band.
  for (const step of [STEPS.startMissionWorker, STEPS.goalHeartbeat]) {
    const result = runStep(step);
    steps.push(compactStep(step, result));
    if (result?.ok !== true) {
      return Object.freeze({
        ok: false,
        schemaVersion: SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_SCHEMA,
        repairApplied: true,
        blocker: text(result?.errorCode) || `${step.id.toUpperCase().replace(/-/g, '_')}_FAILED`,
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

  const finalSupervisor = runStep(STEPS.supervisor);
  steps.push(compactStep(STEPS.supervisor, finalSupervisor));
  const finalLaneStatus = runStep(STEPS.controllerLaneStatus);
  steps.push(compactStep(STEPS.controllerLaneStatus, finalLaneStatus));
  const green = finalSupervisor?.ok === true && laneStatusGreen(finalLaneStatus);
  return Object.freeze({
    ok: green,
    schemaVersion: SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_SCHEMA,
    repairApplied: true,
    blocker: green
      ? ''
      : finalSupervisor?.ok !== true
        ? text(finalSupervisor?.errorCode) || 'GOAL_BUILDER_FLOW_STILL_BLOCKED'
        : laneStatusBlocker(finalLaneStatus),
    steps: Object.freeze(steps),
    canonicalGoalFabricOnly: true,
    sourceMutationDelegatedToMissionWorker: true,
    duplicateSchedulerAllowed: false,
    mergeAuthority: false,
    arbitraryShellAllowed: false,
    finalVerdict: green
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
