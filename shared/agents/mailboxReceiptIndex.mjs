import { readFile, readdir } from 'node:fs/promises';

import {
  createSharedWorkspaceStatusRecord,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';

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
const OPERATION_PATTERN = /^[A-Z][A-Z0-9_]{2,80}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SAFE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const SAFE_BLOCKER_PATTERN = /^[A-Z0-9][A-Z0-9._:-]{0,159}$/;
const SAFE_STATE = new Set(['ACCEPTED', 'RUNNING', 'DONE', 'BLOCKED']);
const SECRET_OR_PATH_PATTERN = /secret|token|session|password|credential|private[_-]?key|api[_-]?key|cookie|\.env\b|BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY|[A-Za-z]:[\\/]|(?:^|[\\/])\.\.(?:[\\/]|$)/i;

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

function receiptTimestamp(receipt = {}) {
  return safeTimestamp(receipt.completedAt || receipt.heartbeatAt || receipt.acceptedAt);
}

function sortTimestamp(receipt = {}) {
  return Date.parse(receiptTimestamp(receipt)) || 0;
}

export function sanitizeMailboxReceiptForIndex(receipt = {}) {
  const execution = receipt?.result || {};
  const operationResult = execution?.result || {};
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
    sourceHead: safeSha(operationResult?.sourceHead || operationResult?.recoveredHead),
    branch: String(operationResult?.branch || receipt?.branch || '') === 'main' ? 'main' : '',
    expectedHeadMatch: operationResult?.expectedHeadMatch === true,
    blocker: safeBlocker(receipt?.blocker || operationResult?.blocker),
    finalVerdict: safeVerdict(operationResult?.finalVerdict || execution?.verdict),
    proofWrittenToSharedWorkspace: operationResult?.proofWrittenToSharedWorkspace === true,
    monitorCount: safeCount(operationResult?.monitorCount),
    executedCount: safeCount(operationResult?.executedCount),
    notificationCount: safeCount(operationResult?.notificationCount),
    notificationSurface: safeOperation(String(operationResult?.notificationSurface || '').replace(/-/g, '_')),
    proofRefs: safeProofRefs([...(receipt?.proofRefs || []), ...(operationResult?.proofRefs || [])]),
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
  const safeNames = names
    .filter((name) => name.endsWith('.json') && REQUEST_ID_PATTERN.test(name.slice(0, -5)))
    .sort()
    .slice(-Math.max(1, Math.min(MAILBOX_RECEIPT_INDEX_MAX_FILES, Number(maxFiles) || MAILBOX_RECEIPT_INDEX_MAX_FILES)));
  const receipts = [];
  for (const name of safeNames) {
    const file = resolveSharedWorkspacePath({ root, repoRoot, segments: ['receipts', 'github-command-mailbox', name] });
    if (!file.ok) continue;
    try {
      const payload = await readFile(file.path, 'utf8');
      if (Buffer.byteLength(payload, 'utf8') > MAILBOX_RECEIPT_INDEX_MAX_FILE_BYTES) continue;
      const receipt = JSON.parse(payload);
      if (String(receipt?.requestId || '') === name.slice(0, -5)) receipts.push(receipt);
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

export async function readMailboxReceiptIndex({ root, repoRoot } = {}) {
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
  const validation = validateSharedWorkspaceRecord(record);
  if (!validation.valid
    || record?.statusId !== MAILBOX_RECEIPT_INDEX_STATUS_ID
    || record?.receiptIndexSchemaVersion !== MAILBOX_RECEIPT_INDEX_SCHEMA_VERSION) {
    return { ok: false, blocker: 'MAILBOX_RECEIPT_INDEX_RECORD_INVALID', finalVerdict: 'MAILBOX_RECEIPT_INDEX_BLOCKED' };
  }
  return {
    ok: true,
    blocker: '',
    finalVerdict: 'MAILBOX_RECEIPT_INDEX_READ_READY',
    projection: createMailboxReceiptIndexProjection(record),
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
