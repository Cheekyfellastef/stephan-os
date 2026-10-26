#!/usr/bin/env node
// Scheduled client of the existing guardian. No alternate maintenance owner.
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, lstatSync, openSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGoalDiscoveryWorkspaceV1 } from '../shared/agents/goalDiscoveryWorkspaceV1.mjs';
import { loadSovereignCommanderToken } from './sovereign-commander-http.mjs';
import { readMaintenanceBootWitnessV1, readMaintenanceRecoverySourceV1 } from './sovereign-maintenance-custody-store-v1.mjs';
import { collectUi4173ServedExactHeadProof, getUi4173RepairCurrentGitHead } from './battle-bridge-ui-4173-repair.mjs';
import { sovereignControlPlaneGamingSafeV1 } from './sovereign-commander-control-plane-repair.mjs';
import { appendWorkspaceJsonl, SHARED_WORKSPACE_RECORD_SCHEMA_VERSION, SHARED_WORKSPACE_RECORD_KINDS } from '../shared/agents/sharedAgentWorkspaceStore.mjs';

const BASE = 'http://127.0.0.1:18791';
const SHA = /^[a-f0-9]{40}$/;
const SCHEMA = 'stephanos.frontend-autostart.v1';
const wait = ms => new Promise(done => setTimeout(done, ms));
const blocked = (blocker, extra = {}) => ({ schemaVersion: SCHEMA, ok: false, blocker, ...extra });

// A changed/unprovable source is an invalidated attempt, not an unavailable
// service. Keep that state distinct across every awaited observation.
export function createFrontendSourceBoundary(expectedHead, sourceReader) {
  let invalidation;
  const assertUsing = reader => {
    if (invalidation) throw invalidation;
    let current;
    try { current = reader(); } catch { /* Unprovable is invalidated. */ }
    if (!SHA.test(expectedHead || '') || current !== expectedHead) {
      invalidation = Object.assign(new Error('FRONTEND_AUTOSTART_SOURCE_CHANGED'), { code: 'FRONTEND_AUTOSTART_SOURCE_CHANGED' });
      throw invalidation;
    }
  };
  const bind = reader => Object.freeze({
    assertCurrent: () => assertUsing(reader),
    observe: async operation => {
      assertUsing(reader);
      try { const value = await operation(); assertUsing(reader); return value; }
      catch (error) { assertUsing(reader); throw error; }
    },
    // Derived full/local readers share the private latch; there is no reset.
    withReader: bind,
  });
  return bind(sourceReader);
}

export async function finalizeFrontendStartupResult(result, { publish = publishFrontendStartupResult } = {}) {
  try {
    if (!(await publish(result))?.ok) throw new Error('PUBLICATION_REFUSED');
    return result;
  } catch (error) {
    return blocked(error?.code === 'FRONTEND_AUTOSTART_SOURCE_CHANGED' ? error.code : 'FRONTEND_AUTOSTART_RECEIPT_UNPROVEN',
      { expectedHead: result.expectedHead, actionAttempted: result.actionAttempted === true,
        priorServedProofPassed: result.ok === true });
  }
}

export async function publishFrontendStartupResult(result, { workspaceRoot = resolveGoalDiscoveryWorkspaceV1(),
  bootReader = readMaintenanceBootWitnessV1, writer = appendWorkspaceJsonl,
  sourceReader = readMaintenanceRecoverySourceV1 } = {}) {
  const appendObservation = async () => {
    const bootWitness = await bootReader();
    // This is history of a source-bound observation, never another current
    // readiness authority. Canonical ignition owns current runtime truth.
    const record = { schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
      kind: SHARED_WORKSPACE_RECORD_KINDS.EVENT, eventId: 'frontend-startup-' + randomUUID(),
      participantId: 'sovereign-commander', timestampUtc: new Date().toISOString(),
      summary: 'Build-bound startup observation; use canonical ignition for current readiness.',
      reportSchema: SCHEMA, bootWitness, currentReadinessAuthority: false,
      observation: { sourceHead: result.expectedHead || '', observedAtUtc: result.observedAtUtc || null,
        outcomeWhenObserved: result.ok ? 'SERVED_PROOF_PASSED' : 'UNPROVEN',
        actionAttempted: result.actionAttempted === true, commandVerdict: result.commandVerdict || 'NOT_REPORTED',
        proofHash: result.proofHash || '', blockerWhenObserved: result.blocker || '' },
    };
    return writer(workspaceRoot, ['events', 'stephanos-frontend-autostart.ndjson'], record);
  };
  return result.ok
    ? createFrontendSourceBoundary(result.expectedHead, sourceReader).observe(appendObservation)
    : appendObservation();
}

export function claimFrontendBootAttempt({ workspaceRoot, witness, expectedHead }) {
  if (!SHA.test(expectedHead) || !/^[a-f0-9]{64}$/.test(witness?.machineHash || '')
      || !Number.isFinite(Date.parse(witness?.bootStartedAtUtc))) throw new Error('FRONTEND_BOOT_IDENTITY_UNPROVEN');
  const statusDir = resolve(workspaceRoot, 'status');
  for (const path of [workspaceRoot, statusDir]) {
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('FRONTEND_BOOT_DIRECTORY_UNSAFE');
  }
  // Conservative duplicate-attempt diagnostic, never admission authority.
  // Keep it after any uncertain dispatch; a later full boot gets a new name.
  const boot = createHash('sha256').update(witness.machineHash + '\0' + witness.bootStartedAtUtc).digest('hex');
  let fd;
  try { fd = openSync(resolve(statusDir, 'frontend-boot-attempt-' + boot + '.json'), 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') return false; throw error; }
  try { writeFileSync(fd, JSON.stringify({ schemaVersion: SCHEMA, expectedHead, witness, outcome: 'DISPATCH_NOT_YET_PROVEN' }) + '\n'); }
  finally { closeSync(fd); }
  return true;
}

export async function runFrontendAutostart({
  approved = false, admissionReader = readMaintenanceRecoverySourceV1,
  sourceReader = getUi4173RepairCurrentGitHead,
  bootReader = readMaintenanceBootWitnessV1, tokenReader = loadSovereignCommanderToken,
  workspaceRoot = resolveGoalDiscoveryWorkspaceV1(), claim = claimFrontendBootAttempt,
  fetchFn = fetch, sleep = wait, attempts = 12, gamingSafe = sovereignControlPlaneGamingSafeV1,
  proof = expectedHead => collectUi4173ServedExactHeadProof({ expectedHead,
    fetchFn: url => fetchFn(url, { signal: AbortSignal.timeout(5000), cache: 'no-store' }) }),
} = {}) {
  if (approved !== true) return blocked('FRONTEND_AUTOSTART_INSTALL_APPROVAL_REQUIRED');
  let expectedHead;
  try { expectedHead = admissionReader(); } catch { return blocked('FRONTEND_AUTOSTART_CANONICAL_SOURCE_UNPROVEN'); }
  if (!SHA.test(expectedHead || '')) return blocked('FRONTEND_AUTOSTART_CANONICAL_SOURCE_UNPROVEN');
  const boundary = createFrontendSourceBoundary(expectedHead, sourceReader);
  // Full canonical admission (including fixed fetch/source hygiene) is distinct
  // from cheap local HEAD continuity. Do not fetch on every transport await.
  const admission = boundary.withReader(admissionReader);
  const readyResult = extra => ({ schemaVersion: SCHEMA, ok: true, expectedHead,
    observedAtUtc: new Date().toISOString(), ...extra });
  let actionAttempted = false;
  try {
  const ready = async () => {
    try {
      const served = await boundary.observe(() => proof(expectedHead));
      if (served?.ready !== true) return false;
      admission.assertCurrent();
      return true;
    }
    catch (error) {
      if (error?.code === 'FRONTEND_AUTOSTART_SOURCE_CHANGED') throw error;
      return false;
    }
  };
  if (await ready()) return readyResult({ reusedExisting: true, actionAttempted: false });
  // Commander has its existing boot task. This adapter cannot bootstrap or
  // recycle it, clear custody, change controllers, or start another executor.
  let guardianReady = false;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await boundary.observe(() => fetchFn(BASE + '/health', { signal: AbortSignal.timeout(5000) }));
      const health = await boundary.observe(() => response.json());
      const guardian = health.continuousRepairGuardian;
      guardianReady = response.ok && health.service === 'stephanos-sovereign-commander'
        && health.ok === true && guardian?.timeoutCustodyHeld === false
        && guardian.persistentCustody?.held === false && guardian.running === false
        && guardian.maintenanceInFlight === false;
    } catch (error) { if (error?.code === 'FRONTEND_AUTOSTART_SOURCE_CHANGED') throw error; guardianReady = false; }
    if (guardianReady && gamingSafe()) break;
    guardianReady = false;
    if (i + 1 < attempts) await boundary.observe(() => sleep(5000));
  }
  if (!guardianReady) return blocked('FRONTEND_AUTOSTART_GUARDIAN_NOT_ADMITTED', { expectedHead, actionAttempted: false });
  let token, sessionId;
  const post = async (message, timeoutMs = 10000) => {
    const response = await boundary.observe(() => fetchFn(BASE + '/mcp', {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
      body: JSON.stringify(message),
    }));
    const raw = await boundary.observe(() => response.text());
    return { ok: response.ok, sessionId: response.headers.get('mcp-session-id'), body: raw ? JSON.parse(raw) : null };
  };
    token = await boundary.observe(tokenReader);
    if (typeof token !== 'string' || token.length < 32) throw new Error('TOKEN_UNAVAILABLE');
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-11-25', clientInfo: { name: 'stephanos-frontend-autostart', version: '1.0.0' }, capabilities: {},
    } });
    if (!init.ok || !init.sessionId) throw new Error('MCP_INITIALIZE_UNPROVEN');
    sessionId = init.sessionId;
    const initialized = await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    const listed = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const maintenance = listed.body?.result?.tools?.find(tool => tool.name === 'maintenance_action');
    if (!initialized.ok || !listed.ok || !maintenance?.inputSchema?.properties?.actionId?.enum?.includes('repair-ui-4173'))
      throw new Error('FIXED_FRONTEND_ACTION_UNAVAILABLE');
    boundary.assertCurrent();
    if (await ready()) return readyResult({ reusedExisting: true, actionAttempted: false });
    const witness = await boundary.observe(bootReader);
    admission.assertCurrent();
    if (!gamingSafe()) return blocked('FRONTEND_AUTOSTART_GAMING_PROTECTION_HELD', { expectedHead, actionAttempted: false });
    boundary.assertCurrent();
    if (!claim({ workspaceRoot, witness, expectedHead }))
      return blocked('FRONTEND_BOOT_ATTEMPT_ALREADY_RESERVED', { expectedHead, actionAttempted: false });
    actionAttempted = true;
    let response, command;
    try {
      response = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'maintenance_action', arguments: { actionId: 'repair-ui-4173' } } }, 240000);
      command = response.body?.result?.structuredContent;
    } catch (error) {
      if (error?.code === 'FRONTEND_AUTOSTART_SOURCE_CHANGED') throw error;
      // Genuine transport uncertainty never authorizes another dispatch.
    }
    // Cold build can finish after the registered repair's readiness timeout.
    // Observe the same attempt; never spawn another build to repair a timeout.
    for (let i = 0; i < 12; i++) {
      if (await ready()) return readyResult({ actionAttempted,
        commandOk: response?.ok === true && response.body?.result?.isError !== true && command?.ok === true,
        commandVerdict: command?.finalVerdict || 'UNKNOWN', proofHash: command?.proofHash || '', servedExactHeadProven: true });
      if (i + 1 < 12) await boundary.observe(() => sleep(5000));
    }
    return blocked('FRONTEND_AUTOSTART_SERVED_HEAD_UNPROVEN', { expectedHead, actionAttempted, commandVerdict: command?.finalVerdict || 'UNKNOWN' });
  } catch (error) { return blocked(error?.code === 'FRONTEND_AUTOSTART_SOURCE_CHANGED'
    ? error.code : 'FRONTEND_AUTOSTART_TRANSPORT_UNPROVEN', { expectedHead, actionAttempted }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let result;
  if (process.platform !== 'win32' || process.execPath.toLowerCase() !== 'c:\\program files\\nodejs\\node.exe'
      || process.argv.slice(2).join(' ') !== '--operator-approved') result = blocked('FRONTEND_AUTOSTART_FIXED_WINDOWS_ENTRY_REQUIRED');
  else {
    result = await runFrontendAutostart({ approved: true });
    result = await finalizeFrontendStartupResult(result);
  }
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 2;
}
