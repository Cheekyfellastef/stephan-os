import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  appendExecutionReceipt,
  createExecutionReceipt,
  EXECUTION_RECEIPT_TERMINAL_STATES,
  readExecutionReceiptHistory,
} from '../../shared/agents/executionReceiptV1.mjs';
import { buildMissionEventFromWorkerResult } from '../../shared/agents/missionOrchestratorWorkerResult.mjs';
import { gateSourceWorkerCompletionV1 } from '../../shared/agents/sourceArtifactEscrowCompletionGateV1.mjs';
import {
  OFFLINE_PUBLICATION_OUTBOX_V1_SCHEMA,
  OFFLINE_PUBLICATION_OUTBOX_STATE,
} from '../../shared/agents/offlinePublicationOutboxV1.mjs';
import { appendMissionEvent, readMissionRecord } from './missionOrchestratorStore.js';
import { collectAgentWorkerResult, resolveMissionWorkerQueueRoot } from './missionOrchestratorWorkerService.js';
import { finalizeSourceArtifactEscrowFromWorktreeV1 } from './sourceArtifactEscrowStore.js';

function providerNeutralTerminalQueueReleaseProven(item, result, adapter) {
  const normalizedAdapter = normalizedText(adapter).toLowerCase();
  if (!['foundry-forge', 'chatgpt-github'].includes(normalizedAdapter)) return false;
  return item?.schemaVersion === 'stephanos.mission-worker-queue-item.v1'
    && item?.actionGrant?.schemaVersion === 'stephanos.mission-worker-action-grant.v1'
    && item?.executionBinding?.schemaVersion === 'stephanos.mission-worker-queue-execution-binding.v1'
    && result?.schemaVersion === 'stephanos.provider-neutral-source-builder.v1'
    && result?.processed === true
    && result?.success === false
    && normalizedText(result?.adapter).toLowerCase() === normalizedAdapter
    && normalizedText(result?.providerAdapter).toLowerCase() === normalizedAdapter
    && normalizedText(result?.missionId).toLowerCase() === normalizedText(item?.missionId).toLowerCase()
    && normalizedText(result?.actionId).toLowerCase() === normalizedText(item?.actionId).toLowerCase()
    && normalizedText(result?.finalVerdict) === 'PROVIDER_NEUTRAL_SOURCE_BUILD_BLOCKED'
    && Boolean(normalizedText(result?.error));
}

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

export async function appendMissionWorkerExecutionReceiptTransition(previous, state, options = {}, additions = {}) {
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

function verifiedReceiptHash(receipt = {}) {
  if (receipt?.verified !== true) return '';
  const hash = normalizedText(receipt.commandOutputHash || receipt.sha256).toLowerCase();
  return /^[0-9a-f]{64}$/.test(hash) ? hash : '';
}

function canonicalElasticGoalEvidenceRequirement(action = {}, requirement = '') {
  const missionMatch = /^critical-([1-9]\d*)-elastic-goal$/.exec(normalizedText(action.missionId).toLowerCase());
  const requirementMatch = /^Goal #([1-9]\d*) bounded implementation and focused verification evidence$/.exec(normalizedText(requirement));
  return Boolean(missionMatch && requirementMatch && missionMatch[1] === requirementMatch[1]);
}

function safelyTestGroundedRequirement(action = {}, requirement = '') {
  const value = normalizedText(requirement);
  if (!value) return false;
  if (/\b(browser|ui|visual|screenshot|screen|manual|live|runtime|network|http|playtest)\b/i.test(value)) return false;
  if (canonicalElasticGoalEvidenceRequirement(action, value)) return true;
  return /\b(test|tests|check|checks)\b/i.test(value);
}

export function buildVerificationEvidenceReceipts(action = {}, now = new Date()) {
  const required = [...new Set((Array.isArray(action.requiredEvidence) ? action.requiredEvidence : []).map(normalizedText).filter(Boolean))];
  const existing = Array.isArray(action.receipts) ? action.receipts : [];
  const existingRequirements = new Set(existing.filter((receipt) => receipt?.verified === true).map((receipt) => normalizedText(receipt.requirement)).filter(Boolean));
  const sourceTests = existing.filter((receipt) => normalizedText(receipt?.evidenceType) === 'source-test-command' && verifiedReceiptHash(receipt));
  const sourceMutations = existing.filter((receipt) => normalizedText(receipt?.evidenceType) === 'source-mutation' && verifiedReceiptHash(receipt));
  const createdAt = now instanceof Date ? now.toISOString() : new Date().toISOString();
  const receipts = [];
  for (const requirement of required) {
    if (existingRequirements.has(requirement) || !safelyTestGroundedRequirement(action, requirement)) continue;
    const canonicalElastic = canonicalElasticGoalEvidenceRequirement(action, requirement);
    if (!sourceTests.length || (canonicalElastic && !sourceMutations.length)) continue;
    const supporting = [...sourceMutations, ...sourceTests].map((receipt) => ({
      receiptId: normalizedText(receipt.receiptId),
      requirement: normalizedText(receipt.requirement),
      evidenceType: normalizedText(receipt.evidenceType),
      hash: verifiedReceiptHash(receipt),
    }));
    const commandOutputHash = createHash('sha256').update(JSON.stringify(supporting)).digest('hex');
    receipts.push(Object.freeze({
      receiptId: `verification-evidence-${createHash('sha256').update(`${action.missionId}\n${requirement}\n${commandOutputHash}`).digest('hex').slice(0, 20)}`,
      requirement,
      source: 'verification-judge',
      evidenceType: 'source-test-suite',
      verified: true,
      commandOutputHash,
      createdAt,
    }));
  }
  return Object.freeze(receipts);
}

function normalizedPositiveInteger(value) {
  const normalized = typeof value === 'string'
    ? Number(value.replace(/^#/, ''))
    : Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : 0;
}

function executionWorkerTypeForAdapter(adapter = '') {
  const normalized = normalizedText(adapter).toLowerCase();
  if (normalized === 'codex') return 'remote-codex';
  if (normalized === 'openclaw-standalone' || normalized === 'openclaw-local') return 'openclaw';
  if (normalized === 'stephanos-native') return 'orchestration-engine';
  if (normalized === 'foundry-forge' || normalized === 'chatgpt-github' || normalized === 'desktop-commander') return 'github-first';
  return normalized;
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
    || normalizedPositiveInteger(binding.issueNumber) !== normalizedPositiveInteger(grant.issueNumber)
    || normalizedPositiveInteger(binding.prNumber) !== normalizedPositiveInteger(grant.prNumber)
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
    || normalizedPositiveInteger(binding.issueNumber) !== normalizedPositiveInteger(receipt.issueNumber)
    || normalizedPositiveInteger(binding.prNumber) !== normalizedPositiveInteger(receipt.prNumber)
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
      || normalizedPositiveInteger(suppliedGrant.issueNumber) !== normalizedPositiveInteger(grant.issueNumber)
      || normalizedPositiveInteger(suppliedGrant.prNumber) !== normalizedPositiveInteger(grant.prNumber)
      || normalizedText(suppliedGrant.branch) !== normalizedText(grant.branch)
      || normalizedText(suppliedGrant.headSha).toLowerCase() !== normalizedText(grant.headSha).toLowerCase()
      || normalizedText(suppliedGrant.sourceRevision).toLowerCase() !== normalizedText(grant.sourceRevision).toLowerCase()
    );
    if (suppliedMismatch) throw new Error('EXECUTION_RECEIPT_RUNTIME_GRANT_MISMATCH');
  }
}

export async function beginMissionWorkerExecutionReceiptChain(claim, options = {}) {
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
  if (!current && persisted) {
    const { grant, binding } = persisted;
    const sourceHead = normalizedText(binding.headSha || binding.sourceRevision).toLowerCase();
    const adapter = normalizedText(grant.adapter).toLowerCase();
    const queued = createExecutionReceipt({
      repository: binding.repository,
      issueNumber: binding.issueNumber,
      prNumber: binding.prNumber,
      branch: binding.branch,
      sourceHead,
      workerId: grant.workerId,
      workerType: executionWorkerTypeForAdapter(adapter),
      executionId: binding.executionId,
      leaseKey: binding.leaseKey,
      state: 'queued',
      phase: 'worker-queue-admitted',
      sequence: 1,
      timestampUtc: claim?.item?.createdAt || (options.now instanceof Date ? options.now.toISOString() : new Date().toISOString()),
      proofRefs: grant.capacityProofRefs,
      expectedNextAction: `${adapter || 'mission'} worker may atomically claim this exact granted execution.`,
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
  if (current.state !== 'queued') {
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
  current = await appendMissionWorkerExecutionReceiptTransition(current, 'accepted', options, {
    phase: 'worker-claim-accepted',
    expectedNextAction: 'Worker must append started before executor authority is invoked.',
  });
  current = await appendMissionWorkerExecutionReceiptTransition(current, 'started', options, {
    phase: 'worker-execution-started',
    expectedNextAction: 'Worker must publish fresh progress heartbeat or terminal truth.',
  });
  current = await appendMissionWorkerExecutionReceiptTransition(current, 'progress', options, {
    phase: 'worker-execution-active',
    expectedNextAction: 'Worker must publish deterministic terminal truth after result validation.',
  });
  return current;
}

function pendingQueueItemIdentityValid(item, adapter, entryName) {
  const actionId = normalizedText(item?.actionId).toLowerCase();
  const missionId = normalizedText(item?.missionId).toLowerCase();
  return item?.schemaVersion === 'stephanos.mission-worker-queue-item.v1'
    && normalizedText(item?.adapter).toLowerCase() === normalizedText(adapter).toLowerCase()
    && Boolean(actionId)
    && Boolean(missionId)
    && normalizedText(entryName).toLowerCase() === `${actionId}.json`
    && item?.payload
    && typeof item.payload === 'object'
    && !Array.isArray(item.payload);
}

async function publishPendingQueueDiagnostic(options, diagnostic) {
  if (typeof options.onPendingQueueDiagnostic === 'function') {
    await options.onPendingQueueDiagnostic(diagnostic);
  }
  return diagnostic;
}

async function quarantinePendingQueueItem(paths, adapter, entry, pendingPath, observedBytes, sourceReason, options = {}) {
  const digest = createHash('sha256').update(observedBytes).digest('hex');
  const stem = entry.name.replace(/\.json$/i, '');
  const quarantinePath = resolve(
    paths.failed,
    `${stem}.invalid-${digest.slice(0, 16)}-${process.pid}.bin`,
  );
  const currentBytes = await readFile(pendingPath).catch(() => null);
  if (!currentBytes || !currentBytes.equals(observedBytes)) {
    return publishPendingQueueDiagnostic(options, Object.freeze({
      schemaVersion: 'stephanos.mission-worker-pending-quarantine.v1',
      adapter,
      pendingPath,
      quarantinePath,
      queueItemSha256: digest,
      reason: 'MISSION_WORKER_PENDING_QUARANTINE_IDENTITY_CHANGED',
      sourceReason,
    }));
  }
  try {
    await rename(pendingPath, quarantinePath);
  } catch (error) {
    return publishPendingQueueDiagnostic(options, Object.freeze({
      schemaVersion: 'stephanos.mission-worker-pending-quarantine.v1',
      adapter,
      pendingPath,
      quarantinePath,
      queueItemSha256: digest,
      reason: ['ENOENT', 'EEXIST'].includes(error?.code)
        ? 'MISSION_WORKER_PENDING_QUARANTINE_RACE'
        : 'MISSION_WORKER_PENDING_QUARANTINE_FAILED',
      sourceReason,
    }));
  }
  const quarantinedBytes = await readFile(quarantinePath).catch(() => null);
  return publishPendingQueueDiagnostic(options, Object.freeze({
    schemaVersion: 'stephanos.mission-worker-pending-quarantine.v1',
    adapter,
    pendingPath,
    quarantinePath,
    queueItemSha256: digest,
    reason: quarantinedBytes && quarantinedBytes.equals(observedBytes)
      ? 'MISSION_WORKER_PENDING_ITEM_QUARANTINED'
      : 'MISSION_WORKER_PENDING_QUARANTINE_IDENTITY_MISMATCH',
    sourceReason,
  }));
}

async function proveProcessingClaim(claim, options = {}) {
  const action = claim?.item?.payload;
  if (action?.actionKind !== 'agent-handoff') {
    return Object.freeze({ proven: true, state: 'NOT_AGENT_HANDOFF' });
  }

  const missionId = normalizedText(claim?.item?.missionId).toLowerCase();
  const adapter = normalizedText(claim?.adapter).toLowerCase();
  const record = await readMissionRecord(missionId, options);
  const status = normalizedText(record?.state?.dispatch?.status).toLowerCase();
  const currentAdapter = normalizedText(record?.state?.dispatch?.adapter).toLowerCase();

  // Backward compatibility for queue items published before this repair, where
  // publication itself incorrectly promoted dispatch to running.
  if (status === 'running') {
    if (currentAdapter !== adapter) {
      throw new Error('MISSION_WORKER_PROCESSING_CLAIM_ADAPTER_MISMATCH');
    }
    return Object.freeze({ proven: true, state: 'LEGACY_RUNNING_ALREADY_RECORDED' });
  }
  if (status !== 'pending') {
    throw new Error(`MISSION_WORKER_PROCESSING_CLAIM_STATE_INVALID:${status || 'unknown'}`);
  }

  const claimed = await appendMissionEvent(missionId, {
    eventId: `pickup-${normalizedText(claim?.item?.actionId)}`.slice(0, 128),
    eventType: 'AGENT_DISPATCHED',
    agentId: adapter,
    adapter,
    expectedRevision: record.state.revision,
    expectedCurrentPhase: record.state.currentPhase,
    summary: `${adapter} atomically claimed the durable worker queue item; pending-to-processing pickup is proven.`,
  }, options);

  if (claimed?.preconditionFailed === true) {
    throw new Error('MISSION_WORKER_PROCESSING_CLAIM_STATE_PRECONDITION_FAILED');
  }
  if (
    normalizedText(claimed?.state?.dispatch?.status).toLowerCase() !== 'running'
    || normalizedText(claimed?.state?.dispatch?.adapter).toLowerCase() !== adapter
  ) {
    throw new Error('MISSION_WORKER_PROCESSING_CLAIM_NOT_RECORDED');
  }
  return Object.freeze({ proven: true, state: 'PROCESSING_CLAIM_PROVEN' });
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
      const bytes = await readFile(pendingPath);
      let item;
      try {
        item = JSON.parse(bytes.toString('utf8'));
      } catch {
        await quarantinePendingQueueItem(
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
        await quarantinePendingQueueItem(
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
        await quarantinePendingQueueItem(
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
      await rename(pendingPath, processingPath);
      const claim = { adapter, item, processingPath, paths };
      try {
        claim.pickupProof = await proveProcessingClaim(claim, options);
      } catch (claimError) {
        // Do not strand an item in processing when mission-state pickup proof
        // cannot be recorded. Return ownership to pending so the canonical
        // conveyor can safely retry or route it on the next bounded sweep.
        await rename(processingPath, pendingPath).catch(() => {});
        await publishPendingQueueDiagnostic(options, Object.freeze({
          schemaVersion: 'stephanos.mission-worker-processing-claim.v1',
          adapter,
          missionId: normalizedText(item?.missionId).toLowerCase(),
          actionId: normalizedText(item?.actionId).toLowerCase(),
          reason: normalizedText(claimError?.message, 'MISSION_WORKER_PROCESSING_CLAIM_FAILED'),
        }));
        continue;
      }
      return claim;
    } catch (error) {
      if (['ENOENT', 'EEXIST'].includes(error?.code)) continue;
      throw error;
    }
  }
  return null;
}

export async function finalizeMissionWorkerQueueClaim(claim, result, success) {
  const targetRoot = success ? claim.paths.completed : claim.paths.failed;
  const fileName = basename(claim.processingPath);
  const resultPath = resolve(targetRoot, fileName.replace(/\.json$/, '.result.json'));
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(claim.processingPath, resolve(targetRoot, fileName));
  return resultPath;
}


export async function proveMissionWorkerRetryOwnershipReleased({
  missionId,
  actionId,
  adapter,
  queueRoot,
  sharedWorkspaceRoot,
  repoRoot,
  env = process.env,
  readReceiptHistory = readExecutionReceiptHistory,
} = {}) {
  const normalizedMissionId = normalizedText(missionId).toLowerCase();
  const normalizedActionId = normalizedText(actionId).toLowerCase();
  const normalizedAdapter = normalizedText(adapter).toLowerCase();
  if (!normalizedMissionId || !normalizedActionId || !normalizedAdapter) {
    return Object.freeze({ ok: false, classification: 'MISSION_WORKER_RETRY_IDENTITY_INCOMPLETE' });
  }

  const root = queueRoot || resolveMissionWorkerQueueRoot(env);
  if (!root) return Object.freeze({ ok: false, classification: 'MISSION_WORKER_RETRY_QUEUE_ROOT_REQUIRED' });
  const paths = queuePaths(root, normalizedAdapter);
  await ensurePaths(paths);
  const fileName = normalizedActionId + '.json';
  const processingPath = resolve(paths.processing, fileName);
  try {
    await readFile(processingPath);
    return Object.freeze({
      ok: false,
      classification: 'MISSION_WORKER_RETRY_PRIOR_CLAIM_STILL_PROCESSING',
      missionId: normalizedMissionId,
      actionId: normalizedActionId,
      adapter: normalizedAdapter,
    });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const terminalPath = resolve(paths.failed, fileName);
  const resultPath = resolve(paths.failed, fileName.replace(/\.json$/, '.result.json'));
  let item;
  let result;
  try {
    item = JSON.parse(await readFile(terminalPath, 'utf8'));
    result = JSON.parse(await readFile(resultPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return Object.freeze({
        ok: false,
        classification: 'MISSION_WORKER_RETRY_TERMINAL_QUEUE_PROOF_MISSING',
        missionId: normalizedMissionId,
        actionId: normalizedActionId,
        adapter: normalizedAdapter,
      });
    }
    throw error;
  }

  const identityValid = normalizedText(item?.missionId).toLowerCase() === normalizedMissionId
    && normalizedText(item?.actionId).toLowerCase() === normalizedActionId
    && normalizedText(item?.adapter).toLowerCase() === normalizedAdapter
    && normalizedText(result?.missionId).toLowerCase() === normalizedMissionId
    && normalizedText(result?.actionId).toLowerCase() === normalizedActionId
    && result?.success !== true;
  if (!identityValid) {
    return Object.freeze({
      ok: false,
      classification: 'MISSION_WORKER_RETRY_TERMINAL_QUEUE_IDENTITY_INVALID',
      missionId: normalizedMissionId,
      actionId: normalizedActionId,
      adapter: normalizedAdapter,
    });
  }

  if (!sharedWorkspaceRoot) {
    return Object.freeze({
      ok: false,
      classification: 'MISSION_WORKER_RETRY_EXECUTION_RECEIPT_ROOT_REQUIRED',
      missionId: normalizedMissionId,
      actionId: normalizedActionId,
      adapter: normalizedAdapter,
    });
  }
  const binding = item?.executionBinding || {};
  const receiptFilters = {
    executionId: normalizedActionId,
    leaseKey: normalizedText(binding.leaseKey),
  };
  const expectedHead = normalizedText(binding.headSha || binding.sourceRevision).toLowerCase();
  if (expectedHead) receiptFilters.expectedHead = expectedHead;
  const history = await readReceiptHistory(
    sharedWorkspaceRoot,
    receiptFilters,
    { repoRoot },
  );
  const terminalReceipt = history?.latestReceipt;
  const receiptTerminal = history?.ok === true
    && terminalReceipt
    && EXECUTION_RECEIPT_TERMINAL_STATES.includes(normalizedText(terminalReceipt.state).toLowerCase())
    && normalizedText(terminalReceipt.executionId).toLowerCase() === normalizedActionId
    && normalizedText(terminalReceipt.leaseKey) === normalizedText(binding.leaseKey);
  if (!receiptTerminal) {
    // Provider-neutral workers release ownership by atomically moving the
    // exact processing item into failed only after provider execution returns.
    // That immutable item+result pair is terminal release proof even if an
    // execution-receipt publication was unavailable. Other adapters remain
    // strictly bound to their terminal execution receipt.
    if (providerNeutralTerminalQueueReleaseProven(item, result, normalizedAdapter)) {
      return Object.freeze({
        ok: true,
        classification: 'MISSION_WORKER_RETRY_PROVIDER_NEUTRAL_QUEUE_RELEASE_PROVEN',
        missionId: normalizedMissionId,
        actionId: normalizedActionId,
        adapter: normalizedAdapter,
        terminalQueuePath: terminalPath,
        resultPath,
        executionReceiptId: '',
        executionReceiptState: 'provider-neutral-failed-queue',
      });
    }
    return Object.freeze({
      ok: false,
      classification: 'MISSION_WORKER_RETRY_TERMINAL_EXECUTION_RECEIPT_UNPROVEN',
      missionId: normalizedMissionId,
      actionId: normalizedActionId,
      adapter: normalizedAdapter,
      receiptReason: normalizedText(history?.reason),
    });
  }

  return Object.freeze({
    ok: true,
    classification: 'MISSION_WORKER_RETRY_OWNERSHIP_RELEASE_PROVEN',
    missionId: normalizedMissionId,
    actionId: normalizedActionId,
    adapter: normalizedAdapter,
    terminalQueuePath: terminalPath,
    resultPath,
    executionReceiptId: normalizedText(terminalReceipt.receiptId),
    executionReceiptState: normalizedText(terminalReceipt.state).toLowerCase(),
  });
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
  const outbox = execution.offlinePublicationOutbox;
  const escrow = execution.sourceArtifactEscrow;
  const outboxValid = outbox
    && outbox.schemaVersion === OFFLINE_PUBLICATION_OUTBOX_V1_SCHEMA
    && outbox.state === OFFLINE_PUBLICATION_OUTBOX_STATE
    && outbox.missionId === escrow.missionId
    && outbox.actionId === escrow.actionId
    && outbox.completeArtifactSha256 === escrow.completeArtifactSha256
    && outbox.artifactRef === escrow.artifactRef
    && outbox.preserveVerifiedArtifact === true
    && outbox.rebuildRequired === false
    && outbox.pushAuthority === false
    && outbox.mergeAuthority === false;
  if (!outboxValid) {
    const error = new Error('OFFLINE_PUBLICATION_OUTBOX_REQUIRED');
    error.code = 'OFFLINE_PUBLICATION_OUTBOX_REQUIRED';
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
  const resultPath = await finalizeMissionWorkerQueueClaim(claim, result, execution.success === true);
  return { processed: true, claim, event, applied, result, resultPath };
}

async function failClaim(claim, action, error) {
  const result = { schemaVersion: 'stephanos.mission-worker-consumption-result.v1', actionId: action.actionId, missionId: action.missionId, operation: action.operation, error: error?.message || 'unknown worker error', finalVerdict: 'MISSION_WORKER_ITEM_FAILED' };
  const resultPath = await finalizeMissionWorkerQueueClaim(claim, result, false);
  return { processed: true, claim, error, result, resultPath };
}

async function processAgentClaim(adapter, options, execute) {
  const claim = await claimNextMissionWorkerItem(adapter, options);
  if (!claim) return { processed: false, reason: 'queue-empty' };
  claim.options = options;
  const action = claim.item.payload;
  let executionReceipt = null;
  try {
    executionReceipt = await beginMissionWorkerExecutionReceiptChain(claim, options);
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
      sourceArtifactEscrow: execution.sourceArtifactEscrow,
      offlinePublicationOutbox: execution.offlinePublicationOutbox,
      receipt: execution.receipt,
      evidenceReceipts: execution.evidenceReceipts || [],
      error: execution.error || '',
    }, options);
    if (executionReceipt) {
      executionReceipt = await appendMissionWorkerExecutionReceiptTransition(
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
    const resultPath = await finalizeMissionWorkerQueueClaim(claim, result, execution.success === true);
    return { processed: true, claim, applied, result, resultPath, executionReceipt };
  } catch (error) {
    if (executionReceipt && !['completed', 'failed', 'cancelled'].includes(executionReceipt.state)) {
      try {
        executionReceipt = await appendMissionWorkerExecutionReceiptTransition(executionReceipt, 'failed', options, {
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

export async function processNextVerificationItem(options = {}) {
  const claim = await claimNextMissionWorkerItem('verification', options);
  if (!claim) return { processed: false, reason: 'queue-empty' };
  claim.options = options;
  const action = claim.item?.payload || {};
  try {
    if (action.actionKind !== 'evidence-judgment') {
      throw new Error('VERIFICATION_ACTION_KIND_INVALID');
    }
    const receipts = buildVerificationEvidenceReceipts(action, options.now instanceof Date ? options.now : new Date());
    if (!receipts.length) {
      const result = Object.freeze({
        schemaVersion: 'stephanos.mission-worker-consumption-result.v1',
        actionId: normalizedText(action.actionId),
        missionId: normalizedText(action.missionId),
        adapter: 'verification',
        evidenceReceiptCount: 0,
        finalVerdict: 'VERIFICATION_EVIDENCE_NOT_GROUNDED',
      });
      const resultPath = await finalizeMissionWorkerQueueClaim(claim, result, false);
      return { processed: true, claim, result, resultPath };
    }
    const applied = await appendMissionEvent(action.missionId, {
      eventId: ('verification-' + normalizedText(action.actionId)).slice(0, 128),
      eventType: 'EVIDENCE_RECORDED',
      receipts,
      summary: 'Verification Judge bound existing deterministic source and test proof to declared evidence requirements.',
    }, options);
    const result = Object.freeze({
      schemaVersion: 'stephanos.mission-worker-consumption-result.v1',
      actionId: normalizedText(action.actionId),
      missionId: normalizedText(action.missionId),
      adapter: 'verification',
      stateRevision: Number(applied?.state?.revision),
      currentPhase: normalizedText(applied?.state?.currentPhase),
      evidenceReceiptCount: receipts.length,
      finalVerdict: 'VERIFICATION_EVIDENCE_GROUNDED',
    });
    const resultPath = await finalizeMissionWorkerQueueClaim(claim, result, true);
    return { processed: true, claim, applied, result, resultPath };
  } catch (error) {
    return failClaim(claim, action, error);
  }
}

export async function processNextForgePublicationItem(options = {}) {
  if (typeof options.executeForgePublication !== 'function')
    throw new Error('Bounded Forge publication executor adapter required.');
  const claim = await claimNextMissionWorkerItem('forge-publication', options);
  if (!claim) return { processed: false, reason: 'queue-empty' };
  claim.options = options;
  const action = claim.item?.payload || {};
  if (action.actionKind !== 'forge-escrow-publication'
      || action.adapter !== 'forge-publication'
      || action.missionId !== claim.item.missionId
      || action.actionId !== claim.item.actionId
      || !claim.item.actionGrant
      || claim.item.actionGrant.actionId !== action.actionId) {
    return failClaim(claim, action, new Error('FORGE_PUBLICATION_QUEUE_GRANT_INVALID'));
  }
  let executionReceipt = null;
  try {
    executionReceipt = await beginMissionWorkerExecutionReceiptChain(claim, options);
    const publication = await options.executeForgePublication(action, claim);
    if (publication?.ok !== true
        || publication?.finalVerdict !== 'FORGE_PRE_PR_DRAFT_PUBLISHED_WITH_EXACT_TREE_PROOF'
        || publication?.mergeAuthority !== false || publication?.forcePushAllowed !== false
        || publication?.draft !== true
        || publication?.repository !== 'Cheekyfellastef/stephan-os'
        || normalizedText(action.repository).toLowerCase() !== 'cheekyfellastef/stephan-os'
        || publication?.branch !== action.branch
        || publication?.exactResultTree !== action.exactResultTree
        || publication?.sourceArtifactSha256 !== action.artifactSha256) {
      throw new Error(publication?.reason || 'FORGE_PUBLICATION_EXACT_RESULT_INVALID');
    }
    const now = options.now instanceof Date ? options.now.toISOString() : new Date().toISOString();
    const receipt = {
      receiptId: 'forge-publication-' + action.actionId,
      requirement: action.receiptRequirement,
      source: 'forge-signed-github-publication',
      evidenceType: 'signed-exact-tree-publication',
      verified: true,
      commandOutputHash: createHash('sha256').update(JSON.stringify(publication)).digest('hex'),
      createdAt: now,
    };
    const event = {
      eventId: 'forge-published-' + action.actionId, missionId: action.missionId,
      eventType: 'FORGE_ESCROW_DRAFT_PUBLISHED', timestamp: now, publication, receipt,
      prUrl: 'https://github.com/Cheekyfellastef/stephan-os/pull/' + publication.prNumber,
      summary: 'Signed exact-tree Forge draft PR publication completed.',
    };
    const applied = await appendMissionEvent(action.missionId, event, options);
    if (applied?.state?.pullRequest?.number !== publication.prNumber
        || applied?.state?.pullRequest?.headSha !== publication.commitSha) {
      throw new Error('FORGE_PUBLICATION_MISSION_RECEIPT_UNPROVEN');
    }
    if (executionReceipt) await appendMissionWorkerExecutionReceiptTransition(executionReceipt, 'completed', options, {
      phase: 'forge-draft-pr-published',
      proofRefs: [receipt.receiptId],
      expectedNextAction: 'Require independent PR checks and operator merge approval.',
    });
    const result = {
      schemaVersion: 'stephanos.mission-worker-consumption-result.v1',
      missionId: action.missionId, actionId: action.actionId, adapter: 'forge-publication',
      prNumber: publication.prNumber, commitSha: publication.commitSha,
      finalVerdict: 'MISSION_WORKER_ITEM_COMPLETE',
    };
    const resultPath = await finalizeMissionWorkerQueueClaim(claim, result, true);
    return { processed: true, claim, applied, result, resultPath };
  } catch (error) {
    if (executionReceipt) {
      try { await appendMissionWorkerExecutionReceiptTransition(executionReceipt, 'failed', options, {
        phase: 'forge-publication-blocked', blocker: String(error?.message || error),
        expectedNextAction: 'Preserve escrow and reconcile remote branch/PR before retry.',
      }); } catch {}
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

export async function processNextStephanosNativeItem(options = {}) {
  if (typeof options.executeStephanosNativeAction !== 'function') throw new Error('Stephanos-native execution adapter is required.');
  return processAgentClaim('stephanos-native', options, options.executeStephanosNativeAction);
}

export async function processNextOpenClawStandaloneItem(options = {}) {
  if (typeof options.executeOpenClawStandaloneAction !== 'function') throw new Error('OpenClaw Standalone execution adapter is required.');
  return processAgentClaim('openclaw-standalone', options, options.executeOpenClawStandaloneAction);
}

export async function processNextOpenClawLocalItem(options = {}) {
  if (typeof options.executeOpenClawLocalAction !== 'function') throw new Error('OpenClaw Local execution adapter is required.');
  return processAgentClaim('openclaw-local', options, options.executeOpenClawLocalAction);
}

export async function processNextOpenClawReadonlyItem(options = {}) {
  if (typeof options.executeOpenClawReadonlyAction !== 'function') throw new Error('OpenClaw read-only execution adapter is required.');
  return processAgentClaim('openclaw-readonly', options, options.executeOpenClawReadonlyAction);
}
