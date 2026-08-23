import * as base from './battleBridgeGitHubCommandMailboxBaseV1.mjs';
import {
  BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
  executeApprovedBackendRestartOnBattleBridge,
  normalizeApprovedBackendRestartCommand,
  validateApprovedBackendRestartCommandShape,
} from './battleBridgeApprovedBackendRestartMailboxV1.mjs';

export * from './battleBridgeGitHubCommandMailboxBaseV1.mjs';

export const BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS = Object.freeze([
  ...base.BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS,
  BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
]);

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

function translateApprovedBackendRestartForBase(command = {}, { shapeValid = true } = {}) {
  return {
    ...command,
    operation: 'WAKE_BATTLE_BRIDGE_RECOVERY_MESH',
    ...(shapeValid ? {} : { targetRequestId: 'invalid-restart-shape' }),
  };
}

function translatedComment(comment = {}, translatedCommand = {}) {
  return {
    ...comment,
    body: `\`\`\`${base.BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(translatedCommand)}\n\`\`\``,
  };
}

export function validateBattleBridgeGitHubCommand(command = {}, options = {}) {
  if (String(command?.operation || '') !== BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION) {
    return base.validateBattleBridgeGitHubCommand(command, options);
  }
  const shape = validateApprovedBackendRestartCommandShape(command);
  if (!shape.ok) return shape;
  const envelope = base.validateBattleBridgeGitHubCommand(
    translateApprovedBackendRestartForBase(command),
    options,
  );
  return normalizeApprovedBackendRestartCommand(command, envelope);
}

export function classifyBattleBridgeMailboxOperation(operation = '') {
  if (String(operation || '') === BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION) {
    return base.BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL;
  }
  return base.classifyBattleBridgeMailboxOperation(operation);
}

export function selectBattleBridgeGitHubCommandBatch(comments = [], options = {}) {
  const originals = new Map();
  const translated = (Array.isArray(comments) ? comments : []).map((comment) => {
    const extracted = base.extractBattleBridgeGitHubCommand(comment?.body || '');
    if (!extracted.ok || extracted.command?.operation !== BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION) {
      return comment;
    }
    const shape = validateApprovedBackendRestartCommandShape(extracted.command);
    originals.set(String(comment?.id ?? ''), Object.freeze({
      command: extracted.command,
      shapeValid: shape.ok === true,
    }));
    return translatedComment(
      comment,
      translateApprovedBackendRestartForBase(extracted.command, { shapeValid: shape.ok === true }),
    );
  });

  const selected = base.selectBattleBridgeGitHubCommandBatch(translated, options);
  if (!selected?.ok) return selected;

  const commands = Array.isArray(selected.commands)
    ? selected.commands.map((entry) => {
      const original = originals.get(String(entry?.commentId ?? ''));
      if (!original?.shapeValid) return entry;
      return Object.freeze({
        ...entry,
        command: Object.freeze({
          ...entry.command,
          operation: BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
          expectedHead: String(original.command.expectedHead || '').toLowerCase(),
        }),
        partition: base.BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL,
      });
    })
    : [];

  const terminalRejections = Array.isArray(selected.terminalRejections)
    ? selected.terminalRejections.map((entry) => {
      const original = originals.get(String(entry?.commentId ?? ''));
      if (!original) return entry;
      return Object.freeze({
        ...entry,
        command: Object.freeze({
          ...entry.command,
          operation: BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
        }),
      });
    })
    : [];

  return Object.freeze({
    ...selected,
    ...(Array.isArray(selected.commands) ? { commands: Object.freeze(commands) } : {}),
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
  if (String(command?.operation || '') !== BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION) {
    return base.executeBattleBridgeGitHubCommand(command, options);
  }
  const shape = validateApprovedBackendRestartCommandShape(command);
  if (!shape.ok) return shape;
  const executor = typeof options?.restartApprovedBackend === 'function'
    ? options.restartApprovedBackend
    : executeApprovedBackendRestartOnBattleBridge;
  try {
    const result = await executor(command);
    return Object.freeze({
      ok: result?.ok !== false,
      verdict: result?.ok === false ? 'COMMAND_EXECUTION_BLOCKED' : 'COMMAND_EXECUTION_COMPLETE',
      operation: BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
      requestId: String(command?.requestId || ''),
      result,
    });
  } catch (error) {
    return fail('COMMAND_EXECUTION_FAILED', {
      operation: BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
      requestId: String(command?.requestId || ''),
      error: error?.message || String(error),
    });
  }
}
