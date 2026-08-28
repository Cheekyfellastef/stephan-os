import { createHash } from 'node:crypto';
import { readFile, mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  buildMissionWorkerAction,
  createMissionWorkerActionId,
  issueMissionWorkerAuthorization,
  projectMissionWorkerActionState,
} from '../../shared/agents/missionOrchestratorWorker.mjs';
import {
  appendMissionEvent,
  listMissionRecords,
  readMissionRecord,
  resolveMissionOrchestratorRoot,
  runWithMissionStatePrecondition,
} from './missionOrchestratorStore.js';
import {
  createSharedWorkspaceHandoffRecord,
  isSharedWorkspaceParticipantId,
  writeAtomicJson,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  appendExecutionReceipt,
  createExecutionReceipt,
  readCurrentExecutionReceipt,
} from '../../shared/agents/executionReceiptV1.mjs';
import {
  claimSourceMutationLease,
  releaseSourceMutationLease,
} from './programmeAuthorityService.js';

const SOURCE_EXECUTION_BINDING_SCHEMA = 'stephanos.source-build-execution-binding.v1';
const SOURCE_MUTATION_ADAPTERS = new Set(['codex', 'openclaw-local', 'chatgpt-github', 'foundry-forge']);
const EXECUTION_RECEIPT_PROOF_REFS = Object.freeze(['receipts/execution-receipts.jsonl']);

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
  if (action.actionKind === 'agent-handoff' && ['codex', 'openclaw-local', 'openclaw-readonly', 'chatgpt-github', 'foundry-forge'].includes(action.adapter)) return action.adapter;
  if (action.actionKind === 'local-deployment') return 'openclaw-local-deployment';
  if (action.actionKind === 'evidence-judgment') return 'verification';
  return '';
}

function positiveInteger(value) {
  const normalized = typeof value === 'string'
    ? Number(value.replace(/^#/, ''))
    : Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function encodedMissionIdentity(value) {
  const normalized = text(value).toLowerCase();
  const goalLane = /^goal-([1-9]\d*)-pr-([1-9]\d*)(?:$|[-_.])/.exec(normalized);
  if (goalLane) {
    return {
      issueNumber: positiveInteger(goalLane[1]),
      prNumber: positiveInteger(goalLane[2]),
    };
  }
  const criticalGoal = /^critical-([1-9]\d*)(?:$|[-_.])/.exec(normalized);
  return {
    issueNumber: positiveInteger(criticalGoal?.[1]),
    prNumber: null,
  };
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
    claimSourceMutationLease: overrides.claimSourceMutationLease ?? claimSourceMutationLease,
    releaseSourceMutationLease: overrides.releaseSourceMutationLease ?? releaseSourceMutationLease,
    appendExecutionReceipt: overrides.appendExecutionReceipt ?? appendExecutionReceipt,
    readCurrentExecutionReceipt: overrides.readCurrentExecutionReceipt ?? readCurrentExecutionReceipt,
  };
}

function sourceWorkerType(adapter) {
  return ({
    codex: 'remote-codex',
    'openclaw-local': 'openclaw',
    'chatgpt-github': 'github-first',
    'foundry-forge': 'orchestration-engine',
  })[adapter] || '';
}

function compactId(prefix, values = []) {
  const digest = createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 24);
  return `${prefix}-${digest}`;
}

function executionWorkerId(value) {
  const normalized = text(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+/, '').slice(0, 80);
  return /^[a-z0-9]/.test(normalized) ? normalized : compactId('worker', [value]);
}

function nowUtc(options = {}, afterUtc = '') {
  const requested = options.now instanceof Date ? options.now : new Date();
  let timestamp = Number.isFinite(requested.getTime()) ? requested.getTime() : Date.now();
  const after = Date.parse(text(afterUtc));
  if (Number.isFinite(after) && timestamp <= after) timestamp = after + 1;
  return new Date(timestamp).toISOString();
}

function exactPrSourceGrant(action, grant, adapter) {
  return Boolean(
    action?.actionKind === 'agent-handoff'
    && SOURCE_MUTATION_ADAPTERS.has(adapter)
    && grant?.schemaVersion === 'stephanos.mission-worker-action-grant.v1'
    && text(grant.controllerId) === 'durable-flywheel-controller'
    && text(grant.laneId)
    && text(grant.repository)
    && positiveInteger(grant.issueNumber)
    && positiveInteger(grant.prNumber)
    && text(grant.branch)
    && /^[0-9a-f]{40}$/.test(text(grant.headSha).toLowerCase())
    && text(grant.workerId) === text(action.workerId)
  );
}

function exactClaimBinding(record, expected) {
  return Boolean(
    record
    && text(record.leaseId) === expected.leaseId
    && text(record.laneId) === expected.laneId
    && text(record.repository) === expected.repository
    && positiveInteger(record.issueNumber) === expected.issueNumber
    && positiveInteger(record.prNumber) === expected.prNumber
    && text(record.branch) === expected.branch
    && text(record.headSha).toLowerCase() === expected.headSha
    && text(record.ownerId) === expected.ownerId
  );
}

function createSourceExecutionBinding(action, grant, lease) {
  const executionId = compactId('source-exec', [
    grant.laneId,
    action.actionId,
    grant.repository,
    grant.prNumber,
    grant.headSha,
  ]);
  return Object.freeze({
    schemaVersion: SOURCE_EXECUTION_BINDING_SCHEMA,
    leaseId: lease.leaseId,
    laneId: lease.laneId,
    repository: lease.repository,
    issueNumber: lease.issueNumber,
    prNumber: lease.prNumber,
    branch: lease.branch,
    headSha: lease.headSha,
    ownerId: lease.ownerId,
    executionId,
    receiptWorkerId: executionWorkerId(action.workerId),
    workerType: sourceWorkerType(action.adapter),
    actionId: action.actionId,
    missionId: action.missionId,
    adapter: action.adapter,
    actionWorkerId: action.workerId,
    queuedReceiptId: `${executionId}-queued`,
    releaseOnlyExactLease: true,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  });
}

function createSourceExecutionReceipt(binding, state, previous = null, options = {}) {
  const sequence = previous ? previous.sequence + 1 : 1;
  return createExecutionReceipt({
    receiptId: sequence === 1 ? binding.queuedReceiptId : `${binding.executionId}-${state}-${sequence}`,
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
    sequence,
    predecessorReceiptId: previous?.receiptId || '',
    timestampUtc: nowUtc(options, previous?.timestampUtc),
    blocker: state === 'failed' ? text(options.blocker, 'source execution failed before worker claim') : '',
    operatorActionRequired: false,
    proofRefs: EXECUTION_RECEIPT_PROOF_REFS,
    expectedNextAction: ['completed', 'failed', 'cancelled'].includes(state)
      ? ''
      : text(options.expectedNextAction, 'advance exact source execution'),
  });
}

async function releaseExactSourceExecution(binding, options = {}, afterUtc = '') {
  const deps = sourceExecutionDependencies(options);
  const root = sourceWorkspaceRoot(options);
  return deps.releaseSourceMutationLease({
    leaseId: binding.leaseId,
    laneId: binding.laneId,
    repository: binding.repository,
    issueNumber: binding.issueNumber,
    prNumber: binding.prNumber,
    branch: binding.branch,
    headSha: binding.headSha,
    ownerId: binding.ownerId,
    nowUtc: nowUtc(options, afterUtc),
  }, {
    root,
    repoRoot: options.repoRoot,
    env: options.env || process.env,
  });
}

async function terminalizeFailedSourceExecution(binding, reason, options = {}) {
  if (!binding) return { ok: true, terminalized: false, released: false, reason: 'SOURCE_EXECUTION_NOT_APPLICABLE' };
  const deps = sourceExecutionDependencies(options);
  const root = sourceWorkspaceRoot(options);
  const current = await deps.readCurrentExecutionReceipt(root, {
    executionId: binding.executionId,
    leaseKey: binding.leaseId,
    expectedHead: binding.headSha,
  }, { repoRoot: options.repoRoot });
  if (!current?.ok || !current.receipt) {
    return { ok: false, terminalized: false, released: false, reason: `SOURCE_EXECUTION_RECEIPT_READ_FAILED:${text(current?.reason, 'missing-current-receipt')}`, current };
  }
  let receipt = current.receipt;
  if (!['completed', 'failed', 'cancelled'].includes(receipt.state)) {
    const failed = createSourceExecutionReceipt(binding, 'failed', receipt, {
      ...options,
      phase: 'queue-publication-failed',
      blocker: reason,
    });
    const append = await deps.appendExecutionReceipt(root, failed, { repoRoot: options.repoRoot });
    if (!append?.ok) {
      return { ok: false, terminalized: false, released: false, reason: `SOURCE_EXECUTION_TERMINAL_RECEIPT_FAILED:${text(append?.reason)}`, append };
    }
    receipt = failed;
  }
  const release = await releaseExactSourceExecution(binding, options, receipt.timestampUtc);
  return {
    ok: release?.ok === true,
    terminalized: true,
    released: release?.ok === true,
    reason: release?.ok === true ? 'SOURCE_EXECUTION_FAILED_AND_RELEASED' : `SOURCE_EXECUTION_RELEASE_FAILED:${text(release?.reason)}`,
    receipt,
    release,
  };
}

async function prepareSourceExecution(action, grant, adapter, options = {}) {
  if (!exactPrSourceGrant(action, grant, adapter)) {
    return { ok: true, binding: null, queuedReceipt: null, claim: null };
  }
  const root = sourceWorkspaceRoot(options);
  if (!root) return { ok: false, reason: 'SOURCE_EXECUTION_SHARED_WORKSPACE_ROOT_MISSING', binding: null };
  const deps = sourceExecutionDependencies(options);
  const leaseId = compactId('source-lease', [grant.laneId, action.actionId, grant.repository, grant.prNumber, grant.headSha]);
  const expected = {
    leaseId,
    laneId: text(grant.laneId),
    repository: text(grant.repository),
    issueNumber: positiveInteger(grant.issueNumber),
    prNumber: positiveInteger(grant.prNumber),
    branch: text(grant.branch),
    headSha: text(grant.headSha).toLowerCase(),
    ownerId: text(action.workerId),
  };
  const claim = await deps.claimSourceMutationLease({
    ...expected,
    nowUtc: nowUtc(options),
    proofRefs: EXECUTION_RECEIPT_PROOF_REFS,
  }, {
    root,
    repoRoot: options.repoRoot,
    env: options.env || process.env,
  });
  if (claim?.ok !== true || !exactClaimBinding(claim.record, expected)) {
    return {
      ok: false,
      reason: claim?.ok === true ? 'SOURCE_MUTATION_LEASE_CLAIM_BINDING_MISMATCH' : `SOURCE_MUTATION_LEASE_CLAIM_FAILED:${text(claim?.reason)}`,
      claim,
      binding: null,
    };
  }
  const binding = createSourceExecutionBinding(action, grant, claim.record);
  const queuedReceipt = createSourceExecutionReceipt(binding, 'queued', null, {
    ...options,
    phase: 'source-dispatch-queued',
    expectedNextAction: 'Mission Worker claims the exact queued source action.',
  });
  const append = await deps.appendExecutionReceipt(root, queuedReceipt, { repoRoot: options.repoRoot });
  if (append?.ok !== true) {
    const release = await releaseExactSourceExecution(binding, options, queuedReceipt.timestampUtc);
    return {
      ok: false,
      reason: `SOURCE_EXECUTION_QUEUED_RECEIPT_FAILED:${text(append?.reason)}`,
      claim,
      append,
      release,
      binding: null,
    };
  }
  return { ok: true, binding, queuedReceipt, claim, append };
}

async function exactExistingQueueItem(path, expected) {
  try {
    const item = JSON.parse(await readFile(path, 'utf8'));
    return Boolean(
      item?.schemaVersion === 'stephanos.mission-worker-queue-item.v1'
      && text(item.adapter) === expected.adapter
      && text(item.actionId) === expected.actionId
      && text(item.missionId) === expected.missionId
      && JSON.stringify(item.sourceExecution || null) === JSON.stringify(expected.sourceExecution || null)
    );
  } catch {
    return false;
  }
}

async function publishExternalLaneHandoff(state, action, options = {}) {
  const root = options.sharedWorkspaceRoot
    || options.env?.STEPHANOS_SHARED_AGENT_WORKSPACE
    || process.env.STEPHANOS_SHARED_AGENT_WORKSPACE;
  const identity = encodedMissionIdentity(state.missionId);
  const proofRefs = Array.isArray(action.capacityProofRefs) ? action.capacityProofRefs : [];
  const workerId = text(action.workerId);
  if (!isSharedWorkspaceParticipantId(workerId)) {
    return { ok: false, reason: 'WORKER_ID_NOT_SHARED_WORKSPACE_REPRESENTABLE', path: '' };
  }
  const handoff = createSharedWorkspaceHandoffRecord({
    handoffId: action.actionId,
    participantId: 'mission-orchestrator',
    fromParticipantId: 'mission-orchestrator',
    toParticipantId: workerId,
    timestampUtc: options.now instanceof Date ? options.now.toISOString() : new Date().toISOString(),
    correlationId: state.missionId,
    relatedIssue: `#${identity.issueNumber || 1292}`,
    relatedPr: identity.prNumber ? `#${identity.prNumber}` : '',
    proofRefs,
    summary: `${action.adapter} is the exact capacity-proven source construction owner for ${state.missionId}.`,
    body: JSON.stringify({
      schemaVersion: 'stephanos.external-build-lane-handoff.v1',
      missionId: state.missionId,
      actionId: action.actionId,
      adapter: action.adapter,
      workerId: action.workerId,
      capacityRoute: action.capacityRoute,
      capacityReceiptId: action.capacityReceiptId,
      repository: state.repository,
      branch: state.git?.branch || '',
      allowedFiles: action.allowedFiles || [],
      requiredTests: action.requiredTests || [],
      requiredEvidence: action.requiredEvidence || [],
      mergeAuthority: false,
      leaseSeizureAllowed: false,
    }),
  });
  if (handoff.toParticipantId !== workerId) {
    return { ok: false, reason: 'SHARED_WORKSPACE_HANDOFF_RECIPIENT_MISMATCH', path: '' };
  }
  return writeAtomicJson(root, ['outbox', `${action.actionId}.json`], handoff, {
    repoRoot: options.repoRoot,
    nowMs: Date.parse(handoff.timestampUtc),
  });
}

function validateExecutionTargetBindings(state, action, grant) {
  const errors = [];
  const repository = text(grant?.repository).toLowerCase();
  const branch = text(grant?.branch);
  const stateRepository = text(state?.repository).toLowerCase();
  const stateBranch = text(state?.git?.branch || state?.branch);
  const actionRepository = text(
    action?.repository || action?.claims?.repository,
  ).toLowerCase();
  const actionBranch = text(action?.branch || action?.claims?.branch);
  if (!repository) errors.push('action-grant-repository-missing');
  else {
    if (stateRepository !== repository) errors.push('action-grant-repository-mismatch');
    if (actionRepository && actionRepository !== repository) {
      errors.push('action-grant-action-repository-mismatch');
    }
  }
  if (!branch) errors.push('action-grant-branch-missing');
  else {
    if (stateBranch !== branch) errors.push('action-grant-branch-mismatch');
    if (actionBranch && actionBranch !== branch) {
      errors.push('action-grant-action-branch-mismatch');
    }
  }

  const missionIdentity = encodedMissionIdentity(state?.missionId);
  const laneIdentity = encodedMissionIdentity(grant?.laneId);
  const laneId = text(grant?.laneId).toLowerCase();
  const stateMissionId = text(state?.missionId).toLowerCase();
  const issueNumber = positiveInteger(grant?.issueNumber);
  const prNumber = positiveInteger(grant?.prNumber);
  const headSha = text(grant?.headSha).toLowerCase();
  const statePrNumber = positiveInteger(
    state?.pullRequest?.number
      ?? state?.prNumber
      ?? state?.relatedPr
      ?? missionIdentity.prNumber,
  );
  const actionPrNumber = positiveInteger(
    action?.prNumber ?? action?.claims?.prNumber,
  );
  const hasPrTarget = Boolean(statePrNumber || actionPrNumber);
  if (hasPrTarget) {
    if (!laneId) errors.push('action-grant-lane-binding-missing');
    if (!issueNumber) errors.push('action-grant-issue-binding-missing');
    if (!prNumber) errors.push('action-grant-pr-binding-missing');
    if (!headSha) errors.push('action-grant-head-binding-missing');
  }
  if (laneId && laneId !== stateMissionId) {
    errors.push('action-grant-lane-mismatch');
  }
  if (issueNumber) {
    const stateIssueNumber = positiveInteger(
      state?.issueNumber
        ?? state?.relatedIssue
        ?? missionIdentity.issueNumber,
    );
    if (!stateIssueNumber) errors.push('action-grant-issue-binding-unproven');
    else if (stateIssueNumber !== issueNumber) errors.push('action-grant-issue-mismatch');
    if (laneIdentity.issueNumber && laneIdentity.issueNumber !== issueNumber) {
      errors.push('action-grant-lane-issue-mismatch');
    }
  }

  if (prNumber) {
    if (!statePrNumber) errors.push('action-grant-pr-binding-unproven');
    else if (statePrNumber !== prNumber) errors.push('action-grant-pr-mismatch');
    if (actionPrNumber && actionPrNumber !== prNumber) {
      errors.push('action-grant-action-pr-mismatch');
    }
    if (laneIdentity.prNumber && laneIdentity.prNumber !== prNumber) {
      errors.push('action-grant-lane-pr-mismatch');
    }
  }

  if (headSha) {
    const stateHeadSha = text(state?.pullRequest?.headSha).toLowerCase();
    const actionHeadSha = text(
      action?.expectedHeadSha || action?.claims?.expectedHeadSha,
    ).toLowerCase();
    if (stateHeadSha !== headSha) errors.push('action-grant-head-mismatch');
    if (actionHeadSha && actionHeadSha !== headSha) {
      errors.push('action-grant-action-head-mismatch');
    }
  }
  return errors;
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
  const agentHandoff = action?.actionKind === 'agent-handoff';
  const capacityScoped = agentHandoff && ['codex', 'openclaw-local', 'chatgpt-github', 'foundry-forge'].includes(action?.adapter);
  if (capacityScoped) {
    if (text(grant?.capacityRoute) !== text(action?.capacityRoute)) {
      errors.push('action-grant-capacity-route-mismatch');
    }
    if (text(grant?.capacityReceiptId) !== text(action?.capacityReceiptId)) {
      errors.push('action-grant-capacity-receipt-mismatch');
    }
    if (JSON.stringify(grant?.capacityProofRefs || []) !== JSON.stringify(action?.capacityProofRefs || [])) {
      errors.push('action-grant-capacity-proof-mismatch');
    }
  }
  if (agentHandoff && (!text(action?.workerId) || text(grant?.workerId) !== text(action?.workerId))) {
    errors.push('action-grant-worker-mismatch');
  }
  if (grant?.mergeAuthority !== false || grant?.leaseSeizureAllowed !== false) {
    errors.push('action-grant-authority-expanded');
  }
  errors.push(...validateExecutionTargetBindings(state, action, grant));
  return { valid: errors.length === 0, errors };
}

async function beginRepairIfRequired(state, options) {
  if (state.currentPhase !== 'REPAIR_REQUIRED') return { state, repairStarted: false };
  const round = Number.isInteger(state.repair?.currentRound) ? state.repair.currentRound + 1 : 1;
  const started = await appendMissionEvent(state.missionId, {
    eventId: `repair-${state.missionId}-round-${round}`.slice(0, 128),
    eventType: 'REPAIR_STARTED',
    expectedRevision: state.revision,
    expectedCurrentPhase: 'REPAIR_REQUIRED',
    summary: `Bounded source repair round ${round} started after required check failure.`,
  }, options);
  return {
    state: started.state,
    repairStarted: started.preconditionFailed !== true,
    preconditionFailed: started.preconditionFailed === true,
    reason: started.reason || '',
  };
}

async function publishLockedMissionWorkerAction(state, options = {}) {
  const action = buildMissionWorkerAction(state, options);
  if (action.executable !== true) {
    return {
      published: false,
      reason: action.reason || action.finalVerdict,
      action,
      path: '',
    };
  }
  if (options.actionGrant) {
    const validation = validateExactActionGrant(
      state,
      action,
      options.actionGrant,
      options,
    );
    if (!validation.valid) {
      return {
        published: false,
        reason: 'locked-action-grant-mismatch',
        blockers: validation.errors,
        action,
        path: '',
      };
    }
  }
  const adapter = adapterForAction(action);
  if (!adapter) {
    return {
      published: false,
      reason: 'unsupported-worker-adapter',
      action,
      path: '',
    };
  }
  if (['openclaw-local', 'chatgpt-github', 'foundry-forge'].includes(adapter)
      && !isSharedWorkspaceParticipantId(action.workerId)) {
    return {
      published: false,
      reason: 'worker-id-not-shared-workspace-representable',
      action,
      path: '',
      adapter,
    };
  }
  const root = options.queueRoot || resolveMissionWorkerQueueRoot(options.env || process.env);
  if (!root) throw new Error('Mission worker queue directory is not configured.');
  const paths = queuePaths(root, adapter);
  await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })));
  let payload = action;
  if (action.actionKind === 'signed-openclaw-operation') {
    if (!options.privateKeyPem && !options.privateKeyPath) {
      throw new Error('Mission worker authorization private key is not configured.');
    }
    const privateKeyPem = options.privateKeyPem || await readFile(options.privateKeyPath, 'utf8');
    payload = issueMissionWorkerAuthorization(action, privateKeyPem, options);
    if (payload.finalVerdict !== 'MISSION_WORKER_REQUEST_ISSUED') {
      return {
        published: false,
        reason: payload.finalVerdict,
        action,
        payload,
        path: '',
      };
    }
  }

  const sourcePreparation = await prepareSourceExecution(action, options.actionGrant, adapter, options);
  if (sourcePreparation.ok !== true) {
    return {
      published: false,
      reason: sourcePreparation.reason,
      action,
      payload,
      path: '',
      adapter,
      sourceExecutionPreparation: sourcePreparation,
    };
  }
  const sourceExecution = sourcePreparation.binding;
  const path = resolve(paths.pending, `${action.actionId}.json`);
  const queueItem = {
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter,
    actionId: action.actionId,
    missionId: state.missionId,
    createdAt: options.now instanceof Date ? options.now.toISOString() : new Date().toISOString(),
    ...(sourceExecution ? { sourceExecution } : {}),
    payload,
  };
  let published;
  try {
    published = await createImmutableJson(path, queueItem);
  } catch (error) {
    const cleanup = sourceExecution
      ? await terminalizeFailedSourceExecution(sourceExecution, `queue-write:${error?.code || error?.message || 'failed'}`, options)
      : null;
    return {
      published: false,
      reason: 'worker-queue-publication-failed',
      action,
      payload,
      path: '',
      adapter,
      sourceExecution,
      sourceExecutionCleanup: cleanup,
    };
  }
  if (!published) {
    const exactExisting = await exactExistingQueueItem(path, queueItem);
    if (sourceExecution && !exactExisting) {
      const cleanup = await terminalizeFailedSourceExecution(sourceExecution, 'conflicting-worker-queue-item', options);
      return {
        published: false,
        reason: 'source-action-queue-conflict',
        action,
        path: '',
        adapter,
        sourceExecution,
        sourceExecutionCleanup: cleanup,
      };
    }
    if (['openclaw-local', 'chatgpt-github', 'foundry-forge'].includes(adapter)) {
      const fabricPublication = await publishExternalLaneHandoff(state, action, options);
      if (fabricPublication?.ok !== true) {
        const removed = await unlink(path).then(() => true).catch(() => false);
        const cleanup = sourceExecution && removed
          ? await terminalizeFailedSourceExecution(sourceExecution, `shared-workspace-handoff:${text(fabricPublication?.reason, 'publication-failed')}`, options)
          : null;
        return {
          published: false,
          reason: `shared-workspace-handoff:${text(fabricPublication?.reason, 'publication-failed')}`,
          action,
          path: '',
          adapter,
          fabricPublication,
          sourceExecution,
          sourceExecutionCleanup: cleanup,
        };
      }
      return {
        published: true,
        reason: 'external-action-publication-reconciled',
        action,
        payload,
        path,
        adapter,
        fabricPublication,
        queueItemReused: true,
        sourceExecution,
      };
    }
    if (sourceExecution && exactExisting) {
      return {
        published: true,
        reason: 'source-action-publication-reconciled',
        action,
        payload,
        path,
        adapter,
        fabricPublication: null,
        queueItemReused: true,
        sourceExecution,
      };
    }
    return {
      published: false,
      reason: 'action-already-published',
      action,
      path,
    };
  }
  let fabricPublication = null;
  if (['openclaw-local', 'chatgpt-github', 'foundry-forge'].includes(adapter)) {
    fabricPublication = await publishExternalLaneHandoff(state, action, options);
    if (fabricPublication?.ok !== true) {
      const removed = await unlink(path).then(() => true).catch(() => false);
      const cleanup = sourceExecution && removed
        ? await terminalizeFailedSourceExecution(sourceExecution, `shared-workspace-handoff:${text(fabricPublication?.reason, 'publication-failed')}`, options)
        : null;
      return {
        published: false,
        reason: `shared-workspace-handoff:${text(fabricPublication?.reason, 'publication-failed')}`,
        action,
        path: '',
        adapter,
        fabricPublication,
        sourceExecution,
        sourceExecutionCleanup: cleanup,
      };
    }
  }
  return {
    published: true,
    reason: '',
    action,
    payload,
    path,
    adapter,
    fabricPublication,
    sourceExecution,
  };
}

export async function publishMissionWorkerAction(inputState, options = {}) {
  if (inputState.dispatch?.status === 'running' && ['AGENT_IMPLEMENTATION', 'REPAIR_REQUIRED', 'LIVE_RUNTIME_INVESTIGATION'].includes(inputState.currentPhase)) return { published: false, reason: 'agent-already-running', action: null, path: '' };
  const prepared = await beginRepairIfRequired(inputState, options);
  if (prepared.preconditionFailed) {
    return {
      published: false,
      reason: 'repair-transition-precondition-failed',
      blockers: [prepared.reason || 'mission-state-precondition-failed'],
      action: null,
      path: '',
      repairStarted: false,
    };
  }
  const state = prepared.state;
  const locked = await runWithMissionStatePrecondition(
    state.missionId,
    {
      expectedRevision: state.revision,
      expectedCurrentPhase: state.currentPhase,
    },
    (current) => publishLockedMissionWorkerAction(current, options),
    options,
  );
  if (locked.preconditionFailed) {
    return {
      published: false,
      reason: 'mission-state-precondition-failed',
      blockers: [locked.reason],
      action: null,
      path: '',
      repairStarted: prepared.repairStarted,
    };
  }
  const result = {
    ...locked.result,
    repairStarted: prepared.repairStarted,
  };
  if (result.published && result.action.actionKind === 'agent-handoff') {
    const action = result.action;
    try {
      await appendMissionEvent(state.missionId, {
        eventId: `dispatch-${action.actionId}`.slice(0, 128),
        eventType: 'AGENT_DISPATCHED',
        agentId: action.adapter === 'openclaw-readonly' ? 'openclaw-readonly' : action.adapter,
        adapter: action.adapter,
        actionId: action.actionId,
        workerId: action.workerId,
        summary: `${action.adapter} handoff published to the durable worker queue.`,
      }, options);
    } catch (error) {
      if (!result.sourceExecution) throw error;
      const removed = await unlink(result.path).then(() => true).catch(() => false);
      const cleanup = removed
        ? await terminalizeFailedSourceExecution(result.sourceExecution, `agent-dispatched-event:${error?.message || 'failed'}`, options)
        : null;
      return {
        ...result,
        published: false,
        reason: removed ? 'agent-dispatched-event-failed' : 'agent-dispatched-event-failed-queue-ownership-uncertain',
        path: '',
        sourceExecutionCleanup: cleanup,
      };
    }
  }
  return result;
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
    let actionState = state;
    let repairStarted = false;
    if (grant) {
      const projectedState = projectMissionWorkerActionState(state, options);
      const preview = buildMissionWorkerAction(projectedState, options);
      const validation = validateExactActionGrant(projectedState, preview, grant, options);
      if (!validation.valid) {
        return {
          published: false,
          reason: 'action-grant-mismatch',
          blockers: validation.errors,
          action: preview,
          path: '',
        };
      }
      if (state.currentPhase === 'REPAIR_REQUIRED') {
        const preparedRepair = await beginRepairIfRequired(state, options);
        if (preparedRepair.preconditionFailed) {
          return {
            published: false,
            reason: 'repair-transition-precondition-failed',
            blockers: [preparedRepair.reason || 'mission-state-precondition-failed'],
            action: preview,
            path: '',
            repairStarted: false,
          };
        }
        actionState = preparedRepair.state;
        repairStarted = preparedRepair.repairStarted;
        const actualAction = buildMissionWorkerAction(actionState, options);
        const actualValidation = validateExactActionGrant(
          actionState,
          actualAction,
          grant,
          options,
        );
        if (!actualValidation.valid) {
          return {
            published: false,
            reason: 'post-repair-action-grant-mismatch',
            blockers: actualValidation.errors,
            action: actualAction,
            path: '',
            repairStarted,
          };
        }
      }
    }
    const result = await publishMissionWorkerAction(actionState, options);
    if (result.published || grant) {
      return {
        ...result,
        repairStarted: repairStarted || result.repairStarted,
        actionGrantAccepted: Boolean(grant),
      };
    }
  }
  return { published: false, reason: 'no-runnable-mission', action: null, path: '' };
}

export async function readMissionWorkerQueue(options = {}) {
  const root = options.queueRoot || resolveMissionWorkerQueueRoot(options.env || process.env);
  if (!root) return [];
  const adapters = ['openclaw-signed', 'openclaw-github-readonly', 'codex', 'openclaw-local', 'chatgpt-github', 'foundry-forge', 'openclaw-readonly', 'openclaw-local-deployment', 'verification'];
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

async function readLegacyDispatchQueueBinding(state, actionId, options = {}) {
  const adapter = text(state?.dispatch?.adapter).toLowerCase();
  const missionId = text(state?.missionId).toLowerCase();
  const root = options.queueRoot || resolveMissionWorkerQueueRoot(options.env || process.env);
  if (!root) throw new Error('Mission worker queue directory is not configured.');
  const paths = queuePaths(root, adapter);
  const candidates = [];
  for (const stage of ['pending', 'processing']) {
    const path = resolve(paths[stage], `${actionId}.json`);
    try {
      const item = JSON.parse(await readFile(path, 'utf8'));
      const payload = item?.payload;
      const workerId = text(payload?.workerId || payload?.owner);
      if (
        item?.schemaVersion === 'stephanos.mission-worker-queue-item.v1'
        && text(item.adapter).toLowerCase() === adapter
        && text(item.missionId).toLowerCase() === missionId
        && text(item.actionId).toLowerCase() === actionId
        && text(payload?.missionId).toLowerCase() === missionId
        && text(payload?.actionId).toLowerCase() === actionId
        && text(payload?.adapter).toLowerCase() === adapter
        && payload?.actionKind === 'agent-handoff'
        && workerId
      ) candidates.push({ actionId, workerId });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error('Legacy dispatch queue binding could not be verified.');
    }
  }
  if (candidates.length !== 1) throw new Error('Legacy dispatch requires one exact durable queue binding.');
  return candidates[0];
}

async function reconcileLegacyRunningDispatch(state, result, options = {}) {
  const storedActionId = text(state?.dispatch?.actionId).toLowerCase();
  const storedWorkerId = text(state?.dispatch?.workerId);
  if (storedActionId && storedWorkerId) return state;
  if (storedActionId || storedWorkerId) throw new Error('Active dispatch binding is incomplete.');
  if (!Number.isSafeInteger(state?.revision) || state.revision < 1) {
    throw new Error('Legacy dispatch revision cannot be reconciled.');
  }
  const adapter = text(state.dispatch?.adapter).toLowerCase();
  const expectedActionId = createMissionWorkerActionId({ ...state, revision:state.revision - 1 }, adapter).toLowerCase();
  const resultActionId = text(result?.actionId).toLowerCase();
  if (resultActionId !== expectedActionId) throw new Error('Agent result action does not match the legacy dispatch.');
  const binding = await readLegacyDispatchQueueBinding(state, expectedActionId, options);
  if (text(result?.workerId) !== binding.workerId) throw new Error('Agent result worker does not match the legacy dispatch.');
  const reconciled = await appendMissionEvent(state.missionId, {
    eventId: `reconcile-${expectedActionId}`.slice(0, 128),
    eventType: 'AGENT_DISPATCH_BINDING_RECONCILED',
    expectedRevision: state.revision,
    expectedCurrentPhase: state.currentPhase,
    adapter,
    actionId: binding.actionId,
    workerId: binding.workerId,
    summary: 'Pre-upgrade running dispatch bound to its one exact durable queue action before result acceptance.',
  }, options);
  if (reconciled.preconditionFailed === true) throw new Error('Legacy dispatch changed during binding reconciliation.');
  return reconciled.state;
}

export async function collectAgentWorkerResult(result, options = {}) {
  const missionId = text(result?.missionId).toLowerCase();
  const actionId = text(result?.actionId).toLowerCase();
  const adapter = text(result?.adapter).toLowerCase();
  if (!missionId || !actionId || !['codex', 'openclaw-local', 'openclaw-readonly', 'chatgpt-github', 'foundry-forge'].includes(adapter)) throw new Error('Agent result identity is incomplete or unsupported.');
  const current = await readMissionRecord(missionId, options);
  if (current.state.dispatch?.status !== 'running') throw new Error('Mission has no active agent dispatch.');
  if (adapter !== current.state.dispatch.adapter) throw new Error('Agent result adapter does not match the active dispatch.');
  const dispatchState = await reconcileLegacyRunningDispatch(current.state, result, options);
  if (actionId !== text(dispatchState.dispatch.actionId).toLowerCase()) throw new Error('Agent result action does not match the active dispatch.');
  if (text(result?.workerId) !== text(dispatchState.dispatch.workerId)) throw new Error('Agent result worker does not match the active dispatch.');
  let collected = await appendMissionEvent(missionId, { eventId: `result-${actionId}`.slice(0, 128), eventType: 'AGENT_RESULT_RECEIVED', actionId, workerId: text(result.workerId), success: result.success === true, resultId: text(result.resultId, actionId), changedFiles: Array.isArray(result.changedFiles) ? result.changedFiles : [], receipt: result.receipt, error: text(result.error), summary: `${adapter} result collected from the durable worker queue.` }, options);
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
