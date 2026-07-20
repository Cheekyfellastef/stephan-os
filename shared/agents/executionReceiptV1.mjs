import { readFile } from 'node:fs/promises';
import {
  appendWorkspaceJsonl,
  createSharedWorkspaceReceiptRecord,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';

export const EXECUTION_RECEIPT_SCHEMA_VERSION = 'stephanos.execution-receipt.v1';
export const EXECUTION_RECEIPT_KIND = 'stephanos.execution.receipt';
export const EXECUTION_RECEIPT_STATES = Object.freeze([
  'queued',
  'accepted',
  'started',
  'progress',
  'stalled',
  'completed',
  'failed',
  'cancelled',
]);
export const EXECUTION_RECEIPT_TERMINAL_STATES = Object.freeze([
  'completed',
  'failed',
  'cancelled',
]);
export const EXECUTION_RECEIPT_TRANSITIONS = Object.freeze({
  queued: Object.freeze(['accepted', 'failed', 'cancelled']),
  accepted: Object.freeze(['started', 'failed', 'cancelled']),
  started: Object.freeze(['progress', 'stalled', 'completed', 'failed', 'cancelled']),
  progress: Object.freeze(['progress', 'stalled', 'completed', 'failed', 'cancelled']),
  stalled: Object.freeze(['progress', 'failed', 'cancelled']),
  completed: Object.freeze([]),
  failed: Object.freeze([]),
  cancelled: Object.freeze([]),
});
export const EXECUTION_WORKER_TYPES = Object.freeze([
  'remote-codex',
  'battle-bridge-codex',
  'openclaw',
  'github-first',
  'monitor',
  'orchestration-engine',
]);
export const DEFAULT_EXECUTION_HEARTBEAT_MS = 2 * 60 * 1000;

const REQUIRED_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'receiptId',
  'repository',
  'issueNumber',
  'prNumber',
  'branch',
  'sourceHead',
  'workerId',
  'workerType',
  'executionId',
  'leaseKey',
  'state',
  'phase',
  'sequence',
  'predecessorReceiptId',
  'timestampUtc',
  'heartbeatExpiresAtUtc',
  'blocker',
  'operatorActionRequired',
  'proofRefs',
  'expectedNextAction',
]);
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const SAFE_REPOSITORY = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const SAFE_BRANCH = /^[a-z0-9][a-z0-9._/-]{0,180}$/i;
const EXACT_HEAD = /^[0-9a-f]{40}$/i;
const SAFE_PROOF_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function safeId(value, fallback = '') {
  const normalized = text(value, fallback).toLowerCase();
  return SAFE_ID.test(normalized) ? normalized : fallback;
}

function timestampMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function positiveInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function isSafeProofRef(value) {
  const normalized = text(value).replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.startsWith('//') || /^[a-z]:\//i.test(normalized)) return false;
  if (normalized.split('/').some((part) => part === '..')) return false;
  return SAFE_PROOF_SEGMENT.test(normalized) || /^(proof|proofs|receipts|evidence\/receipts)\//.test(normalized);
}

function terminal(state) {
  return EXECUTION_RECEIPT_TERMINAL_STATES.includes(state);
}

function stateFromQueueStatus(status) {
  return ({
    QUEUED: 'queued',
    WAITING_OPERATOR_APPROVAL: 'queued',
    READY_FOR_MANUAL_DISPATCH: 'queued',
    DISPATCHED_MANUAL: 'accepted',
    CLAIMED: 'accepted',
    RUNNING: 'started',
    WAITING_PROOF: 'progress',
    PROOF_RECEIVED: 'progress',
    VERIFIED: 'progress',
    BLOCKED: 'stalled',
    FAILED: 'failed',
    DONE: 'completed',
  })[text(status).toUpperCase()] || 'queued';
}

export function createExecutionReceipt(input = {}) {
  const state = EXECUTION_RECEIPT_STATES.includes(text(input.state).toLowerCase())
    ? text(input.state).toLowerCase()
    : 'queued';
  const issueNumber = positiveInteger(input.issueNumber);
  const executionId = safeId(input.executionId, `execution-${issueNumber || 'unknown'}`);
  const sequence = positiveInteger(input.sequence, 1);
  const timestampUtc = text(input.timestampUtc, new Date(0).toISOString());
  const heartbeatMs = Number.isFinite(input.heartbeatMs) && input.heartbeatMs > 0
    ? input.heartbeatMs
    : DEFAULT_EXECUTION_HEARTBEAT_MS;
  const timestamp = timestampMs(timestampUtc);
  const heartbeatExpiresAtUtc = text(
    input.heartbeatExpiresAtUtc,
    Number.isFinite(timestamp) ? new Date(timestamp + heartbeatMs).toISOString() : '',
  );
  const receiptId = safeId(input.receiptId, `${executionId}-${sequence}`);
  return Object.freeze({
    schemaVersion: EXECUTION_RECEIPT_SCHEMA_VERSION,
    kind: EXECUTION_RECEIPT_KIND,
    receiptId,
    repository: text(input.repository),
    issueNumber,
    prNumber: positiveInteger(input.prNumber),
    branch: text(input.branch),
    sourceHead: text(input.sourceHead).toLowerCase(),
    workerId: safeId(input.workerId, 'unknown-worker'),
    workerType: text(input.workerType).toLowerCase(),
    executionId,
    leaseKey: safeId(input.leaseKey, `issue-${issueNumber || 'unknown'}`),
    state,
    phase: text(input.phase, state),
    sequence,
    predecessorReceiptId: sequence === 1 ? '' : safeId(input.predecessorReceiptId),
    timestampUtc,
    heartbeatExpiresAtUtc,
    blocker: text(input.blocker),
    operatorActionRequired: input.operatorActionRequired === true,
    proofRefs: Object.freeze([...new Set(list(input.proofRefs))]),
    expectedNextAction: text(input.expectedNextAction),
  });
}

export function validateExecutionReceipt(receipt = {}, options = {}) {
  const errors = [];
  if (JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify([...REQUIRED_KEYS].sort())) errors.push('unbounded-schema');
  if (receipt.schemaVersion !== EXECUTION_RECEIPT_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (receipt.kind !== EXECUTION_RECEIPT_KIND) errors.push('invalid-kind');
  if (!SAFE_ID.test(text(receipt.receiptId))) errors.push('invalid-receipt-id');
  if (!SAFE_REPOSITORY.test(text(receipt.repository))) errors.push('invalid-repository');
  if (!positiveInteger(receipt.issueNumber)) errors.push('invalid-issue-number');
  if (receipt.prNumber !== 0 && !positiveInteger(receipt.prNumber)) errors.push('invalid-pr-number');
  if (!SAFE_BRANCH.test(text(receipt.branch)) || text(receipt.branch).includes('..')) errors.push('invalid-branch');
  if (!EXACT_HEAD.test(text(receipt.sourceHead))) errors.push('invalid-source-head');
  if (!SAFE_ID.test(text(receipt.workerId))) errors.push('invalid-worker-id');
  if (!EXECUTION_WORKER_TYPES.includes(text(receipt.workerType))) errors.push('invalid-worker-type');
  if (!SAFE_ID.test(text(receipt.executionId))) errors.push('invalid-execution-id');
  if (!SAFE_ID.test(text(receipt.leaseKey))) errors.push('invalid-lease-key');
  if (!EXECUTION_RECEIPT_STATES.includes(receipt.state)) errors.push('invalid-state');
  if (!text(receipt.phase) || text(receipt.phase).length > 160) errors.push('invalid-phase');
  if (!positiveInteger(receipt.sequence)) errors.push('invalid-sequence');
  if (receipt.sequence === 1 && text(receipt.predecessorReceiptId)) errors.push('unexpected-predecessor');
  if (receipt.sequence > 1 && !SAFE_ID.test(text(receipt.predecessorReceiptId))) errors.push('missing-predecessor');
  const timestamp = timestampMs(receipt.timestampUtc);
  const heartbeat = timestampMs(receipt.heartbeatExpiresAtUtc);
  if (!Number.isFinite(timestamp)) errors.push('invalid-timestamp');
  if (!Number.isFinite(heartbeat)) errors.push('invalid-heartbeat-expiry');
  if (Number.isFinite(timestamp) && Number.isFinite(heartbeat) && heartbeat < timestamp) errors.push('heartbeat-before-receipt');
  if (receipt.operatorActionRequired !== true && receipt.operatorActionRequired !== false) errors.push('invalid-operator-action-flag');
  if (!Array.isArray(receipt.proofRefs) || receipt.proofRefs.length === 0) errors.push('missing-proof-refs');
  for (const ref of list(receipt.proofRefs)) if (!isSafeProofRef(ref)) errors.push('unsafe-proof-ref');
  if (!terminal(receipt.state) && !text(receipt.expectedNextAction)) errors.push('missing-expected-next-action');
  if (receipt.state === 'stalled' && !text(receipt.blocker)) errors.push('missing-stall-blocker');
  if (receipt.operatorActionRequired && !text(receipt.blocker)) errors.push('operator-action-without-blocker');
  if (options.repository && receipt.repository !== options.repository) errors.push('repository-mismatch');
  if (positiveInteger(options.issueNumber) && receipt.issueNumber !== positiveInteger(options.issueNumber)) errors.push('issue-mismatch');
  if (options.branch && receipt.branch !== options.branch) errors.push('branch-mismatch');
  if (options.expectedHead && receipt.sourceHead !== String(options.expectedHead).toLowerCase()) errors.push('head-mismatch');
  if (options.executionId && receipt.executionId !== options.executionId) errors.push('execution-mismatch');
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    refusalReason: errors[0] || '',
    finalVerdict: errors.length ? 'EXECUTION_RECEIPT_BLOCKED' : 'EXECUTION_RECEIPT_PASS',
  });
}

export function classifyExecutionReceiptTransition(previous, next, options = {}) {
  const previousValidation = validateExecutionReceipt(previous, options);
  const nextValidation = validateExecutionReceipt(next, options);
  const errors = [...previousValidation.errors.map((error) => `previous:${error}`), ...nextValidation.errors.map((error) => `next:${error}`)];
  const identityFields = ['repository', 'issueNumber', 'prNumber', 'branch', 'workerId', 'workerType', 'executionId', 'leaseKey'];
  for (const field of identityFields) if (previous?.[field] !== next?.[field]) errors.push(`${field}-changed`);
  if (terminal(previous?.state)) errors.push(previous?.state === next?.state ? 'terminal-state-already-recorded' : 'conflicting-terminal-state');
  if (next?.sequence !== previous?.sequence + 1) errors.push('out-of-order-sequence');
  if (next?.predecessorReceiptId !== previous?.receiptId) errors.push('predecessor-mismatch');
  if (!EXECUTION_RECEIPT_TRANSITIONS[previous?.state]?.includes(next?.state)) errors.push('invalid-state-transition');
  if (timestampMs(next?.timestampUtc) <= timestampMs(previous?.timestampUtc)) errors.push('non-monotonic-timestamp');
  return Object.freeze({
    accepted: errors.length === 0,
    errors: Object.freeze([...new Set(errors)]),
    refusalReason: errors[0] || '',
    finalVerdict: errors.length ? 'EXECUTION_TRANSITION_BLOCKED' : 'EXECUTION_TRANSITION_ACCEPTED',
  });
}

export function classifyExecutionReceiptSet(receipts = [], options = {}) {
  const valid = [];
  const invalid = [];
  for (const receipt of Array.isArray(receipts) ? receipts : []) {
    const validation = validateExecutionReceipt(receipt, options);
    (validation.valid ? valid : invalid).push({ receipt, validation });
  }
  const latestByExecution = new Map();
  for (const entry of valid) {
    const current = latestByExecution.get(entry.receipt.executionId);
    if (!current || entry.receipt.sequence > current.receipt.sequence) latestByExecution.set(entry.receipt.executionId, entry);
  }
  const activeByLease = new Map();
  for (const entry of latestByExecution.values()) {
    if (terminal(entry.receipt.state)) continue;
    const executions = activeByLease.get(entry.receipt.leaseKey) || [];
    executions.push(entry.receipt.executionId);
    activeByLease.set(entry.receipt.leaseKey, executions);
  }
  const duplicateLeases = [...activeByLease.entries()]
    .filter(([, executionIds]) => new Set(executionIds).size > 1)
    .map(([leaseKey, executionIds]) => Object.freeze({ leaseKey, executionIds: Object.freeze([...new Set(executionIds)]) }));
  return Object.freeze({
    validReceipts: Object.freeze(valid.map((entry) => entry.receipt)),
    invalidReceipts: Object.freeze(invalid.map((entry) => entry.receipt)),
    duplicateLeases: Object.freeze(duplicateLeases),
    finalVerdict: duplicateLeases.length ? 'DUPLICATE_ACTIVE_EXECUTION_LEASE' : (invalid.length ? 'EXECUTION_RECEIPT_SET_BLOCKED' : 'EXECUTION_RECEIPT_SET_PASS'),
  });
}

export function projectExecutionReceipt(receipt, options = {}) {
  if (!receipt) {
    return Object.freeze({
      operationalState: 'UNKNOWN',
      worker: 'UNKNOWN',
      task: 'UNKNOWN',
      state: 'unknown',
      phase: 'unknown',
      exactHead: '',
      lastHeartbeat: '',
      stale: true,
      blocker: 'MISSING_EXECUTION_RECEIPT',
      operatorActionRequired: false,
      proofRefs: Object.freeze([]),
      expectedNextTransition: 'valid receipt',
    });
  }
  const validation = validateExecutionReceipt(receipt, options);
  if (!validation.valid) {
    return Object.freeze({
      operationalState: 'UNKNOWN',
      worker: text(receipt.workerId, 'UNKNOWN'),
      task: text(receipt.executionId, 'UNKNOWN'),
      state: 'unknown',
      phase: 'invalid-receipt',
      exactHead: '',
      lastHeartbeat: text(receipt.timestampUtc),
      stale: true,
      blocker: validation.refusalReason,
      operatorActionRequired: false,
      proofRefs: Object.freeze([]),
      expectedNextTransition: 'replace invalid receipt',
    });
  }
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const stale = !terminal(receipt.state) && nowMs > timestampMs(receipt.heartbeatExpiresAtUtc);
  const operationalState = stale ? 'STALE' : ({
    queued: 'QUEUED',
    accepted: 'ACCEPTED',
    started: 'RUNNING',
    progress: 'RUNNING',
    stalled: 'STALLED',
    completed: 'COMPLETED',
    failed: 'FAILED',
    cancelled: 'CANCELLED',
  })[receipt.state];
  return Object.freeze({
    operationalState,
    worker: receipt.workerId,
    workerType: receipt.workerType,
    task: receipt.executionId,
    repository: receipt.repository,
    issueNumber: receipt.issueNumber,
    prNumber: receipt.prNumber,
    branch: receipt.branch,
    state: receipt.state,
    phase: receipt.phase,
    exactHead: receipt.sourceHead,
    lastHeartbeat: receipt.timestampUtc,
    heartbeatExpiresAtUtc: receipt.heartbeatExpiresAtUtc,
    stale,
    blocker: stale ? 'EXECUTION_HEARTBEAT_STALE' : receipt.blocker,
    operatorActionRequired: receipt.operatorActionRequired,
    proofRefs: receipt.proofRefs,
    expectedNextTransition: receipt.expectedNextAction || 'terminal',
  });
}

export function renderExecutionReceiptStatus(receipt, options = {}) {
  const projection = projectExecutionReceipt(receipt, options);
  return [
    `EXECUTION_STATE=${projection.operationalState}`,
    `WORKER=${projection.worker}`,
    `TASK=${projection.task}`,
    `PHASE=${projection.phase}`,
    `HEAD=${projection.exactHead || 'UNKNOWN'}`,
    `LAST_HEARTBEAT=${projection.lastHeartbeat || 'UNKNOWN'}`,
    `BLOCKER=${projection.blocker || 'NONE'}`,
    `OPERATOR_ACTION_REQUIRED=${projection.operatorActionRequired}`,
    `NEXT=${projection.expectedNextTransition}`,
  ].join('\n');
}

export function toSharedWorkspaceExecutionReceipt(receipt) {
  const validation = validateExecutionReceipt(receipt);
  if (!validation.valid) return Object.freeze({ ok: false, reason: validation.refusalReason, validation });
  const base = createSharedWorkspaceReceiptRecord({
    receiptId: receipt.receiptId,
    participantId: receipt.workerId,
    timestampUtc: receipt.timestampUtc,
    correlationId: receipt.leaseKey,
    relatedIssue: String(receipt.issueNumber),
    relatedPr: receipt.prNumber ? String(receipt.prNumber) : '',
    proofRefs: receipt.proofRefs,
    receivedRecordId: receipt.predecessorReceiptId || receipt.executionId,
    disposition: receipt.state,
    summary: `${receipt.workerId} reports ${receipt.state} for ${receipt.executionId}.`,
  });
  const record = Object.freeze({ ...base, executionReceipt: receipt });
  const workspaceValidation = validateSharedWorkspaceRecord(record);
  return Object.freeze({ ok: workspaceValidation.valid, reason: workspaceValidation.refusalReason, validation: workspaceValidation, record });
}

export async function appendExecutionReceipt(root, receipt, options = {}) {
  const converted = toSharedWorkspaceExecutionReceipt(receipt);
  if (!converted.ok) return Object.freeze({ ok: false, reason: converted.reason, validation: converted.validation });
  const history = await appendWorkspaceJsonl(root, ['receipts', 'execution-receipts.jsonl'], converted.record, options);
  if (!history.ok) return Object.freeze({ ok: false, reason: history.reason, history });
  const current = await writeAtomicJson(root, ['receipts', `${receipt.leaseKey}.json`], converted.record, options);
  if (!current.ok) return Object.freeze({ ok: false, reason: current.reason, history, current });
  return Object.freeze({ ok: true, reason: 'EXECUTION_RECEIPT_APPENDED', history, current, receipt });
}

export async function readExecutionReceiptHistory(root, filters = {}, options = {}) {
  const resolved = resolveSharedWorkspacePath({ root, repoRoot: options.repoRoot, segments: ['receipts', 'execution-receipts.jsonl'] });
  if (!resolved.ok) return Object.freeze({ ok: false, reason: resolved.reason, receipts: Object.freeze([]) });
  let payload = '';
  try {
    payload = await readFile(resolved.path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({ ok: true, reason: 'NO_EXECUTION_RECEIPTS', receipts: Object.freeze([]) });
    return Object.freeze({ ok: false, reason: 'EXECUTION_RECEIPT_READ_FAILED', receipts: Object.freeze([]) });
  }
  const receipts = [];
  for (const line of payload.split('\n').filter(Boolean)) {
    try {
      const record = JSON.parse(line);
      if (!validateSharedWorkspaceRecord(record, options).valid) continue;
      const receipt = record.executionReceipt;
      if (!validateExecutionReceipt(receipt, filters).valid) continue;
      if (filters.executionId && receipt.executionId !== filters.executionId) continue;
      if (filters.leaseKey && receipt.leaseKey !== filters.leaseKey) continue;
      receipts.push(receipt);
    } catch {}
  }
  receipts.sort((left, right) => left.sequence - right.sequence || left.timestampUtc.localeCompare(right.timestampUtc));
  return Object.freeze({ ok: true, reason: 'EXECUTION_RECEIPTS_READ', receipts: Object.freeze(receipts) });
}

export async function readCurrentExecutionReceipt(root, filters = {}, options = {}) {
  const history = await readExecutionReceiptHistory(root, filters, options);
  if (!history.ok || history.receipts.length === 0) return Object.freeze({ ...history, receipt: null, projection: projectExecutionReceipt(null, options) });
  const receipt = history.receipts.at(-1);
  return Object.freeze({ ...history, receipt, projection: projectExecutionReceipt(receipt, options) });
}

export function executionReceiptFromCodexQueueRecord(queueRecord = {}, input = {}) {
  const state = stateFromQueueStatus(queueRecord.status);
  const historyEntry = Array.isArray(queueRecord.history) ? queueRecord.history.at(-1) : null;
  const timestampUtc = text(input.timestampUtc || historyEntry?.timestamp || queueRecord.createdAt);
  const proofRefs = list(input.proofRefs || queueRecord.proofRequirements?.refs);
  return createExecutionReceipt({
    receiptId: input.receiptId,
    repository: input.repository,
    issueNumber: queueRecord.issueNumber,
    prNumber: input.prNumber,
    branch: queueRecord.branch,
    sourceHead: input.sourceHead,
    workerId: input.workerId || 'codex-dispatch-queue',
    workerType: input.workerType || 'remote-codex',
    executionId: queueRecord.jobId,
    leaseKey: input.leaseKey || `issue-${queueRecord.issueNumber}`,
    state,
    phase: input.phase || `codex-queue-${text(queueRecord.status).toLowerCase()}`,
    sequence: input.sequence,
    predecessorReceiptId: input.predecessorReceiptId,
    timestampUtc,
    heartbeatExpiresAtUtc: input.heartbeatExpiresAtUtc,
    heartbeatMs: input.heartbeatMs,
    blocker: input.blocker || queueRecord.blockerMetadata?.reason || queueRecord.integrationState?.blocker || '',
    operatorActionRequired: queueRecord.status === 'WAITING_OPERATOR_APPROVAL' || input.operatorActionRequired === true,
    proofRefs,
    expectedNextAction: input.expectedNextAction || (terminal(state) ? '' : 'publish next Codex queue transition'),
  });
}

export function buildExecutionWorkerAdapterContract() {
  return Object.freeze({
    schemaVersion: EXECUTION_RECEIPT_SCHEMA_VERSION,
    workerTypes: EXECUTION_WORKER_TYPES,
    requiredStates: EXECUTION_RECEIPT_STATES,
    requiredProducerOperations: Object.freeze(['accept', 'heartbeat', 'progress', 'stall', 'complete', 'fail', 'cancel']),
    sharedWorkspacePaths: Object.freeze({
      history: 'receipts/execution-receipts.jsonl',
      currentByLease: 'receipts/<leaseKey>.json',
    }),
    invariants: Object.freeze({
      oneActiveExecutionPerLease: true,
      silenceMeansUnknown: true,
      exactHeadBindingRequired: true,
      idempotentSequenceRequired: true,
      proofReferencesRequired: true,
      mergeAuthorityGranted: false,
    }),
    firstProducer: 'codex-dispatch-queue',
    finalVerdict: 'EXECUTION_WORKER_ADAPTER_CONTRACT_READY',
  });
}
