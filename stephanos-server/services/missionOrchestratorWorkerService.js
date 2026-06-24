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

export async function publishMissionWorkerAction(state, options = {}) {
  if (state.dispatch?.status === 'running' && ['AGENT_IMPLEMENTATION', 'LIVE_RUNTIME_INVESTIGATION'].includes(state.currentPhase)) return { published: false, reason: 'agent-already-running', action: null, path: '' };
  const action = buildMissionWorkerAction(state, options);
  if (action.executable !== true) return { published: false, reason: action.reason || action.finalVerdict, action, path: '' };
  const adapter = adapterForAction(action);
  if (!adapter) return { published: false, reason: 'unsupported-worker-adapter', action, path: '' };
  const root = options.queueRoot || resolveMissionWorkerQueueRoot(options.env || process.env);
  if (!root) throw new Error('Mission worker queue directory is not configured.');
  const paths = queuePaths(root, adapter);
  await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })));
  let payload = action;
  if (action.actionKind === 'signed-openclaw-operation') {
    if (!options.privateKeyPem && !options.privateKeyPath) throw new Error('Mission worker authorization private key is not configured.');
    const privateKeyPem = options.privateKeyPem || await readFile(options.privateKeyPath, 'utf8');
    payload = issueMissionWorkerAuthorization(action, privateKeyPem, options);
    if (payload.finalVerdict !== 'MISSION_WORKER_REQUEST_ISSUED') return { published: false, reason: payload.finalVerdict, action, payload, path: '' };
  }
  const path = resolve(paths.pending, `${action.actionId}.json`);
  const published = await createImmutableJson(path, { schemaVersion: 'stephanos.mission-worker-queue-item.v1', adapter, actionId: action.actionId, missionId: state.missionId, createdAt: options.now instanceof Date ? options.now.toISOString() : new Date().toISOString(), payload });
  if (!published) return { published: false, reason: 'action-already-published', action, path };
  if (action.actionKind === 'agent-handoff') {
    await appendMissionEvent(state.missionId, { eventId: `dispatch-${action.actionId}`.slice(0, 128), eventType: 'AGENT_DISPATCHED', agentId: action.adapter === 'codex' ? 'codex' : 'openclaw-standalone', summary: `${action.adapter} handoff published to the durable worker queue.` }, options);
  }
  return { published: true, reason: '', action, payload, path, adapter };
}

export async function publishNextMissionWorkerAction(options = {}) {
  const missions = await listMissionRecords(options);
  const runnable = missions.filter((state) => !['COMPLETE', 'CANCELLED', 'BLOCKED', 'AWAITING_OPERATOR_APPROVAL'].includes(state.currentPhase));
  for (const state of runnable) {
    const result = await publishMissionWorkerAction(state, options);
    if (result.published) return result;
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
  return appendMissionEvent(missionId, { eventId: `result-${actionId}`.slice(0, 128), eventType: 'AGENT_RESULT_RECEIVED', success: result.success === true, resultId: text(result.resultId, actionId), changedFiles: Array.isArray(result.changedFiles) ? result.changedFiles : [], receipt: result.receipt, error: text(result.error), summary: `${adapter} result collected from the durable worker queue.` }, options);
}
