import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  appendExecutionReceipt,
  createExecutionReceipt,
  readExecutionReceiptHistory,
} from '../../shared/agents/executionReceiptV1.mjs';
import { buildMissionEventFromWorkerResult } from '../../shared/agents/missionOrchestratorWorkerResult.mjs';
import { gateSourceWorkerCompletionV1 } from '../../shared/agents/sourceArtifactEscrowCompletionGateV1.mjs';
import { appendMissionEvent } from './missionOrchestratorStore.js';
import { collectAgentWorkerResult, resolveMissionWorkerQueueRoot } from './missionOrchestratorWorkerService.js';
import { finalizeSourceArtifactEscrowFromWorktreeV1 } from './sourceArtifactEscrowStore.js';

function queuePaths(root, adapter) {
  const adapterRoot = resolve(root, adapter);
  return { pending: resolve(adapterRoot, 'pending'), processing: resolve(adapterRoot, 'processing'), completed: resolve(adapterRoot, 'completed'), failed: resolve(adapterRoot, 'failed') };
}

async function ensurePaths(paths) {
  await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })));
}

function executionReceiptRoot(options = {}) {
  return options.sharedWorkspaceRoot
    || options.env?.STEPHANOS_SHARED_AGENT_WORKSPACE
    || process.env.STEPHANOS_SHARED_AGENT_WORKSPACE
    || '';
}

function executionReceiptOptions(options = {}) {
  return {
    repoRoot: options.repoRoot
      || options.env?.STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT
      || process.env.STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT,
  };
}

function nextReceiptTimestamp(previous, options = {}, explicitTimestamp = '') {
  const explicit = Date.parse(String(explicitTimestamp || ''));
  const requested = options.now instanceof Date ? options.now.getTime() : Date.now();
  const previousMs = Date.parse(previous?.timestampUtc || '');
  return new Date(Math.max(
    Number.isFinite(explicit) ? explicit : requested,
    Number.isFinite(previousMs) ? previousMs + 1 : requested,
  )).toISOString();
}

async function appendReceiptTransition(previous, state, options = {}, additions = {}) {
  if (!previous) return null;
  const root = executionReceiptRoot(options);
  if (!root) throw new Error('EXECUTION_RECEIPT_WORKSPACE_REQUIRED');
  const receipt = createExecutionReceipt({
    repository: previous.repository,
    issueNumber: previous.issueNumber,
    prNumber: previous.prNumber,
    branch: previous.branch,
    sourceHead: previous.sourceHead,
    workerId: previous.workerId,
    workerType: previous.workerType,
    executionId: previous.executionId,
    leaseKey: previous.leaseKey,
    state,
    phase: additions.phase || state,
    sequence: previous.sequence + 1,
    predecessorReceiptId: previous.receiptId,
    timestampUtc: nextReceiptTimestamp(previous, options, additions.timestampUtc),
    blocker: additions.blocker || '',
    operatorActionRequired: additions.operatorActionRequired === true,
    proofRefs: additions.proofRefs || previous.proofRefs,
    expectedNextAction: additions.expectedNextAction || '',
  });
  const appended = await appendExecutionReceipt(root, receipt, executionReceiptOptions(options));
  if (appended?.ok !== true) {
    const error = new Error(`EXECUTION_RECEIPT_APPEND_FAILED:${appended?.reason || 'unknown'}`);
    error.code = 'EXECUTION_RECEIPT_APPEND_FAILED';
    error.receipt = receipt;
    error.appendResult = appended;
    throw error;
  }
  return receipt;
}

async function beginNativeExecutionReceiptChain(claim, options = {}) {
  const root = executionReceiptRoot(options);
  if (!root) return null;
  const executionId = String(claim?.item?.actionId || '').trim().toLowerCase();
  if (!executionId) return null;
  const history = await readExecutionReceiptHistory(root, { executionId }, executionReceiptOptions(options));
  if (history?.ok !== true) {
    const error = new Error(`EXECUTION_RECEIPT_HISTORY_BLOCKED:${history?.reason || 'unknown'}`);
    error.code = 'EXECUTION_RECEIPT_HISTORY_BLOCKED';
    error.history = history;
    throw error;
  }
  let current = history.latestReceipt;
  if (!current) return null;
  if (current.state !== 'queued') {
    const error = new Error(`EXECUTION_RECEIPT_CLAIM_STATE_INVALID:${current.state}`);
    error.code = 'EXECUTION_RECEIPT_CLAIM_STATE_INVALID';
    error.receipt = current;
    throw error;
  }
  const actionGrant = options.actionGrant;
  if (actionGrant) {
    const mismatched = (
      String(actionGrant.repository || '').toLowerCase() !== current.repository.toLowerCase()
      || Number(actionGrant.issueNumber) !== current.issueNumber
      || Number(actionGrant.prNumber) !== current.prNumber
      || String(actionGrant.branch || '') !== current.branch
      || String(actionGrant.headSha || '').toLowerCase() !== current.sourceHead
    );
    if (mismatched) throw new Error('EXECUTION_RECEIPT_ACTION_GRANT_IDENTITY_MISMATCH');
  }
  current = await appendReceiptTransition(current, 'accepted', options, {
    phase: 'worker-claim-accepted',
    expectedNextAction: 'Worker must append started before executor authority is invoked.',
  });
  current = await appendReceiptTransition(current, 'started', options, {
    phase: 'worker-execution-started',
    expectedNextAction: 'Worker must publish fresh progress heartbeat or terminal truth.',
  });
  current = await appendReceiptTransition(current, 'progress', options, {
    phase: 'worker-execution-active',
    expectedNextAction: 'Worker must publish deterministic terminal truth after result validation.',
  });
  return current;
}

export async function claimNextMissionWorkerItem(adapter, options = {}) {
  const root = options.queueRoot || resolveMissionWorkerQueueRoot(options.env || process.env);
  if (!root) throw new Error('Mission worker queue directory is not configured.');
  const paths = queuePaths(root, adapter);
  await ensurePaths(paths);
  const entries = (await readdir(paths.pending, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).sort((left, right) => left.name.localeCompare(right.name));
  const actionGrant = options.actionGrant;
  if (actionGrant?.adapter && actionGrant.adapter !== adapter) return null;
  const candidateEntries = actionGrant?.actionId
    ? entries.filter((entry) => (
      entry.name.toLowerCase() === `${String(actionGrant.actionId).toLowerCase()}.json`
    ))
    : entries;
  for (const entry of candidateEntries) {
    const pendingPath = resolve(paths.pending, entry.name);
    const processingPath = resolve(paths.processing, entry.name);
    try {
      const item = JSON.parse(await readFile(pendingPath, 'utf8'));
      if (
        actionGrant
        && (
          String(item?.missionId || '').toLowerCase()
            !== String(actionGrant.missionId || '').toLowerCase()
          || String(item?.actionId || '').toLowerCase()
            !== String(actionGrant.actionId || '').toLowerCase()
        )
      ) {
        continue;
      }
      await rename(pendingPath, processingPath);
      return { adapter, item, processingPath, paths };
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

function requireSourceEscrowBeforeCompletion(execution = {}) {
  const changedFiles = Array.isArray(execution.changedFiles) ? execution.changedFiles.filter(Boolean) : [];
  if (execution.success !== true || changedFiles.length === 0) return;
  if (!execution.sourceArtifactIdentity || typeof execution.sourceArtifactIdentity !== 'object' || Array.isArray(execution.sourceArtifactIdentity)) {
    const error = new Error('SOURCE_ARTIFACT_ESCROW_IDENTITY_REQUIRED');
    error.code = 'SOURCE_ARTIFACT_ESCROW_IDENTITY_REQUIRED';
    throw error;
  }
  const gate = gateSourceWorkerCompletionV1({
    stage: execution.stage || '',
    sourceChanged: true,
    testsPassed: execution.testsPassed === true,
    terminalRequested: true,
    escrow: execution.sourceArtifactEscrow || {},
    expectedIdentity: execution.sourceArtifactIdentity,
    nowUtc: execution.completedAt || new Date().toISOString(),
  });
  if (!gate.terminalReceiptAllowed) {
    const error = new Error(gate.finalVerdict);
    error.code = gate.finalVerdict;
    error.completionGate = gate;
    throw error;
  }
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
  let executionReceipt = null;
  try {
    executionReceipt = await beginNativeExecutionReceiptChain(claim, options);
    let execution = await execute(action, claim);
    const changedFiles = Array.isArray(execution?.changedFiles) ? execution.changedFiles.filter(Boolean) : [];
    if (execution?.success === true && changedFiles.length > 0) {
      const finalize = typeof options.finalizeSourceArtifactEscrow === 'function'
        ? options.finalizeSourceArtifactEscrow
        : finalizeSourceArtifactEscrowFromWorktreeV1;
      execution = await finalize(action, execution, claim, options);
    }
    requireSourceEscrowBeforeCompletion(execution);
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
    if (executionReceipt) {
      executionReceipt = await appendReceiptTransition(
        executionReceipt,
        execution.success === true ? 'completed' : 'failed',
        options,
        {
          phase: execution.success === true ? 'worker-result-validated' : 'worker-result-blocked',
          timestampUtc: execution.completedAt || '',
          blocker: execution.success === true ? '' : (execution.error || 'MISSION_WORKER_EXECUTION_BLOCKED'),
          proofRefs: execution.evidenceReceipts || executionReceipt.proofRefs,
          expectedNextAction: execution.success === true
            ? 'Release/refill may consume this terminal receipt after canonical completion gates pass.'
            : 'Surface blocker and keep mutation authority closed until a new bounded execution is admitted.',
        },
      );
    }
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
    return { processed: true, claim, applied, result, resultPath, executionReceipt };
  } catch (error) {
    if (executionReceipt && !['completed', 'failed', 'cancelled'].includes(executionReceipt.state)) {
      try {
        executionReceipt = await appendReceiptTransition(executionReceipt, 'failed', options, {
          phase: 'worker-execution-failed',
          blocker: error?.message || `${adapter} execution failed.`,
          expectedNextAction: 'Surface blocker and keep mutation authority closed until a new bounded execution is admitted.',
        });
      } catch (receiptError) {
        error.executionReceiptFailure = receiptError;
      }
    }
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
