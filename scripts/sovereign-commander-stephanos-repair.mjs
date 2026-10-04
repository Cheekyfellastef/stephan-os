#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_SCHEMA =
  'stephanos.sovereign-commander-stephanos-repair.v1';
export const SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_MARKER =
  'SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_RESULT=';
export const REQUIRED_COMMANDER_CAPABILITY_VERSION =
  '2026-10-04-stephanos-repair-time-budget-v1';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const git = 'C:\\Program Files\\Git\\cmd\\git.exe';

const STEPS = Object.freeze({
  caretaker: Object.freeze({
    id: 'sovereign-control-plane-caretaker',
    executable: powershell,
    args: Object.freeze([
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', resolve(repoRoot, 'scripts', 'windows', 'run-sovereign-commander-hidden.ps1'),
      '-RequireCapabilityVersion', REQUIRED_COMMANDER_CAPABILITY_VERSION,
    ]),
    timeoutMs: 45_000,
  }),
  goalBuilder: Object.freeze({
    id: 'repair-goal-builder-flow',
    executable: node,
    args: Object.freeze([resolve(repoRoot, 'scripts', 'sovereign-commander-goal-builder-repair.mjs')]),
    timeoutMs: 125_000,
  }),
  coreStatus: Object.freeze({
    id: 'status-stephanos-core-daemon',
    executable: powershell,
    args: Object.freeze([
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', resolve(repoRoot, 'scripts', 'windows', 'status-stephanos-core-daemon.ps1'),
    ]),
    timeoutMs: 10_000,
  }),
});

function text(value) {
  return String(value ?? '').trim();
}

function parseJsonPayload(stdout) {
  const raw = text(stdout);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {}
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = lines[index].includes('=')
      ? lines[index].slice(lines[index].indexOf('=') + 1)
      : lines[index];
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

export function runFixedStephanosRepairStep(step) {
  const result = spawnSync(step.executable, [...step.args], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: step.timeoutMs,
    maxBuffer: 512 * 1024,
  });
  return Object.freeze({
    ok: !result?.error && Number(result?.status) === 0,
    status: Number.isInteger(result?.status) ? result.status : null,
    stdout: String(result?.stdout || ''),
    errorCode: text(result?.error?.code || result?.error?.message),
  });
}

function readCurrentHead() {
  const result = spawnSync(git, ['-C', repoRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 10_000,
  });
  const head = text(result?.stdout).toLowerCase();
  return !result?.error && Number(result?.status) === 0 && /^[0-9a-f]{40}$/.test(head) ? head : '';
}

function compactStep(step, result, payload = null) {
  return Object.freeze({
    actionId: step.id,
    ok: result?.ok === true,
    status: Number.isInteger(result?.status) ? result.status : null,
    errorCode: text(result?.errorCode).slice(0, 120),
    finalVerdict: text(payload?.finalVerdict).slice(0, 160),
    blocker: text(payload?.blocker).slice(0, 160),
  });
}

function blocked(expectedHead, steps, blocker) {
  return Object.freeze({
    schemaVersion: SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_SCHEMA,
    ok: false,
    blocker,
    sourceHead: expectedHead,
    steps: Object.freeze(steps),
    openClawSupportActions: Object.freeze(['repair-openclaw-local', 'repair-openclaw-standalone']),
    openClawSupportRequired: false,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    pcRestartAllowed: false,
    finalVerdict: 'SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_BLOCKED',
  });
}

export function runSovereignCommanderStephanosRepair({
  runStep = runFixedStephanosRepairStep,
  readHead = readCurrentHead,
} = {}) {
  const expectedHead = text(readHead()).toLowerCase();
  const steps = [];
  if (!/^[0-9a-f]{40}$/.test(expectedHead)) {
    return blocked('', steps, 'STEPHANOS_REPAIR_SOURCE_HEAD_UNAVAILABLE');
  }

  const caretaker = runStep(STEPS.caretaker);
  const caretakerPayload = parseJsonPayload(caretaker?.stdout);
  steps.push(compactStep(STEPS.caretaker, caretaker, caretakerPayload));
  const caretakerGreen = caretaker?.ok === true
    && caretakerPayload?.healthy === true
    && caretakerPayload?.coreDaemonHealthy === true
    && text(caretakerPayload?.coreDaemonSourceHead).toLowerCase() === expectedHead;
  if (!caretakerGreen) {
    return blocked(
      expectedHead,
      steps,
      text(caretakerPayload?.blocker || caretaker?.errorCode || 'STEPHANOS_CARETAKER_REPAIR_FAILED'),
    );
  }

  const builder = runStep(STEPS.goalBuilder);
  const builderPayload = parseJsonPayload(builder?.stdout);
  steps.push(compactStep(STEPS.goalBuilder, builder, builderPayload));
  if (builder?.ok !== true || builderPayload?.ok !== true) {
    return blocked(
      expectedHead,
      steps,
      text(builderPayload?.blocker || builder?.errorCode || 'STEPHANOS_GOAL_BUILDER_REPAIR_FAILED'),
    );
  }

  const status = runStep(STEPS.coreStatus);
  const core = parseJsonPayload(status?.stdout);
  steps.push(compactStep(STEPS.coreStatus, status, core));
  const coreGreen = status?.ok === true
    && core?.ok === true
    && core?.daemonHealthy === true
    && Number(core?.heartbeatAgeSeconds) <= 60
    && text(core?.sourceHead).toLowerCase() === expectedHead
    && text(core?.readiness).toUpperCase() === 'READY'
    && text(core?.wakeState).toUpperCase() === 'AWAKE'
    && core?.awake === true
    && core?.repairRequired === false;
  if (!coreGreen) {
    return blocked(
      expectedHead,
      steps,
      text(core?.repairReason || core?.finalVerdict || status?.errorCode || 'STEPHANOS_CORE_PROOF_FAILED'),
    );
  }

  return Object.freeze({
    schemaVersion: SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_SCHEMA,
    ok: true,
    blocker: '',
    sourceHead: expectedHead,
    steps: Object.freeze(steps),
    core: Object.freeze({
      readiness: text(core.readiness),
      wakeState: text(core.wakeState),
      awake: core.awake === true,
      repairRequired: core.repairRequired === true,
      heartbeatAgeSeconds: Number(core.heartbeatAgeSeconds),
    }),
    openClawSupportActions: Object.freeze(['repair-openclaw-local', 'repair-openclaw-standalone']),
    openClawSupportRequired: false,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    pcRestartAllowed: false,
    finalVerdict: 'SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_GREEN',
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runSovereignCommanderStephanosRepair();
  process.stdout.write(
    `${SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_MARKER}${JSON.stringify(result)}\n`,
  );
  process.exitCode = result.ok ? 0 : 2;
}
