#!/usr/bin/env node
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  collectCanonicalIgnitionSourceTruth,
  defaultBattleBridgeSharedWorkspace,
  evaluateCanonicalIgnitionSourceTruth,
} from './battle-bridge-ignition-supervisor.mjs';
import { collectLauncherReadinessLiveFacts } from './launcher-readiness-live-facts.mjs';
import { planLauncherReadiness } from './launcher-readiness-planner.mjs';

export const SOVEREIGN_COMMANDER_IGNITION_DIAGNOSIS_SCHEMA =
  'stephanos.sovereign-commander-ignition-diagnosis.v1';
export const SOVEREIGN_COMMANDER_IGNITION_DIAGNOSIS_MARKER =
  'SOVEREIGN_COMMANDER_IGNITION_DIAGNOSIS_RESULT=';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SHA40 = /^[a-f0-9]{40}$/;
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const MAX_SUPERVISOR_BYTES = 256 * 1024;
const MAX_SUPERVISOR_AGE_MS = 10 * 60 * 1000;

function text(value) {
  return String(value ?? '').trim();
}

function token(value, fallback = '') {
  const candidate = text(value).slice(0, 160);
  return SAFE_TOKEN.test(candidate) ? candidate : fallback;
}

function safeTime(value) {
  const milliseconds = Date.parse(text(value));
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : '';
}

function readSupervisorStatus(path, nowMs = Date.now()) {
  try {
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
      || before.size < 1 || before.size > MAX_SUPERVISOR_BYTES) return null;
    const bytes = readFileSync(path);
    const after = lstatSync(path);
    if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1
      || before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || bytes.length !== before.size) return null;
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || parsed.schema !== 'stephanos.battle-bridge-ignition-supervisor.v1') return null;
    const observedAtUtc = safeTime(parsed.generatedAt);
    const observedAtMs = Date.parse(observedAtUtc);
    const stale = !Number.isFinite(observedAtMs)
      || observedAtMs > nowMs + 5_000
      || nowMs - observedAtMs > MAX_SUPERVISOR_AGE_MS;
    const phases = Object.values(parsed.phases || {}).slice(0, 12).flatMap((phase) => {
      const id = text(phase?.id).slice(0, 80);
      const state = text(phase?.state).toLowerCase();
      const blockerId = token(phase?.blockerId);
      if (!id || !['pending','running','ready','degraded','blocked','failed'].includes(state)) return [];
      return [Object.freeze({ id, state, blockerId })];
    });
    return Object.freeze({
      observed: true,
      stale,
      observedAtUtc,
      currentPhase: text(parsed.currentPhase).slice(0, 80),
      trafficLight: ['blue','green','amber','red'].includes(text(parsed.trafficLight).toLowerCase())
        ? text(parsed.trafficLight).toLowerCase() : 'unknown',
      blockerId: token(parsed.blockerId),
      phases: Object.freeze(phases),
    });
  } catch {
    return null;
  }
}

function serviceReady(report, id) {
  return report?.observedServices?.[id]?.ready === true;
}

function diagnosisBlocker({ sourceOk, backendReady, uiReady, workspaceReady, supervisor }) {
  if (!sourceOk) return 'IGNITION_SOURCE_UNPROVEN';
  if (!backendReady) return 'IGNITION_BACKEND_8787_NOT_READY';
  if (!uiReady) return 'IGNITION_UI_4173_NOT_READY';
  if (!workspaceReady) return 'IGNITION_SHARED_WORKSPACE_UNPROVEN';
  if (supervisor?.observed && !supervisor.stale && supervisor.blockerId) {
    return supervisor.blockerId;
  }
  return '';
}

export async function diagnoseSovereignCommanderIgnition({
  repoRoot = REPO_ROOT,
  sharedWorkspace = defaultBattleBridgeSharedWorkspace(),
  nowMs = Date.now,
  sourceTruthFn = collectCanonicalIgnitionSourceTruth,
  evaluateSourceTruthFn = evaluateCanonicalIgnitionSourceTruth,
  liveFactsFn = collectLauncherReadinessLiveFacts,
  readinessFn = planLauncherReadiness,
  supervisorReader = readSupervisorStatus,
} = {}) {
  const observedAtUtc = new Date(nowMs()).toISOString();
  let sourceTruth = null;
  let sourceVerdict = null;
  try {
    sourceTruth = sourceTruthFn({ cwd: repoRoot, platform: process.platform, environment: process.env });
    sourceVerdict = evaluateSourceTruthFn(sourceTruth);
  } catch {}
  const sourceHead = text(sourceVerdict?.sourceTruth?.head || sourceTruth?.head).toLowerCase();
  const sourceOk = sourceVerdict?.ok === true && SHA40.test(sourceHead);

  let readiness = null;
  try {
    const facts = await liveFactsFn({ repoRoot, sharedWorkspace });
    readiness = readinessFn(facts);
  } catch {}
  const backendReady = serviceReady(readiness, 'backend');
  const uiReady = serviceReady(readiness, 'stephanos-ui');
  const openClawReady = serviceReady(readiness, 'openclaw-gateway');
  const workspaceReady = serviceReady(readiness, 'shared-workspace')
    && !(readiness?.staleWorkspaceRecords || []).length;

  const supervisorPath = resolve(sharedWorkspace, 'status', 'battle-bridge-ignition-supervisor-current.json');
  const supervisor = supervisorReader(supervisorPath, nowMs()) || Object.freeze({
    observed: false, stale: true, observedAtUtc: '', currentPhase: '',
    trafficLight: 'unknown', blockerId: '', phases: Object.freeze([]),
  });

  const blocker = diagnosisBlocker({
    sourceOk, backendReady, uiReady, workspaceReady, supervisor,
  });
  const liveRuntimeReady = sourceOk && backendReady && uiReady && workspaceReady;
  let nextRepairAction = '';
  if (sourceOk && !backendReady) nextRepairAction = 'restart-stephanos-runtime';
  else if (sourceOk && backendReady && !uiReady && openClawReady && workspaceReady) {
    nextRepairAction = 'repair-ui-4173';
  }

  const autoRepairEligible = Boolean(nextRepairAction)
    && sourceOk
    && !(readiness?.safetyBlockers || []).some((item) => item?.id === 'dirty-source');

  return Object.freeze({
    schemaVersion: SOVEREIGN_COMMANDER_IGNITION_DIAGNOSIS_SCHEMA,
    ok: liveRuntimeReady,
    observedAtUtc,
    sourceHead: SHA40.test(sourceHead) ? sourceHead : '',
    sourceExact: sourceOk,
    readinessVerdict: text(readiness?.finalVerdict).slice(0, 80),
    services: Object.freeze({
      backend8787: Object.freeze({ ready: backendReady }),
      stephanosUi4173: Object.freeze({ ready: uiReady }),
      openClaw18789: Object.freeze({ ready: openClawReady, requiredForIgnition: false }),
      sharedWorkspace: Object.freeze({ ready: workspaceReady }),
    }),
    supervisor,
    repairRequired: !liveRuntimeReady,
    autoRepairEligible,
    nextRepairAction,
    blocker: blocker || (liveRuntimeReady ? '' : 'IGNITION_RUNTIME_UNPROVEN'),
    readOnly: true,
    sourceMutationAllowed: false,
    arbitraryShellAllowed: false,
    mergeAuthority: false,
    pcRestartAllowed: false,
    rawLogsReturned: false,
    rawPathsReturned: false,
    secretMaterialIncluded: false,
    finalVerdict: liveRuntimeReady
      ? 'SOVEREIGN_COMMANDER_IGNITION_DIAGNOSIS_GREEN'
      : autoRepairEligible
        ? 'SOVEREIGN_COMMANDER_IGNITION_DIAGNOSIS_REPAIR_READY'
        : 'SOVEREIGN_COMMANDER_IGNITION_DIAGNOSIS_ATTENTION_REQUIRED',
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await diagnoseSovereignCommanderIgnition();
  process.stdout.write(SOVEREIGN_COMMANDER_IGNITION_DIAGNOSIS_MARKER + JSON.stringify(result) + '\n');
  process.exitCode = result.ok || result.autoRepairEligible ? 0 : 2;
}
