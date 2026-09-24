import * as core from './battleBridgeGitHubCommandMailboxCoreV1.mjs';
import {
  OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION,
  executeOperatorEnvironmentApprovalOnBattleBridge,
  isTerminalizableOperatorEnvironmentApprovalBlocker,
  validateOperatorEnvironmentApprovalBattleBridgeCommandShape,
} from './operatorEnvironmentApprovalBattleBridgeV1.mjs';
import {
  STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION,
  executeStephanosNativeCapacityPublisherInstallOnBattleBridge,
  isTerminalizableStephanosNativeCapacityPublisherBlocker,
  validateStephanosNativeCapacityPublisherInstallCommandShape,
} from './stephanosNativeCapacityPublisherBattleBridgeV1.mjs';

export * from './battleBridgeGitHubCommandMailboxCoreV1.mjs';

export const BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS = Object.freeze([
  ...core.BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS,
  OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION,
  STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION,
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

function customOperationKind(operation = '') {
  const normalized = String(operation || '');
  if (normalized === OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION) return 'environment';
  if (normalized === STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION) return 'native-publisher';
  return '';
}

function validateCustomCommandShape(command = {}) {
  const kind = customOperationKind(command?.operation);
  if (kind === 'environment') return validateOperatorEnvironmentApprovalBattleBridgeCommandShape(command);
  if (kind === 'native-publisher') return validateStephanosNativeCapacityPublisherInstallCommandShape(command);
  return Object.freeze({ ok: true, requested: false });
}

function containsCustomCommand(comments = []) {
  return (Array.isArray(comments) ? comments : []).some((comment) => {
    const extracted = core.extractBattleBridgeGitHubCommand(comment?.body || '');
    return extracted?.ok && Boolean(customOperationKind(extracted.command?.operation));
  });
}

function projectCustomCommand(command = {}, shape = {}) {
  if (shape?.ok === true && shape?.requested === true && shape?.command) return shape.command;
  return command;
}

function translateForCore(command = {}, shape = {}) {
  const translated = {};
  for (const field of STANDARD_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(command || {}, field)) translated[field] = command[field];
  }
  translated.operation = CORE_TRANSLATION_OPERATION;
  translated.expectedHead = shape?.ok === true
    ? String(shape?.command?.expectedHead || shape?.expectedHead || command?.expectedHead || '')
    : 'invalid';
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
    || isTerminalizableStephanosNativeCapacityPublisherBlocker(value)
    || core.isTerminalizableOwnerCommandBlocker(value);
}

export function validateBattleBridgeGitHubCommand(command = {}, options = {}) {
  const kind = customOperationKind(command?.operation);
  if (!kind) return core.validateBattleBridgeGitHubCommand(command, options);

  const shape = validateCustomCommandShape(command);
  if (!shape.ok) return shape;
  const envelope = core.validateBattleBridgeGitHubCommand(
    translateForCore(command, shape),
    options,
  );
  if (!envelope?.ok) return envelope;
  return Object.freeze({
    ...envelope,
    command: projectCustomCommand(command, shape),
  });
}

export function classifyBattleBridgeMailboxOperation(operation = '') {
  if (customOperationKind(operation)) return core.BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL;
  return core.classifyBattleBridgeMailboxOperation(operation);
}

export function selectBattleBridgeGitHubCommandBatch(comments = [], options = {}) {
  if (!containsCustomCommand(comments)) return core.selectBattleBridgeGitHubCommandBatch(comments, options);

  const originals = new Map();
  const translated = (Array.isArray(comments) ? comments : []).map((comment) => {
    const extracted = core.extractBattleBridgeGitHubCommand(comment?.body || '');
    if (!extracted?.ok || !customOperationKind(extracted.command?.operation)) return comment;
    const shape = validateCustomCommandShape(extracted.command);
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
        command: projectCustomCommand(original.command, original.shape),
        partition: core.BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL,
      });
    })
    : [];

  const terminalRejections = Array.isArray(selected.terminalRejections)
    ? selected.terminalRejections.map((entry) => {
      const original = originals.get(String(entry?.commentId ?? ''));
      if (!original) return entry;
      return Object.freeze({
        ...entry,
        blocker: original.shape?.ok === true ? entry.blocker : original.shape.blocker,
        command: projectCustomCommand(original.command, original.shape),
      });
    })
    : [];

  const terminalCommentIds = new Set(
    terminalRejections.map((entry) => String(entry?.commentId ?? '')).filter(Boolean),
  );
  const rejected = [];
  if (Array.isArray(selected.rejected)) {
    for (const entry of selected.rejected) {
      const original = originals.get(String(entry?.commentId ?? ''));
      const blocker = original?.shape?.ok === false ? original.shape.blocker : entry.blocker;
      if (
        original?.shape?.ok === false
        && isTerminalizableOwnerCommandBlocker(blocker)
      ) {
        const requestId = String(original.command?.requestId || '');
        const commentId = String(entry?.commentId ?? '');
        if (!options?.consumedRequestIds?.has?.(requestId) && !terminalCommentIds.has(commentId)) {
          terminalCommentIds.add(commentId);
          terminalRejections.push(Object.freeze({
            ...entry,
            blocker,
            command: projectCustomCommand(original.command, original.shape),
          }));
        }
        continue;
      }
      rejected.push(original?.shape?.ok === false ? Object.freeze({ ...entry, blocker }) : entry);
    }
  }

  return Object.freeze({
    ...selected,
    commands: Object.freeze(commands),
    ...(Array.isArray(selected.rejected) ? { rejected: Object.freeze(rejected) } : {}),
    terminalRejections: Object.freeze(terminalRejections),
  });
}

export function selectNextBattleBridgeGitHubCommand(comments = [], options = {}) {
  if (!containsCustomCommand(comments)) return core.selectNextBattleBridgeGitHubCommand(comments, options);
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
  const kind = customOperationKind(command?.operation);
  if (!kind) return core.executeBattleBridgeGitHubCommand(command, options);

  const shape = validateCustomCommandShape(command);
  if (!shape.ok) return shape;
  try {
    if (kind === 'environment') {
      const executor = typeof options?.executeOperatorEnvironmentApprovalOnBattleBridgeFn === 'function'
        ? options.executeOperatorEnvironmentApprovalOnBattleBridgeFn
        : executeOperatorEnvironmentApprovalOnBattleBridge;
      return await executor(shape.command, options);
    }
    const executor = typeof options?.executeStephanosNativeCapacityPublisherInstallOnBattleBridgeFn === 'function'
      ? options.executeStephanosNativeCapacityPublisherInstallOnBattleBridgeFn
      : executeStephanosNativeCapacityPublisherInstallOnBattleBridge;
    return await executor(shape.command, options);
  } catch {
    return fail(kind === 'environment'
      ? 'OPERATOR_ENVIRONMENT_APPROVAL_EXECUTION_FAILED'
      : 'STEPHANOS_NATIVE_PUBLISHER_INSTALL_EXECUTION_FAILED', {
      operation: command?.operation || '',
      requestId: String(command?.requestId || ''),
    });
  }
}
