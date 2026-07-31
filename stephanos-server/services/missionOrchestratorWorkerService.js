import { readFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildMissionWorkerAction, issueMissionWorkerAuthorization } from '../../shared/agents/missionOrchestratorWorker.mjs';
import { appendMissionEvent, listMissionRecords, readMissionRecord, resolveMissionOrchestratorRoot } from './missionOrchestratorStore.js';

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

export function resolveMissionWorkerQueueRoot(env = process.env) {
  const configured = text(env.STEPHANOS_MISSION_WORKER_QUEUE_DIR);
  if (configured) return resolve(configured);
  const orchestratorRoot = resolveMissionOrchestratorRoot(env);
  return orchestratorRoot ? resolve(orchestratorRoot, 'worker-queue') : '';
}

function queuePaths(root, adapter) {
  const adapterRoot = resolve(root, adapter);
  return { pending: resolve(adapterRoot, 'pending'), processing: resolve(adapterRoot, 'processing'), completed: resolve(adapterRoot, 'completed'), failed: resolve(adapterRoot, 'failed') };
}

async function createImmutableJson(path, value) {
  try {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
}

function adapterForAction(action) {
  if (action.actionKind === 'signed-openclaw-operation') return 'openclaw-signed';
  if (action.actionKind === 'github-inspection') return 'openclaw-github-readonly';
  if (action.actionKind === 'agent-handoff' && action.adapter === 'codex') return 'codex';
  if (action.actionKind === 'agent-handoff' && action.adapter === 'openclaw-readonly') return 'openclaw-readonly';
  if (action.actionKind === 'local-deployment') return 'openclaw-local-deployment';
  if (action.actionKind === 'evidence-judgment') return 'verification';
  return '';
}

function validateExactActionGrant(state, action, grant, options = {}) {
  const errors = [];
  const sourceRevision = text(grant?.sourceRevision).toLowerCase();
  const expectedSourceRevision = text(
    options.sourceRevision
      || options.env?.STEPHANOS_MISSION_WORKER_HEAD_SHA,
  ).toLowerCase();
  if (grant?.schemaVersion !== 'stephanos.mission-worker-action-grant.v1') {
    errors.push('invalid-action-grant-schema');
  }
  if (text(grant?.controllerId) !== 'durable-flywheel-controller') {
    errors.push('invalid-action-grant-controller');
  }
  if (!/^[0-9a-f]{40}$/.test(sourceRevision)) {
    errors.push('invalid-action-grant-source-revision');
  }
  if (expectedSourceRevision && sourceRevision !== expectedSourceRevision) {
    errors.push('action-grant-source-revision-mismatch');
  }
  if (grant?.boundedActionCount !== 1) errors.push('action-grant-not-single-use');
  if (text(grant?.missionId).toLowerCase() !== text(state?.missionId).toLowerCase()) {
    errors.push('action-grant-mission-mismatch');
  }
  if (Number(grant?.missionRevision) !== Number(state?.revision)) {
    errors.push('action-grant-revision-mismatch');
  }
  if (text(grant?.currentPhase).toUpperCase() !== text(state?.currentPhase).toUpperCase()) {
    errors.push('action-grant-phase-mismatch');
  }
  if (text(grant?.actionId).toLowerCase() !== text(action?.actionId).toLowerCase()) {
    errors.push('action-grant-action-mismatch');
  }
  if (text(grant?.actionKind) !== text(action?.actionKind)) {
    errors.push('action-grant-kind-mismatch');
  }
  if (text(grant?.adapter) !== adapterForAction(action)) {
    errors.push('action-grant-adapter-mismatch');
  }
  if (text(grant?.operation) !== text(action?.operation)) {
    errors.push('action-grant-operation-mismatch');
  }
  if (grant?.mergeAuthority !== false || grant?.leaseSeizureAllowed !== false) {
    errors.push('action-grant-authority-expanded');
  }
  return { valid: errors.length === 0, errors };
}

async function beginRepairIfRequired(state, options) {
  if (state.currentPhase !== 'REPAIR_REQUIRED') return { state, repairStarted: false };
  const round = Number.isInteger(state.repair?.currentRound) ? state.repair.currentRound + 1 : 1;
  const started = await appendMissionEvent(state.missionId, {
    eventId: `repair-${state.missionId}-round-${round}`.slice(0, 128),
    eventType: 'REPAIR_STARTED',
    summary: `Bounded Codex repair round ${round} started after required check failure.`,
  }, options);
  return { state: started.state, repairStarted: true };
}

export async function publishMissionWorkerAction(inputState, options = {}) {
  if (inputState.dispatch?.status === 'running' && ['AGENT_IMPLEMENTATION', 'REPAIR_REQUIRED', 'LIVE_RUNTIME_INVESTIGATION'].includes(inputState.currentPhase)) return { published: false, reason: 'agent-already-running', action: null, path: '' };
  const prepared = await beginRepairIfRequired(inputState, options);
  const state = prepared.state;
  const action = buildMissionWorkerAction(state, options);
  if (action.executable !== true) return { published: false, reason: action.reason || action.finalVerdict, action, path: '', repairStarted: prepared.repairStarted };
  const adapter = adapterForAction(action);
  if (!adapter) return { published: false, reason: 'unsupported-worker-adapter', action, path: '', repairStarted: prepared.repairStarted };
  const root = options.queueRoot || resolveMissionWorkerQueueRoot(options.env || process.env);
  if (!root) throw new Error('Mission worker queue directory is not configured.');
  const paths = queuePaths(root, adapter);
  await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })));
  let payload = action;
  if (action.actionKind === 'signed-openclaw-operation') {
    if (!options.privateKeyPem && !options.privateKeyPath) throw new Error('Mission worker authorization private key is not configured.');
    const privateKeyPem = options.privateKeyPem || await readFile(options.privateKeyPath, 'utf8');
    payload = issueMissionWorkerAuthorization(action, privateKeyPem, options);
    if (payload.finalVerdict !== 'MISSION_WORKER_REQUEST_ISSUED') return { published: false, reason: payload.finalVerdict, action, payload, path: '', repairStarted: prepared.repairStarted };
  }
  const path = resolve(paths.pending, `${action.actionId}.json`);
  const published = await createImmutableJson(path, { schemaVersion: 'stephanos.mission-worker-queue-item.v1', adapter, actionId: action.actionId, missionId: state.missionId, createdAt: options.now instanceof Date ? options.now.toISOString() : new Date().toISOString(), payload });
  if (!published) return { published: false, reason: 'action-already-published', action, path, repairStarted: prepared.repairStarted };
  if (action.actionKind === 'agent-handoff') {
    await appendMissionEvent(state.missionId, { eventId: `dispatch-${action.actionId}`.slice(0, 128), eventType: 'AGENT_DISPATCHED', agentId: action.adapter === 'codex' ? 'codex' : 'openclaw-standalone', summary: `${action.adapter} handoff published to the durable worker queue.` }, options);
  }
  return { published: true, reason: '', action, payload, path, adapter, repairStarted: prepared.repairStarted };
}

export async function publishNextMissionWorkerAction(options = {}) {
  const missions = await listMissionRecords(options);
  const runnable = missions.filter((state) => !['COMPLETE', 'CANCELLED', 'BLOCKED', 'AWAITING_OPERATOR_APPROVAL'].includes(state.currentPhase));
  const grant = options.actionGrant;
  const grantedMissionId = text(grant?.missionId).toLowerCase();
  const candidates = grant
    ? runnable.filter((state) => text(state?.missionId).toLowerCase() === grantedMissionId)
    : runnable;
  if (grant && candidates.length !== 1) {
    return {
      published: false,
      reason: candidates.length ? 'action-grant-mission-ambiguous' : 'action-grant-mission-not-runnable',
      action: null,
      path: '',
    };
  }
  for (const state of candidates) {
    if (grant) {
      const preview = buildMissionWorkerAction(state, options);
      const validation = validateExactActionGrant(state, preview, grant, options);
      if (!validation.valid) {
        return {
          published: false,
          reason: 'action-grant-mismatch',
          blockers: validation.errors,
          action: preview,
          path: '',
        };
      }
    }
    const result = await publishMissionWorkerAction(state, options);
    if (result.published || grant) return { ...result, actionGrantAccepted: Boolean(grant) };
  }
  return { published: false, reason: 'no-runnable-mission', action: null, path: '' };
}

export async function readMissionWorkerQueue(options = {}) {
  const root = options.queueRoot || resolveMissionWorkerQueueRoot(options.env || process.env);
  if (!root) return [];
  const adapters = ['openclaw-signed', 'openclaw-github-readonly', 'codex', 'openclaw-readonly', 'openclaw-local-deployment', 'verification'];
  const result = [];
  for (const adapter of adapters) {
    const paths = queuePaths(root, adapter);
    let entries = [];
    try { entries = await readdir(paths.pending, { withFileTypes: true }); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith('.json'))) {
      const path = join(paths.pending, entry.name);
      try { result.push({ adapter, path, item: JSON.parse(await readFile(path, 'utf8')) }); }
      catch { result.push({ adapter, path, item: null, error: 'queue-item-read-failed' }); }
    }
  }
  return result.sort((left, right) => String(left.item?.createdAt || '').localeCompare(String(right.item?.createdAt || '')));
}

export async function collectAgentWorkerResult(result, options = {}) {
  const missionId = text(result?.missionId).toLowerCase();
  const actionId = text(result?.actionId).toLowerCase();
  const adapter = text(result?.adapter).toLowerCase();
  if (!missionId || !actionId || !['codex', 'openclaw-readonly'].includes(adapter)) throw new Error('Agent result identity is incomplete or unsupported.');
  const current = await readMissionRecord(missionId, options);
  if (current.state.dispatch?.status !== 'running') throw new Error('Mission has no active agent dispatch.');
  if (adapter !== current.state.dispatch.adapter) throw new Error('Agent result adapter does not match the active dispatch.');
  let collected = await appendMissionEvent(missionId, { eventId: `result-${actionId}`.slice(0, 128), eventType: 'AGENT_RESULT_RECEIVED', success: result.success === true, resultId: text(result.resultId, actionId), changedFiles: Array.isArray(result.changedFiles) ? result.changedFiles : [], receipt: result.receipt, error: text(result.error), summary: `${adapter} result collected from the durable worker queue.` }, options);
  const evidenceReceipts = Array.isArray(result.evidenceReceipts) ? result.evidenceReceipts : [];
  if (result.success === true && evidenceReceipts.length) {
    collected = await appendMissionEvent(missionId, {
      eventId: `evidence-${actionId}`.slice(0, 128),
      eventType: 'EVIDENCE_RECORDED',
      receipts: evidenceReceipts,
      summary: `${adapter} grounded evidence collected from the durable worker queue.`,
    }, options);
  }
  return collected;
}
