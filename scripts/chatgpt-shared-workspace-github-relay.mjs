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
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceReceiptRecord,
  resolveSharedWorkspacePath,
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

  const replayStore = createInMemoryReplayStore();
  const verification = parsed.ok
    ? verifyRequestFn(request, {
        authenticated: observed.authorLogin === CHATGPT_SHARED_WORKSPACE_OWNER,
        transportConfigured: true,
        replayStore,
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
    projection = await projectionBuilder({
      workspaceRoot: paths.workspaceRoot,
      repoRoot: paths.repoRoot,
      timestampUtc,
      nowMs,
    });
    projection = readProjectionForOperation(request.operation, projection);
    deliveryStatus = projection?.aggregationOk === false ? 'WORKSPACE_READ_BLOCKED' : 'WORKSPACE_READ_PASS';
  } else if (verification.accepted) {
    const built = recordBuilder(request, {
      timestampUtc,
      workspaceValidationOptions: { nowMs },
    });
    if (!built?.ok) {
      deliveryStatus = built?.reason || 'WORKSPACE_RECORD_BUILD_FAILED';
      primaryWrite = { ok: false, reason: deliveryStatus, bytes: 0 };
    } else {
      workspaceRecord = built.record;
      const messageName = `${safeId(request.requestId, digest(observed.body).slice(0, 24))}.json`;
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
