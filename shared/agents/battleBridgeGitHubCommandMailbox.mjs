import * as legacy from './battleBridgeGitHubCommandMailboxLegacyV1.mjs';
import {
  MISSION_WORKER_DIAGNOSTIC_LINK_OPERATION,
  runMissionWorkerDiagnosticLink,
} from '../../scripts/mission-worker-diagnostic-link.mjs';

export * from './battleBridgeGitHubCommandMailboxLegacyV1.mjs';

export const BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS = Object.freeze([
  ...legacy.BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS,
  MISSION_WORKER_DIAGNOSTIC_LINK_OPERATION,
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const DIAGNOSTIC_LINK_ALLOWED_FIELDS = new Set([
  'schemaVersion',
  'requestId',
  'operation',
  'repository',
  'issueNumber',
  'branch',
  'operatorApproval',
  'expectedHead',
  'expiresAt',
]);
const DIAGNOSTIC_LINK_TERMINAL_BLOCKERS = new Set([
  'MISSION_WORKER_DIAGNOSTIC_LINK_EXPECTED_HEAD_REQUIRED',
  'MISSION_WORKER_DIAGNOSTIC_LINK_FIELD_NOT_ALLOWED',
]);
const DIAGNOSTIC_EXPECTED_HEAD_UNSET = Symbol('DIAGNOSTIC_EXPECTED_HEAD_UNSET');

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

function validateDiagnosticLinkCommandShape(command = {}) {
  if (String(command?.operation || '') !== MISSION_WORKER_DIAGNOSTIC_LINK_OPERATION) {
    return Object.freeze({ ok: true, requested: false });
  }
  const unexpectedField = Object.keys(command)
    .find((field) => !DIAGNOSTIC_LINK_ALLOWED_FIELDS.has(field));
  if (unexpectedField) {
    return fail('MISSION_WORKER_DIAGNOSTIC_LINK_FIELD_NOT_ALLOWED', {
      requested: true,
      field: unexpectedField,
    });
  }
  const expectedHead = String(command?.expectedHead || '').trim().toLowerCase();
  if (!SHA_PATTERN.test(expectedHead)) {
    return fail('MISSION_WORKER_DIAGNOSTIC_LINK_EXPECTED_HEAD_REQUIRED', { requested: true });
  }
  return Object.freeze({ ok: true, requested: true, expectedHead });
}

function projectDiagnosticEnvelope(command = {}, expectedHead = DIAGNOSTIC_EXPECTED_HEAD_UNSET) {
  const projected = {};
  for (const field of DIAGNOSTIC_LINK_ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(command || {}, field)) projected[field] = command[field];
  }
  projected.operation = MISSION_WORKER_DIAGNOSTIC_LINK_OPERATION;
  const projectedExpectedHead = expectedHead === DIAGNOSTIC_EXPECTED_HEAD_UNSET
    ? command?.expectedHead
    : expectedHead;
  projected.expectedHead = String(projectedExpectedHead ?? '').trim().toLowerCase();
  return Object.freeze(projected);
}

function translateDiagnosticLinkForLegacy(command = {}, shape = {}) {
  const translated = {};
  for (const field of DIAGNOSTIC_LINK_ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(command || {}, field)) translated[field] = command[field];
  }
  translated.operation = 'RUN_WORKER_WATCHDOG_ACCEPTANCE';
  translated.expectedHead = shape?.ok === true ? shape.expectedHead : 'invalid';
  return translated;
}

function translatedComment(comment = {}, translatedCommand = {}) {
  return {
    ...comment,
    body: `\`\`\`${legacy.BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(translatedCommand)}\n\`\`\``,
  };
}

function projectDiagnosticTerminalRejection(original = {}, options = {}) {
  const command = original?.command || {};
  const shape = original?.shape || {};
  const comment = original?.comment || {};
  if (shape?.ok === true || !DIAGNOSTIC_LINK_TERMINAL_BLOCKERS.has(String(shape?.blocker || ''))) return null;

  const originalExpectedHead = String(command?.expectedHead || '').trim().toLowerCase();
  const validationHead = SHA_PATTERN.test(originalExpectedHead)
    ? originalExpectedHead
    : '0'.repeat(40);
  const envelope = legacy.validateBattleBridgeGitHubCommand(
    translateDiagnosticLinkForLegacy(command, { ok: true, expectedHead: validationHead }),
    {
      authorLogin: String(comment?.user?.login || ''),
      now: options?.now || new Date(),
      authoredAt: comment?.created_at || options?.now || new Date(),
    },
  );
  if (!envelope?.ok) return null;

  const commentId = Number(comment?.id || 0);
  if (!Number.isSafeInteger(commentId) || commentId < 1) return null;
  return Object.freeze({
    commentId,
    commentUrl: String(comment?.html_url || comment?.url || ''),
    blocker: String(shape.blocker),
    command: projectDiagnosticEnvelope(envelope.command, originalExpectedHead),
  });
}

export function isTerminalizableOwnerCommandBlocker(value) {
  const blocker = String(value || '');
  return DIAGNOSTIC_LINK_TERMINAL_BLOCKERS.has(blocker)
    || legacy.isTerminalizableOwnerCommandBlocker(blocker);
}

export function validateBattleBridgeGitHubCommand(command = {}, options = {}) {
  const diagnostic = validateDiagnosticLinkCommandShape(command);
  if (!diagnostic.ok) return diagnostic;
  if (!diagnostic.requested) return legacy.validateBattleBridgeGitHubCommand(command, options);

  const envelope = legacy.validateBattleBridgeGitHubCommand(
    translateDiagnosticLinkForLegacy(command, diagnostic),
    options,
  );
  if (!envelope?.ok) return envelope;
  return Object.freeze({
    ...envelope,
    command: projectDiagnosticEnvelope(envelope.command, diagnostic.expectedHead),
  });
}

export function classifyBattleBridgeMailboxOperation(operation = '') {
  if (String(operation || '') === MISSION_WORKER_DIAGNOSTIC_LINK_OPERATION) {
    return legacy.BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL;
  }
  return legacy.classifyBattleBridgeMailboxOperation(operation);
}

export function selectBattleBridgeGitHubCommandBatch(comments = [], options = {}) {
  const diagnosticOriginals = new Map();
  const translated = (Array.isArray(comments) ? comments : []).map((comment) => {
    const extracted = legacy.extractBattleBridgeGitHubCommand(comment?.body || '');
    if (!extracted.ok || extracted.command?.operation !== MISSION_WORKER_DIAGNOSTIC_LINK_OPERATION) {
      return comment;
    }
    const shape = validateDiagnosticLinkCommandShape(extracted.command);
    diagnosticOriginals.set(String(comment?.id ?? ''), Object.freeze({
      command: extracted.command,
      shape,
      comment,
    }));
    return translatedComment(comment, translateDiagnosticLinkForLegacy(extracted.command, shape));
  });

  const selected = legacy.selectBattleBridgeGitHubCommandBatch(translated, options);
  if (!selected?.ok) return selected;

  const commands = Array.isArray(selected.commands)
    ? selected.commands.map((entry) => {
      const original = diagnosticOriginals.get(String(entry?.commentId ?? ''));
      if (!original?.shape?.ok) return entry;
      return Object.freeze({
        ...entry,
        command: projectDiagnosticEnvelope(entry.command, original.shape.expectedHead),
        partition: legacy.BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL,
      });
    })
    : [];

  const rejected = Array.isArray(selected.rejected)
    ? selected.rejected.map((entry) => {
      const original = diagnosticOriginals.get(String(entry?.commentId ?? ''));
      if (!original || original.shape?.ok) return entry;
      return Object.freeze({ ...entry, blocker: original.shape.blocker });
    })
    : selected.rejected;

  const terminalRejections = Array.isArray(selected.terminalRejections)
    ? selected.terminalRejections.map((entry) => {
      const original = diagnosticOriginals.get(String(entry?.commentId ?? ''));
      if (!original) return entry;
      return Object.freeze({
        ...entry,
        blocker: original.shape?.ok === true ? entry.blocker : original.shape.blocker,
        command: projectDiagnosticEnvelope(
          entry.command,
          String(original.command?.expectedHead || '').trim().toLowerCase(),
        ),
      });
    })
    : [];

  const terminalRequestIds = new Set(
    terminalRejections.map((entry) => String(entry?.command?.requestId || '')).filter(Boolean),
  );
  if (Array.isArray(selected.rejected)) {
    for (const entry of selected.rejected) {
      const original = diagnosticOriginals.get(String(entry?.commentId ?? ''));
      if (!original || original.shape?.ok === true) continue;
      const terminal = projectDiagnosticTerminalRejection(original, options);
      if (!terminal) continue;
      const requestId = String(terminal.command?.requestId || '');
      if (options?.consumedRequestIds?.has?.(requestId) || terminalRequestIds.has(requestId)) continue;
      terminalRequestIds.add(requestId);
      terminalRejections.push(terminal);
    }
  }

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
  if (String(command?.operation || '') !== MISSION_WORKER_DIAGNOSTIC_LINK_OPERATION) {
    return legacy.executeBattleBridgeGitHubCommand(command, options);
  }
  const shape = validateDiagnosticLinkCommandShape(command);
  if (!shape.ok) return shape;
  const executor = typeof options?.runMissionWorkerDiagnosticLinkFn === 'function'
    ? options.runMissionWorkerDiagnosticLinkFn
    : runMissionWorkerDiagnosticLink;
  try {
    const result = await executor({ expectedHead: shape.expectedHead });
    return Object.freeze({
      ok: result?.ok !== false,
      verdict: result?.ok === false ? 'COMMAND_EXECUTION_BLOCKED' : 'COMMAND_EXECUTION_COMPLETE',
      operation: MISSION_WORKER_DIAGNOSTIC_LINK_OPERATION,
      requestId: String(command?.requestId || ''),
      ...(result?.ok === false ? { blocker: String(result?.blocker || 'MISSION_WORKER_DIAGNOSTIC_LINK_EXECUTION_FAILED') } : {}),
      result,
    });
  } catch {
    return fail('MISSION_WORKER_DIAGNOSTIC_LINK_EXECUTION_FAILED', {
      operation: MISSION_WORKER_DIAGNOSTIC_LINK_OPERATION,
      requestId: String(command?.requestId || ''),
    });
  }
}
