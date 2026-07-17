export const BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA = 'stephanos.battle-bridge-github-command.v1';
export const BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE = 1507;
export const BATTLE_BRIDGE_GITHUB_COMMAND_AUTHOR = 'Cheekyfellastef';
export const BATTLE_BRIDGE_GITHUB_COMMAND_MARKER = 'stephanos-battle-bridge-command';

export const BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS = Object.freeze([
  'UPDATE_STEPHANOS_FROM_CHAT',
  'INSTALL_UNATTENDED_GITHUB_SYNC',
  'RUN_BATTLE_BRIDGE_DIAGNOSTICS',
  'READ_DEPLOYMENT_STATUS',
  'READ_CAPABILITY_REGISTRY',
  'READ_SHARED_WORKSPACE_STATUS',
  'RUN_WORKER_WATCHDOG_ACCEPTANCE',
]);

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const MAX_FUTURE_WINDOW_MS = 6 * 60 * 60 * 1000;

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

export function extractBattleBridgeGitHubCommand(body = '') {
  const text = String(body || '');
  const fence = '```';
  const pattern = new RegExp(`${fence}${BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\\s*([\\s\\S]*?)${fence}`, 'i');
  const match = text.match(pattern);
  if (!match) return fail('COMMAND_MARKER_MISSING');
  try {
    const command = JSON.parse(match[1].trim());
    return Object.freeze({ ok: true, command });
  } catch (error) {
    return fail('COMMAND_JSON_INVALID', { error: error?.message || String(error) });
  }
}

export function validateBattleBridgeGitHubCommand(command = {}, {
  authorLogin = '',
  now = new Date(),
} = {}) {
  if (authorLogin !== BATTLE_BRIDGE_GITHUB_COMMAND_AUTHOR) {
    return fail('COMMAND_AUTHOR_NOT_ALLOWED', { authorLogin });
  }
  if (command.schemaVersion !== BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA) {
    return fail('COMMAND_SCHEMA_MISMATCH');
  }
  if (!REQUEST_ID_PATTERN.test(String(command.requestId || ''))) {
    return fail('COMMAND_REQUEST_ID_INVALID');
  }
  if (!BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS.includes(command.operation)) {
    return fail('COMMAND_OPERATION_NOT_ALLOWED', { operation: command.operation || '' });
  }
  if (command.repository !== BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY) {
    return fail('COMMAND_REPOSITORY_MISMATCH');
  }
  if (Number(command.issueNumber) !== BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE) {
    return fail('COMMAND_ISSUE_MISMATCH');
  }
  if (command.branch !== 'main') return fail('COMMAND_BRANCH_NOT_ALLOWED');
  if (command.operatorApproval !== 'operator-approved') {
    return fail('COMMAND_OPERATOR_APPROVAL_REQUIRED');
  }
  if (command.expectedHead && !SHA_PATTERN.test(String(command.expectedHead))) {
    return fail('COMMAND_EXPECTED_HEAD_INVALID');
  }

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const expiresAtMs = new Date(command.expiresAt || '').getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresAtMs)) {
    return fail('COMMAND_EXPIRY_INVALID');
  }
  if (expiresAtMs <= nowMs) return fail('COMMAND_EXPIRED');
  if (expiresAtMs - nowMs > MAX_FUTURE_WINDOW_MS) {
    return fail('COMMAND_EXPIRY_TOO_FAR_AHEAD');
  }

  return Object.freeze({
    ok: true,
    verdict: 'COMMAND_ACCEPTED',
    command: Object.freeze({
      schemaVersion: command.schemaVersion,
      requestId: String(command.requestId),
      operation: command.operation,
      repository: command.repository,
      issueNumber: BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
      branch: 'main',
      operatorApproval: 'operator-approved',
      expectedHead: String(command.expectedHead || ''),
      expiresAt: new Date(expiresAtMs).toISOString(),
    }),
  });
}

export function selectNextBattleBridgeGitHubCommand(comments = [], {
  consumedRequestIds = new Set(),
  now = new Date(),
} = {}) {
  const ordered = [...comments].sort((a, b) => Number(a?.id || 0) - Number(b?.id || 0));
  const rejected = [];
  for (const comment of ordered) {
    const extracted = extractBattleBridgeGitHubCommand(comment?.body || '');
    if (!extracted.ok) continue;
    const validated = validateBattleBridgeGitHubCommand(extracted.command, {
      authorLogin: comment?.user?.login || '',
      now,
    });
    if (!validated.ok) {
      rejected.push(Object.freeze({ commentId: comment?.id || null, ...validated }));
      continue;
    }
    if (consumedRequestIds.has(validated.command.requestId)) continue;
    return Object.freeze({
      ok: true,
      verdict: 'COMMAND_READY',
      commentId: comment?.id || null,
      commentUrl: comment?.html_url || comment?.url || '',
      command: validated.command,
      rejected,
    });
  }
  return Object.freeze({ ok: true, verdict: 'NO_COMMAND_READY', rejected });
}

export async function executeBattleBridgeGitHubCommand(command, {
  updateStephanos,
  installUnattendedSync,
  runDiagnostics,
  readDeploymentStatus,
  readCapabilityRegistry,
  readSharedWorkspaceStatus,
  runWorkerWatchdogAcceptance,
} = {}) {
  const handlers = {
    UPDATE_STEPHANOS_FROM_CHAT: updateStephanos,
    INSTALL_UNATTENDED_GITHUB_SYNC: installUnattendedSync,
    RUN_BATTLE_BRIDGE_DIAGNOSTICS: runDiagnostics,
    READ_DEPLOYMENT_STATUS: readDeploymentStatus,
    READ_CAPABILITY_REGISTRY: readCapabilityRegistry,
    READ_SHARED_WORKSPACE_STATUS: readSharedWorkspaceStatus,
    RUN_WORKER_WATCHDOG_ACCEPTANCE: runWorkerWatchdogAcceptance,
  };
  const handler = handlers[command?.operation];
  if (typeof handler !== 'function') {
    return fail('COMMAND_HANDLER_NOT_CONFIGURED', { operation: command?.operation || '' });
  }
  try {
    const result = await handler(command);
    return Object.freeze({
      ok: result?.ok !== false,
      verdict: result?.ok === false ? 'COMMAND_EXECUTION_BLOCKED' : 'COMMAND_EXECUTION_COMPLETE',
      operation: command.operation,
      requestId: command.requestId,
      result,
    });
  } catch (error) {
    return fail('COMMAND_EXECUTION_FAILED', {
      operation: command?.operation || '',
      requestId: command?.requestId || '',
      error: error?.message || String(error),
    });
  }
}

export function buildBattleBridgeGitHubCommandReceipt({
  command,
  state,
  acceptedAt,
  heartbeatAt,
  completedAt = '',
  result = null,
  blocker = '',
  proofRefs = [],
} = {}) {
  return Object.freeze({
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: String(command?.requestId || ''),
    operation: String(command?.operation || ''),
    repository: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
    issueNumber: BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
    branch: 'main',
    state: String(state || ''),
    acceptedAt: String(acceptedAt || ''),
    heartbeatAt: String(heartbeatAt || ''),
    completedAt: String(completedAt || ''),
    blocker: String(blocker || ''),
    proofRefs: Array.isArray(proofRefs) ? proofRefs.slice(0, 20).map(String) : [],
    result,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    liveOpenClawUpdateAllowed: false,
  });
}
