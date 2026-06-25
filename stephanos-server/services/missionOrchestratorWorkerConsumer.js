import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { buildMissionEventFromWorkerResult } from '../../shared/agents/missionOrchestratorWorkerResult.mjs';
import { appendMissionEvent } from './missionOrchestratorStore.js';
import { collectAgentWorkerResult, resolveMissionWorkerQueueRoot } from './missionOrchestratorWorkerService.js';

function queuePaths(root, adapter) {
  const adapterRoot = resolve(root, adapter);
  return { pending: resolve(adapterRoot, 'pending'), processing: resolve(adapterRoot, 'processing'), completed: resolve(adapterRoot, 'completed'), failed: resolve(adapterRoot, 'failed') };
}

async function ensurePaths(paths) {
  await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })));
}

export async function claimNextMissionWorkerItem(adapter, options = {}) {
  const root = options.queueRoot || resolveMissionWorkerQueueRoot(options.env || process.env);
  if (!root) throw new Error('Mission worker queue directory is not configured.');
  const paths = queuePaths(root, adapter);
  await ensurePaths(paths);
  const entries = (await readdir(paths.pending, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const pendingPath = resolve(paths.pending, entry.name);
    const processingPath = resolve(paths.processing, entry.name);
    try {
      await rename(pendingPath, processingPath);
      return { adapter, item: JSON.parse(await readFile(processingPath, 'utf8')), processingPath, paths };
    } catch (error) {
      if (['ENOENT', 'EEXIST'].includes(error?.code)) continue;
      throw error;
    }
  }
  return null;
}

async function finishClaim(claim, result, success) {
  const targetRoot = success ? claim.paths.completed : claim.paths.failed;
  const fileName = basename(claim.processingPath);
  const resultPath = resolve(targetRoot, fileName.replace(/\.json$/, '.result.json'));
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(claim.processingPath, resolve(targetRoot, fileName));
  return resultPath;
}

function signedAction(item) {
  const payload = item?.payload;
  return { actionKind: 'signed-openclaw-operation', actionId: payload?.actionId || item?.actionId || '', missionId: payload?.missionId || item?.missionId || '', operation: payload?.operation || '', receiptRequirement: payload?.receiptRequirement || `signed ${payload?.operation || 'operation'}` };
}

async function applyClaimResult(claim, action, execution, inspection) {
  const event = buildMissionEventFromWorkerResult(action, execution, inspection);
  const applied = await appendMissionEvent(action.missionId, event, claim.options);
  const result = {
    schemaVersion: 'stephanos.mission-worker-consumption-result.v1', actionId: action.actionId, missionId: action.missionId,
    operation: action.operation, eventId: event.eventId, stateRevision: applied.state.revision, currentPhase: applied.state.currentPhase,
    duplicate: applied.duplicate, execution: { success: execution.success === true, commandOutputHash: execution.commandOutputHash || '', completedAt: execution.completedAt || '' },
    inspection, finalVerdict: execution.success === true ? 'MISSION_WORKER_ITEM_COMPLETE' : 'MISSION_WORKER_ITEM_BLOCKED',
  };
  const resultPath = await finishClaim(claim, result, execution.success === true);
  return { processed: true, claim, event, applied, result, resultPath };
}

async function failClaim(claim, action, error) {
  const result = { schemaVersion: 'stephanos.mission-worker-consumption-result.v1', actionId: action.actionId, missionId: action.missionId, operation: action.operation, error: error?.message || 'unknown worker error', finalVerdict: 'MISSION_WORKER_ITEM_FAILED' };
  const resultPath = await finishClaim(claim, result, false);
  return { processed: true, claim, error, result, resultPath };
}

async function processAgentClaim(adapter, options, execute) {
  const claim = await claimNextMissionWorkerItem(adapter, options);
  if (!claim) return { processed: false, reason: 'queue-empty' };
  claim.options = options;
  const action = claim.item.payload;
  try {
    const execution = await execute(action, claim);
    const applied = await collectAgentWorkerResult({
      missionId: action.missionId,
      actionId: action.actionId,
      adapter,
      success: execution.success === true,
      resultId: execution.resultId || action.actionId,
      changedFiles: execution.changedFiles || [],
      receipt: execution.receipt,
      evidenceReceipts: execution.evidenceReceipts || [],
      error: execution.error || '',
    }, options);
    const result = {
      schemaVersion: 'stephanos.mission-worker-consumption-result.v1',
      actionId: action.actionId,
      missionId: action.missionId,
      adapter,
      stateRevision: applied.state.revision,
      currentPhase: applied.state.currentPhase,
      execution: {
        success: execution.success === true,
        commandOutputHash: execution.receipt?.commandOutputHash || '',
        completedAt: execution.completedAt || '',
      },
      changedFiles: execution.changedFiles || [],
      evidenceReceiptCount: Array.isArray(execution.evidenceReceipts) ? execution.evidenceReceipts.length : 0,
      finalVerdict: execution.success === true ? 'MISSION_WORKER_ITEM_COMPLETE' : 'MISSION_WORKER_ITEM_BLOCKED',
    };
    const resultPath = await finishClaim(claim, result, execution.success === true);
    return { processed: true, claim, applied, result, resultPath };
  } catch (error) {
    try {
      await collectAgentWorkerResult({ missionId: action.missionId, actionId: action.actionId, adapter, success: false, error: error?.message || `${adapter} execution failed.` }, options);
    } catch {
      // Preserve the original adapter failure in the queue result.
    }
    return failClaim(claim, action, error);
  }
}

export async function processNextSignedOpenClawItem(options = {}) {
  if (typeof options.executeSignedOperation !== 'function') throw new Error('Signed OpenClaw executor adapter is required.');
  if (typeof options.inspectSignedOperation !== 'function') throw new Error('Signed OpenClaw result inspector is required.');
  const claim = await claimNextMissionWorkerItem('openclaw-signed', options);
  if (!claim) return { processed: false, reason: 'queue-empty' };
  claim.options = options;
  const action = signedAction(claim.item);
  try {
    const execution = await options.executeSignedOperation(claim.item.payload, claim);
    const inspection = execution.success === true ? await options.inspectSignedOperation(claim.item.payload, execution, claim) : {};
    return await applyClaimResult(claim, action, execution, inspection);
  } catch (error) {
    return failClaim(claim, action, error);
  }
}

export async function processNextGitHubInspectionItem(options = {}) {
  if (typeof options.inspectGitHub !== 'function') throw new Error('Read-only GitHub inspector is required.');
  const claim = await claimNextMissionWorkerItem('openclaw-github-readonly', options);
  if (!claim) return { processed: false, reason: 'queue-empty' };
  claim.options = options;
  const action = claim.item.payload;
  try {
    const inspected = await options.inspectGitHub(action, claim);
    return await applyClaimResult(claim, action, inspected.execution, inspected.inspection);
  } catch (error) {
    return failClaim(claim, action, error);
  }
}

export async function processNextCodexItem(options = {}) {
  if (typeof options.executeCodexAction !== 'function') throw new Error('Codex execution adapter is required.');
  return processAgentClaim('codex', options, options.executeCodexAction);
}

export async function processNextOpenClawReadonlyItem(options = {}) {
  if (typeof options.executeOpenClawReadonlyAction !== 'function') throw new Error('OpenClaw read-only execution adapter is required.');
  return processAgentClaim('openclaw-readonly', options, options.executeOpenClawReadonlyAction);
}
