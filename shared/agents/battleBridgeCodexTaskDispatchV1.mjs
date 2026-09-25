import {
  createRemoteCodexBattleBridgeHandoff,
} from './remoteCodexBattleBridgeHandoffV1.mjs';
import {
  dispatchApprovedCodexHandoffOnBattleBridge,
} from '../../scripts/stephanos-codex-dispatch-mcp.mjs';
import { runApprovedBattleBridgeProofCommands } from './codexDispatchHostOps.mjs';

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

export async function executeGuardedCodexTaskOnBattleBridge(command = {}, options = {}) {
  const shape = validateGuardedCodexTaskDispatchCommandShape(command);
  if (!shape.ok || !shape.requested) return shape;

  const now = options.now instanceof Date
    ? options.now
    : new Date(options.now || Date.now());
  const prepared = createRemoteCodexBattleBridgeHandoff(handoffInput(shape.command));
  if (!prepared.ok) return prepared;

  const directProofExecutor = typeof options.runApprovedBattleBridgeProofCommandsFn === 'function'
    ? options.runApprovedBattleBridgeProofCommandsFn
    : runApprovedBattleBridgeProofCommands;
  let directProof;
  try {
    directProof = await directProofExecutor({
      repoRoot: String(options.repoRoot || process.env.STEPHANOS_REPO_ROOT || ''),
      expectedHead: shape.expectedHead,
      requestId: shape.command.requestId,
      requestedProofCommands: shape.command.requestedProofCommands,
      platform: options.platform || process.platform,
      ...(options.spawnSyncFn ? { spawnSyncFn: options.spawnSyncFn } : {}),
      ...(options.nodeCommand ? { nodeCommand: options.nodeCommand } : {}),
      nowFn: () => now,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      verdict: 'COMMAND_EXECUTION_BLOCKED',
      blocker: 'DIRECT_BATTLE_BRIDGE_PROOF_EXECUTION_INDETERMINATE',
      operation: GUARDED_CODEX_TASK_DISPATCH_OPERATION,
      requestId: String(shape.command.requestId || ''),
      taskId: '',
      dispatchJobId: '',
      providerTaskId: '',
      providerExecutionStarted: false,
      resultReadbackOperation: '',
      transport: 'battle-bridge-direct',
      mcpSessionRequired: false,
      error: String(error?.message || error),
      mergeAuthority: false,
      sourceMutationAuthority: false,
      arbitraryShellAllowed: false,
      credentialsMayBeReadOrExported: false,
    });
  }

  if (directProof?.handled === true) {
    const executionStarted = directProof.executionStarted === true;
    const providerTaskId = executionStarted ? String(directProof.providerTaskId || '') : '';
    const directRoute = Object.freeze({
      routeId: 'battle-bridge-direct-proof-v1',
      adapterId: 'battle-bridge-deterministic-proof',
      providerFamily: 'BATTLE_BRIDGE_HOST',
      workerId: 'battle-bridge-local',
      capacityReceiptId: '',
      proofRefs: Object.freeze([]),
    });
    return Object.freeze({
      ok: directProof.ok === true,
      verdict: directProof.ok === true ? 'COMMAND_EXECUTION_COMPLETE' : 'COMMAND_EXECUTION_BLOCKED',
      ...(directProof.blocker ? { blocker: String(directProof.blocker) } : {}),
      operation: GUARDED_CODEX_TASK_DISPATCH_OPERATION,
      requestId: shape.command.requestId,
      expectedHead: shape.expectedHead,
      taskId: '',
      dispatchJobId: '',
      providerTaskId,
      providerExecutionStarted: executionStarted,
      resultReadbackOperation: '',
      dispatcherState: executionStarted ? 'COMPLETED_DIRECT_HOST_PROOF' : 'DIRECT_HOST_PROOF_BLOCKED',
      decision: 'DIRECT_BATTLE_BRIDGE_PROOF',
      finalVerdict: String(directProof.finalVerdict || 'DIRECT_BATTLE_BRIDGE_PROOF_BLOCKED'),
      selectedRoute: directRoute,
      selectedProvider: directRoute.providerFamily,
      executionProvider: directRoute.adapterId,
      providerNeutralHandoff: null,
      deterministicProof: directProof,
      nextOperatorAction: directProof.ok === true
        ? 'Use the inline deterministic Battle Bridge proof result. No Codex or MCP task readback is required.'
        : 'Inspect the typed deterministic proof blocker. No Codex fallback was attempted after direct execution began.',
      transport: 'battle-bridge-direct',
      mcpSessionRequired: false,
      mergeAuthority: false,
      sourceMutationAuthority: false,
      arbitraryShellAllowed: false,
      credentialsMayBeReadOrExported: false,
    });
  }

  const dispatch = typeof options.dispatchApprovedCodexHandoffOnBattleBridgeFn === 'function'
    ? options.dispatchApprovedCodexHandoffOnBattleBridgeFn
    : dispatchApprovedCodexHandoffOnBattleBridge;

  try {
    const result = await dispatch(prepared.handoff, {
      now: () => now.toISOString(),
      platform: options.platform || process.platform,
      repositoryRoot: String(options.repoRoot || process.env.STEPHANOS_REPO_ROOT || ''),
      ...(options.integration ? { integration: options.integration } : {}),
      ...(options.readRepositoryHead ? { readRepositoryHead: options.readRepositoryHead } : {}),
      ...(options.dispatchDecision ? { dispatchDecision: options.dispatchDecision } : {}),
      ...(options.providerNeutralContinuity ? { providerNeutralContinuity: options.providerNeutralContinuity } : {}),
      ...(options.readLiveProviderNeutralCapacity ? { readLiveProviderNeutralCapacity: options.readLiveProviderNeutralCapacity } : {}),
    });
    if (result?.ok !== true) {
      return Object.freeze({
        ok: false,
        verdict: 'COMMAND_EXECUTION_BLOCKED',
        blocker: String(result?.blocker || 'GUARDED_CODEX_DISPATCH_FAILED'),
        operation: GUARDED_CODEX_TASK_DISPATCH_OPERATION,
        requestId: shape.command.requestId,
        dispatcherState: String(result?.dispatcherState || ''),
        decision: String(result?.decision || ''),
        dispatcherFinalVerdict: String(result?.dispatcherFinalVerdict || result?.finalVerdict || ''),
        exactNextAction: String(result?.exactNextAction || ''),
        capacityDecision: String(result?.capacityDecision || ''),
        capacityAvailability: String(result?.capacityAvailability || ''),
        externalCandidateCount: Number.isSafeInteger(result?.externalCandidateCount)
          && result.externalCandidateCount >= 0
          ? result.externalCandidateCount
          : 0,
        finalVerdict: String(
          result?.dispatcherFinalVerdict
            || result?.finalVerdict
            || result?.decision
            || result?.dispatcherState
            || 'GUARDED_CODEX_DISPATCH_BLOCKED',
        ),
        selectedProvider: String(result?.selectedRoute?.providerFamily || ''),
        executionProvider: String(result?.selectedRoute?.adapterId || result?.selectedRoute?.providerFamily || ''),
        selectedRoute: result?.selectedRoute || null,
        providerNeutralHandoff: result?.providerNeutralHandoff || null,
        nextOperatorAction: String(result?.nextOperatorAction || ''),
        transport: String(result?.transport || 'battle-bridge-native'),
        mcpSessionRequired: result?.mcpSessionRequired === true,
        result,
        mergeAuthority: false,
        sourceMutationAuthority: false,
      });
    }
    return Object.freeze({
      ...result,
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      finalVerdict: String(result?.finalVerdict || result?.decision || 'GUARDED_CODEX_TASK_DISPATCHED'),
      selectedProvider: String(result?.selectedRoute?.providerFamily || ''),
      executionProvider: String(result?.selectedRoute?.adapterId || result?.selectedRoute?.providerFamily || ''),
      operation: GUARDED_CODEX_TASK_DISPATCH_OPERATION,
      requestId: shape.command.requestId,
      expectedHead: shape.expectedHead,
      transport: String(result?.transport || 'battle-bridge-native'),
      mcpSessionRequired: result?.mcpSessionRequired === true,
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
