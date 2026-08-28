import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { buildMissionEventFromWorkerResult } from '../../shared/agents/missionOrchestratorWorkerResult.mjs';
import {
  appendExecutionReceipt,
  createExecutionReceipt,
  readCurrentExecutionReceipt,
} from '../../shared/agents/executionReceiptV1.mjs';
import { releaseSourceMutationLease } from './programmeAuthorityService.js';
import { appendMissionEvent } from './missionOrchestratorStore.js';
import { collectAgentWorkerResult, resolveMissionWorkerQueueRoot } from './missionOrchestratorWorkerService.js';

const SOURCE_EXECUTION_BINDING_SCHEMA = 'stephanos.source-build-execution-binding.v1';
const SOURCE_EXECUTION_TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);
const EXECUTION_RECEIPT_PROOF_REFS = Object.freeze(['receipts/execution-receipts.jsonl']);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function queuePaths(root, adapter) {
  const adapterRoot = resolve(root, adapter);
  return { pending: resolve(adapterRoot, 'pending'), processing: resolve(adapterRoot, 'processing'), completed: resolve(adapterRoot, 'completed'), failed: resolve(adapterRoot, 'failed') };
}

async function ensurePaths(paths) {
  await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })));
}

function sourceWorkspaceRoot(options = {}) {
  return text(
    options.sharedWorkspaceRoot
      || options.env?.STEPHANOS_SHARED_AGENT_WORKSPACE
      || process.env.STEPHANOS_SHARED_AGENT_WORKSPACE,
  );
}

function sourceExecutionDependencies(options = {}) {
  const overrides = options.testOnly === true && options.sourceExecutionDependencies
    ? options.sourceExecutionDependencies
    : {};
  return {
    appendExecutionReceipt: overrides.appendExecutionReceipt ?? appendExecutionReceipt,
    readCurrentExecutionReceipt: overrides.readCurrentExecutionReceipt ?? readCurrentExecutionReceipt,
    releaseSourceMutationLease: overrides.releaseSourceMutationLease ?? releaseSourceMutationLease,
  };
}

function nowUtc(options = {}, afterUtc = '') {
  const requested = options.now instanceof Date ? options.now : new Date();
  let timestamp = Number.isFinite(requested.getTime()) ? requested.getTime() : Date.now();
  const after = Date.parse(text(afterUtc));
  if (Number.isFinite(after) && timestamp <= after) timestamp = after + 1;
  return new Date(timestamp).toISOString();
}

function validSourceExecutionBinding(binding, item, adapter) {
  return Boolean(
    binding?.schemaVersion === SOURCE_EXECUTION_BINDING_SCHEMA
    && text(binding.leaseId)
    && text(binding.laneId)
    && text(binding.repository)
    && Number.isSafeInteger(Number(binding.issueNumber))
    && Number(binding.issueNumber) > 0
    && Number.isSafeInteger(Number(binding.prNumber))
    && Number(binding.prNumber) > 0
    && text(binding.branch)
    && /^[0-9a-f]{40}$/.test(text(binding.headSha).toLowerCase())
    && text(binding.ownerId)
    && text(binding.executionId)
    && text(binding.receiptWorkerId)
    && text(binding.workerType)
    && text(binding.actionId).toLowerCase() === text(item?.actionId).toLowerCase()
    && text(binding.missionId).toLowerCase() === text(item?.missionId).toLowerCase()
    && text(binding.adapter).toLowerCase() === text(adapter).toLowerCase()
    && text(binding.actionWorkerId) === text(item?.payload?.workerId || item?.payload?.owner)
    && binding.releaseOnlyExactLease === true
    && binding.mergeAuthority === false
    && binding.leaseSeizureAllowed === false
  );
}

function createTransitionReceipt(binding, state, previous, options = {}) {
  return createExecutionReceipt({
    receiptId: `${binding.executionId}-${state}-${previous.sequence + 1}`,
    repository: binding.repository,
    issueNumber: binding.issueNumber,
    prNumber: binding.prNumber,
    branch: binding.branch,
    sourceHead: binding.headSha,
    workerId: binding.receiptWorkerId,
    workerType: binding.workerType,
    executionId: binding.executionId,
    leaseKey: binding.leaseId,
    state,
    phase: text(options.phase, `source-${state}`),
    sequence: previous.sequence + 1,
    predecessorReceiptId: previous.receiptId,
    timestampUtc: nowUtc(options, previous.timestampUtc),
    blocker: state === 'failed' ? text(options.blocker, 'source worker failed') : '',
    operatorActionRequired: false,
    proofRefs: EXECUTION_RECEIPT_PROOF_REFS,
    expectedNextAction: SOURCE_EXECUTION_TERMINAL_STATES.has(state)
      ? ''
      : text(options.expectedNextAction, 'advance exact source execution'),
  });
}

async function currentSourceExecutionReceipt(binding, options = {}) {
  const deps = sourceExecutionDependencies(options);
  const root = sourceWorkspaceRoot(options);
  if (!root) return { ok: false, reason: 'SOURCE_EXECUTION_SHARED_WORKSPACE_ROOT_MISSING', receipt: null };
  return deps.readCurrentExecutionReceipt(root, {
    executionId: binding.executionId,
    leaseKey: binding.leaseId,
    expectedHead: binding.headSha,
  }, { repoRoot: options.repoRoot });
}

async function appendSourceExecutionTransition(binding, state, options = {}) {
  const current = await currentSourceExecutionReceipt(binding, options);
  if (!current?.ok || !current.receipt) {
    return { ok: false, reason: `SOURCE_EXECUTION_CURRENT_RECEIPT_UNAVAILABLE:${text(current?.reason)}`, current, receipt: null };
  }
  if (SOURCE_EXECUTION_TERMINAL_STATES.has(current.receipt.state)) {
    return state === current.receipt.state
      ? { ok: true, reason: 'SOURCE_EXECUTION_TERMINAL_ALREADY_RECORDED', current, receipt: current.receipt, idempotent: true }
      : { ok: false, reason: 'SOURCE_EXECUTION_CONFLICTING_TERMINAL_STATE', current, receipt: null };
  }
  const receipt = createTransitionReceipt(binding, state, current.receipt, options);
  const deps = sourceExecutionDependencies(options);
  const append = await deps.appendExecutionReceipt(sourceWorkspaceRoot(options), receipt, { repoRoot: options.repoRoot });
  return {
    ok: append?.ok === true,
    reason: append?.ok === true ? 'SOURCE_EXECUTION_TRANSITION_APPENDED' : `SOURCE_EXECUTION_TRANSITION_FAILED:${text(append?.reason)}`,
    current,
    receipt,
    append,
  };
}

async function releaseExactSourceExecution(binding, options = {}, afterUtc = '') {
  const deps = sourceExecutionDependencies(options);
  return deps.releaseSourceMutationLease({
    leaseId: binding.leaseId,
    laneId: binding.laneId,
    repository: binding.repository,
    issueNumber: Number(binding.issueNumber),
    prNumber: Number(binding.prNumber),
    branch: binding.branch,
    headSha: binding.headSha,
    ownerId: binding.ownerId,
    nowUtc: nowUtc(options, afterUtc),
  }, {
    root: sourceWorkspaceRoot(options),
    repoRoot: options.repoRoot,
    env: options.env || process.env,
  });
}

async function terminalizeAndRelease(binding, success, error, options = {}) {
  if (!binding) return { ok: true, terminalized: false, released: false };
  const targetState = success ? 'completed' : 'failed';
  const transition = await appendSourceExecutionTransition(binding, targetState, {
    ...options,
    phase: success ? 'source-worker-completed' : 'source-worker-failed',
    blocker: success ? '' : text(error, 'source worker failed'),
  });
  if (!transition.ok) return { ok: false, terminalized: false, released: false, transition };
  const release = await releaseExactSourceExecution(binding, options, transition.receipt.timestampUtc);
  return {
    ok: release?.ok === true,
    terminalized: true,
    released: release?.ok === true,
    transition,
    release,
  };
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
      const sourceExecution = item?.sourceExecution || null;
      if (sourceExecution && !validSourceExecutionBinding(sourceExecution, item, adapter)) {
        throw new Error('Source execution queue binding is invalid or retargeted.');
      }
      await rename(pendingPath, processingPath);
      let acceptedReceipt = null;
      if (sourceExecution) {
        const accepted = await appendSourceExecutionTransition(sourceExecution, 'accepted', {
          ...options,
          phase: 'source-worker-accepted',
          expectedNextAction: 'Worker starts the exact claimed source action.',
        });
        if (!accepted.ok) {
          try {
            await rename(processingPath, pendingPath);
          } catch {
            throw new Error(`Source execution accepted receipt failed and queue claim could not be rolled back: ${accepted.reason}`);
          }
          throw new Error(`Source execution accepted receipt failed: ${accepted.reason}`);
        }
        acceptedReceipt = accepted.receipt;
      }
      return { adapter, item, processingPath, paths, sourceExecution, acceptedReceipt };
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
  const workerId = String(action?.workerId || action?.owner || '').trim();
  let lifecycleTerminalized = false;
  try {
    if (claim.sourceExecution) {
      const started = await appendSourceExecutionTransition(claim.sourceExecution, 'started', {
        ...options,
        phase: 'source-worker-started',
        expectedNextAction: 'Worker reports exact source result and grounded proof.',
      });
      if (!started.ok) throw new Error(`Source execution started receipt failed: ${started.reason}`);
    }
    const execution = await execute(action, claim);
    const applied = await collectAgentWorkerResult({
      missionId: action.missionId,
      actionId: action.actionId,
      adapter,
      workerId,
      success: execution.success === true,
      resultId: execution.resultId || action.actionId,
      changedFiles: execution.changedFiles || [],
      receipt: execution.receipt,
      evidenceReceipts: execution.evidenceReceipts || [],
      error: execution.error || '',
    }, options);
    if (claim.sourceExecution) {
      const terminal = await terminalizeAndRelease(
        claim.sourceExecution,
        execution.success === true,
        execution.error || '',
        options,
      );
      if (!terminal.ok) throw new Error(`Source execution terminal lifecycle failed: ${terminal.transition?.reason || terminal.release?.reason || 'unknown failure'}`);
      lifecycleTerminalized = true;
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
    return { processed: true, claim, applied, result, resultPath };
  } catch (error) {
    if (claim.sourceExecution && !lifecycleTerminalized) {
      try {
        await terminalizeAndRelease(claim.sourceExecution, false, error?.message || `${adapter} execution failed.`, options);
      } catch {
        // Do not mask the original execution or lifecycle failure.
      }
    }
    try {
      await collectAgentWorkerResult({ missionId: action.missionId, actionId: action.actionId, adapter, workerId, success: false, error: error?.message || `${adapter} execution failed.` }, options);
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
