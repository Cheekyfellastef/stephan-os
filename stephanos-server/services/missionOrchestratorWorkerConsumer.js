import { mkdir, readFile, readdir, rename } from 'node:fs/promises';
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
import { inspectProviderNeutralActiveOrphanRecovery } from './providerNeutralSourceBuilderActiveOrphanRecoveryV1.js';
import {
  inspectProviderNeutralAppliedMutationRecoveryV1,
  retireProviderNeutralTerminalMutationCheckpointV1,
} from './providerNeutralSourceMutationCheckpointV1.js';
import {
  acquireMissionWorkerClaimOwnership,
  inspectMissionWorkerClaimOwnership,
  missionWorkerQueueItemSha256,
} from './missionWorkerClaimOwnershipV1.js';
import { publishMissionWorkerResultAtomicallyV1 } from './missionWorkerResultPublicationV1.js';

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

function normalizedText(value) {
  return String(value ?? '').trim();
}

function persistedNativeBinding(claim) {
  const grant = claim?.item?.actionGrant;
  const binding = claim?.item?.executionBinding;
  if (!grant && !binding) return null;
  if (!grant || !binding) throw new Error('EXECUTION_RECEIPT_QUEUE_BINDING_INCOMPLETE');
  if (grant.schemaVersion !== 'stephanos.mission-worker-action-grant.v1') {
    throw new Error('EXECUTION_RECEIPT_QUEUE_GRANT_SCHEMA_INVALID');
  }
  if (binding.schemaVersion !== 'stephanos.mission-worker-queue-execution-binding.v1') {
    throw new Error('EXECUTION_RECEIPT_QUEUE_BINDING_SCHEMA_INVALID');
  }
  const grantMismatch = (
    normalizedText(binding.executionId).toLowerCase() !== normalizedText(grant.actionId).toLowerCase()
    || normalizedText(binding.grantId) !== normalizedText(grant.grantId)
    || normalizedText(binding.missionId).toLowerCase() !== normalizedText(grant.missionId).toLowerCase()
    || Number(binding.missionRevision) !== Number(grant.missionRevision)
    || normalizedText(binding.repository).toLowerCase() !== normalizedText(grant.repository).toLowerCase()
    || Number(binding.issueNumber) !== Number(grant.issueNumber)
    || Number(binding.prNumber) !== Number(grant.prNumber)
    || normalizedText(binding.branch) !== normalizedText(grant.branch)
    || normalizedText(binding.headSha).toLowerCase() !== normalizedText(grant.headSha).toLowerCase()
    || normalizedText(binding.sourceRevision).toLowerCase() !== normalizedText(grant.sourceRevision).toLowerCase()
  );
  if (grantMismatch) throw new Error('EXECUTION_RECEIPT_QUEUE_GRANT_BINDING_MISMATCH');
  return { grant, binding };
}

function requirePersistedBindingMatchesReceipt(persisted, receipt, options = {}) {
  if (!persisted) return;
  const { grant, binding } = persisted;
  const exactHead = normalizedText(binding.headSha || binding.sourceRevision).toLowerCase();
  const mismatch = (
    normalizedText(binding.executionId).toLowerCase() !== normalizedText(receipt.executionId).toLowerCase()
    || normalizedText(binding.leaseKey) !== normalizedText(receipt.leaseKey)
    || normalizedText(binding.repository).toLowerCase() !== normalizedText(receipt.repository).toLowerCase()
    || Number(binding.issueNumber) !== Number(receipt.issueNumber)
    || Number(binding.prNumber) !== Number(receipt.prNumber)
    || normalizedText(binding.branch) !== normalizedText(receipt.branch)
    || exactHead !== normalizedText(receipt.sourceHead).toLowerCase()
  );
  if (mismatch) throw new Error('EXECUTION_RECEIPT_QUEUE_BINDING_IDENTITY_MISMATCH');

  const suppliedGrant = options.actionGrant;
  if (suppliedGrant) {
    const suppliedMismatch = (
      normalizedText(suppliedGrant.grantId) !== normalizedText(grant.grantId)
      || normalizedText(suppliedGrant.actionId).toLowerCase() !== normalizedText(grant.actionId).toLowerCase()
      || normalizedText(suppliedGrant.missionId).toLowerCase() !== normalizedText(grant.missionId).toLowerCase()
      || Number(suppliedGrant.missionRevision) !== Number(grant.missionRevision)
      || normalizedText(suppliedGrant.repository).toLowerCase() !== normalizedText(grant.repository).toLowerCase()
      || Number(suppliedGrant.issueNumber) !== Number(grant.issueNumber)
      || Number(suppliedGrant.prNumber) !== Number(grant.prNumber)
      || normalizedText(suppliedGrant.branch) !== normalizedText(grant.branch)
      || normalizedText(suppliedGrant.headSha).toLowerCase() !== normalizedText(grant.headSha).toLowerCase()
      || normalizedText(suppliedGrant.sourceRevision).toLowerCase() !== normalizedText(grant.sourceRevision).toLowerCase()
    );
    if (suppliedMismatch) throw new Error('EXECUTION_RECEIPT_RUNTIME_GRANT_MISMATCH');
  }
}

async function beginNativeExecutionReceiptChain(claim, options = {}) {
  const root = executionReceiptRoot(options);
  if (!root) return null;
  const executionId = String(claim?.item?.actionId || '').trim().toLowerCase();
  if (!executionId) return null;
  const persisted = persistedNativeBinding(claim);
  const filters = persisted
    ? { executionId, leaseKey: persisted.binding.leaseKey, expectedHead: persisted.binding.headSha || persisted.binding.sourceRevision }
    : { executionId };
  const history = await readExecutionReceiptHistory(root, filters, executionReceiptOptions(options));
  if (history?.ok !== true) {
    const error = new Error(`EXECUTION_RECEIPT_HISTORY_BLOCKED:${history?.reason || 'unknown'}`);
    error.code = 'EXECUTION_RECEIPT_HISTORY_BLOCKED';
    error.history = history;
    throw error;
  }
  let current = history.latestReceipt;
  if (!current && persisted?.grant?.adapter === 'stephanos-native') {
    const { grant, binding } = persisted;
    const sourceHead = normalizedText(binding.headSha || binding.sourceRevision).toLowerCase();
    const queued = createExecutionReceipt({
      repository: binding.repository,
      issueNumber: binding.issueNumber,
      prNumber: binding.prNumber,
      branch: binding.branch,
      sourceHead,
      workerId: grant.workerId,
      workerType: 'orchestration-engine',
      executionId: binding.executionId,
      leaseKey: binding.leaseKey,
      state: 'queued',
      phase: 'native-queue-admitted',
      sequence: 1,
      timestampUtc: claim?.item?.createdAt || (options.now instanceof Date ? options.now.toISOString() : new Date().toISOString()),
      proofRefs: grant.capacityProofRefs,
      expectedNextAction: 'Stephanos-native worker may atomically claim this exact granted execution.',
    });
    const appended = await appendExecutionReceipt(root, queued, executionReceiptOptions(options));
    if (appended?.ok !== true) {
      const error = new Error(`EXECUTION_RECEIPT_APPEND_FAILED:${appended?.reason || 'unknown'}`);
      error.code = 'EXECUTION_RECEIPT_APPEND_FAILED';
      error.receipt = queued;
      error.appendResult = appended;
      throw error;
    }
    current = queued;
  }
  if (!current) {
    if (persisted) throw new Error('EXECUTION_RECEIPT_QUEUED_TRUTH_REQUIRED');
    return null;
  }
  const acceptedResume = current.state === 'accepted' && options.allowAcceptedReceiptResume === true;
  const activeResume = ['started', 'progress'].includes(current.state)
    && options.allowActiveReceiptResume === true;
  if (current.state !== 'queued' && !acceptedResume && !activeResume) {
    const error = new Error(`EXECUTION_RECEIPT_CLAIM_STATE_INVALID:${current.state}`);
    error.code = 'EXECUTION_RECEIPT_CLAIM_STATE_INVALID';
    error.receipt = current;
    throw error;
  }
  requirePersistedBindingMatchesReceipt(persisted, current, options);
  if (!persisted && options.actionGrant) {
    const actionGrant = options.actionGrant;
    const mismatched = (
      String(actionGrant.repository || '').toLowerCase() !== current.repository.toLowerCase()
      || Number(actionGrant.issueNumber) !== current.issueNumber
      || Number(actionGrant.prNumber) !== current.prNumber
      || String(actionGrant.branch || '') !== current.branch
      || String(actionGrant.headSha || '').toLowerCase() !== current.sourceHead
    );
    if (mismatched) throw new Error('EXECUTION_RECEIPT_ACTION_GRANT_IDENTITY_MISMATCH');
  }
  if (current.state === 'queued') {
    current = await appendReceiptTransition(current, 'accepted', options, {
      phase: 'worker-claim-accepted',
      expectedNextAction: 'Worker must append started before executor authority is invoked.',
    });
  }
  if (current.state === 'accepted') {
    current = await appendReceiptTransition(current, 'started', options, {
      phase: acceptedResume ? 'worker-execution-resumed-started' : 'worker-execution-started',
      expectedNextAction: 'Worker must publish fresh progress heartbeat or terminal truth.',
    });
  }
  if (current.state === 'started') {
    current = await appendReceiptTransition(current, 'progress', options, {
      phase: activeResume ? 'worker-execution-resumed-after-interruption' : 'worker-execution-active',
      expectedNextAction: 'Worker must publish deterministic terminal truth after result validation.',
    });
  } else if (current.state === 'progress' && activeResume) {
    current = await appendReceiptTransition(current, 'progress', options, {
      phase: 'worker-execution-resumed-after-interruption',
      expectedNextAction: 'Worker must re-prove exact source state before provider or mutation authority is used.',
    });
  }
  return current;
}

function claimOwnershipRuntimeOptions(options = {}) {
  return options.claimOwnershipOptions || options;
}

async function acquireQueueClaimOwnership(root, adapter, item, bytes, options = {}) {
  if (options.requireClaimOwnership !== true) return null;
  const actionId = normalizedText(item?.actionId).toLowerCase();
  if (!actionId) return null;
  return acquireMissionWorkerClaimOwnership({
    queueRoot: root,
    adapter,
    actionId,
    queueItemSha256: missionWorkerQueueItemSha256(bytes),
    acquiredAtUtc: options.now instanceof Date ? options.now.toISOString() : '',
  }, claimOwnershipRuntimeOptions(options));
}

function pendingQueueItemIdentityValid(item, adapter, entryName) {
  const actionId = normalizedText(item?.actionId).toLowerCase();
  const missionId = normalizedText(item?.missionId).toLowerCase();
  const expectedName = actionId ? `${actionId}.json` : '';
  return item?.schemaVersion === 'stephanos.mission-worker-queue-item.v1'
    && normalizedText(item?.adapter).toLowerCase() === normalizedText(adapter).toLowerCase()
    && Boolean(actionId)
    && Boolean(missionId)
    && expectedName === normalizedText(entryName).toLowerCase()
    && item?.payload
    && typeof item.payload === 'object'
    && !Array.isArray(item.payload);
}

async function quarantinePendingPoisonPill(paths, adapter, entry, pendingPath, bytes, reason, options = {}) {
  const digest = missionWorkerQueueItemSha256(bytes);
  const stem = entry.name.replace(/\.json$/i, '');
  const quarantinePath = resolve(
    paths.failed,
    `${stem}.invalid-${digest.slice(0, 16)}.bin`,
  );
  try {
    await rename(pendingPath, quarantinePath);
  } catch (error) {
    const diagnostic = Object.freeze({
      schemaVersion: 'stephanos.mission-worker-pending-quarantine.v1',
      adapter,
      pendingPath,
      quarantinePath,
      queueItemSha256: digest,
      reason: ['ENOENT', 'EEXIST'].includes(error?.code)
        ? 'MISSION_WORKER_PENDING_QUARANTINE_RACE'
        : 'MISSION_WORKER_PENDING_QUARANTINE_FAILED',
      sourceReason: reason,
    });
    if (typeof options.onPendingQueueDiagnostic === 'function') {
      await options.onPendingQueueDiagnostic(diagnostic);
    }
    return diagnostic;
  }

  const quarantinedBytes = await readFile(quarantinePath).catch(() => null);
  const diagnostic = Object.freeze({
    schemaVersion: 'stephanos.mission-worker-pending-quarantine.v1',
    adapter,
    pendingPath,
    quarantinePath,
    queueItemSha256: digest,
    reason: quarantinedBytes
      && missionWorkerQueueItemSha256(quarantinedBytes) === digest
      ? 'MISSION_WORKER_PENDING_ITEM_QUARANTINED'
      : 'MISSION_WORKER_PENDING_QUARANTINE_IDENTITY_MISMATCH',
    sourceReason: reason,
  });
  if (typeof options.onPendingQueueDiagnostic === 'function') {
    await options.onPendingQueueDiagnostic(diagnostic);
  }
  return diagnostic;
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
    let claimOwnership = null;
    try {
      const bytes = await readFile(pendingPath);
      let item;
      try {
        item = JSON.parse(bytes.toString('utf8'));
      } catch {
        await quarantinePendingPoisonPill(
          paths,
          adapter,
          entry,
          pendingPath,
          bytes,
          'MISSION_WORKER_PENDING_ITEM_JSON_INVALID',
          options,
        );
        continue;
      }
      if (!pendingQueueItemIdentityValid(item, adapter, entry.name)) {
        await quarantinePendingPoisonPill(
          paths,
          adapter,
          entry,
          pendingPath,
          bytes,
          'MISSION_WORKER_PENDING_ITEM_IDENTITY_INVALID',
          options,
        );
        continue;
      }
      if (
        actionGrant
        && (
          String(item?.missionId || '').toLowerCase()
            !== String(actionGrant.missionId || '').toLowerCase()
          || String(item?.actionId || '').toLowerCase()
            !== String(actionGrant.actionId || '').toLowerCase()
        )
      ) {
        await quarantinePendingPoisonPill(
          paths,
          adapter,
          entry,
          pendingPath,
          bytes,
          'MISSION_WORKER_PENDING_ITEM_GRANT_IDENTITY_INVALID',
          options,
        );
        continue;
      }
      claimOwnership = await acquireQueueClaimOwnership(root, adapter, item, bytes, options);
      if (options.requireClaimOwnership === true && claimOwnership?.acquired !== true) continue;
      try {
        await rename(pendingPath, processingPath);
      } catch (error) {
        if (claimOwnership?.release) await claimOwnership.release();
        if (['ENOENT', 'EEXIST'].includes(error?.code)) continue;
        throw error;
      }
      return {
        adapter,
        item,
        processingPath,
        paths,
        claimOwnership,
        queueItemSha256: missionWorkerQueueItemSha256(bytes),
      };
    } catch (error) {
      if (claimOwnership?.release) await claimOwnership.release();
      if (['ENOENT', 'EEXIST'].includes(error?.code)) continue;
      throw error;
    }
  }
  return null;
}

export async function inspectRecoverableProcessingClaim(adapter, options = {}) {
  const root = options.queueRoot || resolveMissionWorkerQueueRoot(options.env || process.env);
  if (!root) return Object.freeze({ claim: null, hold: null });
  const paths = queuePaths(root, adapter);
  await ensurePaths(paths);
  const actionGrant = options.actionGrant;
  const entries = (await readdir(paths.processing, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name));
  const candidates = actionGrant?.actionId
    ? entries.filter((entry) => entry.name.toLowerCase() === `${String(actionGrant.actionId).toLowerCase()}.json`)
    : entries;
  let hold = null;

  for (const entry of candidates) {
    const processingPath = resolve(paths.processing, entry.name);
    let bytes;
    let item;
    try {
      bytes = await readFile(processingPath);
      item = JSON.parse(bytes.toString('utf8'));
    } catch {
      hold ??= Object.freeze({ reason: 'MISSION_WORKER_ORPHAN_PROCESSING_ITEM_INVALID', adapter, processingPath });
      continue;
    }
    const actionId = normalizedText(item?.actionId).toLowerCase();
    if (!actionId) {
      hold ??= Object.freeze({ reason: 'MISSION_WORKER_ORPHAN_ACTION_ID_INVALID', adapter, processingPath });
      continue;
    }
    const digest = missionWorkerQueueItemSha256(bytes);
    const inspectClaimOwnership = options.inspectClaimOwnership || inspectMissionWorkerClaimOwnership;
    const ownerEvidence = await inspectClaimOwnership({
      queueRoot: root,
      adapter,
      actionId,
      queueItemSha256: digest,
    }, claimOwnershipRuntimeOptions(options));
    if (ownerEvidence.state === 'alive' || ownerEvidence.state === 'unknown') continue;
    if (!['dead', 'reused'].includes(ownerEvidence.state)) {
      hold ??= Object.freeze({
        reason: ownerEvidence.reason || 'MISSION_WORKER_ORPHAN_OWNER_UNPROVEN',
        adapter,
        actionId,
        processingPath,
      });
      continue;
    }

    let persisted;
    try {
      persisted = persistedNativeBinding({ item });
    } catch (error) {
      hold ??= Object.freeze({
        reason: error?.message || 'MISSION_WORKER_ORPHAN_BINDING_INVALID',
        adapter,
        actionId,
        processingPath,
      });
      continue;
    }
    if (!persisted) {
      hold ??= Object.freeze({
        reason: 'MISSION_WORKER_ORPHAN_EXECUTION_BINDING_REQUIRED',
        adapter,
        actionId,
        processingPath,
      });
      continue;
    }

    const workspaceRoot = executionReceiptRoot(options);
    if (!workspaceRoot) {
      hold ??= Object.freeze({
        reason: 'MISSION_WORKER_ORPHAN_EXECUTION_RECEIPT_WORKSPACE_REQUIRED',
        adapter,
        actionId,
        processingPath,
      });
      continue;
    }
    const readReceiptHistory = options.readExecutionReceiptHistory || readExecutionReceiptHistory;
    const history = await readReceiptHistory(workspaceRoot, {
      executionId: persisted.binding.executionId,
      leaseKey: persisted.binding.leaseKey,
      expectedHead: persisted.binding.headSha || persisted.binding.sourceRevision,
    }, executionReceiptOptions(options));
    if (history?.ok !== true || !history.latestReceipt) {
      hold ??= Object.freeze({
        reason: history?.reason || 'MISSION_WORKER_ORPHAN_EXECUTION_RECEIPT_REQUIRED',
        adapter,
        actionId,
        processingPath,
      });
      continue;
    }
    const latest = history.latestReceipt;
    let activeResumeProof = null;
    if (!['queued', 'accepted'].includes(latest.state)) {
      if (['started', 'progress'].includes(latest.state) && typeof options.runCommand === 'function') {
        activeResumeProof = inspectProviderNeutralActiveOrphanRecovery({
          adapter,
          item,
          processingPath,
          latestReceipt: latest,
        }, {
          runCommand: options.runCommand,
        });
        if (
          activeResumeProof?.allowed !== true
          && activeResumeProof?.reason === 'PROVIDER_NEUTRAL_ACTIVE_ORPHAN_WORKTREE_NOT_CLEAN'
        ) {
          const inspectAppliedMutationRecovery = options.inspectAppliedMutationRecovery
            || inspectProviderNeutralAppliedMutationRecoveryV1;
          activeResumeProof = await inspectAppliedMutationRecovery({
            adapter,
            item,
            processingPath,
            latestReceipt: latest,
          }, {
            ...options,
            runCommand: options.runCommand,
          });
        }
      }
      if (activeResumeProof?.allowed !== true) {
        hold ??= Object.freeze({
          reason: activeResumeProof?.reason || `MISSION_WORKER_ORPHAN_RECONCILIATION_REQUIRED:${latest.state}`,
          adapter,
          actionId,
          processingPath,
          receiptId: latest.receiptId,
          receiptState: latest.state,
          activeResumeProof,
        });
        continue;
      }
    }

    const acquireClaimOwnership = options.acquireClaimOwnership || acquireMissionWorkerClaimOwnership;
    const claimOwnership = await acquireClaimOwnership({
      queueRoot: root,
      adapter,
      actionId,
      queueItemSha256: digest,
      acquiredAtUtc: options.now instanceof Date ? options.now.toISOString() : '',
    }, claimOwnershipRuntimeOptions(options));
    if (claimOwnership?.acquired !== true) continue;

    let currentBytes;
    try {
      currentBytes = await readFile(processingPath);
    } catch {
      await claimOwnership.release();
      continue;
    }
    if (missionWorkerQueueItemSha256(currentBytes) !== digest) {
      await claimOwnership.release();
      hold ??= Object.freeze({
        reason: 'MISSION_WORKER_ORPHAN_QUEUE_IDENTITY_CHANGED',
        adapter,
        actionId,
        processingPath,
      });
      continue;
    }

    return Object.freeze({
      claim: {
        adapter,
        item,
        processingPath,
        paths,
        claimOwnership,
        queueItemSha256: digest,
        recoveredFromOrphan: true,
        recoveredReceiptState: latest.state,
        activeResumeProof,
      },
      hold,
    });
  }

  return Object.freeze({ claim: null, hold });
}

async function finishClaim(claim, result, success) {
  const targetRoot = success ? claim.paths.completed : claim.paths.failed;
  const fileName = basename(claim.processingPath);
  const resultPath = resolve(targetRoot, fileName.replace(/\.json$/, '.result.json'));
  const publication = await publishMissionWorkerResultAtomicallyV1(resultPath, result);
  if (publication?.ok !== true) {
    const error = new Error(`MISSION_WORKER_RESULT_PUBLICATION_FAILED:${publication?.reason || 'unknown'}`);
    error.code = 'MISSION_WORKER_RESULT_PUBLICATION_FAILED';
    error.publication = publication;
    throw error;
  }
  await rename(claim.processingPath, resolve(targetRoot, fileName));
  if (claim.claimOwnership?.release) await claim.claimOwnership.release();
  return resultPath;
}

export async function finalizeMissionWorkerTerminalClaimV1(
  claim,
  result,
  success,
  options = {},
) {
  const finalize = options.finishClaim || finishClaim;
  try {
    const resultPath = await finalize(claim, result, success);
    return Object.freeze({
      finalized: true,
      reason: 'MISSION_WORKER_TERMINAL_FINALIZED',
      resultPath,
    });
  } catch (error) {
    if (claim?.claimOwnership?.release) {
      try { await claim.claimOwnership.release(); }
      catch { /* terminal proof remains canonical; reconciliation will retry bookkeeping */ }
    }
    return Object.freeze({
      finalized: false,
      reason: 'MISSION_WORKER_TERMINAL_FINALIZATION_PENDING',
      error,
      resultPath: '',
    });
  }
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

const CANONICAL_AGENT_EXECUTION_ADAPTERS = new Set([
  'codex',
  'openclaw-readonly',
  'chatgpt-github',
  'foundry-forge',
  'stephanos-native',
]);

export async function processMissionWorkerAgentClaim(adapter, options = {}, execute) {
  const normalizedAdapter = normalizedText(adapter).toLowerCase();
  if (!CANONICAL_AGENT_EXECUTION_ADAPTERS.has(normalizedAdapter)) {
    throw new Error('MISSION_WORKER_AGENT_ADAPTER_UNSUPPORTED');
  }
  if (typeof execute !== 'function') throw new Error('Mission Worker agent executor is required.');
  adapter = normalizedAdapter;
  const recovery = await inspectRecoverableProcessingClaim(adapter, options);
  const pendingQueueDiagnostics = [];
  const claim = recovery.claim || await claimNextMissionWorkerItem(adapter, {
    ...options,
    requireClaimOwnership: true,
    onPendingQueueDiagnostic: async (diagnostic) => {
      pendingQueueDiagnostics.push(diagnostic);
      if (typeof options.onPendingQueueDiagnostic === 'function') {
        await options.onPendingQueueDiagnostic(diagnostic);
      }
    },
  });
  if (!claim) {
    return {
      processed: false,
      reason: recovery.hold?.reason
        || pendingQueueDiagnostics[0]?.reason
        || 'queue-empty',
      orphanRecovery: recovery.hold || null,
      pendingQueueDiagnostics: Object.freeze([...pendingQueueDiagnostics]),
    };
  }
  claim.options = options;
  const action = claim.item.payload;
  let executionReceipt = null;
  let terminalCheckpointCleanup = null;
  try {
    executionReceipt = await beginNativeExecutionReceiptChain(claim, {
      ...options,
      allowAcceptedReceiptResume: claim.recoveredFromOrphan === true,
      allowActiveReceiptResume: claim.recoveredFromOrphan === true
        && claim.activeResumeProof?.allowed === true,
    });
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
          proofRefs: execution.proofRefs || executionReceipt.proofRefs,
          expectedNextAction: execution.success === true
            ? 'Release/refill may consume this terminal receipt after canonical completion gates pass.'
            : 'Surface blocker and keep mutation authority closed until a new bounded execution is admitted.',
        },
      );
    }
    if (
      execution.success === true
      && changedFiles.length > 0
      && ['foundry-forge', 'chatgpt-github'].includes(adapter)
    ) {
      const retireTerminalCheckpoint = options.retireTerminalMutationCheckpoint
        || retireProviderNeutralTerminalMutationCheckpointV1;
      terminalCheckpointCleanup = await retireTerminalCheckpoint({
        missionId: action.missionId,
        actionId: action.actionId,
        expectedPatchSha256: execution.receipt?.commandOutputHash || '',
      }, options);
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
      executionReceiptId: executionReceipt?.receiptId || '',
      recoveredAfterInterruption: claim.recoveredFromOrphan === true,
      terminalCheckpointCleanup,
      finalVerdict: execution.success === true ? 'MISSION_WORKER_ITEM_COMPLETE' : 'MISSION_WORKER_ITEM_BLOCKED',
    };
    const terminalFinalization = await finalizeMissionWorkerTerminalClaimV1(
      claim,
      result,
      execution.success === true,
      options,
    );
    if (!terminalFinalization.finalized) {
      return {
        processed: false,
        reason: terminalFinalization.reason,
        claim,
        applied,
        result,
        executionReceipt,
        terminalCheckpointCleanup,
        terminalFinalization,
      };
    }
    return {
      processed: true,
      claim,
      applied,
      result,
      resultPath: terminalFinalization.resultPath,
      executionReceipt,
      terminalCheckpointCleanup,
      terminalFinalization,
    };
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
  return processMissionWorkerAgentClaim('codex', options, options.executeCodexAction);
}

export async function processNextStephanosNativeItem(options = {}) {
  if (typeof options.executeStephanosNativeAction !== 'function') throw new Error('Stephanos-native execution adapter is required.');
  return processMissionWorkerAgentClaim('stephanos-native', options, options.executeStephanosNativeAction);
}

export async function processNextOpenClawReadonlyItem(options = {}) {
  if (typeof options.executeOpenClawReadonlyAction !== 'function') throw new Error('OpenClaw read-only execution adapter is required.');
  return processMissionWorkerAgentClaim('openclaw-readonly', options, options.executeOpenClawReadonlyAction);
}
