#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { refreshBattleBridgeSharedWorkspacePublisher } from './battle-bridge-shared-workspace-publisher.mjs';
import { collectLauncherReadinessLiveFacts } from './launcher-readiness-live-facts.mjs';
import { planLauncherReadiness } from './launcher-readiness-planner.mjs';
import { runUi4173Repair, UI_4173_REPAIR_AUTHORITY } from './battle-bridge-ui-4173-repair.mjs';
import { evaluateGitPublicationTruthWithDeps, runIgnitionHousekeep } from './ignite-stephanos-local.mjs';

export const BATTLE_BRIDGE_IGNITION_SUPERVISOR_SCHEMA = 'stephanos.battle-bridge-ignition-supervisor.v1';
export const BATTLE_BRIDGE_IGNITION_PHASES = Object.freeze([
  'housekeeping',
  'source truth',
  'shared workspace publisher',
  'backend 8787',
  'OpenClaw gateway 18789',
  'Stephanos UI 4173',
  'browser/runtime proof',
  'ready',
]);
export const BATTLE_BRIDGE_IGNITION_PHASE_STATES = Object.freeze(['pending', 'running', 'ready', 'degraded', 'blocked', 'failed']);
export const BACKEND_8787_START_COMMAND_IDENTITY = Object.freeze({
  id: 'npm-script:stephanos:battle-bridge:repair',
  commandText: 'npm run stephanos:battle-bridge:repair',
  source: 'package.json#scripts.stephanos:battle-bridge:repair',
  purpose: 'repair/start the Battle Bridge backend listener on 8787 through the existing source-controlled backend repair path',
});
export const BATTLE_BRIDGE_IGNITION_AUTHORITY = Object.freeze({
  executesArbitraryShell: false,
  killsProcesses: false,
  mutatesOpenClaw: false,
  mergesOrPushes: false,
  installsDependencies: false,
  switchesBranches: false,
  deletesRuntimeData: false,
  uiRepairAuthority: UI_4173_REPAIR_AUTHORITY,
  backendStartCommandIdentity: BACKEND_8787_START_COMMAND_IDENTITY,
});

function phaseRecord(id, overrides = {}) {
  return { id, state: 'pending', blockerId: '', nextOperatorAction: '', logPath: '', ...overrides };
}

export function createBattleBridgeSupervisorStatus(overrides = {}) {
  return {
    schema: BATTLE_BRIDGE_IGNITION_SUPERVISOR_SCHEMA,
    generatedAt: new Date().toISOString(),
    currentPhase: 'housekeeping',
    trafficLight: 'blue',
    blockerId: '',
    nextOperatorAction: 'Watch the Battle Bridge ignition supervisor surface.',
    logPath: '',
    services: {
      backend8787: { state: 'pending', ready: false, commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY },
      openClaw18789: { state: 'pending', ready: false },
      stephanosUi4173: { state: 'pending', ready: false },
    },
    sharedWorkspaceFreshness: { state: 'pending', fresh: false, staleRecords: [] },
    sourceTruthVerdict: { state: 'pending', verdict: 'unknown' },
    runtimeOnlyDirtCaveat: null,
    phases: Object.fromEntries(BATTLE_BRIDGE_IGNITION_PHASES.map((id) => [id, phaseRecord(id)])),
    authority: BATTLE_BRIDGE_IGNITION_AUTHORITY,
    ...overrides,
  };
}

function trafficLightFor(status) {
  if (status.blockerId) return 'red';
  if (Object.values(status.phases).some((phase) => phase.state === 'failed' || phase.state === 'blocked')) return 'red';
  if (Object.values(status.phases).some((phase) => phase.state === 'degraded')) return 'amber';
  if (status.phases.ready?.state === 'ready') return 'green';
  return 'blue';
}

function applyReadinessToStatus(status, report = {}) {
  const services = report.observedServices || {};
  status.services.backend8787 = { state: services.backend?.ready ? 'ready' : 'blocked', ready: services.backend?.ready === true, evidence: services.backend?.evidence || null, commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY };
  status.services.openClaw18789 = { state: services['openclaw-gateway']?.ready ? 'ready' : 'blocked', ready: services['openclaw-gateway']?.ready === true, evidence: services['openclaw-gateway']?.evidence || null };
  status.services.stephanosUi4173 = { state: services['stephanos-ui']?.ready ? 'ready' : 'blocked', ready: services['stephanos-ui']?.ready === true, evidence: services['stephanos-ui']?.evidence || null };
  status.sharedWorkspaceFreshness = { state: (services['shared-workspace']?.ready && !(report.staleWorkspaceRecords || []).length) ? 'ready' : 'degraded', fresh: services['shared-workspace']?.ready === true && !(report.staleWorkspaceRecords || []).length, staleRecords: report.staleWorkspaceRecords || [] };
  status.runtimeOnlyDirtCaveat = (report.caveats || []).find((caveat) => caveat.id === 'runtime-only-dirt') || null;
  const sourceBlocker = (report.safetyBlockers || []).find((blocker) => /source|branch|dirty|tracked-runtime/.test(String(blocker.id || '')));
  if (sourceBlocker) {
    status.blockerId = sourceBlocker.id;
    status.nextOperatorAction = sourceBlocker.nextOperatorAction || sourceBlocker.detail || 'Resolve source truth blocker, then rerun npm run stephanos:ignite.';
    status.sourceTruthVerdict = { state: 'blocked', verdict: sourceBlocker.id, blocker: sourceBlocker };
  }
  return status;
}

export function projectBattleBridgeSupervisorStatus({ status = createBattleBridgeSupervisorStatus(), phase, phaseState = 'running', readinessReport = null, blocker = null, logPath = '' } = {}) {
  if (phase) {
    status.currentPhase = phase;
    status.phases[phase] = phaseRecord(phase, { ...(status.phases[phase] || {}), state: phaseState, blockerId: blocker?.id || '', nextOperatorAction: blocker?.nextOperatorAction || blocker?.detail || '', logPath });
  }
  if (readinessReport) applyReadinessToStatus(status, readinessReport);
  if (blocker) {
    status.blockerId = blocker.id;
    status.nextOperatorAction = blocker.nextOperatorAction || blocker.detail || 'Resolve blocker, then rerun npm run stephanos:ignite.';
  }
  if (logPath) status.logPath = logPath;
  status.trafficLight = trafficLightFor(status);
  return status;
}


async function runApprovedBackend8787Start({ spawnFn = spawn } = {}) {
  const child = spawnFn('npm', ['run', 'stephanos:battle-bridge:repair'], { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), detached: false, stdio: 'ignore', shell: false });
  if (!child || typeof child.on !== 'function') return { started: true, commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY };
  return await new Promise((resolve) => {
    child.once('error', (error) => resolve({ started: false, error: error?.message || String(error), commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY }));
    child.once('exit', (code, signal) => resolve({ started: code === 0, exit: { code, signal }, commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY }));
  });
}

function requiredServiceBlocker(id, detail, nextOperatorAction, extra = {}) {
  return { id, detail, nextOperatorAction, ...extra };
}

function isReady(report, id) {
  return report?.observedServices?.[id]?.ready === true;
}

async function writeStatus(status, sharedWorkspace) {
  if (!sharedWorkspace) return null;
  const dir = path.resolve(sharedWorkspace, 'status');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'battle-bridge-ignition-supervisor-current.json');
  await fs.writeFile(file, `${JSON.stringify(status, null, 2)}\n`);
  return file;
}

export async function runBattleBridgeIgnitionSupervisor({ sharedWorkspace = process.env.STEPHANOS_SHARED_WORKSPACE || path.join(os.tmpdir(), 'stephanos-battle-bridge-workspace'), housekeepFn = runIgnitionHousekeep, publisherFn = refreshBattleBridgeSharedWorkspacePublisher, collectFactsFn = collectLauncherReadinessLiveFacts, plannerFn = planLauncherReadiness, repairFn = runUi4173Repair, backendStartFn = runApprovedBackend8787Start, sourceTruthFn = evaluateGitPublicationTruthWithDeps, stdout = process.stdout } = {}) {
  let status = createBattleBridgeSupervisorStatus();
  const writes = [];
  const persist = async () => { const file = await writeStatus(status, sharedWorkspace); if (file) writes.push(file); };
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'housekeeping', phaseState: 'running' }); await persist();
  housekeepFn({ dryRun: false, compact: true });
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'housekeeping', phaseState: 'ready' }); await persist();

  status = projectBattleBridgeSupervisorStatus({ status, phase: 'shared workspace publisher', phaseState: 'running' }); await persist();
  await publisherFn({ sharedWorkspace });
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'shared workspace publisher', phaseState: 'ready' }); await persist();

  status = projectBattleBridgeSupervisorStatus({ status, phase: 'source truth', phaseState: 'running' }); await persist();
  const sourceTruth = sourceTruthFn();
  if (sourceTruth?.blocker) {
    status = projectBattleBridgeSupervisorStatus({ status, phase: 'source truth', phaseState: 'blocked', blocker: sourceTruth.blocker }); await persist();
    stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return { ok: false, status, writes };
  }
  status.sourceTruthVerdict = { state: 'ready', verdict: sourceTruth?.publicationState || sourceTruth?.sourceTruthVerdict || 'source-current' };
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'source truth', phaseState: 'ready' }); await persist();

  let facts = await collectFactsFn({ sharedWorkspace });
  let report = plannerFn(facts);
  status = projectBattleBridgeSupervisorStatus({ status, readinessReport: report }); await persist();

  status = projectBattleBridgeSupervisorStatus({ status, phase: 'backend 8787', phaseState: isReady(report, 'backend') ? 'ready' : 'running' }); await persist();
  if (!isReady(report, 'backend')) {
    const startResult = await backendStartFn({ sharedWorkspace, commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY });
    facts = await collectFactsFn({ sharedWorkspace });
    report = plannerFn(facts);
    status = projectBattleBridgeSupervisorStatus({ status, readinessReport: report });
    if (!isReady(report, 'backend')) {
      const blockerId = startResult?.unavailable ? 'backend-8787-start-unavailable' : 'backend-8787-missing';
      const blocker = requiredServiceBlocker(blockerId, 'Backend 8787 is required before browser/runtime proof and UI repair.', startResult?.unavailable ? 'Source needs a safe backend start adapter before Battle Bridge ignition can continue.' : `Approved backend start command did not produce readiness proof: ${BACKEND_8787_START_COMMAND_IDENTITY.commandText}`, { commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY, startResult });
      status = projectBattleBridgeSupervisorStatus({ status, phase: 'backend 8787', phaseState: startResult?.unavailable ? 'blocked' : 'failed', blocker }); await persist();
      stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return { ok: false, status, writes };
    }
  }
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'backend 8787', phaseState: 'ready', readinessReport: report }); await persist();

  status = projectBattleBridgeSupervisorStatus({ status, phase: 'OpenClaw gateway 18789', phaseState: isReady(report, 'openclaw-gateway') ? 'ready' : 'blocked' }); await persist();
  if (!isReady(report, 'openclaw-gateway')) {
    const blocker = requiredServiceBlocker('openclaw-gateway-18789-missing', 'OpenClaw gateway 18789 is required and cannot be mutated by this supervisor.', 'Start or verify the existing approved OpenClaw gateway 18789, then rerun npm run stephanos:ignite.');
    status = projectBattleBridgeSupervisorStatus({ status, phase: 'OpenClaw gateway 18789', phaseState: 'blocked', blocker }); await persist();
    stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return { ok: false, status, writes };
  }

  if (!isReady(report, 'shared-workspace') || (report.staleWorkspaceRecords || []).length) {
    status = projectBattleBridgeSupervisorStatus({ status, phase: 'shared workspace publisher', phaseState: 'running' }); await persist();
    await publisherFn({ sharedWorkspace });
    facts = await collectFactsFn({ sharedWorkspace });
    report = plannerFn(facts);
    status = projectBattleBridgeSupervisorStatus({ status, phase: 'shared workspace publisher', phaseState: isReady(report, 'shared-workspace') && !(report.staleWorkspaceRecords || []).length ? 'ready' : 'blocked', readinessReport: report }); await persist();
  }

  status = projectBattleBridgeSupervisorStatus({ status, phase: 'Stephanos UI 4173', phaseState: isReady(report, 'stephanos-ui') ? 'ready' : 'running' }); await persist();
  if (report.finalVerdict === 'partial-ui-missing' || !isReady(report, 'stephanos-ui')) {
    status = projectBattleBridgeSupervisorStatus({ status, phase: 'Stephanos UI 4173', phaseState: 'running' }); await persist();
    const repairOutput = { chunks: '' };
    const code = await repairFn({ sharedWorkspace, dryRun: false, stdout: { write: (chunk) => { repairOutput.chunks += chunk; } } });
    let repairResult = null;
    try { repairResult = JSON.parse(repairOutput.chunks); } catch {}
    const uiBlocker = repairResult?.ready ? null : requiredServiceBlocker('stephanos-ui-4173-missing', 'Stephanos UI 4173 did not pass readiness proof after guarded repair.', repairResult?.nextOperatorAction || `Inspect UI repair logs, then rerun proof. Approved command: ${UI_4173_REPAIR_AUTHORITY ? 'npm run stephanos:ignite:launcher-root' : 'source adapter required'}`);
    status = projectBattleBridgeSupervisorStatus({ status, phase: 'Stephanos UI 4173', phaseState: repairResult?.ready ? 'ready' : (code === 0 ? 'blocked' : 'failed'), blocker: uiBlocker, logPath: repairResult?.logs?.logPath || '' }); await persist();
    await publisherFn({ sharedWorkspace });
  }
  const proofFacts = await collectFactsFn({ sharedWorkspace });
  const proofReport = plannerFn(proofFacts);
  const proofReady = proofReport.finalVerdict === 'ready' && isReady(proofReport, 'backend') && isReady(proofReport, 'openclaw-gateway') && isReady(proofReport, 'stephanos-ui') && isReady(proofReport, 'shared-workspace');
  if (!proofReady) {
    const missingPhase = !isReady(proofReport, 'backend') ? 'backend 8787' : (!isReady(proofReport, 'openclaw-gateway') ? 'OpenClaw gateway 18789' : (!isReady(proofReport, 'stephanos-ui') ? 'Stephanos UI 4173' : 'shared workspace publisher'));
    const blockerId = status.blockerId || (missingPhase === 'backend 8787' ? 'backend-8787-missing' : (missingPhase === 'Stephanos UI 4173' ? 'stephanos-ui-4173-missing' : 'browser-runtime-proof-incomplete'));
    status = projectBattleBridgeSupervisorStatus({ status, phase: missingPhase, phaseState: 'blocked', readinessReport: proofReport, blocker: requiredServiceBlocker(blockerId, 'Required Battle Bridge element is not ready; browser/runtime proof remains pending.', 'Resolve blocked required elements, then rerun npm run stephanos:ignite.') });
    await persist();
    stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return { ok: false, status, writes };
  }
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'browser/runtime proof', phaseState: 'ready', readinessReport: proofReport });
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'ready', phaseState: 'ready' });
  await persist();
  stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  return { ok: true, status, writes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sharedWorkspaceIndex = process.argv.indexOf('--shared-workspace');
  const sharedWorkspace = sharedWorkspaceIndex >= 0 ? process.argv[sharedWorkspaceIndex + 1] : undefined;
  try { process.exitCode = (await runBattleBridgeIgnitionSupervisor({ sharedWorkspace })).ok ? 0 : 2; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
