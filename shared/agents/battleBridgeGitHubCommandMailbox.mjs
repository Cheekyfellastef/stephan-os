import { spawnSync } from 'node:child_process';

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

export * from './battleBridgeGitHubCommandMailboxBaseV1.mjs';

export const BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION = 'SYNC_CODEX_DISPATCH_BRIDGE';

export const BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS = Object.freeze([
  ...base.BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS,
  BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
  BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION,
]);

const UPDATE_STEPHANOS_FROM_CHAT_OPERATION = 'UPDATE_STEPHANOS_FROM_CHAT';
const BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_APPROVAL = 'operator-approved';
const INVALID_PRESERVATION_EXPIRY = '1970-01-01T00:00:00.000Z';
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const PRESERVATION_TERMINAL_BLOCKERS = new Set([
  'COMMAND_PRESERVATION_FIELDS_NOT_ALLOWED',
  'COMMAND_PRESERVATION_FIELDS_INCOMPLETE',
  'COMMAND_PRESERVATION_PROFILE_NOT_ALLOWED',
  'COMMAND_PRESERVATION_APPROVAL_REQUIRED',
  'COMMAND_PRESERVATION_EXPECTED_HEAD_REQUIRED',
]);

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

function hasOwn(object, field) {
  return Object.prototype.hasOwnProperty.call(object || {}, field);
}

function validateRuntimeDataPreservationCommandShape(command = {}) {
  const operation = String(command?.operation || '');
  const profilePresent = hasOwn(command, 'preservationProfile');
  const approvalPresent = hasOwn(command, 'preservationApproval');
  const requested = profilePresent || approvalPresent || operation === BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION;
  if (!requested) return Object.freeze({ ok: true, requested: false });
  if (operation !== BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION) {
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
  const expectedHead = String(command?.expectedHead || '').trim().toLowerCase();
  if (!SHA_PATTERN.test(expectedHead)) {
    return fail('COMMAND_PRESERVATION_EXPECTED_HEAD_REQUIRED', { requested: true });
  }
  return Object.freeze({
    ok: true,
    requested: true,
    profile: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE,
    approval: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_APPROVAL,
    expectedHead,
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
  if (String(translated.operation || '') === BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION) {
    translated.operation = UPDATE_STEPHANOS_FROM_CHAT_OPERATION;
  }
  if (shape?.ok === true) return translated;
  return {
    ...translated,
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

function createExactOriginMainGuard(spawnSyncFn, expectedHead) {
  const approvedHead = String(expectedHead || '').trim().toLowerCase();
  return (command, argv, options) => {
    const result = spawnSyncFn(command, argv, options);
    const args = Array.isArray(argv) ? argv.map(String) : [];
    if (String(command || '').toLowerCase().endsWith('git')
      && args[0] === 'rev-parse'
      && args[1] === 'origin/main'
      && !result?.error
      && result?.status === 0) {
      const observedHead = String(result?.stdout || '').trim().toLowerCase();
      if (observedHead !== approvedHead) {
        return {
          ...result,
          status: 1,
          stderr: 'APPROVED_TARGET_HEAD_MISMATCH',
        };
      }
    }
    return result;
  };
}

export function isTerminalizableOwnerCommandBlocker(value) {
  const blocker = String(value || '');
  return PRESERVATION_TERMINAL_BLOCKERS.has(blocker)
    || base.isTerminalizableOwnerCommandBlocker(blocker);
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
    preservation.requested ? translateRuntimeDataPreservationForBase(command, preservation) : command,
    options,
  );
  if (!envelope?.ok || !preservation.requested) return envelope;
  return Object.freeze({
    ...envelope,
    command: Object.freeze({
      ...envelope.command,
      operation: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION,
      preservationProfile: preservation.profile,
      preservationApproval: preservation.approval,
    }),
  });
}

export function classifyBattleBridgeMailboxOperation(operation = '') {
  if ([
    BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
    BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION,
  ].includes(String(operation || ''))) {
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
            operation: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION,
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
            expectedHead: String(preservationOriginal.command?.expectedHead || entry.command?.expectedHead || '').toLowerCase(),
            ...(preservationOriginal.shape?.ok === true ? {
              preservationProfile: preservationOriginal.shape.profile,
              preservationApproval: preservationOriginal.shape.approval,
            } : {}),
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

export function buildBattleBridgeGitHubCommandReceipt(args = {}) {
  const receipt = base.buildBattleBridgeGitHubCommandReceipt(args);
  const preservation = validateRuntimeDataPreservationCommandShape(args?.command || {});
  if (!preservation.ok || !preservation.requested) return receipt;
  return Object.freeze({
    ...receipt,
    preservationProfile: preservation.profile,
    preservationApproved: true,
  });
}

export async function executeBattleBridgeGitHubCommand(command, options = {}) {
  const preservation = validateRuntimeDataPreservationCommandShape(command);
  if (!preservation.ok) return preservation;

  if (preservation.requested) {
    if (options?.syncCodexDispatchBridgeFn !== undefined
      && typeof options.syncCodexDispatchBridgeFn !== 'function') {
      return fail('COMMAND_PRESERVATION_SYNC_HANDLER_INVALID', {
        operation: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION,
        requestId: String(command?.requestId || ''),
      });
    }
    let syncFn = options?.syncCodexDispatchBridgeFn;
    if (typeof syncFn !== 'function') {
      const module = await import('./codexDispatchHostOps.mjs');
      syncFn = module.syncCodexDispatchBridge;
    }
    const rawSpawnSyncFn = typeof options?.spawnSyncFn === 'function' ? options.spawnSyncFn : spawnSync;
    const guardedSpawnSyncFn = createExactOriginMainGuard(rawSpawnSyncFn, preservation.expectedHead);
    let preservationSync;
    try {
      preservationSync = await syncFn({
        expectedBranch: 'main',
        operatorApproval: command.operatorApproval,
        preservationProfile: preservation.profile,
        preservationApproval: preservation.approval,
        spawnSyncFn: guardedSpawnSyncFn,
      });
    } catch (error) {
      return fail('COMMAND_PRESERVATION_SYNC_FAILED', {
        operation: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION,
        requestId: String(command?.requestId || ''),
        error: error?.message || String(error),
      });
    }
    if (!preservationSync?.ok) {
      return Object.freeze({
        ok: false,
        verdict: 'COMMAND_EXECUTION_BLOCKED',
        blocker: String(preservationSync?.blocker || 'COMMAND_PRESERVATION_SYNC_BLOCKED'),
        operation: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION,
        requestId: String(command?.requestId || ''),
        result: preservationSync,
      });
    }
    const afterHead = String(preservationSync?.afterHead || '').trim().toLowerCase();
    if (afterHead !== preservation.expectedHead) {
      return Object.freeze({
        ok: false,
        verdict: 'COMMAND_EXECUTION_BLOCKED',
        blocker: 'COMMAND_PRESERVATION_TARGET_HEAD_MISMATCH',
        operation: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION,
        requestId: String(command?.requestId || ''),
        result: preservationSync,
      });
    }
    return Object.freeze({
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_OPERATION,
      requestId: String(command?.requestId || ''),
      sourceHead: afterHead,
      expectedHead: preservation.expectedHead,
      result: preservationSync,
      preservationSync,
      runtimeRefreshAttempted: false,
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
