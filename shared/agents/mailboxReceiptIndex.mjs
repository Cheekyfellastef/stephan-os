import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  DEFAULT_STALE_AFTER_MS,
  createSharedWorkspaceStatusRecord,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import { isReadableMailboxReceiptFilename } from './windowsSafeMailboxReceiptFilename.mjs';

export const MAILBOX_RECEIPT_INDEX_SCHEMA_VERSION = 'stephanos.mailbox-receipt-index.v1';
export const MAILBOX_RECEIPT_INDEX_STATUS_ID = 'battle-bridge-mailbox-receipt-index';
export const MAILBOX_RECEIPT_INDEX_PARTICIPANT_ID = 'battle-bridge-mailbox';
export const MAILBOX_RECEIPT_INDEX_FILENAME = 'battle-bridge-mailbox-receipt-index.json';
export const MAILBOX_RECEIPT_INDEX_GITHUB_MARKER = 'stephanos-battle-bridge-receipt-index';
export const MAILBOX_RECEIPT_INDEX_MAX_RECENT = 20;
export const MAILBOX_RECEIPT_INDEX_MAX_FILES = 200;
export const MAILBOX_RECEIPT_INDEX_MAX_FILE_BYTES = 256 * 1024;
export const MAILBOX_RECEIPT_INDEX_MAX_GITHUB_BYTES = 9 * 1024;

const RECEIPT_MARKER = 'stephanos-battle-bridge-command-receipt';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const RECEIPT_FILENAME_PATTERN = /^(?:[A-Za-z0-9][A-Za-z0-9._-]{7,120}|_request-[0-9a-f]{32})\.json$/;
const OPERATION_PATTERN = /^[A-Z][A-Z0-9_]{2,80}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SAFE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const SAFE_BLOCKER_PATTERN = /^[A-Z0-9][A-Z0-9._:-]{0,159}$/;
const SAFE_STATE = new Set(['ACCEPTED', 'RUNNING', 'DONE', 'BLOCKED']);
const SECRET_OR_PATH_PATTERN = /(?:secret|token|session|password|credential|private[_-]?key|api[_-]?key|cookie|authorization\s*[:=]|bearer\s+|\.env\b|BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY|(?:^|[\s=:(\[])(?:~?\/|[A-Za-z]:[\\/]|\\\\)|(?:^|[\s=:(\[])\.\.(?:[\\/]|$)|\b(?:sk(?:-proj)?|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,})/i;

function safeTimestamp(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function safeRequestId(value) {
  const text = String(value || '').trim();
  return REQUEST_ID_PATTERN.test(text) ? text : '';
}

function safeOperation(value) {
  const text = String(value || '').trim().toUpperCase();
  return OPERATION_PATTERN.test(text) ? text : '';
}

function safeSha(value) {
  const text = String(value || '').trim().toLowerCase();
  return SHA_PATTERN.test(text) ? text : '';
}

function safeState(value) {
  const text = String(value || '').trim().toUpperCase();
  return SAFE_STATE.has(text) ? text : '';
}

function safeBlocker(value) {
  const text = String(value || '').trim().toUpperCase();
  if (!text || SECRET_OR_PATH_PATTERN.test(text) || !SAFE_BLOCKER_PATTERN.test(text)) return '';
  return text;
}

function safeVerdict(value) {
  const text = String(value || '').trim().toUpperCase();
  if (!text || text.length > 160 || SECRET_OR_PATH_PATTERN.test(text) || !SAFE_BLOCKER_PATTERN.test(text)) return '';
  return text;
}

function safeProofRefs(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(String).filter((ref) => SAFE_REF_PATTERN.test(ref) && !ref.includes('..') && !SECRET_OR_PATH_PATTERN.test(ref)))].slice(0, 20)
    : [];
}

function safeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function safeTelemetryText(value, limit = 500) {
  const normalized = String(value ?? '').trim();
  if (SECRET_OR_PATH_PATTERN.test(normalized)) return '';
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function safeTelemetryId(value) {
  const normalized = safeTelemetryText(value, 160);
  return /^[A-Za-z0-9][A-Za-z0-9._:#-]{1,159}$/.test(normalized) ? normalized : '';
}

function safeTelemetryBranch(value) {
  const normalized = safeTelemetryText(value, 240);
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/.test(normalized) && !normalized.includes('..')
    ? normalized
    : '';
}

function isExactWindowsProofOperation(receipt = {}, operationResult = {}) {
  return receipt?.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF'
    || operationResult?.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF';
}

function projectedExpectedHeadMatch(receipt = {}, operationResult = {}) {
  const expectedHead = String(receipt?.expectedHead || operationResult?.expectedHead || '').trim().toLowerCase();
  if (isExactWindowsProofOperation(receipt, operationResult)) {
    const pullRequestHead = String(operationResult?.pullRequestHead || '').trim().toLowerCase();
    const localHead = String(operationResult?.localHead || '').trim().toLowerCase();
    const proofTarget = String(receipt?.proofTarget || operationResult?.proofTarget || 'PULL_REQUEST_HEAD');
    const mergeCommitHead = String(operationResult?.mergeCommitHead || '').trim().toLowerCase();
    const githubMainHead = String(operationResult?.githubMainHead || '').trim().toLowerCase();
    if (proofTarget === 'MERGED_MAIN') {
      return SHA_PATTERN.test(expectedHead)
        && SHA_PATTERN.test(pullRequestHead)
        && SHA_PATTERN.test(mergeCommitHead)
        && SHA_PATTERN.test(githubMainHead)
        && SHA_PATTERN.test(localHead)
        && operationResult?.mergeCommitIncluded === true
        && expectedHead === githubMainHead
        && expectedHead === localHead;
    }
    return SHA_PATTERN.test(expectedHead)
      && SHA_PATTERN.test(pullRequestHead)
      && SHA_PATTERN.test(localHead)
      && expectedHead === pullRequestHead
      && expectedHead === localHead;
  }
  if (typeof operationResult?.expectedHeadMatch === 'boolean') return operationResult.expectedHeadMatch;
  const sourceHead = String(operationResult?.sourceHead || '').trim().toLowerCase();
  return SHA_PATTERN.test(expectedHead) && SHA_PATTERN.test(sourceHead) && expectedHead === sourceHead;
}

function safeTelemetrySha(value) {
  return safeSha(value);
}

function telemetryPosture(value = {}) {
  return Object.freeze({
    state: safeTelemetryText(value?.state || 'UNKNOWN', 80).toUpperCase(),
    allGreen: value?.allGreen === true,
    mergeable: typeof value?.mergeable === 'boolean' ? value.mergeable : null,
    summary: safeTelemetryText(value?.summary, 300),
    proofRefs: safeProofRefs(value?.proofRefs),
  });
}

function telemetryReceipt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.freeze({
    repository: safeTelemetryText(value.repository, 160),
    issueNumber: safeCount(value.issueNumber),
    prNumber: safeCount(value.prNumber),
    branch: safeTelemetryBranch(value.branch),
    sourceHead: safeTelemetrySha(value.sourceHead),
    workerId: safeTelemetryId(value.workerId),
    workerType: safeTelemetryId(value.workerType),
    executionId: safeTelemetryId(value.executionId),
    leaseKey: safeTelemetryId(value.leaseKey),
    state: safeTelemetryText(value.state, 80).toUpperCase(),
    phase: safeTelemetryText(value.phase, 120).toUpperCase(),
    sequence: safeCount(value.sequence),
    timestampUtc: safeTimestamp(value.timestampUtc),
    heartbeatExpiresAtUtc: safeTimestamp(value.heartbeatExpiresAtUtc),
    blocker: safeTelemetryText(value.blocker, 200),
    operatorActionRequired: value.operatorActionRequired === true,
    expectedNextAction: safeTelemetryText(value.expectedNextAction, 500),
    proofRefs: safeProofRefs(value.proofRefs),
  });
}

export function sanitizeWorkerTelemetryForIndex(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const worker = value.worker || {};
  const task = value.task || {};
  const heartbeat = value.heartbeat || {};
  const lease = value.lease || {};
  const posture = value.testsChecksReview || {};
  return Object.freeze({
    schemaVersion: safeTelemetryText(value.schemaVersion, 120),
    ok: value.ok === true,
    workerActive: value.workerActive === true,
    workerAlive: typeof value.workerAlive === 'boolean' ? value.workerAlive : null,
    workerStatus: safeTelemetryText(value.workerStatus, 80).toUpperCase(),
    worker: Object.freeze({
      pid: safeCount(worker.pid),
      observedPid: safeCount(worker.observedPid),
      commandIdentity: safeTelemetryText(worker.commandIdentity, 240),
      commandLineVerified: worker.commandLineVerified === true,
      taskName: safeTelemetryText(worker.taskName, 160),
      scheduledTaskState: safeTelemetryText(worker.scheduledTaskState, 80).toUpperCase(),
    }),
    task: Object.freeze({
      taskId: safeTelemetryId(task.taskId),
      goalId: safeTelemetryText(task.goalId, 160),
      issueNumber: safeCount(task.issueNumber),
      prNumber: safeCount(task.prNumber),
      branch: safeTelemetryBranch(task.branch),
      headSha: safeTelemetrySha(task.headSha),
      phase: safeTelemetryText(task.phase, 120).toUpperCase(),
      boundedAction: safeTelemetryText(task.boundedAction, 500),
    }),
    heartbeat: Object.freeze({
      timestampUtc: safeTimestamp(heartbeat.timestampUtc),
      ageMs: heartbeat.ageMs === null ? null : safeCount(heartbeat.ageMs),
      fresh: heartbeat.fresh === true,
      headSha: safeTelemetrySha(heartbeat.headSha),
      branch: safeTelemetryBranch(heartbeat.branch),
      tickVerdict: safeTelemetryText(heartbeat.tickVerdict, 120),
      errors: Array.isArray(heartbeat.errors)
        ? heartbeat.errors.map((item) => safeTelemetryText(item, 160)).filter(Boolean).slice(0, 20)
        : [],
    }),
    lease: Object.freeze({
      observed: lease.observed === true,
      valid: lease.valid === true,
      active: lease.active === true,
      leaseId: safeTelemetryId(lease.leaseId),
      laneId: safeTelemetryId(lease.laneId),
      ownerId: safeTelemetryId(lease.ownerId),
      repository: safeTelemetryText(lease.repository, 160),
      issueNumber: safeCount(lease.issueNumber),
      prNumber: safeCount(lease.prNumber),
      branch: safeTelemetryBranch(lease.branch),
      headSha: safeTelemetrySha(lease.headSha),
      acquiredAtUtc: safeTimestamp(lease.acquiredAtUtc),
      renewedAtUtc: safeTimestamp(lease.renewedAtUtc),
      expiresAtUtc: safeTimestamp(lease.expiresAtUtc),
      errors: Array.isArray(lease.errors)
        ? lease.errors.map((item) => safeTelemetryText(item, 160)).filter(Boolean).slice(0, 20)
        : [],
    }),
    latestExecutionReceipt: telemetryReceipt(value.latestExecutionReceipt),
    testsChecksReview: Object.freeze({
      tests: telemetryPosture(posture.tests),
      checks: telemetryPosture(posture.checks),
      review: telemetryPosture(posture.review),
    }),
    blockers: Array.isArray(value.blockers)
      ? value.blockers.map((item) => safeTelemetryText(item, 200)).filter(Boolean).slice(0, 30)
      : [],
    operatorActionRequired: value.operatorActionRequired === true,
    nextAction: safeTelemetryText(value.nextAction, 600),
    evidenceRefs: Object.freeze([
      'status/mission-orchestrator-worker-heartbeat.json',
      'status/source-mutation-lease-current.json',
      'status/battle-bridge-mailbox-receipt-index.json',
    ]),
    finalVerdict: safeTelemetryText(value.finalVerdict, 120).toUpperCase(),
  });
}

function receiptTimestamp(receipt = {}) {
  return safeTimestamp(receipt.completedAt || receipt.heartbeatAt || receipt.acceptedAt);
}

function sortTimestamp(receipt = {}) {
  return Date.parse(receiptTimestamp(receipt)) || 0;
}

export function sanitizeMailboxReceiptForIndex(receipt = {}) {
  const execution = receipt?.result || {};
  const operationResult = execution?.result && typeof execution.result === 'object' ? execution.result : receipt;
  const workerTelemetry = sanitizeWorkerTelemetryForIndex(operationResult?.workerTelemetry);
  const requestId = safeRequestId(receipt?.requestId);
  if (!requestId) return null;
  return Object.freeze({
    requestId,
    operation: safeOperation(receipt?.operation),
    state: safeState(receipt?.state),
    acceptedAt: safeTimestamp(receipt?.acceptedAt),
    heartbeatAt: safeTimestamp(receipt?.heartbeatAt),
    completedAt: safeTimestamp(receipt?.completedAt),
    expectedHead: safeSha(receipt?.expectedHead || operationResult?.expectedHead),
    prNumber: safeCount(receipt?.prNumber || operationResult?.prNumber),
    proofScenario: safeOperation(receipt?.proofScenario || operationResult?.proofScenario),
    proofTarget: safeOperation(receipt?.proofTarget || operationResult?.proofTarget || ''),
    taskId: safeTelemetryId(receipt?.taskId || operationResult?.taskId),
    pullRequestHead: safeSha(operationResult?.pullRequestHead),
    mergeCommitHead: safeSha(operationResult?.mergeCommitHead),
    githubMainHead: safeSha(operationResult?.githubMainHead),
    mergeCommitIncluded: operationResult?.mergeCommitIncluded === true,
    localHead: safeSha(operationResult?.localHead),
    sourceHead: safeSha(operationResult?.sourceHead || operationResult?.recoveredHead),
    branch: String(operationResult?.branch || receipt?.branch || '') === 'main' ? 'main' : '',
    expectedHeadMatch: projectedExpectedHeadMatch(receipt, operationResult),
    blocker: safeBlocker(receipt?.blocker || operationResult?.blocker),
    finalVerdict: safeVerdict(operationResult?.finalVerdict || receipt?.finalVerdict || execution?.verdict),
    proofWrittenToSharedWorkspace: operationResult?.proofWrittenToSharedWorkspace === true,
    monitorCount: safeCount(operationResult?.monitorCount),
    executedCount: safeCount(operationResult?.executedCount),
    notificationCount: safeCount(operationResult?.notificationCount),
    notificationSurface: safeOperation(String(operationResult?.notificationSurface || '').replace(/-/g, '_')),
    proofRefs: safeProofRefs([...(receipt?.proofRefs || []), ...(operationResult?.proofRefs || [])]),
    workerTelemetry,
  });
}

function uniqueLatest(receipts = []) {
  const byRequestId = new Map();
  for (const raw of receipts) {
    const receipt = sanitizeMailboxReceiptForIndex(raw);
    if (!receipt) continue;
    const previous = byRequestId.get(receipt.requestId);
    if (!previous || sortTimestamp(receipt) >= sortTimestamp(previous)) byRequestId.set(receipt.requestId, receipt);
  }
  return [...byRequestId.values()].sort((a, b) => sortTimestamp(b) - sortTimestamp(a) || b.requestId.localeCompare(a.requestId));
}

export function createMailboxReceiptIndexRecord({
  receipts = [],
  timestampUtc = new Date().toISOString(),
  maxRecent = MAILBOX_RECEIPT_INDEX_MAX_RECENT,
} = {}) {
  const safeTimestampUtc = safeTimestamp(timestampUtc) || new Date(0).toISOString();
  const ordered = uniqueLatest(receipts);
  const activeReceipt = ordered.find((receipt) => receipt.state === 'ACCEPTED' || receipt.state === 'RUNNING') || null;
  const recentReceipts = ordered.filter((receipt) => receipt !== activeReceipt).slice(0, Math.max(1, Math.min(MAILBOX_RECEIPT_INDEX_MAX_RECENT, Number(maxRecent) || MAILBOX_RECEIPT_INDEX_MAX_RECENT)));
  const latest = activeReceipt || recentReceipts[0] || null;
  const status = activeReceipt ? 'ACTIVE' : (latest?.state === 'BLOCKED' ? 'ATTENTION_REQUIRED' : 'READY');
  const proofRefs = safeProofRefs(ordered.flatMap((receipt) => receipt.proofRefs));
  const record = {
    ...createSharedWorkspaceStatusRecord({
      statusId: MAILBOX_RECEIPT_INDEX_STATUS_ID,
      participantId: MAILBOX_RECEIPT_INDEX_PARTICIPANT_ID,
      timestampUtc: safeTimestampUtc,
      status,
      summary: activeReceipt
        ? `Battle Bridge mailbox request ${activeReceipt.requestId} is active.`
        : `${recentReceipts.length} recent Battle Bridge mailbox receipt${recentReceipts.length === 1 ? '' : 's'} are indexed.`,
      proofRefs,
    }),
    receiptIndexSchemaVersion: MAILBOX_RECEIPT_INDEX_SCHEMA_VERSION,
    authoritativeSource: 'shared-workspace-receipts/github-command-mailbox',
    accessMode: 'bounded-shared-workspace-read',
    consumerIds: ['stephanos', 'openclaw', 'chatgpt', 'operator', 'future-agents'],
    githubMirrorEnabled: true,
    activeReceipt,
    recentReceipts,
    indexedReceiptCount: ordered.length,
    maxRecentReceipts: MAILBOX_RECEIPT_INDEX_MAX_RECENT,
    finalVerdict: activeReceipt ? 'MAILBOX_RECEIPT_INDEX_ACTIVE' : 'MAILBOX_RECEIPT_INDEX_READY',
    arbitraryFilesystemAccess: false,
    commandExecutionAccess: false,
    sourceMutationAccess: false,
  };
  const validation = validateSharedWorkspaceRecord(record, { nowMs: Date.parse(safeTimestampUtc) });
  if (!validation.valid) throw new Error(`MAILBOX_RECEIPT_INDEX_RECORD_INVALID:${validation.errors.join(',')}`);
  return Object.freeze(record);
}

export function createMailboxReceiptIndexProjection(record = {}) {
  const activeReceipt = sanitizeMailboxReceiptForIndex(record?.activeReceipt);
  const recentReceipts = Array.isArray(record?.recentReceipts)
    ? record.recentReceipts.map(sanitizeMailboxReceiptForIndex).filter(Boolean).slice(0, MAILBOX_RECEIPT_INDEX_MAX_RECENT)
    : [];
  return Object.freeze({
    schemaVersion: MAILBOX_RECEIPT_INDEX_SCHEMA_VERSION,
    updatedAt: safeTimestamp(record?.timestampUtc),
    status: ['ACTIVE', 'ATTENTION_REQUIRED', 'READY'].includes(String(record?.status || '')) ? String(record.status) : 'READY',
    activeReceipt,
    recentReceipts,
    indexedReceiptCount: safeCount(record?.indexedReceiptCount),
    authoritativeSource: 'Shared Workspace',
    accessMode: 'bounded-read',
    consumerIds: ['stephanos', 'openclaw', 'chatgpt', 'operator', 'future-agents'],
    arbitraryFilesystemAccess: false,
    commandExecutionAccess: false,
    sourceMutationAccess: false,
  });
}

export async function loadMailboxReceiptsFromSharedWorkspace({
  root,
  repoRoot,
  maxFiles = MAILBOX_RECEIPT_INDEX_MAX_FILES,
} = {}) {
  const resolved = resolveSharedWorkspacePath({ root, repoRoot, segments: ['receipts', 'github-command-mailbox'] });
  if (!resolved.ok) return { ok: false, reason: resolved.reason, receipts: [] };
  let names;
  try {
    names = await readdir(resolved.path);
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, reason: 'MAILBOX_RECEIPT_DIRECTORY_EMPTY', receipts: [] };
    return { ok: false, reason: 'MAILBOX_RECEIPT_DIRECTORY_READ_FAILED', receipts: [] };
  }
  const candidates = [];
  for (const name of names.filter((item) => RECEIPT_FILENAME_PATTERN.test(item))) {
    const filePath = join(resolved.path, name);
    try {
      const info = await lstat(filePath);
      if (info.isFile()) candidates.push({ name, path: filePath, mtimeMs: info.mtimeMs });
    } catch {}
  }
  const boundedFileCount = Math.max(1, Math.min(MAILBOX_RECEIPT_INDEX_MAX_FILES, Number(maxFiles) || MAILBOX_RECEIPT_INDEX_MAX_FILES));
  const newestCandidates = candidates
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
    .slice(0, boundedFileCount);
  const receipts = [];
  for (const candidate of newestCandidates) {
    try {
      const payload = await readFile(candidate.path, 'utf8');
      if (Buffer.byteLength(payload, 'utf8') > MAILBOX_RECEIPT_INDEX_MAX_FILE_BYTES) continue;
      const receipt = JSON.parse(payload);
      const requestId = String(receipt?.requestId || '');
      if (
        REQUEST_ID_PATTERN.test(requestId)
        && isReadableMailboxReceiptFilename(candidate.name, requestId)
      ) {
        receipts.push(receipt);
      }
    } catch {}
  }
  return { ok: true, reason: 'MAILBOX_RECEIPTS_LOADED', receipts };
}

export async function refreshMailboxReceiptIndex({
  root,
  repoRoot,
  timestampUtc = new Date().toISOString(),
  maxRecent = MAILBOX_RECEIPT_INDEX_MAX_RECENT,
} = {}) {
  const loaded = await loadMailboxReceiptsFromSharedWorkspace({ root, repoRoot });
  if (!loaded.ok) return { ok: false, blocker: loaded.reason, finalVerdict: 'MAILBOX_RECEIPT_INDEX_BLOCKED' };
  const record = createMailboxReceiptIndexRecord({ receipts: loaded.receipts, timestampUtc, maxRecent });
  const write = await writeAtomicJson(root, ['status', MAILBOX_RECEIPT_INDEX_FILENAME], record, { repoRoot, nowMs: Date.parse(record.timestampUtc) });
  return {
    ok: write.ok,
    blocker: write.ok ? '' : write.reason,
    finalVerdict: write.ok ? 'MAILBOX_RECEIPT_INDEX_READY' : 'MAILBOX_RECEIPT_INDEX_BLOCKED',
    record,
    projection: createMailboxReceiptIndexProjection(record),
    proofRefs: safeProofRefs(record.proofRefs),
    arbitraryFilesystemAccess: false,
    commandExecutionAccess: false,
    sourceMutationAccess: false,
  };
}

export async function readMailboxReceiptIndex({
  root,
  repoRoot,
  nowMs = Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  const resolved = resolveSharedWorkspacePath({ root, repoRoot, segments: ['status', MAILBOX_RECEIPT_INDEX_FILENAME] });
  if (!resolved.ok) return { ok: false, blocker: resolved.reason, finalVerdict: 'MAILBOX_RECEIPT_INDEX_BLOCKED' };
  let payload;
  try {
    payload = await readFile(resolved.path, 'utf8');
  } catch {
    return { ok: false, blocker: 'MAILBOX_RECEIPT_INDEX_NOT_FOUND', finalVerdict: 'MAILBOX_RECEIPT_INDEX_BLOCKED' };
  }
  if (Buffer.byteLength(payload, 'utf8') > MAILBOX_RECEIPT_INDEX_MAX_FILE_BYTES) {
    return { ok: false, blocker: 'MAILBOX_RECEIPT_INDEX_TOO_LARGE', finalVerdict: 'MAILBOX_RECEIPT_INDEX_BLOCKED' };
  }
  let record;
  try { record = JSON.parse(payload); } catch {
    return { ok: false, blocker: 'MAILBOX_RECEIPT_INDEX_JSON_INVALID', finalVerdict: 'MAILBOX_RECEIPT_INDEX_BLOCKED' };
  }
  const validation = validateSharedWorkspaceRecord(record, { nowMs, staleAfterMs });
  if (!validation.valid
    || record?.statusId !== MAILBOX_RECEIPT_INDEX_STATUS_ID
    || record?.receiptIndexSchemaVersion !== MAILBOX_RECEIPT_INDEX_SCHEMA_VERSION) {
    return { ok: false, blocker: 'MAILBOX_RECEIPT_INDEX_RECORD_INVALID', finalVerdict: 'MAILBOX_RECEIPT_INDEX_BLOCKED' };
  }
  const projection = createMailboxReceiptIndexProjection(record);
  if (validation.stale) {
    return {
      ok: false,
      blocker: 'MAILBOX_RECEIPT_INDEX_STALE',
      finalVerdict: 'MAILBOX_RECEIPT_INDEX_STALE',
      stale: true,
      projection,
      arbitraryFilesystemAccess: false,
      commandExecutionAccess: false,
      sourceMutationAccess: false,
    };
  }
  return {
    ok: true,
    blocker: '',
    finalVerdict: 'MAILBOX_RECEIPT_INDEX_READ_READY',
    stale: false,
    projection,
    arbitraryFilesystemAccess: false,
    commandExecutionAccess: false,
    sourceMutationAccess: false,
  };
}

export function extractMailboxReceiptFromGitHubComment(comment = {}) {
  const body = String(comment?.body || '');
  if (!body.includes(`<!-- ${RECEIPT_MARKER} -->`)) return null;
  const match = body.match(/```json\s*([\s\S]*?)```/i);
  if (!match) return null;
  try {
    const receipt = JSON.parse(match[1]);
    return sanitizeMailboxReceiptForIndex(receipt) ? receipt : null;
  } catch {
    return null;
  }
}

export function createMailboxReceiptIndexFromGitHubComments(comments = [], { timestampUtc = new Date().toISOString() } = {}) {
  const receipts = comments.map(extractMailboxReceiptFromGitHubComment).filter(Boolean);
  return createMailboxReceiptIndexRecord({ receipts, timestampUtc });
}

export function buildMailboxReceiptIndexGitHubBody(record = {}) {
  let projection = createMailboxReceiptIndexProjection(record);
  let json = JSON.stringify(projection, null, 2);
  while (Buffer.byteLength(json, 'utf8') > MAILBOX_RECEIPT_INDEX_MAX_GITHUB_BYTES && projection.recentReceipts.length > 1) {
    projection = Object.freeze({ ...projection, recentReceipts: projection.recentReceipts.slice(0, -1) });
    json = JSON.stringify(projection, null, 2);
  }
  if (Buffer.byteLength(json, 'utf8') > MAILBOX_RECEIPT_INDEX_MAX_GITHUB_BYTES) {
    throw new Error('MAILBOX_RECEIPT_INDEX_GITHUB_PROJECTION_TOO_LARGE');
  }
  return [
    `<!-- ${MAILBOX_RECEIPT_INDEX_GITHUB_MARKER} -->`,
    '```json',
    json,
    '```',
  ].join('\n');
}

export function findMailboxReceiptIndexComment(comments = []) {
  return comments.find((comment) => String(comment?.body || '').includes(`<!-- ${MAILBOX_RECEIPT_INDEX_GITHUB_MARKER} -->`)) || null;
}
