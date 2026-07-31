import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  createSharedWorkspaceMessage,
  validateSharedWorkspaceMessage,
} from './sharedAgentWorkspace.mjs';
import {
  appendWorkspaceJsonl,
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceStatusRecord,
  ensureSharedWorkspaceLayout,
  resolveSharedWorkspacePath,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';

export const CODEX_DISPATCH_QUEUE_SCHEMA_VERSION = 'codex-dispatch-queue.v1';
export const CODEX_DISPATCH_QUEUE_KIND = 'stephanos.codex_dispatch.queue_record';
export const CODEX_DISPATCH_HISTORY_KIND = 'stephanos.codex_dispatch.queue_history_entry';
export const CODEX_DISPATCH_DASHBOARD_SCHEMA_VERSION = 'codex-dispatch-dashboard.v1';
export const CODEX_DISPATCH_HANDOFF_SCHEMA_VERSION = 'codex-manual-handoff.v1';
const MISSING_AUTOMATED_INTEGRATION_BLOCKER = 'BLOCKED_BY_MISSING_CODEX_AUTOMATED_DISPATCH_INTEGRATION_1293';

const STATUS_VALUES = {
  QUEUED: 'QUEUED',
  WAITING_OPERATOR_APPROVAL: 'WAITING_OPERATOR_APPROVAL',
  READY_FOR_MANUAL_DISPATCH: 'READY_FOR_MANUAL_DISPATCH',
  DISPATCHED_MANUAL: 'DISPATCHED_MANUAL',
  CLAIMED: 'CLAIMED',
  RUNNING: 'RUNNING',
  WAITING_PROOF: 'WAITING_PROOF',
  PROOF_RECEIVED: 'PROOF_RECEIVED',
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
  BLOCKED: 'BLOCKED',
  DONE: 'DONE',
};
Object.defineProperties(STATUS_VALUES, {
  DISPATCHED: { value: 'DISPATCHED_MANUAL', enumerable: false },
  SUCCEEDED: { value: 'DONE', enumerable: false },
});
export const CODEX_QUEUE_STATUS = Object.freeze(STATUS_VALUES);

export const CODEX_QUEUE_TERMINAL_STATUSES = Object.freeze([
  CODEX_QUEUE_STATUS.FAILED,
  CODEX_QUEUE_STATUS.BLOCKED,
  CODEX_QUEUE_STATUS.DONE,
]);

export const CODEX_QUEUE_TRANSITIONS = Object.freeze({
  [CODEX_QUEUE_STATUS.QUEUED]: [CODEX_QUEUE_STATUS.WAITING_OPERATOR_APPROVAL, CODEX_QUEUE_STATUS.BLOCKED],
  [CODEX_QUEUE_STATUS.WAITING_OPERATOR_APPROVAL]: [CODEX_QUEUE_STATUS.READY_FOR_MANUAL_DISPATCH, CODEX_QUEUE_STATUS.BLOCKED],
  [CODEX_QUEUE_STATUS.READY_FOR_MANUAL_DISPATCH]: [CODEX_QUEUE_STATUS.DISPATCHED_MANUAL, CODEX_QUEUE_STATUS.BLOCKED],
  [CODEX_QUEUE_STATUS.DISPATCHED_MANUAL]: [CODEX_QUEUE_STATUS.CLAIMED, CODEX_QUEUE_STATUS.BLOCKED, CODEX_QUEUE_STATUS.FAILED],
  [CODEX_QUEUE_STATUS.CLAIMED]: [CODEX_QUEUE_STATUS.RUNNING, CODEX_QUEUE_STATUS.BLOCKED, CODEX_QUEUE_STATUS.FAILED],
  [CODEX_QUEUE_STATUS.RUNNING]: [CODEX_QUEUE_STATUS.WAITING_PROOF, CODEX_QUEUE_STATUS.BLOCKED, CODEX_QUEUE_STATUS.FAILED],
  [CODEX_QUEUE_STATUS.WAITING_PROOF]: [CODEX_QUEUE_STATUS.PROOF_RECEIVED, CODEX_QUEUE_STATUS.BLOCKED, CODEX_QUEUE_STATUS.FAILED],
  [CODEX_QUEUE_STATUS.PROOF_RECEIVED]: [CODEX_QUEUE_STATUS.VERIFIED, CODEX_QUEUE_STATUS.BLOCKED, CODEX_QUEUE_STATUS.FAILED],
  [CODEX_QUEUE_STATUS.VERIFIED]: [CODEX_QUEUE_STATUS.DONE, CODEX_QUEUE_STATUS.FAILED],
  [CODEX_QUEUE_STATUS.FAILED]: [],
  [CODEX_QUEUE_STATUS.BLOCKED]: [],
  [CODEX_QUEUE_STATUS.DONE]: [],
});

export const CODEX_DISPATCH_GUARDRAILS = Object.freeze({
  sharedWorkspaceOnly: true,
  sourceTreeQueueWritesAllowed: false,
  automaticCodexLaunchAllowed: false,
  fakeDispatchAllowed: false,
  arbitraryShellAllowed: false,
  uncontrolledMutationAllowed: false,
  dirtyMainWritesAllowed: false,
  mergeAllowed: false,
  branchDeletionAllowed: false,
  hardResetAllowed: false,
  approvalSpoofingAllowed: false,
  exactHeadApprovalRequired: true,
  queueBypassesApproval: false,
});

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,120}$/i;
const SAFE_BRANCH_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,160}$/i;
const SAFE_COMMAND_PATTERN = /^(node|npm|git)\b(?!.*\b(reset\s+--hard|merge|push|branch\s+-d|branch\s+-D)\b)/i;
const SAFE_PROOF_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const SAFE_BLOCKER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._:-]{0,159}$/;
const FORBIDDEN_TEXT_PATTERN = /token|secret|password|credential|private key|\.env|session/i;
const REQUIRED_KEYS = Object.freeze([
  'schemaVersion', 'kind', 'jobId', 'issueNumber', 'branch', 'prompt', 'requestedProofCommands',
  'exactHeadProof', 'proofRequirements', 'approvalRequirements', 'integrationState', 'createdAt', 'dispatchedAt',
  'completedAt', 'status', 'resultMetadata', 'blockerMetadata', 'history', 'sharedWorkspaceMessage',
]);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}
function list(value) { return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : []; }
function unique(value) { return [...new Set(list(value))]; }
function canonicalStatus(value) {
  const upper = text(value, CODEX_QUEUE_STATUS.QUEUED).replace(/-/g, '_').toUpperCase();
  const legacy = { DISPATCHED: CODEX_QUEUE_STATUS.DISPATCHED_MANUAL, SUCCEEDED: CODEX_QUEUE_STATUS.DONE, WAITINGPROOF: CODEX_QUEUE_STATUS.WAITING_PROOF };
  const status = legacy[upper] || upper;
  return Object.values(CODEX_QUEUE_STATUS).includes(status) ? status : CODEX_QUEUE_STATUS.QUEUED;
}
function safeId(value, fallback) {
  const candidate = text(value, fallback).toLowerCase();
  return SAFE_ID_PATTERN.test(candidate) && !FORBIDDEN_TEXT_PATTERN.test(candidate) ? candidate : fallback;
}
function safeBranch(value) {
  const branch = text(value, 'codex/queued-job').replace(/\\/g, '/');
  return SAFE_BRANCH_PATTERN.test(branch) && !branch.includes('..') && !FORBIDDEN_TEXT_PATTERN.test(branch) ? branch : 'codex/queued-job';
}
function safePrompt(value) { return text(value).replace(/\s+/g, ' ').slice(0, 4000); }
function safeProofCommands(value) {
  return unique(value).filter((command) => SAFE_COMMAND_PATTERN.test(command) && !FORBIDDEN_TEXT_PATTERN.test(command)).slice(0, 20);
}
function projectedBlockerCode(value = {}) {
  const candidate = text(value?.code).toUpperCase();
  if (!candidate) return '';
  return SAFE_BLOCKER_CODE_PATTERN.test(candidate) && !FORBIDDEN_TEXT_PATTERN.test(candidate)
    ? candidate
    : 'CODEX_QUEUE_BLOCKER_INVALID';
}
function safeExactHeadProof(value = {}) {
  value ||= {};
  const expectedHead = text(value.expectedHead).toLowerCase();
  const prNumber = Number.parseInt(value.prNumber, 10);
  if (!/^[0-9a-f]{40}$/.test(expectedHead) || !Number.isSafeInteger(prNumber) || prNumber <= 0) return null;
  return Object.freeze({
    repository: text(value.repository),
    prNumber,
    expectedHead,
    proofScenario: text(value.proofScenario),
  });
}
export function isSafeCodexQueueProofRef(value) {
  const normalized = text(value).replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.startsWith('//') || /^[a-z]:\//i.test(normalized)) return false;
  if (normalized.split('/').some((part) => part === '..')) return false;
  return SAFE_PROOF_SEGMENT_PATTERN.test(normalized) || /^(proof|proofs|receipts|evidence\/receipts)\//.test(normalized);
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
function eventKindForStatus(status) {
  return ({
    QUEUED: 'codex-job-created',
    WAITING_OPERATOR_APPROVAL: 'codex-job-awaiting-operator-approval',
    READY_FOR_MANUAL_DISPATCH: 'codex-job-ready-for-manual-dispatch',
    DISPATCHED_MANUAL: 'codex-job-dispatched-manual',
    CLAIMED: 'codex-job-claimed',
    RUNNING: 'codex-job-running',
    WAITING_PROOF: 'codex-job-waiting-proof',
    PROOF_RECEIVED: 'codex-job-proof-received',
    VERIFIED: 'codex-job-verified',
    DONE: 'codex-job-done',
    BLOCKED: 'codex-job-blocked',
    FAILED: 'codex-job-failed',
  })[status] || 'codex-job-status';
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
    proofRequirementRefs: ['#1287 Verification Harness', '#1290 Shared Agent Workspace', '#1291 Battle Bridge Supervisor', '#1292 Codex Dispatch Queue V1'],
    sharedWorkspacePaths: {
      queueRecords: 'codex-dispatch/queue/*.json',
      status: 'status/codex-dispatch-queue.json',
      events: 'events/codex-dispatch-queue.jsonl',
    },
    missingIntegrationBlocker: MISSING_AUTOMATED_INTEGRATION_BLOCKER,
    finalVerdict: 'CODEX_DISPATCH_QUEUE_CONTRACT_READY',
  });
}

function buildRecord(input, state) {
  const issueNumber = Number.parseInt(input.issueNumber, 10);
  const prompt = safePrompt(input.prompt || input.summary || '');
  const jobId = safeId(input.jobId, stableJobId({ ...input, prompt }));
  const createdAt = text(input.createdAt || input.createdAtUtc, 'pending');
  const status = canonicalStatus(state.status);
  const proofRefs = unique(input.proofRequirements?.refs || [`proof/${jobId}.json`]);
  const blockerMetadata = Object.freeze({ ...(state.blockerMetadata || input.blockerMetadata || {}) });
  const blockerCode = projectedBlockerCode(blockerMetadata);
  const requiresOperator = status === CODEX_QUEUE_STATUS.WAITING_OPERATOR_APPROVAL
    || blockerMetadata.operatorActionRequired === true
    || !!blockerCode;
  const integrationState = state.integrationState || input.integrationState || {};
  return Object.freeze({
    schemaVersion: CODEX_DISPATCH_QUEUE_SCHEMA_VERSION,
    kind: CODEX_DISPATCH_QUEUE_KIND,
    jobId,
    issueNumber: Number.isSafeInteger(issueNumber) && issueNumber > 0 ? issueNumber : 0,
    branch: safeBranch(input.branch),
    prompt,
    requestedProofCommands: safeProofCommands(input.requestedProofCommands || input.requiredTests),
    exactHeadProof: safeExactHeadProof(input.exactHeadProof),
    proofRequirements: Object.freeze({
      refs: proofRefs,
      verifierTypes: unique(input.proofRequirements?.verifierTypes || ['CodexQueueRecordVerifier', 'ProofReferenceVerifier']),
    }),
    approvalRequirements: Object.freeze({
      requiresOperatorApprovalBeforeDispatch: input.approvalRequirements?.requiresOperatorApprovalBeforeDispatch === true,
      requiresExactHeadApproval: input.approvalRequirements?.requiresExactHeadApproval !== false,
      requiresOperatorApprovalBeforeMerge: input.approvalRequirements?.requiresOperatorApprovalBeforeMerge !== false,
      approvalReceipt: text(state.approvalReceipt, ''),
    }),
    integrationState: Object.freeze({
      automatedCodexDispatchProven: integrationState.automatedCodexDispatchProven === true,
      blocker: integrationState.automatedCodexDispatchProven === true ? '' : MISSING_AUTOMATED_INTEGRATION_BLOCKER,
    }),
    createdAt,
    dispatchedAt: text(state.dispatchedAt, ''),
    completedAt: text(state.completedAt, ''),
    status,
    resultMetadata: Object.freeze({ ...(state.resultMetadata || input.resultMetadata || {}) }),
    blockerMetadata,
    history: Object.freeze(state.history.map((entry) => Object.freeze({ ...entry }))),
    sharedWorkspaceMessage: createSharedWorkspaceMessage({
      messageId: jobId,
      sender: 'codex',
      recipient: 'operator',
      channel: 'codex-dispatch-queue',
      kind: eventKindForStatus(status),
      severity: status === CODEX_QUEUE_STATUS.BLOCKED
        || status === CODEX_QUEUE_STATUS.FAILED
        || requiresOperator
        ? 'warning'
        : 'info',
      correlationId: `issue-${Number.isSafeInteger(issueNumber) ? issueNumber : 0}`,
      relatedGoal: `#${Number.isSafeInteger(issueNumber) ? issueNumber : 0}`,
      summary: `Codex queue job ${jobId} is ${status} for issue #${Number.isSafeInteger(issueNumber) ? issueNumber : 0}.`,
      status,
      proofRefs,
      requiresOperator,
    }),
  });
}

export function createCodexQueueRecord(input = {}) {
  const createdAt = text(input.createdAt || input.createdAtUtc, 'pending');
  return buildRecord(input, {
    status: CODEX_QUEUE_STATUS.QUEUED,
    approvalReceipt: '',
    dispatchedAt: '',
    completedAt: '',
    resultMetadata: input.resultMetadata,
    blockerMetadata: input.blockerMetadata,
    history: [historyEntry({ toStatus: CODEX_QUEUE_STATUS.QUEUED, timestamp: createdAt })],
  });
}
export const createCodexQueueItem = createCodexQueueRecord;

function validateHistory(record, errors) {
  if (!Array.isArray(record.history) || record.history.length === 0) {
    errors.push('missing-history');
    return;
  }
  const first = record.history[0];
  if (first?.fromStatus !== '' || first?.toStatus !== CODEX_QUEUE_STATUS.QUEUED) errors.push('history-must-start-queued');
  for (let index = 0; index < record.history.length; index += 1) {
    const entry = record.history[index];
    if (entry?.kind !== CODEX_DISPATCH_HISTORY_KIND) errors.push('invalid-history-kind');
    if (!Object.values(CODEX_QUEUE_STATUS).includes(entry?.toStatus)) errors.push('invalid-history-status');
    if (index > 0) {
      const previous = record.history[index - 1];
      if (entry?.fromStatus !== previous?.toStatus) errors.push('disconnected-history');
      if (!(CODEX_QUEUE_TRANSITIONS[previous?.toStatus] || []).includes(entry?.toStatus)) errors.push('invalid-history-transition');
    }
  }
  if (record.history.at(-1)?.toStatus !== record.status) errors.push('history-status-mismatch');
}

export function validateCodexQueueRecord(record = {}) {
  const errors = [];
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...REQUIRED_KEYS].sort())) errors.push('unbounded-schema');
  if (record.schemaVersion !== CODEX_DISPATCH_QUEUE_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (record.kind !== CODEX_DISPATCH_QUEUE_KIND) errors.push('invalid-kind');
  if (!SAFE_ID_PATTERN.test(text(record.jobId))) errors.push('invalid-job-id');
  if (!Number.isSafeInteger(record.issueNumber) || record.issueNumber <= 0) errors.push('invalid-issue-number');
  if (!SAFE_BRANCH_PATTERN.test(text(record.branch)) || text(record.branch).includes('..')) errors.push('invalid-branch');
  if (!text(record.prompt)) errors.push('missing-prompt');
  if (!Array.isArray(record.requestedProofCommands) || record.requestedProofCommands.length === 0) errors.push('missing-proof-commands');
  for (const command of list(record.requestedProofCommands)) if (!SAFE_COMMAND_PATTERN.test(command) || FORBIDDEN_TEXT_PATTERN.test(command)) errors.push('unsafe-proof-command');
  if (!Object.values(CODEX_QUEUE_STATUS).includes(record.status)) errors.push('invalid-status');
  if (record.approvalRequirements?.requiresExactHeadApproval !== true) errors.push('exact-head-approval-not-required');
  if (!record.integrationState || typeof record.integrationState.automatedCodexDispatchProven !== 'boolean') errors.push('missing-integration-state');
  const expectedIntegrationBlocker = record.integrationState?.automatedCodexDispatchProven === true
    ? ''
    : MISSING_AUTOMATED_INTEGRATION_BLOCKER;
  if (record.integrationState?.blocker !== expectedIntegrationBlocker) {
    errors.push('integration-blocker-mismatch');
  }
  const blockerCode = projectedBlockerCode(record.blockerMetadata);
  const expectedOperatorAction = record.status === CODEX_QUEUE_STATUS.WAITING_OPERATOR_APPROVAL
    || record.blockerMetadata?.operatorActionRequired === true
    || !!blockerCode;
  if (record.sharedWorkspaceMessage?.requiresOperator !== expectedOperatorAction) {
    errors.push('operator-message-mismatch');
  }
  const expectedSeverity = record.status === CODEX_QUEUE_STATUS.BLOCKED
    || record.status === CODEX_QUEUE_STATUS.FAILED
    || expectedOperatorAction
    ? 'warning'
    : 'info';
  if (record.sharedWorkspaceMessage?.severity !== expectedSeverity) {
    errors.push('operator-message-severity-mismatch');
  }
  validateHistory(record, errors);
  if (!Array.isArray(record.proofRequirements?.refs) || record.proofRequirements.refs.length === 0) errors.push('missing-proof-requirement-refs');
  for (const ref of list(record.proofRequirements?.refs)) if (!isSafeCodexQueueProofRef(ref)) errors.push('unsafe-proof-ref');
  if (!validateSharedWorkspaceMessage(record.sharedWorkspaceMessage).valid) errors.push('invalid-shared-workspace-message');
  const uniqueErrors = [...new Set(errors)];
  return { valid: uniqueErrors.length === 0, errors: uniqueErrors, finalVerdict: uniqueErrors.length ? 'CODEX_QUEUE_RECORD_BLOCKED' : 'CODEX_QUEUE_RECORD_PASS' };
}
export const validateCodexQueueItem = validateCodexQueueRecord;

export function transitionCodexQueueRecord(record = {}, nextStatus, input = {}) {
  const validation = validateCodexQueueRecord(record);
  if (!validation.valid) return Object.freeze({ valid: false, error: 'invalid-record', errors: validation.errors, record, finalVerdict: 'CODEX_QUEUE_TRANSITION_REJECTED' });
  const current = record.status;
  const target = canonicalStatus(nextStatus);
  if (!(CODEX_QUEUE_TRANSITIONS[current] || []).includes(target)) {
    return Object.freeze({ valid: false, error: 'invalid-transition', fromStatus: current, toStatus: target, record, finalVerdict: 'CODEX_QUEUE_TRANSITION_REJECTED' });
  }
  const approvalReceipt = text(input.approvalReceipt, record.approvalRequirements?.approvalReceipt);
  if (target === CODEX_QUEUE_STATUS.READY_FOR_MANUAL_DISPATCH && !approvalReceipt) {
    return Object.freeze({ valid: false, error: 'missing-operator-approval-receipt', fromStatus: current, toStatus: target, record, finalVerdict: 'CODEX_QUEUE_TRANSITION_REJECTED' });
  }
  const timestamp = text(input.timestamp || input.timestampUtc, 'pending');
  const next = buildRecord(record, {
    status: target,
    approvalReceipt,
    dispatchedAt: target === CODEX_QUEUE_STATUS.DISPATCHED_MANUAL ? timestamp : record.dispatchedAt,
    completedAt: CODEX_QUEUE_TERMINAL_STATUSES.includes(target) ? timestamp : record.completedAt,
    resultMetadata: input.resultMetadata || record.resultMetadata,
    blockerMetadata: input.blockerMetadata || record.blockerMetadata,
    integrationState: input.integrationState || record.integrationState,
    history: [...record.history, historyEntry({ fromStatus: current, toStatus: target, timestamp, reason: input.reason, metadata: input.metadata })],
  });
  const nextValidation = validateCodexQueueRecord(next);
  if (!nextValidation.valid) return Object.freeze({ valid: false, error: 'invalid-transition-result', errors: nextValidation.errors, fromStatus: current, toStatus: target, record, finalVerdict: 'CODEX_QUEUE_TRANSITION_REJECTED' });
  return Object.freeze({ valid: true, record: next, finalVerdict: 'CODEX_QUEUE_TRANSITION_PASS' });
}

export function buildManualCodexHandoffPacket(record = {}, input = {}) {
  const validation = validateCodexQueueRecord(record);
  const ready = record.status === CODEX_QUEUE_STATUS.READY_FOR_MANUAL_DISPATCH && !!text(record.approvalRequirements?.approvalReceipt);
  return Object.freeze({
    schemaVersion: CODEX_DISPATCH_HANDOFF_SCHEMA_VERSION,
    kind: 'stephanos.codex_dispatch.manual_handoff_packet',
    jobId: text(record.jobId),
    issueNumber: record.issueNumber,
    branch: record.branch,
    status: record.status,
    dispatchMode: 'manual_operator_dispatch_only',
    automatedDispatchBlockedBy: record.integrationState?.automatedCodexDispatchProven ? '' : MISSING_AUTOMATED_INTEGRATION_BLOCKER,
    operatorApprovalReceipt: text(record.approvalRequirements?.approvalReceipt),
    exactHeadApprovalRequired: true,
    prompt: record.prompt,
    proofCommands: [...(record.requestedProofCommands || [])],
    proofRefs: unique([...(record.proofRequirements?.refs || []), ...(input.proofRefs || [])]).filter(isSafeCodexQueueProofRef),
    safety: { ...CODEX_DISPATCH_GUARDRAILS },
    validForManualDispatch: validation.valid && ready,
    finalVerdict: validation.valid && ready ? 'CODEX_MANUAL_HANDOFF_READY' : 'CODEX_MANUAL_HANDOFF_BLOCKED',
  });
}

export function projectCodexQueueDashboard(records = [], input = {}) {
  const safeRecords = records.filter((record) => validateCodexQueueRecord(record).valid).sort((a, b) => a.jobId.localeCompare(b.jobId));
  const counts = Object.fromEntries(Object.values(CODEX_QUEUE_STATUS).map((status) => [status, safeRecords.filter((record) => record.status === status).length]));
  return Object.freeze({
    schemaVersion: CODEX_DISPATCH_DASHBOARD_SCHEMA_VERSION,
    kind: 'stephanos.codex_dispatch.dashboard_projection',
    generatedAt: text(input.generatedAt || input.timestampUtc, 'pending'),
    queueDepth: safeRecords.filter((record) => !CODEX_QUEUE_TERMINAL_STATUSES.includes(record.status)).length,
    counts,
    jobs: safeRecords.map((record) => {
      const blocker = projectedBlockerCode(record.blockerMetadata) || record.integrationState.blocker;
      return Object.freeze({
        jobId: record.jobId,
        issueNumber: record.issueNumber,
        branch: record.branch,
        status: record.status,
        requiresOperator: record.sharedWorkspaceMessage.requiresOperator
          || record.blockerMetadata?.operatorActionRequired === true
          || !!projectedBlockerCode(record.blockerMetadata),
        blocker,
        proofRefs: record.proofRequirements.refs,
      });
    }),
    finalVerdict: 'CODEX_QUEUE_DASHBOARD_READY',
  });
}

export async function writeCodexQueueRecordToSharedWorkspace(root, record, options = {}) {
  const validation = validateCodexQueueRecord(record);
  if (!validation.valid) return { ok: false, reason: validation.errors[0], validation };
  const layout = await ensureSharedWorkspaceLayout({ root, repoRoot: options.repoRoot });
  if (!layout.ok) return { ok: false, reason: layout.reason };
  const resolved = resolveSharedWorkspacePath({ root: layout.root, repoRoot: options.repoRoot, segments: ['codex-dispatch', 'queue', `${record.jobId}.json`] });
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  await mkdir(dirname(resolved.path), { recursive: true });
  const payload = `${JSON.stringify(record, null, 2)}\n`;
  const tmp = `${resolved.path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, payload, { flag: 'wx', mode: 0o600 });
  await rename(tmp, resolved.path);
  return { ok: true, reason: 'CODEX_QUEUE_RECORD_WRITTEN', path: resolved.path, bytes: Buffer.byteLength(payload), validation };
}

export async function readCodexQueueRecordFromSharedWorkspace(root, jobId, options = {}) {
  const id = safeId(jobId, 'invalid-job');
  const resolved = resolveSharedWorkspacePath({ root, repoRoot: options.repoRoot, segments: ['codex-dispatch', 'queue', `${id}.json`] });
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  try {
    const record = JSON.parse(await readFile(resolved.path, 'utf8'));
    const validation = validateCodexQueueRecord(record);
    return { ok: validation.valid, reason: validation.valid ? 'CODEX_QUEUE_RECORD_READ' : validation.errors[0], record, validation };
  } catch {
    return { ok: false, reason: 'CODEX_QUEUE_RECORD_MISSING' };
  }
}

export async function publishCodexQueueStatusToSharedWorkspace(root, record, options = {}) {
  const validation = validateCodexQueueRecord(record);
  if (!validation.valid) return Object.freeze({ ok: false, reason: validation.errors[0], validation, writes: [], finalVerdict: 'CODEX_QUEUE_WORKSPACE_PUBLISH_BLOCKED' });
  const timestampUtc = text(options.timestampUtc, record.completedAt || record.dispatchedAt || record.createdAt || 'pending');
  const statusRecord = createSharedWorkspaceStatusRecord({
    statusId: 'codex-dispatch-queue',
    timestampUtc,
    status: record.status,
    summary: `Codex dispatch queue ${record.jobId} is ${record.status}.`,
    proofRefs: record.proofRequirements.refs,
  });
  const eventRecord = createSharedWorkspaceEventRecord({
    eventId: `${record.jobId}-event`,
    timestampUtc,
    eventKind: eventKindForStatus(record.status),
    summary: record.sharedWorkspaceMessage.summary,
  });
  const statusWrite = await writeAtomicJson(root, ['status', 'codex-dispatch-queue.json'], statusRecord, options);
  if (!statusWrite.ok) return Object.freeze({ ok: false, reason: statusWrite.reason, statusWrite, finalVerdict: 'CODEX_QUEUE_WORKSPACE_PUBLISH_BLOCKED' });
  const eventWrite = await appendWorkspaceJsonl(root, ['events', 'codex-dispatch-queue.jsonl'], eventRecord, options);
  return Object.freeze({
    ok: eventWrite.ok,
    reason: eventWrite.ok ? 'CODEX_QUEUE_STATUS_PUBLISHED' : eventWrite.reason,
    record,
    statusWrite,
    eventWrite,
    statusRecord,
    eventRecord,
    validation,
    finalVerdict: eventWrite.ok ? 'CODEX_QUEUE_WORKSPACE_PUBLISH_PASS' : 'CODEX_QUEUE_WORKSPACE_PUBLISH_BLOCKED',
  });
}
export const publishCodexQueueRecordToSharedWorkspace = publishCodexQueueStatusToSharedWorkspace;
export const publishCodexQueueRecord = publishCodexQueueStatusToSharedWorkspace;
export const publishCodexQueueItemToSharedWorkspace = publishCodexQueueStatusToSharedWorkspace;
export const publishCodexQueueItem = publishCodexQueueStatusToSharedWorkspace;

export function createCodexQueueRecordVerifierResult(packet = {}, options = {}) {
  const record = packet.record || packet;
  const validation = validateCodexQueueRecord(record);
  return Object.freeze({
    checkId: 'codex-queue-record-proof',
    verifierType: 'CodexQueueRecordVerifier',
    status: validation.valid ? 'PASS' : 'BLOCKED',
    target: record.jobId || 'codex-dispatch-queue-record',
    evidence: [`valid=${validation.valid}`, `status=${record.status || 'unknown'}`, `proofRefs=${record.proofRequirements?.refs?.length || 0}`, `approvalRequired=${record.approvalRequirements?.requiresOperatorApprovalBeforeDispatch === true}`],
    reason: validation.valid ? '' : validation.errors[0],
    timestampUtc: options.timestampUtc || record.createdAt || 'pending',
    finalVerdict: validation.valid ? 'CODEX_QUEUE_RECORD_VERIFIER_PASS' : 'CODEX_QUEUE_RECORD_VERIFIER_BLOCKED',
    proofRefs: record.proofRequirements?.refs || [],
  });
}
