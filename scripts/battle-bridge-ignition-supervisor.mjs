#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { refreshBattleBridgeSharedWorkspacePublisher } from './battle-bridge-shared-workspace-publisher.mjs';
import { collectLauncherReadinessLiveFacts, defaultWindowsSharedWorkspacePath } from './launcher-readiness-live-facts.mjs';
import { planLauncherReadiness } from './launcher-readiness-planner.mjs';
import { runUi4173Repair, UI_4173_REPAIR_AUTHORITY } from './battle-bridge-ui-4173-repair.mjs';
import { evaluateGitPublicationTruthWithDeps, runIgnitionHousekeep } from './ignite-stephanos-local.mjs';
import { buildOpenClawGatewayStartupTarget, OPENCLAW_GATEWAY_STARTUP_SOURCE, resolveOpenClawGatewayStartupExecution } from '../shared/agents/openClawGatewayStartup.mjs';

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
  killsProcesses: true,
  mutatesOpenClaw: true,
  mergesOrPushes: false,
  installsDependencies: false,
  switchesBranches: false,
  deletesRuntimeData: false,
  uiRepairAuthority: UI_4173_REPAIR_AUTHORITY,
  backendStartCommandIdentity: BACKEND_8787_START_COMMAND_IDENTITY,
  openClawGatewayStartupSource: OPENCLAW_GATEWAY_STARTUP_SOURCE,
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

export function defaultBattleBridgeSharedWorkspace({ env = process.env, platform = process.platform } = {}) {
  return env.STEPHANOS_SHARED_WORKSPACE
    || env.STEPHANOS_OPENCLAW_WORKSPACE
    || defaultWindowsSharedWorkspacePath({ home: env.USERPROFILE || env.HOME || os.homedir(), platform })
    || path.join(os.homedir(), 'Documents', 'Stephanos-openclaw-workspace');
}

function applyReadinessToStatus(status, report = {}) {
  const services = report.observedServices || {};
  const backendRepair = status.services.backend8787?.repair || null;
  const openClawStart = status.services.openClaw18789?.start || null;
  const servedRuntimeProof = status.services.stephanosUi4173?.servedRuntimeProof || null;
  status.services.backend8787 = { state: services.backend?.ready ? 'ready' : 'blocked', ready: services.backend?.ready === true, evidence: services.backend?.evidence || null, commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY, ...(backendRepair ? { repair: backendRepair } : {}) };
  status.services.openClaw18789 = { state: services['openclaw-gateway']?.ready ? 'ready' : 'blocked', ready: services['openclaw-gateway']?.ready === true, evidence: services['openclaw-gateway']?.evidence || null, ...(openClawStart ? { start: openClawStart } : {}) };
  status.services.stephanosUi4173 = { state: services['stephanos-ui']?.ready ? 'ready' : 'blocked', ready: services['stephanos-ui']?.ready === true, evidence: services['stephanos-ui']?.evidence || null, ...(servedRuntimeProof ? { servedRuntimeProof } : {}) };
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


export async function runApprovedBackend8787Start({ spawnFn = spawn, sharedWorkspace = defaultBattleBridgeSharedWorkspace() } = {}) {
  const logRoot = path.resolve(sharedWorkspace, 'logs', 'battle-bridge-backend-8787-repair');
  await fs.mkdir(logRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(logRoot, stamp);
  await fs.mkdir(logPath, { recursive: true });
  const stdoutLogPath = path.join(logPath, 'stdout.log');
  const stderrLogPath = path.join(logPath, 'stderr.log');
  const child = spawnFn('npm', ['run', 'stephanos:battle-bridge:repair'], { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), detached: false, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  if (child?.stdout?.pipe) child.stdout.pipe(createWriteStream(stdoutLogPath, { flags: 'a' }));
  if (child?.stderr?.pipe) child.stderr.pipe(createWriteStream(stderrLogPath, { flags: 'a' }));
  const logs = { logPath, stdoutLogPath, stderrLogPath };
  if (!child || typeof child.on !== 'function') return { started: true, exitCode: 0, logs, logPath, commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY };
  return await new Promise((resolve) => {
    child.once('error', (error) => resolve({ started: false, exitCode: null, error: error?.message || String(error), logs, logPath, commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY }));
    child.once('exit', (code, signal) => resolve({ started: code === 0, exitCode: code, exit: { code, signal }, logs, logPath, commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY }));
  });
}


function openClawHealthReady(payload = {}) {
  const status = String(payload?.status || payload?.state || '').toLowerCase();
  return payload?.ok === true || status === 'ok' || status === 'live';
}

async function probeOpenClawGateway18789Health({ fetchFn = globalThis.fetch } = {}) {
  const healthUrl = 'http://127.0.0.1:18789/health';
  const identityUrl = 'http://127.0.0.1:18789/identity';
  const healthResponse = await fetchJson(healthUrl, { fetchFn });
  let identity = null;
  if (healthResponse.ok && openClawHealthReady(healthResponse.json || {})) {
    try { identity = await fetchJson(identityUrl, { fetchFn }); } catch (error) { identity = { ok: false, error: error?.message || String(error) }; }
  }
  return { ready: Boolean(healthResponse.ok && openClawHealthReady(healthResponse.json || {})), healthUrl, identityUrl, health: healthResponse, identity };
}

export async function runApprovedOpenClawGateway18789Start({ spawnFn = spawn, sharedWorkspace = defaultBattleBridgeSharedWorkspace(), fetchFn = globalThis.fetch, readyTimeoutMs = 60000, retryIntervalMs = 500, env = process.env, token = '', approved = false, platform = process.platform, existsSync } = {}) {
  const target = buildOpenClawGatewayStartupTarget({ env, token, approved });
  const logRoot = path.resolve(sharedWorkspace, 'logs', 'openclaw-gateway-18789-start');
  await fs.mkdir(logRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(logRoot, stamp);
  await fs.mkdir(logPath, { recursive: true });
  const stdoutLogPath = path.join(logPath, 'stdout.log');
  const stderrLogPath = path.join(logPath, 'stderr.log');
  const exitLogPath = path.join(logPath, 'exit.json');
  const healthProofLogPath = path.join(logPath, 'health-proof.json');
  const logs = { logPath, stdoutLogPath, stderrLogPath, exitLogPath, healthProofLogPath };
  if (!target.available) {
    const unavailableExit = { code: null, signal: null, error: target.reason, reusedExistingRuntime: false };
    await fs.writeFile(stdoutLogPath, '');
    await fs.writeFile(stderrLogPath, '');
    await fs.writeFile(exitLogPath, `${JSON.stringify(unavailableExit, null, 2)}
`);
    await fs.writeFile(healthProofLogPath, `${JSON.stringify({ ready: false, skipped: true, reason: target.reason, healthUrl: 'http://127.0.0.1:18789/health' }, null, 2)}
`);
    return { started: false, exitCode: null, unavailable: true, reason: target.reason, target, logs, logPath, exit: unavailableExit, healthProof: { ready: false, skipped: true, reason: target.reason } };
  }
  let existingProof = null;
  try { existingProof = await probeOpenClawGateway18789Health({ fetchFn }); } catch (error) { existingProof = { ready: false, error: error?.message || String(error), healthUrl: 'http://127.0.0.1:18789/health' }; }
  await fs.writeFile(healthProofLogPath, `${JSON.stringify(existingProof, null, 2)}
`);
  if (existingProof.ready) {
    const exitState = { code: null, signal: null, error: null, reusedExistingRuntime: true };
    await fs.writeFile(exitLogPath, `${JSON.stringify(exitState, null, 2)}
`);
    return { started: false, reusedExistingRuntime: true, duplicateStartAvoided: true, ready: true, exitCode: null, exit: exitState, logs, logPath, target, healthProof: existingProof, pid: null };
  }
  let child = null;
  const childEnv = {
    ...process.env,
    ...env,
    STEPHANOS_OPENCLAW_AUTOSTART: 'battle-bridge-supervisor-gateway-only',
    ...(token || env.STEPHANOS_OPENCLAW_GATEWAY_TOKEN || env.OPENCLAW_GATEWAY_TOKEN ? {
      STEPHANOS_OPENCLAW_GATEWAY_TOKEN: token || env.STEPHANOS_OPENCLAW_GATEWAY_TOKEN || env.OPENCLAW_GATEWAY_TOKEN,
      OPENCLAW_GATEWAY_TOKEN: token || env.OPENCLAW_GATEWAY_TOKEN || env.STEPHANOS_OPENCLAW_GATEWAY_TOKEN,
    } : {}),
  };
  const execution = resolveOpenClawGatewayStartupExecution({ target, env: childEnv, platform, ...(existsSync ? { existsSync } : {}) });
  const safeExecution = execution.ok ? {
    program: execution.command,
    args: execution.commandArgs,
    resolvedOpenClawPath: execution.resolvedOpenClawPath || execution.resolvedExecutable || '',
    strategy: execution.strategy || execution.source || '',
  } : {
    program: '',
    args: [],
    resolvedOpenClawPath: '',
    strategy: '',
  };
  const exitState = { code: null, signal: null, error: execution.ok ? null : execution.reason, execution: safeExecution, commandText: target.commandText };
  try {
    if (execution.ok) child = spawnFn(execution.command, execution.commandArgs, { cwd: path.resolve(sharedWorkspace), detached: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false, env: childEnv });
  } catch (error) {
    exitState.error = error?.message || String(error);
  }
  if (child?.stdout?.pipe) child.stdout.pipe(createWriteStream(stdoutLogPath, { flags: 'a' })); else await fs.writeFile(stdoutLogPath, '', { flag: 'a' });
  if (child?.stderr?.pipe) child.stderr.pipe(createWriteStream(stderrLogPath, { flags: 'a' })); else await fs.writeFile(stderrLogPath, '', { flag: 'a' });
  if (child?.once) {
    child.once('error', (error) => { exitState.error = error?.message || String(error); });
    child.once('exit', (code, signal) => { exitState.code = code; exitState.signal = signal; });
  }
  const deadline = Date.now() + Math.max(0, readyTimeoutMs);
  let proof = null;
  do {
    try { proof = await probeOpenClawGateway18789Health({ fetchFn }); } catch (error) { proof = { ready: false, error: error?.message || String(error), healthUrl: 'http://127.0.0.1:18789/health' }; }
    await fs.writeFile(healthProofLogPath, `${JSON.stringify(proof, null, 2)}\n`);
    await fs.writeFile(exitLogPath, `${JSON.stringify(exitState, null, 2)}\n`);
    if (proof.ready) return { started: true, ready: true, exitCode: exitState.code, exit: exitState, logs, logPath, target, execution: safeExecution, healthProof: proof, pid: Number(child?.pid || 0) || null };
    if (exitState.error || exitState.signal !== null || (exitState.code !== null && exitState.code !== 0)) break;
    if (Date.now() < deadline && retryIntervalMs > 0) await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
  } while (Date.now() <= deadline);
  await fs.writeFile(healthProofLogPath, `${JSON.stringify(proof, null, 2)}\n`);
  await fs.writeFile(exitLogPath, `${JSON.stringify(exitState, null, 2)}\n`);
  return { started: !exitState.error, ready: false, exitCode: exitState.code, exit: exitState, error: exitState.error, logs, logPath, target, execution: safeExecution, healthProof: proof, pid: Number(child?.pid || 0) || null };
}

export function getCurrentGitHead({ cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), execFile = execFileSync } = {}) {
  return String(execFile('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' })).trim();
}

function commitMatchesHead(value, head) {
  const served = String(value || '').trim();
  const current = String(head || '').trim();
  if (!served || !current) return false;
  if (served === current) return true;
  return served.length >= 7 && current.startsWith(served);
}

function runtimeMarkerMatchesHead(marker, head) {
  const text = String(marker || '');
  const tokens = text.match(/[0-9a-f]{7,40}/gi) || [];
  return tokens.some((token) => commitMatchesHead(token, head));
}

export function evaluateServedRuntimeExactHeadProof({ health = null, dist = null, currentHead = '' } = {}) {
  const gitCommit = health?.gitCommit || health?.commit || '';
  const runtimeMarker = health?.runtimeMarker || health?.marker || '';
  const healthOk = health?.ok === true || health?.status === 'ok' || Boolean(gitCommit || runtimeMarker);
  const distOk = dist?.ok === true || (dist?.statusCode >= 200 && dist?.statusCode < 300);
  const gitCommitMatches = commitMatchesHead(gitCommit, currentHead);
  const runtimeMarkerMatches = runtimeMarkerMatchesHead(runtimeMarker, currentHead);
  return {
    ready: Boolean(healthOk && distOk && gitCommitMatches && runtimeMarkerMatches),
    currentHead,
    healthOk,
    distOk,
    gitCommit,
    runtimeMarker,
    gitCommitMatches,
    runtimeMarkerMatches,
    buildTimestamp: health?.buildTimestamp || null,
    health,
    dist,
  };
}

async function fetchJson(url, { fetchFn = globalThis.fetch } = {}) {
  const response = await fetchFn(url);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: response.ok, statusCode: response.status, json, text: text.slice(0, 500) };
}

export async function collectServedRuntimeExactHeadProof({ currentHead = getCurrentGitHead(), fetchFn = globalThis.fetch } = {}) {
  const healthResponse = await fetchJson('http://127.0.0.1:4173/__stephanos/health', { fetchFn });
  const distResponse = await fetchJson('http://127.0.0.1:4173/apps/stephanos/dist/index.html', { fetchFn });
  return evaluateServedRuntimeExactHeadProof({
    currentHead,
    health: healthResponse.json || { ok: healthResponse.ok, statusCode: healthResponse.statusCode },
    dist: { ok: distResponse.ok, statusCode: distResponse.statusCode },
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

export async function runBattleBridgeIgnitionSupervisor({ sharedWorkspace = defaultBattleBridgeSharedWorkspace(), housekeepFn = runIgnitionHousekeep, publisherFn = refreshBattleBridgeSharedWorkspacePublisher, collectFactsFn = collectLauncherReadinessLiveFacts, plannerFn = planLauncherReadiness, repairFn = runUi4173Repair, backendStartFn = runApprovedBackend8787Start, openClawStartFn = runApprovedOpenClawGateway18789Start, sourceTruthFn = evaluateGitPublicationTruthWithDeps, runtimeProofFn = collectServedRuntimeExactHeadProof, currentHeadFn = getCurrentGitHead, stdout = process.stdout } = {}) {
  let status = createBattleBridgeSupervisorStatus();
  const writes = [];
  const persist = async () => { const file = await writeStatus(status, sharedWorkspace); if (file) writes.push(file); };
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'housekeeping', phaseState: 'running' }); await persist();
  housekeepFn({ dryRun: false, compact: true });
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'housekeeping', phaseState: 'ready' }); await persist();

  status = projectBattleBridgeSupervisorStatus({ status, phase: 'source truth', phaseState: 'running' }); await persist();
  const sourceTruth = sourceTruthFn();
  if (sourceTruth?.blocker) {
    status = projectBattleBridgeSupervisorStatus({ status, phase: 'source truth', phaseState: 'blocked', blocker: sourceTruth.blocker }); await persist();
    stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return { ok: false, status, writes };
  }
  status.sourceTruthVerdict = { state: 'ready', verdict: sourceTruth?.publicationState || sourceTruth?.sourceTruthVerdict || 'source-current' };
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'source truth', phaseState: 'ready' }); await persist();

  status = projectBattleBridgeSupervisorStatus({ status, phase: 'shared workspace publisher', phaseState: 'running' }); await persist();
  await publisherFn({ sharedWorkspace });
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'shared workspace publisher', phaseState: 'ready' }); await persist();

  let facts = await collectFactsFn({ sharedWorkspace });
  let report = plannerFn(facts);
  status = projectBattleBridgeSupervisorStatus({ status, readinessReport: report }); await persist();

  status = projectBattleBridgeSupervisorStatus({ status, phase: 'backend 8787', phaseState: isReady(report, 'backend') ? 'ready' : 'running' }); await persist();
  if (!isReady(report, 'backend')) {
    const startResult = await backendStartFn({ sharedWorkspace, commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY });
    status.services.backend8787.repair = { commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY, logPath: startResult?.logPath || startResult?.logs?.logPath || '', logs: startResult?.logs || null, exitCode: startResult?.exitCode ?? startResult?.exit?.code ?? null };
    status.phases['backend 8787'].logPath = startResult?.logPath || startResult?.logs?.logPath || '';
    await persist();
    facts = await collectFactsFn({ sharedWorkspace });
    report = plannerFn(facts);
    status = projectBattleBridgeSupervisorStatus({ status, readinessReport: report });
    if (!isReady(report, 'backend')) {
      const blockerId = startResult?.unavailable ? 'backend-8787-start-unavailable' : (startResult?.exitCode === 0 || startResult?.started ? 'backend-8787-repair-no-health-proof' : 'backend-8787-repair-failed');
      const blocker = requiredServiceBlocker(blockerId, 'Backend 8787 is required before browser/runtime proof and UI repair, and must be proved by HTTP health.', startResult?.unavailable ? 'Source needs a safe backend start adapter before Battle Bridge ignition can continue.' : `Inspect backend repair logs at ${startResult?.logPath || startResult?.logs?.logPath || 'canonical shared workspace logs'}; then rerun npm run stephanos:ignite.`, { commandIdentity: BACKEND_8787_START_COMMAND_IDENTITY, startResult, logPath: startResult?.logPath || startResult?.logs?.logPath || '' });
      status = projectBattleBridgeSupervisorStatus({ status, phase: 'backend 8787', phaseState: startResult?.unavailable ? 'blocked' : 'failed', blocker, logPath: startResult?.logPath || startResult?.logs?.logPath || '' }); await persist();
      stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return { ok: false, status, writes };
    }
  }
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'backend 8787', phaseState: 'ready', readinessReport: report, logPath: status.services.backend8787.repair?.logPath || '' }); await persist();

  status = projectBattleBridgeSupervisorStatus({ status, phase: 'OpenClaw gateway 18789', phaseState: isReady(report, 'openclaw-gateway') ? 'ready' : 'running' }); await persist();
  if (!isReady(report, 'openclaw-gateway')) {
    const startResult = await openClawStartFn({ sharedWorkspace });
    status.services.openClaw18789.start = { startupSource: OPENCLAW_GATEWAY_STARTUP_SOURCE, commandText: startResult?.target?.commandText || '', execution: startResult?.execution || startResult?.exit?.execution || null, logPath: startResult?.logPath || startResult?.logs?.logPath || '', logs: startResult?.logs || null, exitCode: startResult?.exitCode ?? startResult?.exit?.code ?? null, healthProof: startResult?.healthProof || null };
    status.phases['OpenClaw gateway 18789'].logPath = startResult?.logPath || startResult?.logs?.logPath || '';
    await persist();
    facts = await collectFactsFn({ sharedWorkspace });
    report = plannerFn(facts);
    status = projectBattleBridgeSupervisorStatus({ status, readinessReport: report });
    if (!isReady(report, 'openclaw-gateway') || startResult?.ready !== true) {
      const exitCode = startResult?.exitCode ?? startResult?.exit?.code ?? null;
      const failedExit = Boolean(startResult?.error || startResult?.exit?.signal || (exitCode !== null && exitCode !== 0));
      const blockerId = failedExit ? 'openclaw-gateway-18789-start-failed' : 'openclaw-gateway-18789-no-health-proof';
      const logPath = startResult?.logPath || startResult?.logs?.logPath || 'canonical shared workspace logs/openclaw-gateway-18789-start';
      const blocker = requiredServiceBlocker(blockerId, 'OpenClaw gateway 18789 startup must be proved by http://127.0.0.1:18789/health returning ok/status live; readonly adapter stubs are not accepted.', `Inspect OpenClaw gateway startup logs at ${logPath}; then rerun npm run stephanos:ignite.`, { startupSource: OPENCLAW_GATEWAY_STARTUP_SOURCE, startResult, logPath });
      status = projectBattleBridgeSupervisorStatus({ status, phase: 'OpenClaw gateway 18789', phaseState: failedExit ? 'failed' : 'blocked', blocker, logPath }); await persist();
      stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return { ok: false, status, writes };
    }
  }
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'OpenClaw gateway 18789', phaseState: 'ready', readinessReport: report, logPath: status.services.openClaw18789.start?.logPath || '' }); await persist();

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
  status = projectBattleBridgeSupervisorStatus({ status, phase: 'browser/runtime proof', phaseState: 'running', readinessReport: proofReport }); await persist();
  let servedRuntimeProof = null;
  if (isReady(proofReport, 'stephanos-ui')) {
    servedRuntimeProof = await runtimeProofFn({ currentHead: currentHeadFn(), sharedWorkspace });
    status.services.stephanosUi4173.servedRuntimeProof = servedRuntimeProof;
    if (!servedRuntimeProof.ready) {
      status = projectBattleBridgeSupervisorStatus({ status, phase: 'Stephanos UI 4173', phaseState: 'running' }); await persist();
      const repairOutput = { chunks: '' };
      const code = await repairFn({ sharedWorkspace, dryRun: false, stdout: { write: (chunk) => { repairOutput.chunks += chunk; } } });
      let repairResult = null;
      try { repairResult = JSON.parse(repairOutput.chunks); } catch {}
      await publisherFn({ sharedWorkspace });
      const repairedFacts = await collectFactsFn({ sharedWorkspace });
      const repairedReport = plannerFn(repairedFacts);
      proofReport.observedServices = repairedReport.observedServices;
      proofReport.finalVerdict = repairedReport.finalVerdict;
      proofReport.staleWorkspaceRecords = repairedReport.staleWorkspaceRecords || [];
      servedRuntimeProof = isReady(repairedReport, 'stephanos-ui') ? await runtimeProofFn({ currentHead: currentHeadFn(), sharedWorkspace }) : servedRuntimeProof;
      status = projectBattleBridgeSupervisorStatus({ status, phase: 'Stephanos UI 4173', phaseState: servedRuntimeProof.ready ? 'ready' : (code === 0 ? 'blocked' : 'failed'), readinessReport: repairedReport, logPath: repairResult?.logs?.logPath || '' });
      status.services.stephanosUi4173.servedRuntimeProof = servedRuntimeProof;
      await persist();
    }
  }
  const exactHeadReady = servedRuntimeProof?.ready === true;
  const proofReady = proofReport.finalVerdict === 'ready' && isReady(proofReport, 'backend') && isReady(proofReport, 'openclaw-gateway') && isReady(proofReport, 'stephanos-ui') && isReady(proofReport, 'shared-workspace') && exactHeadReady;
  if (!proofReady) {
    const missingPhase = !isReady(proofReport, 'backend') ? 'backend 8787' : (!isReady(proofReport, 'openclaw-gateway') ? 'OpenClaw gateway 18789' : (!isReady(proofReport, 'stephanos-ui') ? 'Stephanos UI 4173' : 'shared workspace publisher'));
    const staleRuntime = isReady(proofReport, 'stephanos-ui') && servedRuntimeProof && !servedRuntimeProof.ready;
    const blockerId = staleRuntime ? 'served-runtime-stale' : (status.blockerId || (missingPhase === 'backend 8787' ? 'backend-8787-missing' : (missingPhase === 'Stephanos UI 4173' ? 'stephanos-ui-4173-missing' : 'browser-runtime-proof-incomplete')));
    const detail = staleRuntime ? `Stephanos UI 4173 is alive but served runtime does not match current source HEAD ${servedRuntimeProof.currentHead}.` : 'Required Battle Bridge element is not ready; browser/runtime proof remains pending.';
    const action = staleRuntime ? 'Rebuild/restart 4173 through guarded UI repair, then rerun npm run stephanos:ignite.' : 'Resolve blocked required elements, then rerun npm run stephanos:ignite.';
    status = projectBattleBridgeSupervisorStatus({ status, phase: staleRuntime ? 'browser/runtime proof' : missingPhase, phaseState: 'blocked', readinessReport: proofReport, blocker: requiredServiceBlocker(blockerId, detail, action, { servedRuntimeProof }) });
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
