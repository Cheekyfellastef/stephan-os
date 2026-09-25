import {
  buildRemoteCodexDispatchCall,
  createRemoteCodexBattleBridgeHandoff,
} from './remoteCodexBattleBridgeHandoffV1.mjs';
import { createCodexDispatchMcpHandler } from '../../scripts/stephanos-codex-dispatch-mcp.mjs';

export const GUARDED_CODEX_TASK_DISPATCH_OPERATION = 'DISPATCH_GUARDED_CODEX_TASK';

const SHA40 = /^[0-9a-f]{40}$/i;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const MAX_WINDOW_MS = 6 * 60 * 60 * 1000;
const ALLOWED_FIELDS = Object.freeze([
  'schemaVersion',
  'requestId',
  'operation',
  'repository',
  'issueNumber',
  'branch',
  'operatorApproval',
  'expectedHead',
  'task',
  'requestedProofCommands',
  'exactHeadProof',
  'operatorApprovalReceipt',
  'createdAt',
  'expiresAt',
]);
const TERMINAL_BLOCKERS = new Set([
  'GUARDED_CODEX_DISPATCH_FIELD_NOT_ALLOWED',
  'GUARDED_CODEX_DISPATCH_REQUEST_ID_INVALID',
  'GUARDED_CODEX_DISPATCH_EXPECTED_HEAD_REQUIRED',
  'GUARDED_CODEX_DISPATCH_TASK_INVALID',
  'GUARDED_CODEX_DISPATCH_TIME_INVALID',
  'GUARDED_CODEX_DISPATCH_PROOF_COMMANDS_INVALID',
  'GUARDED_CODEX_DISPATCH_PROOF_REQUIRED',
  'GUARDED_CODEX_DISPATCH_APPROVAL_RECEIPT_REQUIRED',
]);

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, requested: true, ...details });
}

function safeProofCommands(value) {
  return Array.isArray(value)
    && value.length >= 1
    && value.length <= 20
    && value.every((item) => typeof item === 'string' && item.length >= 1 && item.length <= 300);
}

function handoffInput(command = {}) {
  return {
    requestId: String(command.requestId || ''),
    owningIssue: Number(command.issueNumber),
    task: String(command.task || ''),
    operatorApproval: command.operatorApproval,
    operatorApprovalReceipt: command.operatorApprovalReceipt,
    repository: command.repository,
    expectedHead: String(command.expectedHead || '').toLowerCase(),
    exactHeadProof: command.exactHeadProof,
    requestedProofCommands: Array.isArray(command.requestedProofCommands)
      ? [...command.requestedProofCommands]
      : command.requestedProofCommands,
    createdAt: command.createdAt,
    expiresAt: command.expiresAt,
  };
}

export function isTerminalizableGuardedCodexTaskDispatchBlocker(value) {
  const blocker = String(value || '');
  return TERMINAL_BLOCKERS.has(blocker) || blocker.startsWith('REMOTE_CODEX_');
}

export function validateGuardedCodexTaskDispatchCommandShape(command = {}) {
  if (String(command?.operation || '') !== GUARDED_CODEX_TASK_DISPATCH_OPERATION) {
    return Object.freeze({ ok: true, requested: false });
  }
  const unexpected = Object.keys(command).find((field) => !ALLOWED_FIELDS.includes(field));
  if (unexpected) return fail('GUARDED_CODEX_DISPATCH_FIELD_NOT_ALLOWED', { field: unexpected });
  if (!REQUEST_ID.test(String(command.requestId || ''))) {
    return fail('GUARDED_CODEX_DISPATCH_REQUEST_ID_INVALID');
  }
  const expectedHead = String(command.expectedHead || '').trim().toLowerCase();
  if (!SHA40.test(expectedHead)) return fail('GUARDED_CODEX_DISPATCH_EXPECTED_HEAD_REQUIRED');
  const task = String(command.task || '');
  if (task.trim() !== task || task.length < 20 || task.length > 4000) {
    return fail('GUARDED_CODEX_DISPATCH_TASK_INVALID');
  }
  const createdMs = Date.parse(String(command.createdAt || ''));
  const expiresMs = Date.parse(String(command.expiresAt || ''));
  if (!Number.isFinite(createdMs) || !Number.isFinite(expiresMs)
      || expiresMs <= createdMs || expiresMs - createdMs > MAX_WINDOW_MS) {
    return fail('GUARDED_CODEX_DISPATCH_TIME_INVALID');
  }
  if (!safeProofCommands(command.requestedProofCommands)) {
    return fail('GUARDED_CODEX_DISPATCH_PROOF_COMMANDS_INVALID');
  }
  if (!command.exactHeadProof || typeof command.exactHeadProof !== 'object' || Array.isArray(command.exactHeadProof)) {
    return fail('GUARDED_CODEX_DISPATCH_PROOF_REQUIRED');
  }
  if (!command.operatorApprovalReceipt || typeof command.operatorApprovalReceipt !== 'object'
      || Array.isArray(command.operatorApprovalReceipt)) {
    return fail('GUARDED_CODEX_DISPATCH_APPROVAL_RECEIPT_REQUIRED');
  }
  const prepared = createRemoteCodexBattleBridgeHandoff(handoffInput({
    ...command,
    expectedHead,
  }));
  if (!prepared.ok) return Object.freeze({ ...prepared, requested: true });
  return Object.freeze({
    ok: true,
    requested: true,
    expectedHead,
    command: Object.freeze({
      ...command,
      expectedHead,
      requestedProofCommands: Object.freeze([...command.requestedProofCommands]),
      exactHeadProof: Object.freeze({ ...command.exactHeadProof }),
      operatorApprovalReceipt: Object.freeze({ ...command.operatorApprovalReceipt }),
    }),
  });
}

function requestMeta(id) {
  return Object.freeze({
    jsonrpc: '2.0',
    id,
    isRequest: true,
    isNotification: false,
  });
}

export async function executeGuardedCodexTaskOnBattleBridge(command = {}, options = {}) {
  const shape = validateGuardedCodexTaskDispatchCommandShape(command);
  if (!shape.ok || !shape.requested) return shape;

  const now = options.now instanceof Date
    ? options.now
    : new Date(options.now || Date.now());
  const prepared = createRemoteCodexBattleBridgeHandoff(handoffInput(shape.command));
  if (!prepared.ok) return prepared;

  let latestAttachment = null;
  const handlerFactory = typeof options.createCodexDispatchMcpHandlerFn === 'function'
    ? options.createCodexDispatchMcpHandlerFn
    : createCodexDispatchMcpHandler;
  const handler = handlerFactory({
    now: () => now.toISOString(),
    attachmentIdentity: {
      repositoryRoot: String(options.repoRoot || process.env.STEPHANOS_REPO_ROOT || ''),
      ...(options.platform ? { platform: options.platform } : {}),
    },
    attachmentProofPublisher: (proof) => {
      latestAttachment = proof;
      return 'captured-in-process';
    },
  });

  try {
    await handler('initialize', {
      protocolVersion: '2025-06-18',
      clientInfo: { name: 'codex-mcp-client', version: '1.0.0' },
    }, requestMeta(1));
    await handler('notifications/initialized', {}, {
      jsonrpc: '2.0',
      id: undefined,
      isRequest: false,
      isNotification: true,
    });
    await handler('tools/list', {}, requestMeta(2));
    if (!latestAttachment) return fail('GUARDED_CODEX_DISPATCH_ATTACHMENT_NOT_PUBLISHED');

    const call = buildRemoteCodexDispatchCall(prepared.handoff, latestAttachment, { now });
    if (!call.ok) return call;

    const response = await handler('tools/call', {
      name: call.toolName,
      arguments: call.args,
    }, requestMeta(3));
    const result = response?.structuredContent || {};
    if (result?.ok !== true) {
      return Object.freeze({
        ok: false,
        verdict: 'COMMAND_EXECUTION_BLOCKED',
        blocker: String(result?.blocker || 'GUARDED_CODEX_DISPATCH_FAILED'),
        operation: GUARDED_CODEX_TASK_DISPATCH_OPERATION,
        requestId: shape.command.requestId,
        dispatcherState: String(result?.dispatcherState || ''),
        decision: String(result?.decision || ''),
        selectedRoute: result?.selectedRoute || null,
        providerNeutralHandoff: result?.providerNeutralHandoff || null,
        nextOperatorAction: String(result?.nextOperatorAction || ''),
        result,
        mergeAuthority: false,
        sourceMutationAuthority: false,
      });
    }
    return Object.freeze({
      ...result,
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      finalVerdict: 'GUARDED_CODEX_TASK_DISPATCHED',
      operation: GUARDED_CODEX_TASK_DISPATCH_OPERATION,
      requestId: shape.command.requestId,
      expectedHead: shape.expectedHead,
      mergeAuthority: false,
      sourceMutationAuthority: false,
      arbitraryShellAllowed: false,
      credentialsMayBeReadOrExported: false,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      verdict: 'COMMAND_EXECUTION_BLOCKED',
      blocker: 'GUARDED_CODEX_DISPATCH_EXECUTION_FAILED',
      operation: GUARDED_CODEX_TASK_DISPATCH_OPERATION,
      requestId: String(shape.command.requestId || ''),
      error: String(error?.message || error),
      mergeAuthority: false,
      sourceMutationAuthority: false,
    });
  }
}
