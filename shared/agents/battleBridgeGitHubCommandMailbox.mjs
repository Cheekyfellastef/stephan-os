import * as core from './battleBridgeGitHubCommandMailboxCoreV1.mjs';
import {
  OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION,
  executeOperatorEnvironmentApprovalOnBattleBridge,
  isTerminalizableOperatorEnvironmentApprovalBlocker,
  validateOperatorEnvironmentApprovalBattleBridgeCommandShape,
} from './operatorEnvironmentApprovalBattleBridgeV1.mjs';

export * from './battleBridgeGitHubCommandMailboxCoreV1.mjs';

export const BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS = Object.freeze([
  ...core.BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS,
  OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION,
]);

const CORE_TRANSLATION_OPERATION = 'RUN_WORKER_WATCHDOG_ACCEPTANCE';
const STANDARD_FIELDS = Object.freeze([
  'schemaVersion',
  'requestId',
  'repository',
  'issueNumber',
  'branch',
  'operatorApproval',
  'expectedHead',
  'expiresAt',
]);

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

function isOperatorEnvironmentApprovalOperation(operation = '') {
  return String(operation || '') === OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION;
}

function projectOperatorEnvironmentApprovalCommand(command = {}) {
  const shape = validateOperatorEnvironmentApprovalBattleBridgeCommandShape(command);
  return shape.ok && shape.requested ? shape.command : command;
}

function translateForCore(command = {}, shape = {}) {
  const translated = {};
  for (const field of STANDARD_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(command || {}, field)) translated[field] = command[field];
  }
  translated.operation = CORE_TRANSLATION_OPERATION;
  translated.expectedHead = shape?.ok === true ? shape.command.expectedHead : 'invalid';
  return Object.freeze(translated);
}

function translatedComment(comment = {}, translatedCommand = {}) {
  return {
    ...comment,
    body: `\`\`\`${core.BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(translatedCommand)}\n\`\`\``,
  };
}

export function isTerminalizableOwnerCommandBlocker(value) {
  return isTerminalizableOperatorEnvironmentApprovalBlocker(value)
    || core.isTerminalizableOwnerCommandBlocker(value);
}

export function validateBattleBridgeGitHubCommand(command = {}, options = {}) {
  const shape = validateOperatorEnvironmentApprovalBattleBridgeCommandShape(command);
  if (!shape.ok) return shape;
  if (!shape.requested) return core.validateBattleBridgeGitHubCommand(command, options);

  const envelope = core.validateBattleBridgeGitHubCommand(
    translateForCore(command, shape),
    options,
  );
  if (!envelope?.ok) return envelope;
  return Object.freeze({
    ...envelope,
    command: projectOperatorEnvironmentApprovalCommand(shape.command),
  });
}

export function classifyBattleBridgeMailboxOperation(operation = '') {
  if (isOperatorEnvironmentApprovalOperation(operation)) {
    return core.BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL;
  }
  return core.classifyBattleBridgeMailboxOperation(operation);
}

export function selectBattleBridgeGitHubCommandBatch(comments = [], options = {}) {
  const originals = new Map();
  const translated = (Array.isArray(comments) ? comments : []).map((comment) => {
    const extracted = core.extractBattleBridgeGitHubCommand(comment?.body || '');
    if (!extracted?.ok || !isOperatorEnvironmentApprovalOperation(extracted.command?.operation)) return comment;
    const shape = validateOperatorEnvironmentApprovalBattleBridgeCommandShape(extracted.command);
    originals.set(String(comment?.id ?? ''), Object.freeze({ command: extracted.command, shape }));
    return translatedComment(comment, translateForCore(extracted.command, shape));
  });

  const selected = core.selectBattleBridgeGitHubCommandBatch(translated, options);
  if (!selected?.ok) return selected;

  const commands = Array.isArray(selected.commands)
    ? selected.commands.map((entry) => {
      const original = originals.get(String(entry?.commentId ?? ''));
      if (!original?.shape?.ok) return entry;
      return Object.freeze({
        ...entry,
        command: projectOperatorEnvironmentApprovalCommand(original.shape.command),
        partition: core.BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL,
      });
    })
    : [];

  const rejected = Array.isArray(selected.rejected)
    ? selected.rejected.map((entry) => {
      const original = originals.get(String(entry?.commentId ?? ''));
      if (!original || original.shape?.ok) return entry;
      return Object.freeze({ ...entry, blocker: original.shape.blocker });
    })
    : selected.rejected;

  const terminalRejections = Array.isArray(selected.terminalRejections)
    ? selected.terminalRejections.map((entry) => {
      const original = originals.get(String(entry?.commentId ?? ''));
      if (!original) return entry;
      return Object.freeze({
        ...entry,
        blocker: original.shape?.ok === true ? entry.blocker : original.shape.blocker,
        command: projectOperatorEnvironmentApprovalCommand(original.command),
      });
    })
    : [];

  return Object.freeze({
    ...selected,
    ...(Array.isArray(selected.commands) ? { commands: Object.freeze(commands) } : {}),
    ...(Array.isArray(selected.rejected) ? { rejected: Object.freeze(rejected) } : {}),
    terminalRejections: Object.freeze(terminalRejections),
  });
}

export function selectNextBattleBridgeGitHubCommand(comments = [], options = {}) {
  const batch = selectBattleBridgeGitHubCommandBatch(comments, { ...options, maxBatch: 1 });
  if (!batch.ok || batch.verdict === 'NO_COMMAND_READY') return batch;
  const selected = batch.commands[0];
  return Object.freeze({
    ok: true,
    verdict: 'COMMAND_READY',
    commentId: selected.commentId,
    commentUrl: selected.commentUrl,
    command: selected.command,
    partition: selected.partition,
    rejected: batch.rejected,
    terminalRejections: batch.terminalRejections,
  });
}

export async function executeBattleBridgeGitHubCommand(command, options = {}) {
  if (!isOperatorEnvironmentApprovalOperation(command?.operation)) {
    return core.executeBattleBridgeGitHubCommand(command, options);
  }
  const shape = validateOperatorEnvironmentApprovalBattleBridgeCommandShape(command);
  if (!shape.ok) return shape;
  const executor = typeof options?.executeOperatorEnvironmentApprovalOnBattleBridgeFn === 'function'
    ? options.executeOperatorEnvironmentApprovalOnBattleBridgeFn
    : executeOperatorEnvironmentApprovalOnBattleBridge;
  try {
    return await executor(shape.command, options);
  } catch {
    return fail('OPERATOR_ENVIRONMENT_APPROVAL_EXECUTION_FAILED', {
      operation: OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION,
      requestId: String(command?.requestId || ''),
    });
  }
}
