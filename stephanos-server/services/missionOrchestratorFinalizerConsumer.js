import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { judgeMissionEvidence } from '../../shared/agents/missionOrchestratorEvidenceJudge.mjs';
import { appendMissionEvent } from './missionOrchestratorStore.js';
import { resolveMissionWorkerQueueRoot } from './missionOrchestratorWorkerService.js';

function paths(root, adapter) {
  const adapterRoot = resolve(root, adapter);
  return {
    pending: resolve(adapterRoot, 'pending'),
    processing: resolve(adapterRoot, 'processing'),
    completed: resolve(adapterRoot, 'completed'),
    failed: resolve(adapterRoot, 'failed'),
  };
}

async function claim(adapter, options = {}) {
  const root = options.queueRoot || resolveMissionWorkerQueueRoot(options.env || process.env);
  if (!root) throw new Error('Mission worker queue directory is not configured.');
  const queuePaths = paths(root, adapter);
  await Promise.all(Object.values(queuePaths).map((path) => mkdir(path, { recursive: true })));
  const entries = (await readdir(queuePaths.pending, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const source = resolve(queuePaths.pending, entry.name);
    const processingPath = resolve(queuePaths.processing, entry.name);
    try {
      await rename(source, processingPath);
      return {
        item: JSON.parse(await readFile(processingPath, 'utf8')),
        processingPath,
        paths: queuePaths,
      };
    } catch (error) {
      if (['ENOENT', 'EEXIST'].includes(error?.code)) continue;
      throw error;
    }
  }
  return null;
}

async function finish(queueClaim, result, success) {
  const target = success ? queueClaim.paths.completed : queueClaim.paths.failed;
  const fileName = basename(queueClaim.processingPath);
  const resultPath = resolve(target, fileName.replace(/\.json$/, '.result.json'));
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(queueClaim.processingPath, resolve(target, fileName));
  return resultPath;
}

function eventId(prefix, actionId) {
  return `${prefix}-${actionId}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 128);
}

export async function processNextVerificationItem(options = {}) {
  const queueClaim = await claim('verification', options);
  if (!queueClaim) return { processed: false, reason: 'queue-empty' };
  const action = queueClaim.item.payload;
  const judgment = judgeMissionEvidence(action);
  try {
    const event = judgment.success
      ? {
        eventId: eventId('verification-pass', action.actionId),
        eventType: 'EVIDENCE_RECORDED',
        receipts: judgment.acceptedReceipts,
        summary: 'Deterministic evidence judgment completed.',
      }
      : {
        eventId: eventId('verification-blocked', action.actionId),
        eventType: 'MISSION_BLOCKED',
        reason: judgment.error,
        summary: 'Mission evidence was incomplete or ungrounded.',
      };
    const applied = await appendMissionEvent(action.missionId, event, options);
    const result = {
      schemaVersion: 'stephanos.mission-finalizer-result.v1',
      missionId: action.missionId,
      actionId: action.actionId,
      adapter: 'verification',
      success: judgment.success,
      missingRequirements: judgment.missingRequirements,
      currentPhase: applied.state.currentPhase,
      stateRevision: applied.state.revision,
      finalVerdict: judgment.finalVerdict,
    };
    const resultPath = await finish(queueClaim, result, judgment.success);
    return { processed: true, judgment, applied, result, resultPath };
  } catch (error) {
    const result = {
      schemaVersion: 'stephanos.mission-finalizer-result.v1',
      missionId: action?.missionId || queueClaim.item.missionId,
      actionId: action?.actionId || queueClaim.item.actionId,
      adapter: 'verification',
      success: false,
      error: error.message,
      finalVerdict: 'MISSION_EVIDENCE_JUDGMENT_FAILED',
    };
    return { processed: true, error, result, resultPath: await finish(queueClaim, result, false) };
  }
}

function deploymentReceipt(step, entry, timestamp) {
  const hash = String(entry.commandOutputHash || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash) || entry.success !== true) {
    throw new Error(`Local deployment ${step} did not return deterministic success proof.`);
  }
  return {
    receiptId: `local-deployment-${step}-${hash.slice(0, 16)}`,
    requirement: `local ${step}`,
    source: 'openclaw-local-deployment',
    evidenceType: 'command-output',
    verified: true,
    commandOutputHash: hash,
    receiptPath: entry.receiptPath || '',
    createdAt: entry.completedAt || timestamp,
  };
}

export async function processNextLocalDeploymentItem(options = {}) {
  if (typeof options.executeLocalDeployment !== 'function') {
    throw new Error('Local deployment executor is required.');
  }
  const queueClaim = await claim('openclaw-local-deployment', options);
  if (!queueClaim) return { processed: false, reason: 'queue-empty' };
  const action = queueClaim.item.payload;
  try {
    const execution = await options.executeLocalDeployment(action, queueClaim);
    const timestamp = execution.completedAt || new Date().toISOString();
    let applied;
    for (const step of action.steps || []) {
      const entry = execution.steps?.[step];
      const success = entry?.success === true;
      const receipt = success
        ? deploymentReceipt(step, entry, timestamp)
        : {
          receiptId: `local-deployment-${step}-failed`,
          requirement: `local ${step}`,
          source: 'openclaw-local-deployment',
          evidenceType: 'command-output',
          verified: true,
          commandOutputHash: createHash('sha256').update(String(entry?.error || execution.error || 'deployment failed')).digest('hex'),
          createdAt: timestamp,
        };
      applied = await appendMissionEvent(action.missionId, {
        eventId: eventId(`deployment-${step}`, action.actionId),
        eventType: 'LOCAL_DEPLOYMENT_STEP_RECORDED',
        step,
        success,
        commitSha: action.mergeCommitSha,
        receipt,
        summary: success ? `Local deployment ${step} completed.` : `Local deployment ${step} failed.`,
      }, options);
      if (!success) break;
    }
    const success = execution.success === true && applied?.state?.currentPhase === 'COMPLETE';
    const result = {
      schemaVersion: 'stephanos.mission-finalizer-result.v1',
      missionId: action.missionId,
      actionId: action.actionId,
      adapter: 'openclaw-local-deployment',
      success,
      currentPhase: applied?.state?.currentPhase || 'BLOCKED',
      stateRevision: applied?.state?.revision || 0,
      finalVerdict: success ? 'MISSION_LOCAL_DEPLOYMENT_COMPLETE' : 'MISSION_LOCAL_DEPLOYMENT_BLOCKED',
    };
    const resultPath = await finish(queueClaim, result, success);
    return { processed: true, execution, applied, result, resultPath };
  } catch (error) {
    const result = {
      schemaVersion: 'stephanos.mission-finalizer-result.v1',
      missionId: action?.missionId || queueClaim.item.missionId,
      actionId: action?.actionId || queueClaim.item.actionId,
      adapter: 'openclaw-local-deployment',
      success: false,
      error: error.message,
      finalVerdict: 'MISSION_LOCAL_DEPLOYMENT_FAILED',
    };
    return { processed: true, error, result, resultPath: await finish(queueClaim, result, false) };
  }
}
