import * as base from './battleBridgeGitHubCommandMailboxBaseV1.mjs';
import {
  BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
  executeApprovedBackendRestartOnBattleBridge,
  normalizeApprovedBackendRestartCommand,
  validateApprovedBackendRestartCommandShape,
} from './battleBridgeApprovedBackendRestartMailboxV1.mjs';
import {
  BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE,
} from './battleBridgeDirtyDataPreservationV1.mjs';
import { syncCodexDispatchBridge } from './codexDispatchHostOps.mjs';

export * from './battleBridgeGitHubCommandMailboxBaseV1.mjs';

export const BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS = Object.freeze([
  ...base.BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS,
  BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
]);

const UPDATE_STEPHANOS_FROM_CHAT_OPERATION = 'UPDATE_STEPHANOS_FROM_CHAT';
const BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_APPROVAL = 'operator-approved';
const INVALID_PRESERVATION_EXPIRY = '1970-01-01T00:00:00.000Z';

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

function hasOwn(object, field) {
  return Object.prototype.hasOwnProperty.call(object || {}, field);
}

function validateRuntimeDataPreservationCommandShape(command = {}) {
  const profilePresent = hasOwn(command, 'preservationProfile');
  const approvalPresent = hasOwn(command, 'preservationApproval');
  const requested = profilePresent || approvalPresent;
  if (!requested) return Object.freeze({ ok: true, requested: false });
  if (String(command?.operation || '') !== UPDATE_STEPHANOS_FROM_CHAT_OPERATION) {
    return fail('COMMAND_PRESERVATION_FIELDS_NOT_ALLOWED', { requested: true });
  }
  const profile = String(command?.preservationProfile || '').trim();
  const approval = String(command?.preservationApproval || '').trim();
  if (!profilePresent || !approvalPresent || !profile || !approval) {
    return fail('COMMAND_PRESERVATION_FIELDS_INCOMPLETE', { requested: true });
  }
  if (profile !== BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE) {
    return fail('COMMAND_PRESERVATION_PROFILE_NOT_ALLOWED', { requested: true });
  }
  if (approval !== BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_APPROVAL) {
    return fail('COMMAND_PRESERVATION_APPROVAL_REQUIRED', { requested: true });
  }
  return Object.freeze({
    ok: true,
    requested: true,
    profile: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE,
    approval: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_APPROVAL,
  });
}

function withoutRuntimeDataPreservationFields(command = {}) {
  const {
    preservationProfile: _preservationProfile,
    preservationApproval: _preservationApproval,
    ...rest
  } = command || {};
  return rest;
}

function translateRuntimeDataPreservationForBase(command = {}, shape = {}) {
  const translated = withoutRuntimeDataPreservationFields(command);
  if (shape?.ok === true) return translated;
  return {
    ...translated,
    operation: UPDATE_STEPHANOS_FROM_CHAT_OPERATION,
    expiresAt: INVALID_PRESERVATION_EXPIRY,
  };
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
  const preservation = validateRuntimeDataPreservationCommandShape(command);
  if (!preservation.ok) return preservation;

  if (String(command?.operation || '') === BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION) {
    const shape = validateApprovedBackendRestartCommandShape(command);
    if (!shape.ok) return shape;
    const envelope = base.validateBattleBridgeGitHubCommand(
      translateApprovedBackendRestartForBase(command),
      options,
    );
    return normalizeApprovedBackendRestartCommand(command, envelope);
  }

  const envelope = base.validateBattleBridgeGitHubCommand(
    preservation.requested ? withoutRuntimeDataPreservationFields(command) : command,
    options,
  );
  if (!envelope?.ok || !preservation.requested) return envelope;
  return Object.freeze({
    ...envelope,
    command: Object.freeze({
      ...envelope.command,
      preservationProfile: preservation.profile,
      preservationApproval: preservation.approval,
    }),
  });
}

export function classifyBattleBridgeMailboxOperation(operation = '') {
  if (String(operation || '') === BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION) {
    return base.BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL;
  }
  return base.classifyBattleBridgeMailboxOperation(operation);
}

export function selectBattleBridgeGitHubCommandBatch(comments = [], options = {}) {
  const backendOriginals = new Map();
  const preservationOriginals = new Map();
  const translated = (Array.isArray(comments) ? comments : []).map((comment) => {
    const extracted = base.extractBattleBridgeGitHubCommand(comment?.body || '');
    if (!extracted.ok) return comment;

    const preservation = validateRuntimeDataPreservationCommandShape(extracted.command);
    if (preservation.requested) {
      preservationOriginals.set(String(comment?.id ?? ''), Object.freeze({
        command: extracted.command,
        shape: preservation,
      }));
      return translatedComment(
        comment,
        translateRuntimeDataPreservationForBase(extracted.command, preservation),
      );
    }

    if (extracted.command?.operation !== BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION) {
      return comment;
    }
    const shape = validateApprovedBackendRestartCommandShape(extracted.command);
    backendOriginals.set(String(comment?.id ?? ''), Object.freeze({
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
      const preservationOriginal = preservationOriginals.get(String(entry?.commentId ?? ''));
      if (preservationOriginal?.shape?.ok === true) {
        return Object.freeze({
          ...entry,
          command: Object.freeze({
            ...entry.command,
            preservationProfile: preservationOriginal.shape.profile,
            preservationApproval: preservationOriginal.shape.approval,
          }),
          partition: base.BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL,
        });
      }
      const backendOriginal = backendOriginals.get(String(entry?.commentId ?? ''));
      if (!backendOriginal?.shapeValid) return entry;
      return Object.freeze({
        ...entry,
        command: Object.freeze({
          ...entry.command,
          operation: BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
          expectedHead: String(backendOriginal.command.expectedHead || '').toLowerCase(),
        }),
        partition: base.BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL,
      });
    })
    : [];

  const rejected = Array.isArray(selected.rejected)
    ? selected.rejected.map((entry) => {
      const original = preservationOriginals.get(String(entry?.commentId ?? ''));
      if (!original || original.shape?.ok === true) return entry;
      return Object.freeze({
        ...entry,
        blocker: original.shape.blocker,
      });
    })
    : selected.rejected;

  const terminalRejections = Array.isArray(selected.terminalRejections)
    ? selected.terminalRejections.map((entry) => {
      const preservationOriginal = preservationOriginals.get(String(entry?.commentId ?? ''));
      if (preservationOriginal) {
        return Object.freeze({
          ...entry,
          blocker: preservationOriginal.shape?.ok === true
            ? entry.blocker
            : preservationOriginal.shape.blocker,
          command: Object.freeze({
            ...entry.command,
            operation: String(preservationOriginal.command?.operation || entry.command?.operation || ''),
          }),
        });
      }
      const backendOriginal = backendOriginals.get(String(entry?.commentId ?? ''));
      if (!backendOriginal) return entry;
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
  const preservation = validateRuntimeDataPreservationCommandShape(command);
  if (!preservation.ok) return preservation;

  if (preservation.requested) {
    const updater = options?.updateStephanos;
    if (typeof updater !== 'function') return base.executeBattleBridgeGitHubCommand(command, options);
    const preservationSyncFn = typeof options?.syncCodexDispatchBridgeFn === 'function'
      ? options.syncCodexDispatchBridgeFn
      : syncCodexDispatchBridge;
    return base.executeBattleBridgeGitHubCommand(command, {
      ...options,
      updateStephanos: async (payload = {}) => updater({
        ...payload,
        syncFn: (syncOptions = {}) => preservationSyncFn({
          ...syncOptions,
          operatorApproval: command.operatorApproval,
          preservationProfile: preservation.profile,
          preservationApproval: preservation.approval,
        }),
      }),
    });
  }

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
