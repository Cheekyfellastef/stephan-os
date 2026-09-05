import { createHash, randomUUID } from 'node:crypto';
import { link, open, readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { readBackendSharedWorkspaceDashboardFeed } from './sharedWorkspaceDashboardFeedService.js';
import {
  createSharedWorkspaceHandoffRecord,
  createSharedWorkspaceReceiptRecord,
  ensureSharedWorkspaceLayout,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  OPERATOR_DECISION_KIND,
  OPERATOR_DECISION_STATUS,
  validateOperatorDecision,
} from '../../shared/agents/operatorAutomationLayer.mjs';
import {
  MISSION_CONTROLLER_CAPACITY_ROUTER_SCHEMA,
} from '../../shared/agents/missionControllerCapacityRouterV1.mjs';

export const OPERATOR_APPROVAL_INBOX_SCHEMA_VERSION = 'stephanos.operator-approval-inbox.v1';
export const OPERATOR_DECISION_RECEIPT_SCHEMA_VERSION = 'stephanos.operator-decision-receipt.v1';

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,120}$/i;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const RECEIPT_PREFIX = 'operator-decision-';
const PENDING = new Set([
  OPERATOR_DECISION_STATUS.PROPOSED,
  OPERATOR_DECISION_STATUS.WAITING_FOR_OPERATOR_APPROVAL,
  OPERATOR_DECISION_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION,
]);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function fail(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  throw error;
}

function validReason(value) {
  return value.length <= 480 && !/[\u0000-\u001f\u007f]/.test(value);
}

function canonicalDecisionBinding(decision = {}) {
  return {
    schemaVersion: decision.schemaVersion,
    decisionId: decision.decisionId,
    decisionKind: decision.decisionKind,
    status: decision.status,
    relatedGoal: decision.relatedGoal,
    relatedPr: decision.relatedPr,
    expectedHeadSha: decision.expectedHeadSha,
    summary: decision.summary,
    requiresOperator: decision.requiresOperator,
    exactApprovalText: decision.exactApprovalText,
    expiresAtUtc: decision.expiresAtUtc,
  };
}

function receiptIdForDecision(decisionId) {
  const digest = createHash('sha256').update(text(decisionId)).digest('hex').slice(0, 24);
  return `${RECEIPT_PREFIX}${digest}`;
}

export function fingerprintOperatorDecision(decision = {}) {
  return createHash('sha256').update(JSON.stringify(canonicalDecisionBinding(decision))).digest('hex');
}

function decisionTitle(decision) {
  if (decision.decisionKind === OPERATOR_DECISION_KIND.MERGE_APPROVAL) return `Protected merge ${decision.relatedPr || ''}`.trim();
  if (decision.decisionKind === OPERATOR_DECISION_KIND.SERVICE_RESTART_APPROVAL) return 'Restart a Stephanos service';
  if (decision.decisionKind === OPERATOR_DECISION_KIND.CODEX_DISPATCH_APPROVAL) return 'Send a consequential job to Codex';
  if (decision.decisionKind === OPERATOR_DECISION_KIND.PROOF_REQUEST) return 'Run a consequential proof';
  return 'Unblock a protected project step';
}

function decisionQuestion(decision) {
  if (decision.decisionKind === OPERATOR_DECISION_KIND.MERGE_APPROVAL) {
    return `Should Stephanos continue the protected merge process for ${decision.relatedPr} at version ${decision.expectedHeadSha.slice(0, 8)}?`;
  }
  return `Should Stephanos continue with this ${text(decision.decisionKind).toLowerCase().replaceAll('_', ' ')} request?`;
}

function decisionNotExpired(decision, nowMs) {
  const expiry = text(decision.expiresAtUtc);
  if (!expiry) return true;
  const expiryMs = Date.parse(expiry);
  return Number.isFinite(expiryMs) && expiryMs > nowMs;
}

function decisionEvidenceIsCurrent(decision, feed, nowMs) {
  if (!decisionNotExpired(decision, nowMs)) return false;
  if (decision.decisionKind !== OPERATOR_DECISION_KIND.MERGE_APPROVAL) return feed?.state === 'ready';
  const prNumber = Number(text(decision.relatedPr).replace(/^#/, ''));
  return Array.isArray(feed?.projection?.goals) && feed.projection.goals.some((goal) => (
    Number(goal?.prNumber) === prNumber
    && text(goal?.exactHead).toLowerCase() === text(decision.expectedHeadSha).toLowerCase()
    && text(goal?.statusTruth).toUpperCase() === 'CURRENT'
    && text(goal?.proofTruth).toUpperCase() === 'CURRENT'
  ));
}

function publicDecision(decision, receipt = null, evidenceCurrent = false) {
  const status = receipt?.resultingStatus || decision.status;
  const pending = PENDING.has(status) && !receipt;
  const actionable = pending && evidenceCurrent;
  const protectedFollowUpRequired = decision.decisionKind === OPERATOR_DECISION_KIND.MERGE_APPROVAL;
  return Object.freeze({
    decisionId: decision.decisionId,
    decisionKind: decision.decisionKind,
    title: decisionTitle(decision),
    question: decisionQuestion(decision),
    summary: decision.summary,
    relatedGoal: decision.relatedGoal,
    relatedPr: decision.relatedPr,
    expectedHeadSha: decision.expectedHeadSha,
    expectedVersion: decision.expectedHeadSha ? decision.expectedHeadSha.slice(0, 8) : '',
    expiresAtUtc: decision.expiresAtUtc,
    status,
    pending,
    actionable,
    blockingReason: pending && !actionable ? 'This exact decision is expired or its authority-bearing evidence is not current. Refresh it before deciding.' : '',
    riskLevel: protectedFollowUpRequired ? 'HIGH' : 'CONSEQUENTIAL',
    approveEffect: protectedFollowUpRequired
      ? 'Records your decision for Stephanos. The separate protected exact-version merge gate still has to accept it before any merge.'
      : 'Records your decision and sends a bounded handoff to the Stephanos build coordinator. It does not execute the action by itself.',
    denyEffect: 'Records “do not continue” and sends that instruction to the Stephanos build coordinator.',
    protectedFollowUpRequired,
    requestFingerprint: fingerprintOperatorDecision(decision),
    receipt: receipt ? Object.freeze({
      receiptId: receipt.receiptId,
      commandId: receipt.commandId,
      action: receipt.action,
      resultingStatus: receipt.resultingStatus,
      timestampUtc: receipt.timestampUtc,
      routedToCodex: receipt.routedToCodex === true,
      routedToStephanos: receipt.routedToStephanos === true,
      codexMeterRequired: false,
    }) : null,
  });
}

function validDecisionReceipt(record = {}, options = {}) {
  const expectedStatus = record.action === 'APPROVE' ? OPERATOR_DECISION_STATUS.APPROVED : OPERATOR_DECISION_STATUS.REJECTED;
  return validateSharedWorkspaceRecord(record).valid
    && record.operatorDecisionSchemaVersion === OPERATOR_DECISION_RECEIPT_SCHEMA_VERSION
    && SAFE_ID.test(text(record.decisionId))
    && SAFE_ID.test(text(record.commandId))
    && ['APPROVE', 'DENY'].includes(record.action)
    && FINGERPRINT.test(text(record.requestFingerprint))
    && record.receiptId === receiptIdForDecision(record.decisionId)
    && record.receivedRecordId === record.decisionId
    && record.correlationId === record.decisionId
    && record.resultingStatus === expectedStatus
    && typeof record.routedToCodex === 'boolean'
    && (record.routedToStephanos === undefined || typeof record.routedToStephanos === 'boolean')
    && (options.requireRouted === false || record.routedToStephanos === true || record.routedToCodex === true)
    && record.actionExecuted === false
    && record.protectedActionAuthorityGranted === false;
}

async function readDecisionReceipts(root, repoRoot) {
  const resolved = resolveSharedWorkspacePath({ root, repoRoot, segments: ['receipts'] });
  if (!resolved.ok) return new Map();
  let names = [];
  try { names = await readdir(resolved.path); } catch { return new Map(); }
  const receipts = new Map();
  for (const name of names.filter((item) => item.startsWith(RECEIPT_PREFIX) && item.endsWith('.json'))) {
    try {
      const record = JSON.parse(await readFile(join(resolved.path, name), 'utf8'));
      if (validDecisionReceipt(record)) receipts.set(record.decisionId, record);
    } catch {}
  }
  return receipts;
}

export async function readOperatorApprovalInbox(input = {}) {
  const readFeed = input.readFeed || readBackendSharedWorkspaceDashboardFeed;
  const feed = input.feed || await readFeed({
    env: input.env,
    repoRoot: input.repoRoot,
    nowMs: input.nowMs,
    staleAfterMs: input.staleAfterMs,
  });
  const root = text(input.root || feed.workspaceRoot);
  const decisions = Array.isArray(feed?.projection?.operatorAttention?.approvals)
    ? feed.projection.operatorAttention.approvals.filter((decision) => validateOperatorDecision(decision).valid)
    : [];
  const receipts = root && root !== 'UNKNOWN' ? await readDecisionReceipts(root, input.repoRoot) : new Map();
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const cards = decisions.map((decision) => publicDecision(
    decision,
    receipts.get(decision.decisionId),
    decisionEvidenceIsCurrent(decision, feed, nowMs),
  ));
  const maintenanceActions = Array.isArray(feed?.projection?.operatorAttention?.maintenanceActions)
    ? feed.projection.operatorAttention.maintenanceActions
    : [];
  return Object.freeze({
    schemaVersion: OPERATOR_APPROVAL_INBOX_SCHEMA_VERSION,
    route: '/api/operator-approvals',
    state: ['ready', 'stale'].includes(feed?.state) ? feed.state : 'unavailable',
    reason: text(feed?.reason, 'OPERATOR_APPROVAL_FEED_UNAVAILABLE'),
    readOnlyFeed: true,
    decisionReceiptWritesAllowed: cards.some((card) => card.actionable),
    actionExecutionAllowed: false,
    protectedActionAuthorityGranted: false,
    pendingCount: cards.filter((card) => card.pending).length,
    resolvedCount: cards.filter((card) => !card.pending).length,
    decisions: Object.freeze(cards),
    maintenanceActions: Object.freeze(maintenanceActions),
    exactNextAction: cards.some((card) => card.pending)
      ? 'Review each genuine decision. Every response is recorded for Stephanos without depending on the Codex meter or silently executing the protected action.'
      : (maintenanceActions.length ? 'Codex and Housekeeper own the listed routine maintenance work.' : 'No operator decision is waiting.'),
  });
}

function receiptRecord(decision, input, nowUtc) {
  const receiptId = receiptIdForDecision(decision.decisionId);
  const approved = input.action === 'APPROVE';
  return {
    ...createSharedWorkspaceReceiptRecord({
      receiptId,
      participantId: 'operator',
      timestampUtc: nowUtc,
      correlationId: decision.decisionId,
      relatedIssue: decision.relatedGoal || '#1282',
      relatedPr: decision.relatedPr,
      proofRefs: [`receipts/${receiptId}.json`],
      receivedRecordId: decision.decisionId,
      disposition: approved ? 'operator-approved-handoff-only' : 'operator-denied',
      summary: approved ? `Operator approved ${decision.decisionId} for Stephanos reconciliation.` : `Operator denied ${decision.decisionId}.`,
    }),
    operatorDecisionSchemaVersion: OPERATOR_DECISION_RECEIPT_SCHEMA_VERSION,
    decisionId: decision.decisionId,
    commandId: input.commandId,
    action: input.action,
    reason: input.reason,
    requestFingerprint: input.requestFingerprint,
    resultingStatus: approved ? OPERATOR_DECISION_STATUS.APPROVED : OPERATOR_DECISION_STATUS.REJECTED,
    routedToCodex: false,
    routedToStephanos: false,
    codexMeterRequired: false,
    actionExecuted: false,
    protectedActionAuthorityGranted: false,
  };
}

async function writeExclusiveReceipt(root, record, options = {}) {
  const validation = validateSharedWorkspaceRecord(record, { nowMs: options.nowMs });
  if (!validation.valid) fail(503, 'INVALID_DECISION_RECEIPT', validation.errors.join(','));
  const layout = await ensureSharedWorkspaceLayout({ root, repoRoot: options.repoRoot });
  if (!layout.ok) fail(503, 'WORKSPACE_UNAVAILABLE', layout.reason);
  const filename = text(options.filename, `${record.receiptId}.json`);
  const resolved = resolveSharedWorkspacePath({ root: layout.root, repoRoot: options.repoRoot, segments: ['receipts', filename] });
  if (!resolved.ok) fail(503, 'WORKSPACE_UNAVAILABLE', resolved.reason);
  const tempPath = `${resolved.path}.${process.pid}.${randomUUID()}.tmp`;
  const payload = `${JSON.stringify(record, null, 2)}\n`;
  const handle = await open(tempPath, 'wx', 0o600);
  try {
    await handle.writeFile(payload);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(tempPath, resolved.path);
    return { record, duplicate: false, path: resolved.path };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = JSON.parse(await readFile(resolved.path, 'utf8'));
    return { record: existing, duplicate: true, path: resolved.path };
  } finally {
    try { await unlink(tempPath); } catch {}
  }
}

async function writeStephanosHandoff(root, decision, receipt, options = {}) {
  const handoffId = `${receipt.receiptId}-stephanos`;
  const handoff = createSharedWorkspaceHandoffRecord({
    handoffId,
    participantId: 'operator',
    fromParticipantId: 'operator',
    toParticipantId: 'stephanos',
    timestampUtc: receipt.timestampUtc,
    correlationId: decision.decisionId,
    relatedIssue: decision.relatedGoal || '#1282',
    relatedPr: decision.relatedPr,
    proofRefs: [`receipts/${receipt.receiptId}.json`],
    summary: `${receipt.action} decision for ${decision.decisionId} is ready for Stephanos to reconcile.`,
    body: JSON.stringify({
      schemaVersion: OPERATOR_DECISION_RECEIPT_SCHEMA_VERSION,
      decisionId: decision.decisionId,
      receiptId: receipt.receiptId,
      action: receipt.action,
      resultingStatus: receipt.resultingStatus,
      expectedHeadSha: decision.expectedHeadSha,
      actionExecuted: false,
      protectedActionAuthorityGranted: false,
      reconciliationAuthority: 'durable-flywheel-controller',
      capacityRouterSchemaVersion: MISSION_CONTROLLER_CAPACITY_ROUTER_SCHEMA,
      capacityRouteSelected: false,
      codexMeterRequired: false,
      buildExecutionAuthorityGranted: false,
    }),
  });
  const writeHandoff = options.writeHandoff || writeAtomicJson;
  return writeHandoff(root, ['inbox', `${handoffId}.json`], handoff, {
    repoRoot: options.repoRoot,
    nowMs: options.nowMs,
  });
}

export async function recordOperatorApprovalDecision(input = {}, options = {}) {
  const decisionId = text(input.decisionId).toLowerCase();
  const action = text(input.action).toUpperCase();
  const commandId = text(input.commandId).toLowerCase();
  const requestFingerprint = text(input.requestFingerprint).toLowerCase();
  const reason = text(input.reason);
  if (!SAFE_ID.test(decisionId)) fail(400, 'INVALID_DECISION_ID', 'Decision ID is invalid.');
  if (!['APPROVE', 'DENY'].includes(action)) fail(400, 'INVALID_DECISION_ACTION', 'Decision action must be APPROVE or DENY.');
  if (!SAFE_ID.test(commandId)) fail(400, 'INVALID_COMMAND_ID', 'Command ID is invalid.');
  if (!FINGERPRINT.test(requestFingerprint)) fail(400, 'INVALID_DECISION_FINGERPRINT', 'Decision fingerprint is invalid.');
  if (reason && !validReason(reason)) fail(400, 'INVALID_DECISION_REASON', 'Decision reason is too long or contains unsupported control characters.');

  const readFeed = options.readFeed || readBackendSharedWorkspaceDashboardFeed;
  const feed = options.feed || await readFeed({
    env: options.env,
    repoRoot: options.repoRoot,
    nowMs: options.nowMs,
    staleAfterMs: options.staleAfterMs,
  });
  const root = text(options.root || feed.workspaceRoot);
  if (!root || root === 'UNKNOWN') fail(503, 'WORKSPACE_UNAVAILABLE', 'The Shared Workspace is unavailable.');
  const inbox = await readOperatorApprovalInbox({ ...options, feed, root });
  const card = inbox.decisions.find((item) => item.decisionId === decisionId);
  if (!card) fail(404, 'DECISION_NOT_FOUND', 'The decision is no longer present in the live approval inbox.');
  if (card.requestFingerprint !== requestFingerprint) fail(409, 'STALE_DECISION', 'The decision changed. Refresh the inbox before deciding.');
  const decision = feed?.projection?.operatorAttention?.approvals?.find((item) => item.decisionId === decisionId);
  if (!decision || !validateOperatorDecision(decision).valid) fail(409, 'DECISION_CHANGED', 'The canonical decision is no longer valid.');
  if (fingerprintOperatorDecision(decision) !== requestFingerprint) fail(409, 'STALE_DECISION', 'The decision changed. Refresh the inbox before deciding.');
  if (card.receipt) {
    if (card.receipt.commandId === commandId && card.receipt.action === action) {
      const handoff = await writeStephanosHandoff(root, decision, card.receipt, { repoRoot: options.repoRoot, nowMs: options.nowMs, writeHandoff: options.writeHandoff });
      if (!handoff.ok) fail(503, 'STEPHANOS_HANDOFF_FAILED', handoff.reason);
      return Object.freeze({
        ok: true,
        duplicate: true,
        card,
        routedToCodex: false,
        routedToStephanos: true,
        codexMeterRequired: false,
        actionExecuted: false,
        protectedActionAuthorityGranted: false,
        protectedFollowUpRequired: decision.decisionKind === OPERATOR_DECISION_KIND.MERGE_APPROVAL,
      });
    }
    fail(409, 'DECISION_ALREADY_RECORDED', `This decision was already recorded as ${card.receipt.action}.`);
  }
  if (!card.actionable) fail(409, 'DECISION_EVIDENCE_NOT_CURRENT', card.blockingReason);

  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const nowUtc = new Date(nowMs).toISOString();
  const requestedPendingReceipt = receiptRecord(decision, { action, commandId, requestFingerprint, reason }, nowUtc);
  const pendingFilename = `${requestedPendingReceipt.receiptId}.pending.json`;
  const pendingWrite = await writeExclusiveReceipt(root, requestedPendingReceipt, {
    repoRoot: options.repoRoot,
    nowMs,
    filename: pendingFilename,
  });
  const pendingReceipt = pendingWrite.record;
  if (!validDecisionReceipt(pendingReceipt, { requireRouted: false }) || pendingReceipt.routedToCodex !== false || pendingReceipt.routedToStephanos !== false) {
    fail(409, 'INVALID_EXISTING_DECISION_RECEIPT', 'An invalid pending decision receipt already occupies this decision.');
  }
  if (pendingReceipt.commandId !== commandId || pendingReceipt.action !== action || pendingReceipt.requestFingerprint !== requestFingerprint) {
    fail(409, 'DECISION_ALREADY_RECORDED', `This decision was already recorded as ${pendingReceipt.action}.`);
  }
  const handoff = await writeStephanosHandoff(root, decision, pendingReceipt, {
    repoRoot: options.repoRoot,
    nowMs,
    writeHandoff: options.writeHandoff,
  });
  if (!handoff.ok) fail(503, 'STEPHANOS_HANDOFF_FAILED', handoff.reason);
  const requestedReceipt = { ...pendingReceipt, routedToStephanos: true };
  const written = await writeExclusiveReceipt(root, requestedReceipt, { repoRoot: options.repoRoot, nowMs });
  const existing = written.record;
  if (!validDecisionReceipt(existing)) fail(409, 'INVALID_EXISTING_DECISION_RECEIPT', 'An invalid decision receipt already occupies this decision.');
  if (existing.commandId !== commandId || existing.action !== action || existing.requestFingerprint !== requestFingerprint) {
    fail(409, 'DECISION_ALREADY_RECORDED', `This decision was already recorded as ${existing.action}.`);
  }
  try { await unlink(pendingWrite.path); } catch {}
  return Object.freeze({
    ok: true,
    duplicate: pendingWrite.duplicate || written.duplicate,
    decisionId,
    action,
    resultingStatus: existing.resultingStatus,
    receiptId: existing.receiptId,
    routedToCodex: false,
    routedToStephanos: true,
    codexMeterRequired: false,
    actionExecuted: false,
    protectedActionAuthorityGranted: false,
    protectedFollowUpRequired: decision.decisionKind === OPERATOR_DECISION_KIND.MERGE_APPROVAL,
  });
}
