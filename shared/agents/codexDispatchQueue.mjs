import { createHash } from 'node:crypto';
import {
  createSharedWorkspaceMessage,
  validateSharedWorkspaceMessage,
} from './sharedAgentWorkspace.mjs';
import {
  appendWorkspaceJsonl,
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceStatusRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';

export const CODEX_DISPATCH_QUEUE_SCHEMA_VERSION = 'codex-dispatch-queue.v1';
export const CODEX_DISPATCH_QUEUE_KIND = 'stephanos.codex_dispatch.queue_record';
export const CODEX_DISPATCH_HISTORY_KIND = 'stephanos.codex_dispatch.queue_history_entry';

export const CODEX_QUEUE_STATUS = Object.freeze({
  QUEUED: 'queued',
  DISPATCHED: 'dispatched',
  RUNNING: 'running',
  WAITING_PROOF: 'waiting-proof',
  SUCCEEDED: 'succeeded',
  BLOCKED: 'blocked',
  FAILED: 'failed',
});

export const CODEX_QUEUE_TERMINAL_STATUSES = Object.freeze([
  CODEX_QUEUE_STATUS.SUCCEEDED,
  CODEX_QUEUE_STATUS.BLOCKED,
  CODEX_QUEUE_STATUS.FAILED,
]);

export const CODEX_QUEUE_TRANSITIONS = Object.freeze({
  [CODEX_QUEUE_STATUS.QUEUED]: [CODEX_QUEUE_STATUS.DISPATCHED, CODEX_QUEUE_STATUS.BLOCKED],
  [CODEX_QUEUE_STATUS.DISPATCHED]: [CODEX_QUEUE_STATUS.RUNNING, CODEX_QUEUE_STATUS.BLOCKED, CODEX_QUEUE_STATUS.FAILED],
  [CODEX_QUEUE_STATUS.RUNNING]: [CODEX_QUEUE_STATUS.WAITING_PROOF, CODEX_QUEUE_STATUS.BLOCKED, CODEX_QUEUE_STATUS.FAILED],
  [CODEX_QUEUE_STATUS.WAITING_PROOF]: [CODEX_QUEUE_STATUS.SUCCEEDED, CODEX_QUEUE_STATUS.BLOCKED, CODEX_QUEUE_STATUS.FAILED],
  [CODEX_QUEUE_STATUS.SUCCEEDED]: [],
  [CODEX_QUEUE_STATUS.BLOCKED]: [],
  [CODEX_QUEUE_STATUS.FAILED]: [],
});

export const CODEX_DISPATCH_GUARDRAILS = Object.freeze({
  sharedWorkspaceOnly: true,
  sourceTreeQueueWritesAllowed: false,
  arbitraryShellAllowed: false,
  uncontrolledMutationAllowed: false,
  dirtyMainWritesAllowed: false,
  mergeAllowed: false,
  branchDeletionAllowed: false,
  hardResetAllowed: false,
  approvalSpoofingAllowed: false,
  queueBypassesApproval: false,
});

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,120}$/i;
const SAFE_BRANCH_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,160}$/i;
const SAFE_COMMAND_PATTERN = /^(node|npm|git)\b(?!.*\b(reset\s+--hard|merge|push|branch\s+-d|branch\s+-D)\b)/i;
const FORBIDDEN_TEXT_PATTERN = /token|secret|password|credential|private key|\.env/i;
const REQUIRED_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'jobId',
  'issueNumber',
  'branch',
  'prompt',
  'requestedProofCommands',
  'approvalRequirements',
  'createdAt',
  'dispatchedAt',
  'completedAt',
  'status',
  'resultMetadata',
  'blockerMetadata',
  'history',
  'sharedWorkspaceMessage',
]);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function unique(value) {
  return [...new Set(list(value))];
}

function safeStatus(value) {
  const status = text(value, CODEX_QUEUE_STATUS.QUEUED).toLowerCase();
  return Object.values(CODEX_QUEUE_STATUS).includes(status) ? status : CODEX_QUEUE_STATUS.QUEUED;
}

function safeId(value, fallback) {
  const candidate = text(value, fallback).toLowerCase();
  return SAFE_ID_PATTERN.test(candidate) && !FORBIDDEN_TEXT_PATTERN.test(candidate) ? candidate : fallback;
}

function safeBranch(value) {
  const branch = text(value, 'codex/queued-job').replace(/\\/g, '/');
  return SAFE_BRANCH_PATTERN.test(branch) && !branch.includes('..') && !FORBIDDEN_TEXT_PATTERN.test(branch)
    ? branch
    : 'codex/queued-job';
}

function safePrompt(value) {
  return text(value, '').replace(/\s+/g, ' ').slice(0, 4000);
}

function safeProofCommands(value) {
  return unique(value)
    .filter((command) => SAFE_COMMAND_PATTERN.test(command) && !FORBIDDEN_TEXT_PATTERN.test(command))
    .slice(0, 20);
}

function stableJobId(input) {
  const seed = `${text(input.issueNumber)}\n${text(input.branch)}\n${text(input.prompt)}`;
  return `codex-job-${createHash('sha256').update(seed).digest('hex').slice(0, 20)}`;
}

function historyEntry({ fromStatus = '', toStatus, timestamp = 'pending', reason = 'created', metadata = {} }) {
  return Object.freeze({
    kind: CODEX_DISPATCH_HISTORY_KIND,
    fromStatus,
    toStatus,
    timestamp,
    reason: text(reason, 'transition').slice(0, 240),
    metadata: Object.freeze({ ...metadata }),
  });
}

export function buildCodexDispatchQueueContract() {
  return Object.freeze({
    schemaVersion: CODEX_DISPATCH_QUEUE_SCHEMA_VERSION,
    contractKind: 'stephanos.codex_dispatch.queue.contract',
    workspaceBoundary: 'Shared Agent Workspace outside source tree',
    statuses: Object.values(CODEX_QUEUE_STATUS),
    transitions: CODEX_QUEUE_TRANSITIONS,
    requiredQueueFields: [...REQUIRED_KEYS],
    guardrails: { ...CODEX_DISPATCH_GUARDRAILS },
    sharedWorkspaceEventKinds: [
      'codex-job-created',
      'codex-job-dispatched',
      'codex-job-running',
      'codex-job-proof',
      'codex-job-blocked',
      'codex-job-complete',
    ],
    finalVerdict: 'CODEX_DISPATCH_QUEUE_CONTRACT_READY',
  });
}

export function createCodexQueueRecord(input = {}) {
  const issueNumber = Number.parseInt(input.issueNumber, 10);
  const prompt = safePrompt(input.prompt || input.summary || '');
  const jobId = safeId(input.jobId, stableJobId({ ...input, prompt }));
  const createdAt = text(input.createdAt || input.createdAtUtc, 'pending');
  const status = safeStatus(input.status);
  const record = {
    schemaVersion: CODEX_DISPATCH_QUEUE_SCHEMA_VERSION,
    kind: CODEX_DISPATCH_QUEUE_KIND,
    jobId,
    issueNumber: Number.isSafeInteger(issueNumber) && issueNumber > 0 ? issueNumber : 0,
    branch: safeBranch(input.branch),
    prompt,
    requestedProofCommands: safeProofCommands(input.requestedProofCommands || input.requiredTests),
    approvalRequirements: Object.freeze({
      requiresOperatorApprovalBeforeDispatch: input.approvalRequirements?.requiresOperatorApprovalBeforeDispatch === true,
      requiresOperatorApprovalBeforeMerge: input.approvalRequirements?.requiresOperatorApprovalBeforeMerge !== false,
      approvalReceipt: text(input.approvalRequirements?.approvalReceipt, ''),
    }),
    createdAt,
    dispatchedAt: text(input.dispatchedAt, ''),
    completedAt: text(input.completedAt, ''),
    status,
    resultMetadata: Object.freeze({ ...(input.resultMetadata || {}) }),
    blockerMetadata: Object.freeze({ ...(input.blockerMetadata || {}) }),
    history: Object.freeze((Array.isArray(input.history) && input.history.length ? input.history : [historyEntry({ toStatus: status, timestamp: createdAt })]).map((entry) => Object.freeze({ ...entry }))),
    sharedWorkspaceMessage: createSharedWorkspaceMessage({
      messageId: jobId,
      sender: 'codex',
      recipient: 'operator',
      channel: 'codex-dispatch-queue',
      kind: 'codex-job-created',
      severity: 'info',
      correlationId: `issue-${Number.isSafeInteger(issueNumber) ? issueNumber : 0}`,
      relatedGoal: `#${Number.isSafeInteger(issueNumber) ? issueNumber : 0}`,
      summary: `Codex job ${jobId} queued for issue #${Number.isSafeInteger(issueNumber) ? issueNumber : 0}.`,
      status,
      proofRefs: [`proof/${jobId}.json`],
      requiresOperator: false,
    }),
  };
  return Object.freeze(record);
}

export const createCodexQueueItem = createCodexQueueRecord;

export function validateCodexQueueRecord(record = {}) {
  const errors = [];
  const keys = Object.keys(record).sort();
  const expected = [...REQUIRED_KEYS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) errors.push('unbounded-schema');
  if (record.schemaVersion !== CODEX_DISPATCH_QUEUE_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (record.kind !== CODEX_DISPATCH_QUEUE_KIND) errors.push('invalid-kind');
  if (!SAFE_ID_PATTERN.test(text(record.jobId))) errors.push('invalid-job-id');
  if (!Number.isSafeInteger(record.issueNumber) || record.issueNumber <= 0) errors.push('invalid-issue-number');
  if (!SAFE_BRANCH_PATTERN.test(text(record.branch)) || text(record.branch).includes('..')) errors.push('invalid-branch');
  if (!text(record.prompt)) errors.push('missing-prompt');
  if (!Array.isArray(record.requestedProofCommands) || record.requestedProofCommands.length === 0) errors.push('missing-proof-commands');
  for (const command of list(record.requestedProofCommands)) {
    if (!SAFE_COMMAND_PATTERN.test(command) || FORBIDDEN_TEXT_PATTERN.test(command)) errors.push('unsafe-proof-command');
  }
  if (!Object.values(CODEX_QUEUE_STATUS).includes(record.status)) errors.push('invalid-status');
  if (!Array.isArray(record.history) || record.history.length === 0) errors.push('missing-history');
  if (!validateSharedWorkspaceMessage(record.sharedWorkspaceMessage).valid) errors.push('invalid-shared-workspace-message');
  return { valid: errors.length === 0, errors, finalVerdict: errors.length ? 'CODEX_QUEUE_RECORD_BLOCKED' : 'CODEX_QUEUE_RECORD_PASS' };
}

export const validateCodexQueueItem = validateCodexQueueRecord;

function workspaceStatusFor(record) {
  return createSharedWorkspaceStatusRecord({
    statusId: 'codex-dispatch-queue',
    timestampUtc: text(record.completedAt || record.dispatchedAt || record.createdAt, 'pending'),
    status: record.status,
    summary: `Codex dispatch queue job ${record.jobId} for issue #${record.issueNumber} is ${record.status}.`,
    proofRefs: record.sharedWorkspaceMessage?.proofRefs || [`proof/${record.jobId}.json`],
  });
}

function workspaceEventFor(record) {
  return createSharedWorkspaceEventRecord({
    eventId: `${record.jobId}-${record.status}`,
    timestampUtc: text(record.completedAt || record.dispatchedAt || record.createdAt, 'pending'),
    eventKind: record.sharedWorkspaceMessage?.eventKind || 'codex-job-created',
    summary: record.sharedWorkspaceMessage?.summary || `Codex dispatch queue job ${record.jobId} is ${record.status}.`,
  });
}

export async function publishCodexQueueRecordToSharedWorkspace(rootInput, record = {}, options = {}) {
  const normalized = createCodexQueueRecord(record);
  const validation = validateCodexQueueRecord(normalized);
  if (!validation.valid) {
    return Object.freeze({
      ok: false,
      reason: validation.errors[0] || 'invalid-codex-queue-record',
      validation,
      finalVerdict: 'CODEX_QUEUE_WORKSPACE_PUBLISH_BLOCKED',
    });
  }

  const statusRecord = workspaceStatusFor(normalized);
  const eventRecord = workspaceEventFor(normalized);
  const statusWrite = await writeAtomicJson(rootInput, ['status', 'codex-dispatch-queue.json'], statusRecord, options);
  if (!statusWrite.ok) {
    return Object.freeze({
      ok: false,
      reason: statusWrite.reason,
      statusWrite,
      finalVerdict: 'CODEX_QUEUE_WORKSPACE_PUBLISH_BLOCKED',
    });
  }
  const eventAppend = await appendWorkspaceJsonl(rootInput, ['events', 'codex-dispatch-queue.jsonl'], eventRecord, options);
  if (!eventAppend.ok) {
    return Object.freeze({
      ok: false,
      reason: eventAppend.reason,
      statusWrite,
      eventAppend,
      finalVerdict: 'CODEX_QUEUE_WORKSPACE_PUBLISH_BLOCKED',
    });
  }

  return Object.freeze({
    ok: true,
    reason: 'CODEX_QUEUE_WORKSPACE_PUBLISHED',
    record: normalized,
    statusRecord,
    eventRecord,
    statusWrite,
    eventAppend,
    finalVerdict: 'CODEX_QUEUE_WORKSPACE_PUBLISH_PASS',
  });
}

export const publishCodexQueueRecord = publishCodexQueueRecordToSharedWorkspace;
export const publishCodexQueueItemToSharedWorkspace = publishCodexQueueRecordToSharedWorkspace;
export const publishCodexQueueItem = publishCodexQueueRecordToSharedWorkspace;

export function transitionCodexQueueRecord(record = {}, nextStatus, input = {}) {
  const current = safeStatus(record.status);
  const target = safeStatus(nextStatus);
  const allowed = CODEX_QUEUE_TRANSITIONS[current] || [];
  if (!allowed.includes(target)) {
    return Object.freeze({
      valid: false,
      error: 'invalid-transition',
      fromStatus: current,
      toStatus: target,
      record,
      finalVerdict: 'CODEX_QUEUE_TRANSITION_REJECTED',
    });
  }
  const timestamp = text(input.timestamp, 'pending');
  const next = createCodexQueueRecord({
    ...record,
    status: target,
    dispatchedAt: target === CODEX_QUEUE_STATUS.DISPATCHED ? timestamp : record.dispatchedAt,
    completedAt: CODEX_QUEUE_TERMINAL_STATUSES.includes(target) ? timestamp : record.completedAt,
    resultMetadata: input.resultMetadata || record.resultMetadata,
    blockerMetadata: input.blockerMetadata || record.blockerMetadata,
    history: [...record.history, historyEntry({ fromStatus: current, toStatus: target, timestamp, reason: input.reason, metadata: input.metadata })],
  });
  return Object.freeze({ valid: true, record: next, finalVerdict: 'CODEX_QUEUE_TRANSITION_PASS' });
}
