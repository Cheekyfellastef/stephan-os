import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDefaultSharedWorkspaceRoot } from './sharedWorkspaceRuntimeConfig.mjs';
import {
  SHARED_WORKSPACE_DIRECTORIES,
  createSharedWorkspaceMessage,
} from './sharedAgentWorkspace.mjs';

export const SHARED_WORKSPACE_RECORD_SCHEMA_VERSION = 'shared-agent-workspace-record.v1';
export const SHARED_WORKSPACE_RECORD_KINDS = Object.freeze({
  GOAL: 'stephanos.shared_workspace.goal',
  STATUS: 'stephanos.shared_workspace.status',
  PROOF: 'stephanos.shared_workspace.proof',
  CAPABILITY: 'stephanos.shared_workspace.agent_capability',
  EVENT: 'stephanos.shared_workspace.event',
  MESSAGE: 'stephanos.shared_workspace.record.message',
  RECEIPT: 'stephanos.shared_workspace.record.receipt',
  HANDOFF: 'stephanos.shared_workspace.record.handoff',
  PARTICIPANT_STATUS: 'stephanos.shared_workspace.record.participant_status',
});
export const SHARED_WORKSPACE_RUNTIME_DIRECTORIES = Object.freeze([
  ...SHARED_WORKSPACE_DIRECTORIES,
  'goals',
  'capabilities',
]);
export const OPENCLAW_DEFAULT_CAPABILITY = Object.freeze({
  agentId: 'openclaw',
  mode: 'design_only',
  boundedWritePath: '/courier-open',
  trustedBuilder: false,
  mergeAuthority: false,
  arbitraryShellAllowed: false,
});
export const DEFAULT_STALE_AFTER_MS = 60 * 60 * 1000;

const SAFE_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const MAX_RECORD_BODY_BYTES = 16 * 1024;
const FORBIDDEN_KEY = /secret|token|session|env|password|credential|privatekey|private_key|api[_-]?key|cache|log/i;
const FORBIDDEN_VALUE = /BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY|\.env\b|node_modules|apps\/stephanos\/dist|runtime-data|session\b/i;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function timestampMs(value) {
  const ms = Date.parse(text(value));
  return Number.isFinite(ms) ? ms : NaN;
}

function isWithin(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function assertNoSecrets(value, path = []) {
  if (Array.isArray(value)) return value.flatMap((item, index) => assertNoSecrets(item, [...path, String(index)]));
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' && FORBIDDEN_VALUE.test(value) ? [`forbidden-secret-value:${path.join('.') || 'value'}`] : [];
  }
  const errors = [];
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) errors.push(`forbidden-secret-field:${[...path, key].join('.')}`);
    errors.push(...assertNoSecrets(child, [...path, key]));
  }
  return errors;
}

function safeId(value) {
  return SAFE_SEGMENT.test(text(value)) ? text(value) : '';
}

function bytes(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8');
}

function list(value) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function firstRecordId(record = {}) {
  return record.recordId || record.messageId || record.receiptId || record.handoffId || record.participantStatusId || record.agentId || record.goalId || record.proofId || record.statusId || record.eventId;
}

function hasRequiredIssueOrPr(record = {}) {
  return Boolean(text(record.relatedIssue) || text(record.relatedPr));
}

function isWorkspaceRuntimeRecordKind(kind) {
  return [
    SHARED_WORKSPACE_RECORD_KINDS.MESSAGE,
    SHARED_WORKSPACE_RECORD_KINDS.RECEIPT,
    SHARED_WORKSPACE_RECORD_KINDS.HANDOFF,
    SHARED_WORKSPACE_RECORD_KINDS.PARTICIPANT_STATUS,
  ].includes(kind);
}

export function resolveSharedWorkspacePath(input = {}) {
  const rootInput = text(input.root || process.env.STEPHANOS_SHARED_AGENT_WORKSPACE || getDefaultSharedWorkspaceRoot(input));
  if (!rootInput || rootInput.includes('\0')) return { ok: false, reason: 'UNSAFE_WORKSPACE_PATH', path: '' };
  if (/%[A-Z_]+%/i.test(rootInput)) return { ok: false, reason: 'WORKSPACE_PATH_MISSING', path: '' };
  const root = resolve(rootInput);
  const repoRoot = input.repoRoot ? resolve(input.repoRoot) : process.cwd();
  if (isWithin(repoRoot, root)) return { ok: false, reason: 'WORKSPACE_PATH_INSIDE_REPOSITORY', path: root };
  const segments = Array.isArray(input.segments) ? input.segments : [];
  if (segments.some((segment) => !SAFE_SEGMENT.test(text(segment)))) return { ok: false, reason: 'UNSAFE_WORKSPACE_PATH', path: root };
  const target = resolve(root, ...segments.map(String));
  if (!isWithin(root, target)) return { ok: false, reason: 'UNSAFE_WORKSPACE_PATH', path: target };
  return { ok: true, reason: 'WORKSPACE_PATH_RESOLVED', root, path: target };
}

export async function ensureSharedWorkspaceLayout(input = {}) {
  const resolved = resolveSharedWorkspacePath(input);
  if (!resolved.ok) return { ok: false, reason: resolved.reason, created: [] };
  const created = [];
  await mkdir(resolved.root, { recursive: true });
  created.push(resolved.root);
  for (const directory of SHARED_WORKSPACE_RUNTIME_DIRECTORIES) {
    const path = join(resolved.root, directory);
    await mkdir(path, { recursive: true });
    created.push(path);
  }
  return { ok: true, reason: 'WORKSPACE_LAYOUT_READY', root: resolved.root, directories: [...SHARED_WORKSPACE_RUNTIME_DIRECTORIES], created };
}

export function createAgentCapabilityRecord(input = {}) {
  const defaults = text(input.agentId).toLowerCase() === 'openclaw' ? OPENCLAW_DEFAULT_CAPABILITY : {};
  return {
    schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
    kind: SHARED_WORKSPACE_RECORD_KINDS.CAPABILITY,
    agentId: safeId(input.agentId || defaults.agentId) || 'future-agent',
    timestampUtc: text(input.timestampUtc, 'pending'),
    mode: defaults.agentId === 'openclaw' ? defaults.mode : text(input.mode || defaults.mode, 'design_only'),
    boundedWritePath: defaults.agentId === 'openclaw' ? defaults.boundedWritePath : text(input.boundedWritePath || defaults.boundedWritePath, ''),
    trustedBuilder: defaults.agentId === 'openclaw' ? false : input.trustedBuilder === true,
    mergeAuthority: false,
    arbitraryShellAllowed: false,
    proofRefs: Array.isArray(input.proofRefs) ? input.proofRefs.map(String) : [],
  };
}

export function validateSharedWorkspaceRecord(record = {}, options = {}) {
  const errors = assertNoSecrets(record);
  if (record?.schemaVersion !== SHARED_WORKSPACE_RECORD_SCHEMA_VERSION) errors.push('invalid-schema-version');
  if (!Object.values(SHARED_WORKSPACE_RECORD_KINDS).includes(record?.kind)) errors.push('invalid-kind');
  if (!safeId(firstRecordId(record))) errors.push('invalid-record-id');
  if (!safeId(record?.participantId || record?.agentId || record?.sender)) errors.push('invalid-participant-id');
  if (!text(record?.timestampUtc)) errors.push('missing-timestampUtc');
  if (text(record?.timestampUtc) && !Number.isFinite(timestampMs(record?.timestampUtc))) errors.push('invalid-timestampUtc');
  if (isWorkspaceRuntimeRecordKind(record?.kind) && !hasRequiredIssueOrPr(record)) errors.push('missing-related-issue-or-pr');
  if (isWorkspaceRuntimeRecordKind(record?.kind) && list(record?.proofRefs).length === 0) errors.push('missing-proofRefs');
  if (bytes(record?.body) > MAX_RECORD_BODY_BYTES) errors.push('body-too-large');
  for (const ref of list(record?.proofRefs)) if (!SAFE_SEGMENT.test(ref) && /(^|[\\/])\.\.|^[\\/]|^[a-z]:[\\/]/i.test(ref)) errors.push('unsafe-proof-ref');
  if (record?.kind === SHARED_WORKSPACE_RECORD_KINDS.CAPABILITY) {
    if (record.mergeAuthority === true) errors.push('merge-authority-forbidden');
    if (record.arbitraryShellAllowed === true) errors.push('arbitrary-shell-forbidden');
    if (record.agentId === 'openclaw' && (record.mode !== 'design_only' || record.boundedWritePath !== '/courier-open' || record.trustedBuilder !== false)) errors.push('openclaw-default-capability-violated');
  }
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const staleAfterMs = Number.isFinite(options.staleAfterMs) ? options.staleAfterMs : DEFAULT_STALE_AFTER_MS;
  const recordMs = timestampMs(record?.timestampUtc);
  const stale = Number.isFinite(recordMs) && nowMs - recordMs > staleAfterMs;
  return { valid: errors.length === 0, errors, stale, classification: stale ? 'STALE_RECORD' : (errors.length ? 'INVALID_RECORD' : 'CURRENT_RECORD'), refusalReason: errors[0] || '', finalVerdict: errors.length ? 'SHARED_WORKSPACE_RECORD_BLOCKED' : 'SHARED_WORKSPACE_RECORD_PASS' };
}

export async function writeAtomicJson(rootInput, segments, record, options = {}) {
  const validation = validateSharedWorkspaceRecord(record, options);
  if (!validation.valid) return { ok: false, reason: validation.refusalReason, validation };
  const resolved = resolveSharedWorkspacePath({ root: rootInput, repoRoot: options.repoRoot, segments });
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  await mkdir(dirname(resolved.path), { recursive: true });
  const tempPath = `${resolved.path}.${process.pid}.${randomUUID()}.tmp`;
  const payload = `${JSON.stringify(record, null, 2)}\n`;
  await writeFile(tempPath, payload, { flag: 'wx', mode: 0o600 });
  await rename(tempPath, resolved.path);
  return { ok: true, reason: 'ATOMIC_JSON_WRITTEN', path: resolved.path, bytes: Buffer.byteLength(payload) };
}

export async function appendWorkspaceJsonl(rootInput, segments, record, options = {}) {
  const validation = validateSharedWorkspaceRecord(record, options);
  if (!validation.valid) return { ok: false, reason: validation.refusalReason, validation };
  const resolved = resolveSharedWorkspacePath({ root: rootInput, repoRoot: options.repoRoot, segments });
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  await mkdir(dirname(resolved.path), { recursive: true });
  const payload = `${JSON.stringify(record)}\n`;
  await writeFile(resolved.path, payload, { flag: 'a', mode: 0o600 });
  return { ok: true, reason: 'JSONL_EVENT_APPENDED', path: resolved.path, bytes: Buffer.byteLength(payload) };
}

async function latestJson(root, directory, options) {
  const resolved = resolveSharedWorkspacePath({ root, repoRoot: options.repoRoot, segments: [directory] });
  if (!resolved.ok) return null;
  let names = [];
  try { names = await readdir(resolved.path); } catch { return null; }
  const records = [];
  for (const name of names.filter((item) => item.endsWith('.json') && SAFE_SEGMENT.test(item.slice(0, -5)))) {
    try {
      const record = JSON.parse(await readFile(join(resolved.path, name), 'utf8'));
      const validation = validateSharedWorkspaceRecord(record, options);
      if (validation.valid) records.push({ record, validation, ms: timestampMs(record.timestampUtc) || 0 });
    } catch {}
  }
  records.sort((a, b) => b.ms - a.ms || JSON.stringify(b.record).localeCompare(JSON.stringify(a.record)));
  return records[0] || null;
}

export async function aggregateLatestSharedWorkspaceStatus(rootInput, options = {}) {
  const layout = await ensureSharedWorkspaceLayout({ root: rootInput, repoRoot: options.repoRoot });
  if (!layout.ok) return { ok: false, reason: layout.reason, finalVerdict: 'SHARED_WORKSPACE_AGGREGATION_BLOCKED' };
  const [goal, status, proof, capability] = await Promise.all([
    latestJson(layout.root, 'goals', options),
    latestJson(layout.root, 'status', options),
    latestJson(layout.root, 'proof', options),
    latestJson(layout.root, 'capabilities', options),
  ]);
  const capabilityStatus = capability ? (capability.validation.stale ? 'NEEDS_CAPABILITY_REFRESH' : 'CAPABILITY_CURRENT') : 'BLOCKED_BY_MISSING_CAPABILITY_RECORD';
  return { ok: true, reason: 'LATEST_STATUS_AGGREGATED', latest: { goal: goal?.record || null, status: status?.record || null, proof: proof?.record || null, capability: capability?.record || null }, classifications: { goal: goal?.validation.classification || 'MISSING_RECORD', status: status?.validation.classification || 'MISSING_RECORD', proof: proof?.validation.classification || 'MISSING_RECORD', capability: capabilityStatus }, finalVerdict: capabilityStatus === 'CAPABILITY_CURRENT' ? 'SHARED_WORKSPACE_LATEST_STATUS_READY' : capabilityStatus };
}

export function createSharedWorkspaceStatusRecord(input = {}) {
  return { schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION, kind: SHARED_WORKSPACE_RECORD_KINDS.STATUS, statusId: safeId(input.statusId) || 'status-current', participantId: safeId(input.participantId || input.agentId) || 'codex', timestampUtc: text(input.timestampUtc, 'pending'), status: text(input.status, 'pending'), summary: text(input.summary, 'No summary supplied.'), proofRefs: list(input.proofRefs) };
}
export function createSharedWorkspaceGoalRecord(input = {}) {
  return { schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION, kind: SHARED_WORKSPACE_RECORD_KINDS.GOAL, goalId: safeId(input.goalId) || 'goal-current', participantId: safeId(input.participantId || input.agentId) || 'codex', timestampUtc: text(input.timestampUtc, 'pending'), title: text(input.title, 'Untitled goal'), status: text(input.status, 'open') };
}
export function createSharedWorkspaceProofRecord(input = {}) {
  return { ...createBaseRuntimeRecord(input, SHARED_WORKSPACE_RECORD_KINDS.PROOF, 'proofId', 'proof-current'), status: text(input.status, 'pending'), summary: text(input.summary, 'No proof summary supplied.'), refs: list(input.refs), proofRefs: list(input.proofRefs).length ? list(input.proofRefs) : ['self'] };
}
export function createSharedWorkspaceEventRecord(input = {}) {
  return { schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION, kind: SHARED_WORKSPACE_RECORD_KINDS.EVENT, eventId: safeId(input.eventId) || 'event-current', participantId: safeId(input.participantId || input.agentId) || 'codex', timestampUtc: text(input.timestampUtc, 'pending'), eventKind: text(input.eventKind, 'status'), summary: text(input.summary, 'No event summary supplied.') };
}
export { createSharedWorkspaceMessage };


function createBaseRuntimeRecord(input = {}, kind, idField, fallbackId) {
  return {
    schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
    kind,
    [idField]: safeId(input[idField] || input.recordId) || fallbackId,
    participantId: safeId(input.participantId || input.agentId || input.sender) || 'codex',
    timestampUtc: text(input.timestampUtc, 'pending'),
    correlationId: safeId(input.correlationId) || safeId(input[idField] || input.recordId) || fallbackId,
    relatedIssue: text(input.relatedIssue, ''),
    relatedPr: text(input.relatedPr, ''),
    proofRefs: list(input.proofRefs),
  };
}

export function createSharedWorkspaceMessageRecord(input = {}) {
  return { ...createBaseRuntimeRecord(input, SHARED_WORKSPACE_RECORD_KINDS.MESSAGE, 'messageId', 'message-current'), channel: text(input.channel, 'shared-workspace'), summary: text(input.summary, 'No summary supplied.'), body: text(input.body, '') };
}

export function createSharedWorkspaceReceiptRecord(input = {}) {
  return { ...createBaseRuntimeRecord(input, SHARED_WORKSPACE_RECORD_KINDS.RECEIPT, 'receiptId', 'receipt-current'), receivedRecordId: safeId(input.receivedRecordId) || 'unknown-record', disposition: text(input.disposition, 'received'), summary: text(input.summary, 'No receipt summary supplied.') };
}

export function createSharedWorkspaceHandoffRecord(input = {}) {
  return { ...createBaseRuntimeRecord(input, SHARED_WORKSPACE_RECORD_KINDS.HANDOFF, 'handoffId', 'handoff-current'), fromParticipantId: safeId(input.fromParticipantId) || 'codex', toParticipantId: safeId(input.toParticipantId) || 'operator', summary: text(input.summary, 'No handoff summary supplied.'), body: text(input.body, '') };
}

export function createSharedWorkspaceParticipantStatusRecord(input = {}) {
  return { ...createBaseRuntimeRecord(input, SHARED_WORKSPACE_RECORD_KINDS.PARTICIPANT_STATUS, 'participantStatusId', 'participant-status-current'), status: text(input.status, 'available'), summary: text(input.summary, 'No participant status supplied.') };
}

export function readCommandInboxInert() {
  return Object.freeze({ ok: true, inert: true, commandExecutionAllowed: false, arbitraryShellAllowed: false, patchApplicationAllowed: false, records: [], finalVerdict: 'COMMAND_INBOX_INERT' });
}
