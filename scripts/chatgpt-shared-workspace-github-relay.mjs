#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  CHATGPT_BRIDGE_PARTICIPANT_ID,
  CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION,
  CHATGPT_BRIDGE_READ_OPERATIONS,
  buildChatGptBridgeRecord,
  createInMemoryReplayStore,
  createSanitizedSharedWorkspaceProjection,
  verifyChatGptBridgeRequest,
} from '../shared/agents/chatGptParticipantBridgeV1.mjs';
import {
  buildScopedDeliveryStatusProjection,
  loadScopedDeliveryStatusEvidence,
} from '../shared/agents/sharedWorkspaceScopedDeliveryStatusV1.mjs';
import {
  buildSharedWorkspaceHeadTruthProjection,
  loadSharedWorkspaceHeadTruthEvidence,
} from '../shared/agents/sharedWorkspaceHeadTruthV1.mjs';
import {
  PARTICIPANT_ROLE,
  buildConversationConnectionProjection,
} from '../shared/agents/sharedWorkspaceMissionRoomV2.mjs';
import {
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceReceiptRecord,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';

export const CHATGPT_SHARED_WORKSPACE_GITHUB_RELAY_SCHEMA = 'stephanos.chatgpt-shared-workspace-github-relay.v1';
export const CHATGPT_SHARED_WORKSPACE_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const CHATGPT_SHARED_WORKSPACE_ISSUE = 1506;
export const CHATGPT_SHARED_WORKSPACE_OWNER = 'Cheekyfellastef';
export const CHATGPT_SHARED_WORKSPACE_REQUEST_COMMENT_ID = 4995844144;
export const CHATGPT_SHARED_WORKSPACE_RESPONSE_COMMENT_ID = 4995847261;
export const CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER = '<!-- stephanos-chatgpt-shared-workspace-request-v1 -->';
export const CHATGPT_SHARED_WORKSPACE_RESPONSE_MARKER = '<!-- stephanos-chatgpt-shared-workspace-response-v1 -->';

const MAX_COMMENT_BYTES = 12 * 1024;
const MAX_CONVERSATION_REPLY_BYTES = 64 * 1024;
const CONVERSATION_REPLY_STALE_AFTER_MS = 5 * 60 * 1000;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const UNSAFE_REMOTE_TEXT = /(?:BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY|xox[baprs]-|gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,}|[a-z]:\\|\\\\|\/(?:users|home|workspace|tmp)\/)/i;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function safeId(value, fallback = '') {
  const normalized = text(value);
  return SAFE_ID_PATTERN.test(normalized) ? normalized : fallback;
}

function bounded(value, limit = 500) {
  const normalized = text(value);
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function digest(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function deepSanitize(value, depth = 0) {
  if (depth > 6) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => deepSanitize(entry, depth + 1));
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    return UNSAFE_REMOTE_TEXT.test(value) ? '[REDACTED]' : bounded(value, 1000);
  }
  const out = {};
  for (const [key, child] of Object.entries(value).slice(0, 40)) out[key] = deepSanitize(child, depth + 1);
  return out;
}

export function resolveChatGptSharedWorkspaceRelayPaths({ env = process.env, home = os.homedir() } = {}) {
  const userHome = path.resolve(env.USERPROFILE || env.HOME || home);
  return Object.freeze({
    repoRoot: path.resolve(userHome, 'Documents', 'GitHub', 'stephan-os'),
    workspaceRoot: path.resolve(userHome, 'Documents', 'Stephanos-openclaw-workspace'),
  });
}

export function parseChatGptSharedWorkspaceRequestComment(body = '') {
  const content = String(body ?? '');
  if (!content.startsWith(CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER)) {
    return Object.freeze({ ok: false, reason: 'REQUEST_MARKER_MISSING', state: 'BLOCKED', request: null });
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_COMMENT_BYTES) {
    return Object.freeze({ ok: false, reason: 'REQUEST_BODY_TOO_LARGE', state: 'BLOCKED', request: null });
  }
  const blocks = [...content.matchAll(/```json\s*([\s\S]*?)\s*```/gi)];
  if (blocks.length !== 1) {
    return Object.freeze({ ok: false, reason: 'REQUEST_JSON_BLOCK_INVALID', state: 'BLOCKED', request: null });
  }
  let envelope;
  try {
    envelope = JSON.parse(blocks[0][1]);
  } catch {
    return Object.freeze({ ok: false, reason: 'REQUEST_JSON_INVALID', state: 'BLOCKED', request: null });
  }
  if (envelope?.schemaVersion !== CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION) {
    return Object.freeze({ ok: false, reason: 'REQUEST_SCHEMA_INVALID', state: 'BLOCKED', request: null });
  }
  if (envelope.state === 'IDLE' && (envelope.request === null || envelope.request === undefined)) {
    return Object.freeze({ ok: true, reason: 'REQUEST_INBOX_IDLE', state: 'IDLE', request: null });
  }
  if (envelope.state !== 'REQUEST_READY' || !envelope.request || typeof envelope.request !== 'object' || Array.isArray(envelope.request)) {
    return Object.freeze({ ok: false, reason: 'REQUEST_ENVELOPE_INVALID', state: 'BLOCKED', request: null });
  }
  return Object.freeze({ ok: true, reason: 'REQUEST_READY', state: 'REQUEST_READY', request: envelope.request });
}

export function validateChatGptSharedWorkspaceResponseBody(body = '') {
  const content = String(body ?? '');
  const errors = [];
  if (!content.startsWith(CHATGPT_SHARED_WORKSPACE_RESPONSE_MARKER)) errors.push('missing-response-marker');
  if (Buffer.byteLength(content, 'utf8') > MAX_COMMENT_BYTES) errors.push('response-body-too-large');
  if (UNSAFE_REMOTE_TEXT.test(content)) errors.push('unsafe-response-text');
  return Object.freeze({ valid: errors.length === 0, errors });
}

export function renderChatGptSharedWorkspaceResponse(payload = {}) {
  const safePayload = deepSanitize({
    schemaVersion: CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION,
    relaySchemaVersion: CHATGPT_SHARED_WORKSPACE_GITHUB_RELAY_SCHEMA,
    ...payload,
    authority: {
      arbitraryFilesystemAccess: false,
      commandExecutionAccess: false,
      sourceMutationAccess: false,
      mergeAuthority: false,
      selfApprovalAllowed: false,
    },
  });
  return `${CHATGPT_SHARED_WORKSPACE_RESPONSE_MARKER}
## ChatGPT Shared Workspace Response Outbox

\`\`\`json
${JSON.stringify(safePayload, null, 2)}
\`\`\`

The Shared Agent Workspace remains authoritative. This is a bounded sanitized projection and audit handoff only.`;
}

function capture(spawnSyncFn, command, args) {
  const result = spawnSyncFn(command, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return Object.freeze({
    ok: !result?.error && result?.status === 0,
    status: result?.status ?? null,
    stdout: String(result?.stdout ?? ''),
    stderr: bounded(result?.stderr || result?.stdout || result?.error?.message || ''),
    errorCode: result?.error?.code || '',
  });
}

export function createFixedChatGptSharedWorkspaceGitHubAdapter({
  spawnSyncFn = spawnSync,
  ghCommand = process.env.STEPHANOS_GH_COMMAND || 'gh',
} = {}) {
  const requestEndpoint = `repos/${CHATGPT_SHARED_WORKSPACE_REPOSITORY}/issues/comments/${CHATGPT_SHARED_WORKSPACE_REQUEST_COMMENT_ID}`;
  const responseEndpoint = `repos/${CHATGPT_SHARED_WORKSPACE_REPOSITORY}/issues/comments/${CHATGPT_SHARED_WORKSPACE_RESPONSE_COMMENT_ID}`;
  return Object.freeze({
    readRequest() {
      const result = capture(spawnSyncFn, ghCommand, ['api', requestEndpoint]);
      if (!result.ok) {
        return Object.freeze({
          ok: false,
          reason: result.errorCode === 'ENOENT' ? 'GH_CLI_NOT_INSTALLED' : 'REQUEST_COMMENT_READ_FAILED',
          status: result.status,
          error: result.stderr,
        });
      }
      let comment;
      try {
        comment = JSON.parse(result.stdout);
      } catch {
        return Object.freeze({ ok: false, reason: 'REQUEST_COMMENT_JSON_INVALID' });
      }
      if (Number(comment?.id) !== CHATGPT_SHARED_WORKSPACE_REQUEST_COMMENT_ID) {
        return Object.freeze({ ok: false, reason: 'REQUEST_COMMENT_ID_MISMATCH' });
      }
      return Object.freeze({
        ok: true,
        reason: 'REQUEST_COMMENT_READ',
        body: String(comment?.body ?? ''),
        authorLogin: text(comment?.user?.login),
        updatedAt: text(comment?.updated_at),
      });
    },
    writeResponse(body) {
      const validation = validateChatGptSharedWorkspaceResponseBody(body);
      if (!validation.valid) return Object.freeze({ ok: false, reason: validation.errors[0], validation });
      const result = capture(spawnSyncFn, ghCommand, ['api', '--method', 'PATCH', responseEndpoint, '-f', `body=${body}`]);
      if (!result.ok) {
        return Object.freeze({
          ok: false,
          reason: result.errorCode === 'ENOENT' ? 'GH_CLI_NOT_INSTALLED' : 'RESPONSE_COMMENT_WRITE_FAILED',
          status: result.status,
          error: result.stderr,
        });
      }
      return Object.freeze({
        ok: true,
        reason: 'RESPONSE_COMMENT_UPDATED',
        repository: CHATGPT_SHARED_WORKSPACE_REPOSITORY,
        issueNumber: CHATGPT_SHARED_WORKSPACE_ISSUE,
        commentId: CHATGPT_SHARED_WORKSPACE_RESPONSE_COMMENT_ID,
      });
    },
  });
}

async function defaultWorkspaceRecordExists({ workspaceRoot, repoRoot, segments, readFileFn = readFile }) {
  const resolved = resolveSharedWorkspacePath({ root: workspaceRoot, repoRoot, segments });
  if (!resolved.ok) return false;
  try {
    await readFileFn(resolved.path, 'utf8');
    return true;
  } catch {
    return false;
  }
}

async function defaultReceiptExists({ workspaceRoot, repoRoot, receiptId, readFileFn = readFile }) {
  return defaultWorkspaceRecordExists({
    workspaceRoot,
    repoRoot,
    segments: ['receipts', `${receiptId}.json`],
    readFileFn,
  });
}

function receiptIdFor(request, rawBody = '') {
  const canonical = safeId(request?.requestId);
  const readable = canonical ? safeId(`chatgpt-bridge-${canonical}`) : '';
  return readable || `chatgpt-bridge-${digest(canonical || rawBody).slice(0, 24)}`;
}

function completionReceiptIdFor(receiptId) {
  return `chatgpt-complete-${digest(receiptId).slice(0, 24)}`;
}

function eventIdFor(receiptId) {
  return `chatgpt-event-${digest(receiptId).slice(0, 24)}`;
}

function conversationReplyFileName(request = {}) {
  const messageId = safeId(request?.boundedPayload?.requestMessageId || request?.boundedPayload?.messageId);
  return messageId ? `conversation-reply-${messageId}.json` : '';
}

export async function loadConversationReply({
  workspaceRoot,
  repoRoot,
  request,
  nowMs,
  readFileFn = readFile,
} = {}) {
  const fileName = conversationReplyFileName(request);
  if (!fileName) return Object.freeze({ ok: false, reason: 'CONVERSATION_REPLY_IDENTITY_INCOMPLETE', record: null });
  const resolved = resolveSharedWorkspacePath({ root: workspaceRoot, repoRoot, segments: ['outbox', fileName] });
  if (!resolved.ok) return Object.freeze({ ok: false, reason: resolved.reason, record: null });
  let raw;
  try {
    raw = await readFileFn(resolved.path, 'utf8');
  } catch (error) {
    return Object.freeze({ ok: false, reason: error?.code === 'ENOENT' ? 'CONVERSATION_REPLY_NOT_READY' : 'CONVERSATION_REPLY_READ_FAILED', record: null });
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_CONVERSATION_REPLY_BYTES) return Object.freeze({ ok: false, reason: 'CONVERSATION_REPLY_TOO_LARGE', record: null });
  let record;
  try { record = JSON.parse(raw); } catch {
    return Object.freeze({ ok: false, reason: 'CONVERSATION_REPLY_JSON_INVALID', record: null });
  }
  const validation = validateSharedWorkspaceRecord(record, { nowMs, staleAfterMs: CONVERSATION_REPLY_STALE_AFTER_MS });
  if (!validation.valid) return Object.freeze({ ok: false, reason: 'CONVERSATION_REPLY_RECORD_INVALID', record: null, validation });
  const subject = request.boundedPayload || {};
  const expectedHead = text(subject.expectedTargetSourceHead).toLowerCase();
  const responder = safeId(record.senderParticipantId || record.participantId);
  const identityMatches = record.channel === 'stephanos-conversation'
    && record.deliveryState === 'REPLIED'
    && record.recipientParticipantId === 'chatgpt'
    && record.requestedEntityId === safeId(subject.requestedEntityId)
    && record.conversationId === safeId(subject.conversationId)
    && record.threadId === safeId(subject.threadId)
    && record.replyToMessageId === safeId(subject.requestMessageId || subject.messageId)
    && record.correlationId === safeId(subject.correlationId, safeId(subject.conversationId))
    && (responder === safeId(subject.requestedEntityId) || responder === 'stephanos');
  if (!identityMatches) return Object.freeze({ ok: false, reason: 'CONVERSATION_REPLY_IDENTITY_MISMATCH', record: null });
  if (expectedHead && text(record.expectedTargetSourceHead).toLowerCase() !== expectedHead) {
    return Object.freeze({ ok: false, reason: 'CONVERSATION_REPLY_TARGET_HEAD_MISMATCH', record: null });
  }
  if (validation.stale) return Object.freeze({ ok: false, reason: 'CONVERSATION_REPLY_STALE', record, validation });
  return Object.freeze({ ok: true, reason: 'CONVERSATION_REPLY_READY', record, validation });
}

export function buildConversationReplyProjection({ loadStatus = {}, request = {}, timestampUtc = new Date().toISOString() } = {}) {
  const record = loadStatus.record || null;
  return Object.freeze({
    projectionKind: 'conversation-reply-projection',
    aggregationOk: true,
    aggregationReason: text(loadStatus.reason, 'CONVERSATION_REPLY_NOT_READY'),
    state: loadStatus.ok ? 'REPLIED' : 'UNPROVEN',
    blocker: loadStatus.ok ? '' : text(loadStatus.reason, 'CONVERSATION_REPLY_NOT_READY'),
    conversationId: safeId(request?.boundedPayload?.conversationId),
    threadId: safeId(request?.boundedPayload?.threadId),
    requestMessageId: safeId(request?.boundedPayload?.requestMessageId || request?.boundedPayload?.messageId),
    requestedEntityId: safeId(request?.boundedPayload?.requestedEntityId),
    reply: record ? {
      messageId: safeId(record.messageId),
      senderParticipantId: safeId(record.senderParticipantId || record.participantId),
      recipientParticipantId: safeId(record.recipientParticipantId),
      replyToMessageId: safeId(record.replyToMessageId),
      correlationId: safeId(record.correlationId),
      sourceHead: text(record.expectedTargetSourceHead).toLowerCase(),
      observedAtUtc: text(record.originTimestampUtc || record.timestampUtc),
      body: bounded(record.body, 2000),
      proofRefs: Array.isArray(record.proofRefs) ? record.proofRefs.map(String) : [],
    } : null,
    timestampUtc,
    arbitraryFilesystemAccess: false,
    commandExecutionAccess: false,
    sourceMutationAccess: false,
  });
}

function participantRole(participantId) {
  if (participantId === 'stephanos') return PARTICIPANT_ROLE.STEPHANOS;
  if (participantId === 'openclaw') return PARTICIPANT_ROLE.OPENCLAW;
  if (participantId === 'codex') return PARTICIPANT_ROLE.CODEX;
  return PARTICIPANT_ROLE.FUTURE_AGENT;
}

export async function loadParticipantConnectionReceipts({
  workspaceRoot,
  repoRoot,
  participantIds = ['stephanos', 'openclaw', 'codex'],
  nowMs,
  readFileFn = readFile,
} = {}) {
  const receipts = [];
  const loads = {};
  for (const rawId of participantIds.slice(0, 8)) {
    const participantId = safeId(rawId);
    if (!participantId) continue;
    const resolved = resolveSharedWorkspacePath({
      root: workspaceRoot,
      repoRoot,
      segments: ['status', `conversation-participant-${participantId}-current.json`],
    });
    if (!resolved.ok) {
      loads[participantId] = resolved.reason;
      continue;
    }
    try {
      const raw = await readFileFn(resolved.path, 'utf8');
      if (Buffer.byteLength(raw, 'utf8') > MAX_CONVERSATION_REPLY_BYTES) {
        loads[participantId] = 'CONVERSATION_CONNECTION_RECEIPT_TOO_LARGE';
        continue;
      }
      const record = JSON.parse(raw);
      const validation = validateSharedWorkspaceRecord(record, { nowMs, staleAfterMs: CONVERSATION_REPLY_STALE_AFTER_MS });
      if (!validation.valid || record.participantId !== participantId) {
        loads[participantId] = 'CONVERSATION_CONNECTION_RECEIPT_INVALID';
        continue;
      }
      receipts.push(record);
      loads[participantId] = validation.stale ? 'CONVERSATION_CONNECTION_RECEIPT_STALE' : 'CONVERSATION_CONNECTION_RECEIPT_LOADED';
    } catch (error) {
      loads[participantId] = error?.code === 'ENOENT' ? 'CONVERSATION_CONNECTION_RECEIPT_MISSING' : 'CONVERSATION_CONNECTION_RECEIPT_READ_FAILED';
    }
  }
  return Object.freeze({ receipts: Object.freeze(receipts), loads: Object.freeze(loads) });
}

export function buildParticipantConnectionsProjection({ loadStatus = {}, participantIds = [], nowMs = Date.now() } = {}) {
  const participants = participantIds.map((participantId) => ({
    participantId,
    role: participantRole(participantId),
    conversationAdapterId: loadStatus.receipts?.find((record) => record.participantId === participantId)?.conversationAdapterId || '',
    canReceiveConversation: true,
    canReplyConversation: true,
  }));
  const projection = buildConversationConnectionProjection({ participants, receipts: loadStatus.receipts || [], nowMs });
  return Object.freeze({ ...projection, loads: loadStatus.loads || {} });
}

export async function loadConversationTargetRegistration({
  workspaceRoot,
  repoRoot,
  request,
  nowMs,
  readFileFn = readFile,
} = {}) {
  const participantId = safeId(request?.boundedPayload?.requestedEntityId);
  if (['stephanos', 'openclaw', 'codex'].includes(participantId)) {
    return Object.freeze({ registered: true, participantId, reason: 'CORE_CONVERSATION_PARTICIPANT' });
  }
  if (!participantId.startsWith('future-agent-')) return Object.freeze({ registered: false, participantId, reason: 'CONVERSATION_TARGET_NOT_REGISTERED' });
  const resolved = resolveSharedWorkspacePath({ root: workspaceRoot, repoRoot, segments: ['capabilities', `${participantId}.json`] });
  if (!resolved.ok) return Object.freeze({ registered: false, participantId, reason: resolved.reason });
  try {
    const raw = await readFileFn(resolved.path, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > MAX_CONVERSATION_REPLY_BYTES) return Object.freeze({ registered: false, participantId, reason: 'CONVERSATION_CAPABILITY_TOO_LARGE' });
    const record = JSON.parse(raw);
    const validation = validateSharedWorkspaceRecord(record, { nowMs, staleAfterMs: CONVERSATION_REPLY_STALE_AFTER_MS });
    const operations = Array.isArray(record.conversationOperations) ? record.conversationOperations : [];
    const registered = validation.valid
      && !validation.stale
      && record.agentId === participantId
      && safeId(record.conversationAdapterId) === safeId(request.boundedPayload?.targetCapabilityId)
      && operations.includes('RECEIVE_TURN')
      && operations.includes('REPLY_TURN');
    return Object.freeze({
      registered,
      participantId,
      reason: registered ? 'CONVERSATION_TARGET_REGISTERED' : (validation.stale ? 'CONVERSATION_TARGET_CAPABILITY_STALE' : 'CONVERSATION_TARGET_NOT_REGISTERED'),
    });
  } catch (error) {
    return Object.freeze({ registered: false, participantId, reason: error?.code === 'ENOENT' ? 'CONVERSATION_TARGET_CAPABILITY_MISSING' : 'CONVERSATION_TARGET_CAPABILITY_READ_FAILED' });
  }
}

function readProjectionForOperation(operation, projection) {
  if (operation === 'READ_LATEST_PROOF') {
    return Object.freeze({
      projectionKind: 'latest-proof-projection',
      latestProof: projection.latestProof || null,
      freshnessUtc: projection.freshnessUtc,
      aggregationOk: projection.aggregationOk,
      aggregationReason: projection.aggregationReason,
    });
  }
  if (operation === 'READ_OPERATOR_ATTENTION') {
    return Object.freeze({
      projectionKind: 'operator-attention-projection',
      operatorAttention: projection.currentStatus
        ? {
            status: projection.currentStatus.status || 'UNKNOWN',
            summary: projection.currentStatus.summary || '',
            proofRefs: projection.currentStatus.proofRefs || [],
          }
        : null,
      freshnessUtc: projection.freshnessUtc,
      aggregationOk: projection.aggregationOk,
      aggregationReason: projection.aggregationReason,
    });
  }
  return projection;
}

function compactWriteResult(result = {}) {
  return Object.freeze({
    ok: result.ok === true,
    reason: text(result.reason, result.ok === true ? 'WORKSPACE_WRITE_PASS' : 'WORKSPACE_WRITE_FAILED'),
    bytes: Number.isFinite(result.bytes) ? result.bytes : 0,
  });
}

async function persistOnce({
  workspaceRoot,
  repoRoot,
  segments,
  record,
  nowMs,
  recordExistsFn,
  writeAtomicJsonFn,
}) {
  const exists = await recordExistsFn({ workspaceRoot, repoRoot, segments });
  if (exists) return Object.freeze({ ok: true, reason: 'WORKSPACE_RECORD_ALREADY_PERSISTED', bytes: 0, resumed: true });
  return writeAtomicJsonFn(workspaceRoot, segments, record, { repoRoot, nowMs });
}

export async function runChatGptSharedWorkspaceGitHubRelay({
  now = new Date(),
  env = process.env,
  paths = resolveChatGptSharedWorkspaceRelayPaths({ env }),
  adapter = createFixedChatGptSharedWorkspaceGitHubAdapter(),
  receiptExistsFn = defaultReceiptExists,
  recordExistsFn = defaultWorkspaceRecordExists,
  readFileFn = readFile,
  verifyRequestFn = verifyChatGptBridgeRequest,
  projectionBuilder = createSanitizedSharedWorkspaceProjection,
  headTruthEvidenceLoader = loadSharedWorkspaceHeadTruthEvidence,
  headTruthProjectionBuilder = buildSharedWorkspaceHeadTruthProjection,
  deliveryEvidenceLoader = loadScopedDeliveryStatusEvidence,
  deliveryProjectionBuilder = buildScopedDeliveryStatusProjection,
  conversationReplyLoader = loadConversationReply,
  conversationReplyProjectionBuilder = buildConversationReplyProjection,
  participantConnectionLoader = loadParticipantConnectionReceipts,
  participantConnectionsProjectionBuilder = buildParticipantConnectionsProjection,
  conversationTargetRegistrationLoader = loadConversationTargetRegistration,
  recordBuilder = buildChatGptBridgeRecord,
  writeAtomicJsonFn = writeAtomicJson,
} = {}) {
  const observed = adapter.readRequest();
  if (!observed?.ok) {
    return Object.freeze({
      ok: false,
      schemaVersion: CHATGPT_SHARED_WORKSPACE_GITHUB_RELAY_SCHEMA,
      classification: 'CHATGPT_SHARED_WORKSPACE_REQUEST_READ_FAILED',
      reason: observed?.reason || 'REQUEST_COMMENT_READ_FAILED',
    });
  }

  const parsed = parseChatGptSharedWorkspaceRequestComment(observed.body);
  if (parsed.ok && parsed.state === 'IDLE') {
    return Object.freeze({
      ok: true,
      schemaVersion: CHATGPT_SHARED_WORKSPACE_GITHUB_RELAY_SCHEMA,
      classification: 'CHATGPT_SHARED_WORKSPACE_RELAY_IDLE',
      requestObserved: false,
      responsePublished: false,
    });
  }

  const request = parsed.request || {};
  const timestampUtc = now.toISOString();
  const nowMs = now.getTime();
  const receiptId = receiptIdFor(request, observed.body);
  const completionReceiptId = completionReceiptIdFor(receiptId);
  if (await receiptExistsFn({
    workspaceRoot: paths.workspaceRoot,
    repoRoot: paths.repoRoot,
    receiptId: completionReceiptId,
    readFileFn,
  })) {
    return Object.freeze({
      ok: true,
      schemaVersion: CHATGPT_SHARED_WORKSPACE_GITHUB_RELAY_SCHEMA,
      classification: 'CHATGPT_SHARED_WORKSPACE_REQUEST_ALREADY_PROCESSED',
      requestObserved: true,
      requestId: text(request.requestId),
      completionReceiptId,
      responsePublished: false,
    });
  }

  const needsConversationRegistration = ['WRITE_CONVERSATION_TURN', 'READ_CONVERSATION_REPLY'].includes(request.operation);
  const targetRegistration = parsed.ok && needsConversationRegistration
    ? await conversationTargetRegistrationLoader({
        workspaceRoot: paths.workspaceRoot,
        repoRoot: paths.repoRoot,
        request,
        nowMs,
        readFileFn,
      })
    : null;
  const registeredConversationParticipantIds = targetRegistration?.registered ? [targetRegistration.participantId] : [];
  const replayStore = createInMemoryReplayStore();
  const verification = parsed.ok
    ? verifyRequestFn(request, {
        authenticated: observed.authorLogin === CHATGPT_SHARED_WORKSPACE_OWNER,
        transportConfigured: true,
        replayStore,
        registeredConversationParticipantIds,
        nowMs,
        timestampUtc,
      })
    : Object.freeze({
        requestId: '',
        participantId: '',
        operation: '',
        recordKind: '',
        responseStatus: 'BLOCKED_AUTHORIZATION_FAILED',
        accepted: false,
        auditReceiptId: `audit-${digest(observed.body).slice(0, 24)}`,
        proofRefs: [`receipts/${receiptId}`],
      });

  let deliveryStatus = parsed.ok ? 'REQUEST_REJECTED' : parsed.reason;
  let projection = null;
  let workspaceRecord = null;
  let primaryWrite = { ok: true, reason: 'NO_PRIMARY_WRITE_REQUIRED', bytes: 0 };

  if (verification.accepted && CHATGPT_BRIDGE_READ_OPERATIONS.includes(request.operation)) {
    if (request.operation === 'READ_CURRENT_STATUS') {
      const [loadStatus, workspaceProjection] = await Promise.all([
        headTruthEvidenceLoader({
          workspaceRoot: paths.workspaceRoot,
          repoRoot: paths.repoRoot,
        }),
        projectionBuilder({
          workspaceRoot: paths.workspaceRoot,
          repoRoot: paths.repoRoot,
          timestampUtc,
          nowMs,
        }),
      ]);
      const headTruth = headTruthProjectionBuilder({
        records: loadStatus.records,
        timestampUtc,
        nowMs,
      });
      projection = Object.freeze({
        ...headTruth,
        currentGoal: workspaceProjection?.currentGoal || null,
        currentStatus: workspaceProjection?.currentStatus || null,
        latestProof: workspaceProjection?.latestProof || null,
        workspaceAggregationOk: workspaceProjection?.aggregationOk !== false,
        workspaceAggregationReason: text(workspaceProjection?.aggregationReason),
      });
    } else if (request.operation === 'READ_DELIVERY_STATUS') {
      const loadStatus = await deliveryEvidenceLoader({
        workspaceRoot: paths.workspaceRoot,
        repoRoot: paths.repoRoot,
        subject: request.boundedPayload?.statusSubject,
        nowMs,
      });
      projection = deliveryProjectionBuilder({
        subject: request.boundedPayload?.statusSubject,
        records: loadStatus.records,
        loadStatus,
        timestampUtc,
        nowMs,
      });
    } else if (request.operation === 'READ_CONVERSATION_REPLY') {
      const loadStatus = await conversationReplyLoader({
        workspaceRoot: paths.workspaceRoot,
        repoRoot: paths.repoRoot,
        request,
        nowMs,
        readFileFn,
      });
      projection = conversationReplyProjectionBuilder({ loadStatus, request, timestampUtc, nowMs });
    } else if (request.operation === 'READ_PARTICIPANT_CONNECTIONS') {
      const participantIds = Array.isArray(request.boundedPayload?.participantIds) && request.boundedPayload.participantIds.length
        ? request.boundedPayload.participantIds.map((value) => safeId(value)).filter(Boolean)
        : ['stephanos', 'openclaw', 'codex'];
      const loadStatus = await participantConnectionLoader({
        workspaceRoot: paths.workspaceRoot,
        repoRoot: paths.repoRoot,
        participantIds,
        nowMs,
        readFileFn,
      });
      projection = participantConnectionsProjectionBuilder({ loadStatus, participantIds, timestampUtc, nowMs });
    } else {
      projection = await projectionBuilder({
        workspaceRoot: paths.workspaceRoot,
        repoRoot: paths.repoRoot,
        timestampUtc,
        nowMs,
      });
      projection = readProjectionForOperation(request.operation, projection);
    }
    deliveryStatus = projection?.aggregationOk === false ? 'WORKSPACE_READ_BLOCKED' : 'WORKSPACE_READ_PASS';
  } else if (verification.accepted) {
    const built = recordBuilder(request, {
      timestampUtc,
      workspaceValidationOptions: { nowMs },
      registeredConversationParticipantIds,
    });
    if (!built?.ok) {
      deliveryStatus = built?.reason || 'WORKSPACE_RECORD_BUILD_FAILED';
      primaryWrite = { ok: false, reason: deliveryStatus, bytes: 0 };
    } else {
      workspaceRecord = built.record;
      const messageName = request.operation === 'WRITE_CONVERSATION_TURN'
        ? `conversation-${safeId(request.boundedPayload?.requestMessageId, digest(observed.body).slice(0, 24))}.json`
        : `${safeId(request.requestId, digest(observed.body).slice(0, 24))}.json`;
      primaryWrite = await persistOnce({
        workspaceRoot: paths.workspaceRoot,
        repoRoot: paths.repoRoot,
        segments: ['inbox', messageName],
        record: workspaceRecord,
        nowMs,
        recordExistsFn,
        writeAtomicJsonFn,
      });
      deliveryStatus = primaryWrite.ok ? 'WORKSPACE_WRITE_PASS' : 'WORKSPACE_WRITE_FAILED';
    }
  }

  const acceptedDelivery = verification.accepted === true
    && ['WORKSPACE_READ_PASS', 'WORKSPACE_WRITE_PASS'].includes(deliveryStatus)
    && primaryWrite.ok === true;
  const terminalOutcome = acceptedDelivery || verification.accepted !== true;
  const relatedIssue = text(request.relatedGoal, `#${CHATGPT_SHARED_WORKSPACE_ISSUE}`);
  const relatedPr = text(request.relatedPr);
  const correlationId = safeId(request.correlationId, receiptId);

  const auditReceipt = createSharedWorkspaceReceiptRecord({
    receiptId,
    participantId: CHATGPT_BRIDGE_PARTICIPANT_ID,
    timestampUtc,
    correlationId,
    relatedIssue,
    relatedPr,
    proofRefs: [`receipts/${receiptId}`],
    receivedRecordId: safeId(request.requestId, receiptId),
    disposition: `${verification.responseStatus}:${deliveryStatus}`,
    summary: `ChatGPT bridge ${text(request.operation, 'request')} ${deliveryStatus}`,
  });
  const auditReceiptWrite = terminalOutcome
    ? await persistOnce({
        workspaceRoot: paths.workspaceRoot,
        repoRoot: paths.repoRoot,
        segments: ['receipts', `${receiptId}.json`],
        record: auditReceipt,
        nowMs,
        recordExistsFn,
        writeAtomicJsonFn,
      })
    : { ok: false, reason: 'DELIVERY_NOT_TERMINAL', bytes: 0 };

  const eventId = eventIdFor(receiptId);
  const event = createSharedWorkspaceEventRecord({
    eventId,
    participantId: CHATGPT_BRIDGE_PARTICIPANT_ID,
    timestampUtc,
    eventKind: verification.accepted ? 'response' : 'warning',
    summary: `ChatGPT bridge ${text(request.operation, 'request')} ${verification.responseStatus}:${deliveryStatus}`,
  });
  const eventWrite = auditReceiptWrite.ok
    ? await persistOnce({
        workspaceRoot: paths.workspaceRoot,
        repoRoot: paths.repoRoot,
        segments: ['events', `${eventId}.json`],
        record: event,
        nowMs,
        recordExistsFn,
        writeAtomicJsonFn,
      })
    : { ok: false, reason: 'AUDIT_RECEIPT_NOT_PERSISTED', bytes: 0 };

  const responseBody = renderChatGptSharedWorkspaceResponse({
    state: terminalOutcome && auditReceiptWrite.ok && eventWrite.ok ? 'RESPONSE_READY' : 'BLOCKED',
    requestId: text(request.requestId),
    operation: text(request.operation),
    recordKind: text(request.recordKind),
    timestampUtc,
    verificationStatus: verification.responseStatus,
    deliveryStatus,
    completed: acceptedDelivery,
    projection,
    workspaceRecord: workspaceRecord ? {
      kind: workspaceRecord.kind,
      recordId: workspaceRecord.messageId || '',
      participantId: workspaceRecord.participantId,
      correlationId: workspaceRecord.correlationId,
      relatedIssue: workspaceRecord.relatedIssue,
      relatedPr: workspaceRecord.relatedPr,
      proofRefs: workspaceRecord.proofRefs,
      summary: workspaceRecord.summary,
    } : null,
    audit: {
      auditReceiptId: verification.auditReceiptId,
      receiptId,
      completionReceiptId,
      proofRefs: verification.proofRefs || [],
      receiptPersisted: auditReceiptWrite.ok === true,
      eventPersisted: eventWrite.ok === true,
      completionReceiptWrittenLast: true,
    },
    source: {
      repository: CHATGPT_SHARED_WORKSPACE_REPOSITORY,
      issueNumber: CHATGPT_SHARED_WORKSPACE_ISSUE,
      requestCommentId: CHATGPT_SHARED_WORKSPACE_REQUEST_COMMENT_ID,
      responseCommentId: CHATGPT_SHARED_WORKSPACE_RESPONSE_COMMENT_ID,
      sharedWorkspaceAuthoritative: true,
    },
  });
  const responseWrite = adapter.writeResponse(responseBody);

  const completionReceipt = createSharedWorkspaceReceiptRecord({
    receiptId: completionReceiptId,
    participantId: CHATGPT_BRIDGE_PARTICIPANT_ID,
    timestampUtc,
    correlationId,
    relatedIssue,
    relatedPr,
    proofRefs: [`receipts/${receiptId}`],
    receivedRecordId: receiptId,
    disposition: `RELAY_COMPLETE:${verification.responseStatus}:${deliveryStatus}`,
    summary: `ChatGPT bridge relay completed after audit event and response publication`,
  });
  const completionWrite = terminalOutcome && auditReceiptWrite.ok && eventWrite.ok && responseWrite.ok
    ? await writeAtomicJsonFn(paths.workspaceRoot, ['receipts', `${completionReceiptId}.json`], completionReceipt, {
        repoRoot: paths.repoRoot,
        nowMs,
      })
    : { ok: false, reason: 'RELAY_SIDE_EFFECTS_INCOMPLETE', bytes: 0 };

  const handledRejection = verification.accepted !== true && completionWrite.ok === true;
  const completed = acceptedDelivery && completionWrite.ok === true;
  const ok = completed || handledRejection;

  return Object.freeze({
    ok,
    schemaVersion: CHATGPT_SHARED_WORKSPACE_GITHUB_RELAY_SCHEMA,
    classification: completed
      ? 'CHATGPT_SHARED_WORKSPACE_REQUEST_COMPLETED'
      : (handledRejection ? 'CHATGPT_SHARED_WORKSPACE_REQUEST_REJECTED_SAFELY' : 'CHATGPT_SHARED_WORKSPACE_RELAY_FAILED'),
    requestObserved: true,
    requestId: text(request.requestId),
    operation: text(request.operation),
    verificationStatus: verification.responseStatus,
    deliveryStatus,
    receiptId,
    completionReceiptId,
    primaryWrite: compactWriteResult(primaryWrite),
    auditReceiptWrite: compactWriteResult(auditReceiptWrite),
    eventWrite: compactWriteResult(eventWrite),
    responseWrite: compactWriteResult(responseWrite),
    completionWrite: compactWriteResult(completionWrite),
    responsePublished: responseWrite.ok === true,
  });
}

export function isDirectCliEntrypoint({ metaUrl = import.meta.url, argv1 = process.argv[1] } = {}) {
  if (!argv1) return false;
  return path.resolve(fileURLToPath(metaUrl)) === path.resolve(argv1);
}

if (isDirectCliEntrypoint()) {
  const result = await runChatGptSharedWorkspaceGitHubRelay();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
