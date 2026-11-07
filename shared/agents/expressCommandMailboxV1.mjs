import { readFile } from 'node:fs/promises';
import { CANONICAL_MAILBOX_ISSUE } from './canonicalMailboxAuthorityV1.mjs';
import {
  SHARED_WORKSPACE_RECORD_KINDS,
  createSharedWorkspaceEventRecord,
  ensureSharedWorkspaceLayout,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';

export const EXPRESS_COMMAND_MAILBOX_SCHEMA = 'stephanos.express-command-mailbox.v1';

export const EXPRESS_COMMAND_OPERATION = Object.freeze({
  PING: 'PING',
  HANDOFF: 'HANDOFF',
});

export const EXPRESS_COMMAND_SOURCE = 'REMOTE_COMMANDER';
export const EXPRESS_COMMAND_TTL_MS = 10 * 60 * 1000;

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const SAFE_RECIPIENTS = new Set([
  'stephanos',
  'mission-orchestrator',
  'desktop-commander',
  'openclaw-standalone',
  'stephanos-scout-coder',
]);
const MAX_PAYLOAD_BYTES = 12 * 1024;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function safeId(value) {
  const normalized = text(value);
  return SAFE_ID.test(normalized) ? normalized : '';
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safePayload(value) {
  if (!plainObject(value)) return null;
  try {
    const encoded = JSON.stringify(value);
    return Buffer.byteLength(encoded, 'utf8') <= MAX_PAYLOAD_BYTES ? value : null;
  } catch {
    return null;
  }
}

function relatedIssue(value) {
  const normalized = text(value).replace(/^#/, '');
  return /^[1-9]\d*$/.test(normalized) ? '#' + normalized : '';
}

function relatedPr(value) {
  const normalized = text(value).replace(/^#/, '');
  return /^[1-9]\d*$/.test(normalized) ? '#' + normalized : '';
}

export function expressCommandFileNameV1(commandId) {
  const id = safeId(commandId);
  return id ? 'express-command-' + id + '.json' : '';
}

export function expressResultFileNameV1(commandId) {
  const id = safeId(commandId);
  return id ? 'express-result-' + id + '.json' : '';
}

export function expressGuardianFileNameV1(commandId) {
  const id = safeId(commandId);
  return id ? 'express-path-guardian-' + id + '.json' : '';
}

export function buildExpressCommandRecordV1(input = {}, options = {}) {
  const commandId = safeId(input.commandId);
  const operation = text(input.operation).toUpperCase();
  const payload = safePayload(input.payload);
  const issue = relatedIssue(input.relatedIssue ?? input.issueNumber ?? input.payload?.issueNumber);
  const pr = relatedPr(input.relatedPr ?? input.prNumber);
  const missionId = safeId(input.missionId) || commandId;
  const recipient = text(input.recipient, 'stephanos').toLowerCase();
  const blockers = [];

  if (!commandId) blockers.push('express-command-id-invalid');
  if (!Object.values(EXPRESS_COMMAND_OPERATION).includes(operation)) blockers.push('express-operation-not-allowlisted');
  if (!payload) blockers.push('express-payload-invalid-or-too-large');
  if (!missionId) blockers.push('express-mission-id-invalid');
  if (!SAFE_RECIPIENTS.has(recipient)) blockers.push('express-recipient-not-allowlisted');
  if (operation === EXPRESS_COMMAND_OPERATION.HANDOFF && !issue && !pr) blockers.push('express-handoff-correlation-required');

  const timestampUtc = text(options.timestampUtc, new Date().toISOString());
  const timestampMs = Date.parse(timestampUtc);
  const expiresAtUtc = Number.isFinite(timestampMs)
    ? new Date(timestampMs + EXPRESS_COMMAND_TTL_MS).toISOString()
    : '';
  const record = {
    ...createSharedWorkspaceEventRecord({
      eventId: commandId ? 'express-command-' + commandId : 'express-command-invalid',
      participantId: 'chatgpt',
      timestampUtc,
      eventKind: 'command-intent',
      summary: operation + ' received through the Remote Commander express transport.',
    }),
    expressSchemaVersion: EXPRESS_COMMAND_MAILBOX_SCHEMA,
    commandId,
    missionId,
    operation,
    expiresAtUtc,
    recipient,
    relatedIssue: issue,
    relatedPr: pr,
    payload: payload || {},
    sourceTransport: EXPRESS_COMMAND_SOURCE,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    pcRestartAuthority: false,
    arbitraryShellAllowed: false,
    duplicateDispatchAllowed: false,
  };
  const validation = validateSharedWorkspaceRecord(record, { nowMs: Date.parse(timestampUtc) });
  if (!validation.valid) blockers.push(...validation.errors.map((error) => 'workspace:' + error));

  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length ? blockers[0] : 'EXPRESS_COMMAND_RECORD_READY',
    blockers: Object.freeze([...new Set(blockers)]),
    record: Object.freeze(record),
    fileName: expressCommandFileNameV1(commandId),
  });
}

export async function submitExpressCommandV1(root, input = {}, options = {}) {
  const built = buildExpressCommandRecordV1(input, options);
  if (!built.ok) {
    return Object.freeze({
      ok: false,
      reason: built.reason,
      blockers: built.blockers,
      commandId: built.record.commandId,
    });
  }

  const layout = await ensureSharedWorkspaceLayout({
    root,
    repoRoot: options.repoRoot,
  });
  if (!layout.ok) {
    return Object.freeze({
      ok: false,
      reason: layout.reason,
      blockers: Object.freeze([layout.reason]),
      commandId: built.record.commandId,
    });
  }

  const write = await writeAtomicJson(
    layout.root,
    ['commands', built.fileName],
    built.record,
    {
      repoRoot: options.repoRoot,
      nowMs: Date.parse(built.record.timestampUtc),
    },
  );
  return Object.freeze({
    ok: write.ok === true,
    reason: write.ok === true ? 'EXPRESS_COMMAND_SUBMITTED' : write.reason,
    commandId: built.record.commandId,
    fileName: built.fileName,
    path: write.path || '',
    record: built.record,
  });
}

export function validateExpressCommandRecordV1(record = {}, options = {}) {
  const blockers = [];
  const commandId = safeId(record.commandId);
  const expectedEventId = commandId ? 'express-command-' + commandId : '';
  if (record?.kind !== SHARED_WORKSPACE_RECORD_KINDS.EVENT) blockers.push('express-record-kind-invalid');
  if (record?.expressSchemaVersion !== EXPRESS_COMMAND_MAILBOX_SCHEMA) blockers.push('express-schema-invalid');
  if (record?.eventKind !== 'command-intent') blockers.push('express-event-kind-invalid');
  if (record?.participantId !== 'chatgpt') blockers.push('express-participant-invalid');
  if (!commandId || record?.eventId !== expectedEventId) blockers.push('express-command-identity-invalid');
  if (!Object.values(EXPRESS_COMMAND_OPERATION).includes(text(record.operation).toUpperCase())) blockers.push('express-operation-not-allowlisted');
  if (record?.sourceTransport !== EXPRESS_COMMAND_SOURCE) blockers.push('express-source-invalid');
  const issuedAtMs = Date.parse(text(record.timestampUtc));
  const expiresAtMs = Date.parse(text(record.expiresAtUtc));
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)
      || expiresAtMs <= issuedAtMs
      || expiresAtMs - issuedAtMs !== EXPRESS_COMMAND_TTL_MS) {
    blockers.push('express-expiry-invalid');
  } else if (options.allowExpired !== true && nowMs > expiresAtMs) {
    blockers.push('express-command-expired');
  }
  if (!SAFE_RECIPIENTS.has(text(record.recipient).toLowerCase())) blockers.push('express-recipient-not-allowlisted');
  if (!safePayload(record.payload)) blockers.push('express-payload-invalid-or-too-large');
  if (record.mergeAuthority !== false || record.leaseSeizureAllowed !== false
      || record.pcRestartAuthority !== false || record.arbitraryShellAllowed !== false
      || record.duplicateDispatchAllowed !== false) {
    blockers.push('express-authority-widened');
  }
  const validation = validateSharedWorkspaceRecord(record, options);
  if (!validation.valid) blockers.push(...validation.errors.map((error) => 'workspace:' + error));
  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length ? blockers[0] : 'EXPRESS_COMMAND_RECORD_VALID',
    blockers: Object.freeze([...new Set(blockers)]),
    commandId,
  });
}

export function buildExpressResultRecordV1(command = {}, result = {}, options = {}) {
  const commandId = safeId(command.commandId) || 'invalid';
  const ok = result.ok === true;
  return Object.freeze({
    ...createSharedWorkspaceEventRecord({
      eventId: 'express-result-' + commandId,
      participantId: 'stephanos',
      timestampUtc: text(options.timestampUtc, new Date().toISOString()),
      eventKind: 'command-result',
      summary: ok
        ? 'Express command ' + commandId + ' completed.'
        : 'Express command ' + commandId + ' blocked or failed.',
    }),
    expressSchemaVersion: EXPRESS_COMMAND_MAILBOX_SCHEMA,
    commandId,
    missionId: safeId(command.missionId) || commandId,
    operation: text(command.operation).toUpperCase(),
    status: ok ? 'COMPLETED' : 'FAILED',
    disposition: text(result.reason, ok ? 'EXPRESS_COMMAND_COMPLETED' : 'EXPRESS_COMMAND_FAILED'),
    relatedIssue: relatedIssue(command.relatedIssue),
    relatedPr: relatedPr(command.relatedPr),
    sourceTransport: EXPRESS_COMMAND_SOURCE,
    mergeAuthority: false,
    pcRestartAuthority: false,
    arbitraryShellAllowed: false,
  });
}

export function buildExpressPathGuardianRecordV1(command = {}, observation = {}, options = {}) {
  const commandId = safeId(command.commandId) || 'invalid';
  const durableObserved = observation.durableObserved === true;
  const routes = durableObserved ? ['EXPRESS', 'DURABLE'] : ['EXPRESS'];
  return Object.freeze({
    ...createSharedWorkspaceEventRecord({
      eventId: 'express-path-guardian-' + commandId,
      participantId: 'stephanos',
      timestampUtc: text(options.timestampUtc, new Date().toISOString()),
      eventKind: 'status',
      summary: durableObserved
        ? 'Command observed on both independent delivery paths.'
        : 'Command observed on the express path; durable path remains independently available.',
    }),
    expressSchemaVersion: EXPRESS_COMMAND_MAILBOX_SCHEMA,
    commandId,
    routes: Object.freeze(routes),
    deliveryClass: durableObserved ? 'BOTH' : 'EXPRESS_ONLY',
    expressObserved: true,
    durableObserved,
    durableProofRef: text(observation.durableProofRef),
    relatedIssue: relatedIssue(command.relatedIssue),
    relatedPr: relatedPr(command.relatedPr),
    authoritySource: 'CANONICAL_SHARED_WORKSPACE',
    mergeAuthority: false,
    arbitraryShellAllowed: false,
  });
}

export function validateDurableMailboxReceiptV1(receipt = {}, commandId = '') {
  const id = safeId(commandId);
  const proofRef = id ? 'receipts/github-command-mailbox/' + id + '.json' : '';
  const blockers = [];
  if (!id) blockers.push('durable-command-id-invalid');
  if (!plainObject(receipt)) blockers.push('durable-receipt-invalid');
  if (receipt?.schemaVersion !== 'stephanos.battle-bridge-github-command-receipt.v1') blockers.push('durable-receipt-schema-invalid');
  if (safeId(receipt?.requestId) !== id) blockers.push('durable-receipt-request-identity-mismatch');
  if (receipt?.repository !== 'Cheekyfellastef/stephan-os') blockers.push('durable-receipt-repository-invalid');
  if (Number(receipt?.issueNumber) !== CANONICAL_MAILBOX_ISSUE) blockers.push('durable-receipt-mailbox-invalid');
  if (receipt?.branch !== 'main') blockers.push('durable-receipt-branch-invalid');
  if (!['DONE', 'FAILED'].includes(text(receipt?.state).toUpperCase())) blockers.push('durable-receipt-not-terminal');
  if (!Array.isArray(receipt?.proofRefs) || !receipt.proofRefs.includes(proofRef)) blockers.push('durable-receipt-proof-ref-missing');
  if (receipt?.arbitraryShellAllowed !== false || receipt?.destructiveGitAllowed !== false) blockers.push('durable-receipt-authority-invalid');
  return Object.freeze({
    ok: blockers.length === 0,
    blockers: Object.freeze([...new Set(blockers)]),
    reason: blockers.length ? blockers[0] : 'DURABLE_MAILBOX_RECEIPT_VALID',
    proofRef: blockers.length ? '' : proofRef,
  });
}

export async function detectDurableMailboxDeliveryV1(root, commandId, options = {}) {
  const id = safeId(commandId);
  if (!id) return Object.freeze({ observed: false, reason: 'DURABLE_COMMAND_ID_INVALID', proofRef: '' });
  const fileName = id + '.json';
  const resolved = resolveSharedWorkspacePath({
    root,
    repoRoot: options.repoRoot,
    segments: ['receipts', 'github-command-mailbox', fileName],
  });
  if (!resolved.ok) return Object.freeze({ observed: false, reason: resolved.reason, proofRef: '' });
  try {
    const parsed = JSON.parse(await readFile(resolved.path, 'utf8'));
    const validation = validateDurableMailboxReceiptV1(parsed, id);
    return Object.freeze({
      observed: validation.ok,
      reason: validation.ok ? 'DURABLE_MAILBOX_RECEIPT_OBSERVED' : validation.reason,
      proofRef: validation.proofRef,
      blockers: validation.blockers,
    });
  } catch (error) {
    return Object.freeze({
      observed: false,
      reason: error?.code === 'ENOENT' ? 'DURABLE_MAILBOX_RECEIPT_NOT_YET_OBSERVED' : 'DURABLE_MAILBOX_RECEIPT_UNREADABLE',
      proofRef: '',
    });
  }
}
