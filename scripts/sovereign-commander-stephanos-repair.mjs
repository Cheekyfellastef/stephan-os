#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { publishSovereignCommanderRepairReport } from '../shared/agents/sovereignCommanderRepairReportV1.mjs';
import { projectOctopusRepairEscalation } from '../shared/agents/stephanosCorePersistentFlywheelV1.mjs';
import { sovereignControlPlaneGamingSafeV1 } from './sovereign-commander-control-plane-repair.mjs';

export const SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_SCHEMA =
  'stephanos.sovereign-commander-stephanos-repair.v1';
export const SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_MARKER =
  'SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_RESULT=';
export const REQUIRED_COMMANDER_CAPABILITY_VERSION =
  '2026-10-13-private-mcp-batch-metadata-v5';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const git = 'C:\\Program Files\\Git\\cmd\\git.exe';
// Private in-process proof: only the fixed runner's pre-spawn denial can carry
// this identity. A child-authored JSON flag cannot manufacture it.
const NO_CHILD_LAUNCHED = Symbol('sovereign-fixed-step-not-launched');
function denyBeforeLaunch(errorCode) {
  return Object.freeze({ ok: false, status: null, stdout: '', errorCode,
    [NO_CHILD_LAUNCHED]: true,
    custodyReleased: false, descendantExclusionProven: false });
}

export const CONTINUOUS_REPAIR_STEP_TIMEOUTS = Object.freeze({
  caretaker: 30_000,
  goalBuilderInitial: 60_000,
  controlPlane: 40_000,
  goalBuilderRetry: 50_000,
  coreStatus: 10_000,
});
export const CONTINUOUS_REPAIR_MAX_COMPOSED_TIMEOUT_MS = Object.values(
  CONTINUOUS_REPAIR_STEP_TIMEOUTS,
).reduce((sum, value) => sum + value, 0);

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
    timeoutMs: 145_000,
  }),
  controlPlane: Object.freeze({
    id: 'repair-control-plane',
    executable: node,
    args: Object.freeze([resolve(repoRoot, 'scripts', 'sovereign-commander-control-plane-repair.mjs'), '--unattended-gaming-guard']),
    timeoutMs: 180_000,
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

export function runFixedStephanosRepairStep(step, { spawnSyncFn = spawnSync } = {}) {
  // A timeout on Node is NOT a Windows descendant-exclusion witness. Until an
  // independently admitted native Job backend exists, continuous mutation is
  // not executable. Do not accept a caller flag or child's self-attestation as
  // a substitute. Read-only fixed Core status remains available.
  if (step.requiresWindowsJobCustody === true) {
    return denyBeforeLaunch('SOVEREIGN_CORE_WINDOWS_JOB_CUSTODY_UNAVAILABLE');
  }
  const result = spawnSyncFn(step.executable, [...step.args], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: step.timeoutMs,
    maxBuffer: 512 * 1024,
  });
  return Object.freeze({
    ok: !result?.error && result?.status === 0,
    status: Number.isInteger(result?.status) ? result.status : null,
    stdout: String(result?.stdout || ''),
    errorCode: text(result?.error?.code || result?.error?.message),
    custodyReleased: step.id === 'status-stephanos-core-daemon'
      && !result?.error && result?.status === 0,
    // Parent exit alone never proves native descendants or scheduled work gone.
    descendantExclusionProven: false,
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

function boundedContinuousStep(step, timeoutMs, enabled) {
  if (!enabled) return step;
  return Object.freeze({
    ...step,
    timeoutMs: Math.min(Number(step.timeoutMs) || timeoutMs, timeoutMs),
    requiresWindowsJobCustody: step.id !== 'status-stephanos-core-daemon',
  });
}

function compactStep(step, result, payload = null) {
  if (result?.[NO_CHILD_LAUNCHED] === true) {
    // There is no child exit status to report. Keep the denial distinct from
    // a launched process with unknown status, which must retain custody.
    return Object.freeze({ actionId: step.id, ok: false,
      executionState: 'NOT_STARTED',
      errorCode: result.errorCode,
      custodyReleased: true, descendantExclusionProven: false });
  }
  return Object.freeze({
    actionId: step.id,
    ok: result?.ok === true,
    status: Number.isInteger(result?.status) ? result.status : null,
    errorCode: text(result?.errorCode).slice(0, 120),
    finalVerdict: text(payload?.finalVerdict).slice(0, 160),
    blocker: text(payload?.blocker).slice(0, 160),
    custodyReleased: result?.custodyReleased === true,
    descendantExclusionProven: result?.descendantExclusionProven === true,
  });
}

function blocked(expectedHead, steps, blocker, independentCoreRepair = null) {
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
    ...(independentCoreRepair ? { independentCoreRepair } : {}),
  });
}

// Diagnostic projection only. A Core status (even a forged all-green one)
// cannot enroll a native custody executor or authorise the broad reconciler.
export function projectIndependentCoreRepairV1(core, expectedHead, observationOk) {
  const exactCoreFault = observationOk === true
    && core?.sourceHead === expectedHead && core?.singleWriterProven === true
    && core?.sourceHeadMatchesLive === true && core?.gamingActive === false
    && (core?.repairRequired === true || core?.readiness === 'DEGRADED');
  return Object.freeze({
    scope: 'CORE_ONLY', mutationAttempted: false, dispatchAllowed: false,
    nativeCustodySourceVersion: 'atomic-job-list-v1',
    nativeCustodyQualified: false, coreRepairWorkerImplemented: true, coreRepairWorkerAdmitted: false,
    supportedCoreRepairScope: 'CORE_PUBLICATION_DIRECTORIES_ONLY',
    exactCoreFaultObserved: exactCoreFault,
    blocker: exactCoreFault ? 'SOVEREIGN_CORE_ONLY_CANCELLABLE_BACKEND_UNQUALIFIED'
      : 'SOVEREIGN_CORE_ONLY_DISJOINT_SOURCE_PROOF_MISSING',
    originalR7Authority: false, controllerInstallerAuthority: false,
    taskSchedulerAuthority: false, serviceRestartAuthority: false,
    custodyReleased: false, descendantExclusionProven: false,
  });
}

export function runSovereignCommanderStephanosRepair({
  runStep = runFixedStephanosRepairStep,
  readHead = readCurrentHead,
  continuousRepairCycle = false,
  gamingSafe = sovereignControlPlaneGamingSafeV1,
} = {}) {
  const expectedHead = text(readHead()).toLowerCase();
  const steps = [];
  let controlPlaneComplete = null;
  let controlPlaneResidualBlocker = '';
  if (!/^[0-9a-f]{40}$/.test(expectedHead)) {
    return blocked('', steps, 'STEPHANOS_REPAIR_SOURCE_HEAD_UNAVAILABLE');
  }
  const guardBlocker = 'SOVEREIGN_COMMANDER_UNATTENDED_GAMING_GUARD_BLOCKED';
  const governorSafe = () => { try { return gamingSafe() === true; } catch { return false; } };
  if (continuousRepairCycle && !governorSafe()) {
    return blocked(expectedHead, steps, guardBlocker);
  }
  // The daemon's guardian previously launched Windows caretaker actions
  // before checking gaming at all. Recheck the on-host governor before each
  // fixed step as well as inside the control-plane subprocess.
  const guardedRunStep = step => continuousRepairCycle && !governorSafe()
    ? denyBeforeLaunch(guardBlocker)
    : runStep(step);

  const caretakerStep = boundedContinuousStep(STEPS.caretaker, CONTINUOUS_REPAIR_STEP_TIMEOUTS.caretaker, continuousRepairCycle);
  const caretaker = guardedRunStep(caretakerStep);
  const caretakerPayload = parseJsonPayload(caretaker?.stdout);
  steps.push(compactStep(caretakerStep, caretaker, caretakerPayload));
  const caretakerGreen = caretaker?.ok === true
    && caretakerPayload?.healthy === true
    && caretakerPayload?.coreDaemonHealthy === true
    && text(caretakerPayload?.coreDaemonSourceHead).toLowerCase() === expectedHead;
  if (!caretakerGreen) {
    if (caretaker?.errorCode === 'SOVEREIGN_CORE_WINDOWS_JOB_CUSTODY_UNAVAILABLE') {
      const observed = guardedRunStep(boundedContinuousStep(
        STEPS.coreStatus, CONTINUOUS_REPAIR_STEP_TIMEOUTS.coreStatus, true));
      const core = parseJsonPayload(observed?.stdout);
      steps.push(compactStep(STEPS.coreStatus, observed, core));
      return blocked(expectedHead, steps, caretaker.errorCode,
        projectIndependentCoreRepairV1(core, expectedHead, observed?.ok));
    }
    return blocked(
      expectedHead,
      steps,
      text(caretakerPayload?.blocker || caretaker?.errorCode || 'STEPHANOS_CARETAKER_REPAIR_FAILED'),
    );
  }

  const initialBuilderStep = boundedContinuousStep(STEPS.goalBuilder, CONTINUOUS_REPAIR_STEP_TIMEOUTS.goalBuilderInitial, continuousRepairCycle);
  let builder = guardedRunStep(initialBuilderStep);
  let builderPayload = parseJsonPayload(builder?.stdout);
  steps.push(compactStep(initialBuilderStep, builder, builderPayload));
  if (builder?.ok !== true || builderPayload?.ok !== true) {
    const builderBlocker = text(
      builderPayload?.blocker || builder?.errorCode || 'STEPHANOS_GOAL_BUILDER_REPAIR_FAILED',
    );
    const escalation = projectOctopusRepairEscalation(builderBlocker);
    if (!continuousRepairCycle || escalation.shouldRepairControlPlane !== true) {
      // A protected historical R7/source-writer HOLD must not be "repaired" by
      // retrying its lease or fabric. It also must not suppress a separately
      // observed, safe Core control-plane repair. Inspect with the existing
      // read-only fixed action; require affirmative physical owner/head and
      // non-gaming proof before attempting the already registered reconciler.
      if (continuousRepairCycle) {
        const observeStep = boundedContinuousStep(
          STEPS.coreStatus, CONTINUOUS_REPAIR_STEP_TIMEOUTS.coreStatus, true,
        );
        const observed = guardedRunStep(observeStep);
        const core = parseJsonPayload(observed?.stdout);
        steps.push(compactStep(observeStep, observed, core));
        // A degraded Core observation is diagnostic ONLY while the original
        // R7 writer/lease is held. The existing control-plane reconciler starts
        // Windows services, tasks and PowerShell descendants. Without an
        // independently proven disjoint action plus cancellable Windows Job
        // custody and post-timeout exclusion proof, invoking it here would
        // violate both gaming custody and the original-writer boundary.
        // Preserve the read-only observation and original builder blocker.
        return blocked(expectedHead, steps, builderBlocker,
          projectIndependentCoreRepairV1(core, expectedHead, observed?.ok));

      }
      // Independent Core maintenance, even if successful, is never proof
      // that the original R7 builder/lease has recovered.
      return blocked(expectedHead, steps, builderBlocker);
    }

    const controlPlaneStep = boundedContinuousStep(STEPS.controlPlane, CONTINUOUS_REPAIR_STEP_TIMEOUTS.controlPlane, true);
    const controlPlane = guardedRunStep(controlPlaneStep);
    const controlPlanePayload = parseJsonPayload(controlPlane?.stdout);
    steps.push(compactStep(controlPlaneStep, controlPlane, controlPlanePayload));
    controlPlaneComplete = controlPlane?.ok === true && controlPlanePayload?.ok === true;
    controlPlaneResidualBlocker = controlPlaneComplete
      ? ''
      : text(
          controlPlanePayload?.blocker
          || controlPlane?.errorCode
          || 'STEPHANOS_CONTROL_PLANE_ESCALATION_INCOMPLETE',
        );

    // The fixed control-plane reconciler is intentionally work-conserving: it
    // continues independent repairs after one fixed installer fails. Always
    // re-probe the goal-builder fabric after that bounded sweep. An unrelated
    // Recovery Mesh/auxiliary installer hold must remain visible, but it must
    // not strand independently repairable builder capacity.
    const retryBuilderStep = boundedContinuousStep(STEPS.goalBuilder, CONTINUOUS_REPAIR_STEP_TIMEOUTS.goalBuilderRetry, true);
    builder = guardedRunStep(retryBuilderStep);
    builderPayload = parseJsonPayload(builder?.stdout);
    steps.push(compactStep(retryBuilderStep, builder, builderPayload));
    if (builder?.ok !== true || builderPayload?.ok !== true) {
      return blocked(
        expectedHead,
        steps,
        text(
          builderPayload?.blocker
          || builder?.errorCode
          || 'STEPHANOS_GOAL_BUILDER_RETRY_FAILED',
        ),
      );
    }
  }

  const coreStatusStep = boundedContinuousStep(STEPS.coreStatus, CONTINUOUS_REPAIR_STEP_TIMEOUTS.coreStatus, continuousRepairCycle);
  const status = guardedRunStep(coreStatusStep);
  const core = parseJsonPayload(status?.stdout);
  steps.push(compactStep(coreStatusStep, status, core));
  // Missing/null heartbeat ages must never coerce to zero and prove a live Core.
  const heartbeatAge = core?.heartbeatAgeSeconds;
  const heartbeatAgeValid = typeof heartbeatAge === 'number'
    && Number.isFinite(heartbeatAge) && heartbeatAge >= 0;
  const coreHeartbeatHealthy = core?.heartbeatFresh === true
    || core?.busyGraceActive === true
    || (heartbeatAgeValid && heartbeatAge <= 60);
  const coreGreen = status?.ok === true
    && core?.ok === true
    && core?.daemonHealthy === true
    && coreHeartbeatHealthy
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

  const residualAttentionRequired = controlPlaneComplete === false;
  return Object.freeze({
    schemaVersion: SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_SCHEMA,
    ok: !residualAttentionRequired,
    blocker: residualAttentionRequired ? controlPlaneResidualBlocker : '',
    sourceHead: expectedHead,
    steps: Object.freeze(steps),
    controlPlaneRepairComplete: typeof controlPlaneComplete === 'boolean' ? controlPlaneComplete : null,
    controlPlaneResidualBlocker: typeof controlPlaneResidualBlocker === 'string' ? controlPlaneResidualBlocker : '',
    builderFlowRecovered: true,
    core: Object.freeze({
      readiness: text(core.readiness),
      wakeState: text(core.wakeState),
      awake: core.awake === true,
      repairRequired: core.repairRequired === true,
      heartbeatAgeSeconds: heartbeatAgeValid ? heartbeatAge : null,
      heartbeatFresh: core.heartbeatFresh === true || (heartbeatAgeValid && heartbeatAge <= 60),
      busyGraceActive: core.busyGraceActive === true,
    }),
    openClawSupportActions: Object.freeze(['repair-openclaw-local', 'repair-openclaw-standalone']),
    openClawSupportRequired: false,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    pcRestartAllowed: false,
    finalVerdict: residualAttentionRequired
      ? 'SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_BLOCKED'
      : 'SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_GREEN',
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const startedAtUtc = text(process.env.STEPHANOS_SOVEREIGN_REPAIR_CYCLE_STARTED_AT_UTC)
    || new Date().toISOString();
  const cycleId = text(process.env.STEPHANOS_SOVEREIGN_REPAIR_CYCLE_ID);
  const repair = runSovereignCommanderStephanosRepair({
    continuousRepairCycle: Boolean(cycleId),
  });
  const completedAtUtc = new Date().toISOString();

  let publication;
  try {
    publication = await publishSovereignCommanderRepairReport({
      repair,
      repoRoot,
      cycleId,
      startedAtUtc,
      completedAtUtc,
      source: 'continuous-repair-guardian',
    });
  } catch (error) {
    publication = Object.freeze({
      ok: false,
      outcome: '',
      status: '',
      blocker: `SOVEREIGN_COMMANDER_REPAIR_REPORT_PUBLICATION_FAILED:${text(error?.code || error?.message || 'UNKNOWN').slice(0, 96)}`,
      currentRecord: 'status/sovereign-commander-repair-current.json',
      eventStream: 'events/sovereign-commander-repair-cycles.ndjson',
      finalVerdict: 'SOVEREIGN_COMMANDER_REPAIR_REPORT_BLOCKED',
    });
  }

  const reporting = Object.freeze({
    ok: publication?.ok === true,
    outcome: text(publication?.outcome),
    status: text(publication?.status),
    blocker: text(publication?.blocker).slice(0, 160),
    currentRecord: text(publication?.currentRecord),
    eventStream: text(publication?.eventStream),
    finalVerdict: text(publication?.finalVerdict),
  });
  const result = reporting.ok
    ? Object.freeze({ ...repair, reporting })
    : Object.freeze({
      ...repair,
      ok: false,
      blocker: repair.ok === true
        ? (reporting.blocker || 'SOVEREIGN_COMMANDER_REPAIR_REPORT_PUBLICATION_FAILED')
        : repair.blocker,
      reportBlocker: reporting.blocker || 'SOVEREIGN_COMMANDER_REPAIR_REPORT_PUBLICATION_FAILED',
      reporting,
      finalVerdict: repair.ok === true
        ? 'SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_REPORT_BLOCKED'
        : repair.finalVerdict,
    });

  process.stdout.write(
    `${SOVEREIGN_COMMANDER_STEPHANOS_REPAIR_MARKER}${JSON.stringify(result)}\n`,
  );
  process.exitCode = result.ok ? 0 : 2;
}
