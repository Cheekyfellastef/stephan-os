import {
  CODEX_BANKED_RESET_EXECUTION_SURFACE,
  CODEX_BANKED_RESET_OPERATION,
  CODEX_BANKED_RESET_POLICY_REF,
  executeCodexBankedResetOnBattleBridge,
} from './codexBankedResetBattleBridgeExecutor.mjs';
import {
  CODEX_BANKED_RESET_STATUS_OPERATION,
  readCodexBankedResetStatusOnBattleBridge,
} from './codexBankedResetStatusBattleBridgeReader.mjs';
import { MUSIC_SPOTIFY_LINK_OPERATION, MUSIC_SPOTIFY_LINK_SOURCE, validateMusicSpotifyLinkCandidate } from './musicSpotifyLinkBridge.mjs';

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
  'READ_CRITICAL_BACKLOG_STATUS',
  'READ_MAILBOX_RECEIPT',
  'RUN_WORKER_WATCHDOG_ACCEPTANCE',
  'RUN_MONITOR_MULTIPLEXER_ACCEPTANCE',
  'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF',
  MUSIC_SPOTIFY_LINK_OPERATION,
  CODEX_BANKED_RESET_STATUS_OPERATION,
  CODEX_BANKED_RESET_OPERATION,
]);

export const WINDOWS_BROWSER_PROOF_SCENARIOS = Object.freeze([
  'MUSIC_RATING_PRESERVES_PLAYBACK',
]);
export const WINDOWS_BROWSER_PROOF_TARGETS = Object.freeze([
  'PULL_REQUEST_HEAD',
  'MERGED_MAIN',
]);

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const RESET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,120}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const PR_NUMBER_PATTERN = /^[1-9][0-9]{0,9}$/;
const MAX_FUTURE_WINDOW_MS = 6 * 60 * 60 * 1000;
const RESET_COMMAND_FIELDS = Object.freeze([
  'resetId',
  'resetExpiresAtUtc',
  'latestSafeExecutionUtc',
  'standingOperatorPolicyRef',
  'executionSurface',
  'fixedUiActionOnly',
  'singlePressOnly',
]);
const FORBIDDEN_RESET_COMMAND_FIELDS = Object.freeze([
  'url', 'uri', 'selector', 'xpath', 'javascript', 'script', 'command', 'executable',
  'args', 'arguments', 'profilePath', 'userDataDir', 'cookie', 'cookies', 'token', 'credential',
]);
const MUSIC_SPOTIFY_FIELDS = Object.freeze(['source', 'spotifyUri', 'targetTrackId', 'targetArtist', 'targetTitle', 'requestedAtUtc']);

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function unsafeAutomationField(command) {
  return FORBIDDEN_RESET_COMMAND_FIELDS.find((field) => hasValue(command[field])) || '';
}

function validateResetFields(command, { nowMs, expiresAtMs }) {
  const unsafeField = unsafeAutomationField(command);
  if (unsafeField) return fail('RESET_COMMAND_UNSAFE_FIELD_PRESENT', { field: unsafeField });
  if (!RESET_ID_PATTERN.test(String(command.resetId || ''))) return fail('RESET_COMMAND_RESET_ID_INVALID');
  if (command.standingOperatorPolicyRef !== CODEX_BANKED_RESET_POLICY_REF) return fail('RESET_COMMAND_POLICY_MISMATCH');
  if (command.executionSurface !== CODEX_BANKED_RESET_EXECUTION_SURFACE) return fail('RESET_COMMAND_EXECUTION_SURFACE_MISMATCH');
  if (command.fixedUiActionOnly !== true) return fail('RESET_COMMAND_FIXED_UI_ACTION_REQUIRED');
  if (command.singlePressOnly !== true) return fail('RESET_COMMAND_SINGLE_PRESS_REQUIRED');

  const resetExpiresAtMs = Date.parse(String(command.resetExpiresAtUtc || ''));
  const latestSafeExecutionMs = Date.parse(String(command.latestSafeExecutionUtc || ''));
  if (!Number.isFinite(resetExpiresAtMs) || !Number.isFinite(latestSafeExecutionMs)) {
    return fail('RESET_COMMAND_TIME_INVALID');
  }
  if (resetExpiresAtMs <= nowMs) return fail('RESET_COMMAND_SELECTED_RESET_EXPIRED');
  if (latestSafeExecutionMs <= nowMs) return fail('RESET_COMMAND_ACTION_EXPIRED');
  if (latestSafeExecutionMs > expiresAtMs) return fail('RESET_COMMAND_LATEST_SAFE_AFTER_COMMAND_EXPIRY');
  if (latestSafeExecutionMs > resetExpiresAtMs) return fail('RESET_COMMAND_LATEST_SAFE_AFTER_RESET_EXPIRY');

  return Object.freeze({
    ok: true,
    reset: Object.freeze({
      resetId: String(command.resetId),
      resetExpiresAtUtc: new Date(resetExpiresAtMs).toISOString(),
      latestSafeExecutionUtc: new Date(latestSafeExecutionMs).toISOString(),
      standingOperatorPolicyRef: CODEX_BANKED_RESET_POLICY_REF,
      executionSurface: CODEX_BANKED_RESET_EXECUTION_SURFACE,
      fixedUiActionOnly: true,
      singlePressOnly: true,
    }),
  });
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
  if (command.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF') {
    if (!SHA_PATTERN.test(String(command.expectedHead || ''))) {
      return fail('WINDOWS_BROWSER_PROOF_EXPECTED_HEAD_REQUIRED');
    }
    if (!PR_NUMBER_PATTERN.test(String(command.prNumber || ''))) {
      return fail('WINDOWS_BROWSER_PROOF_PR_NUMBER_INVALID');
    }
    if (!WINDOWS_BROWSER_PROOF_SCENARIOS.includes(String(command.proofScenario || ''))) {
      return fail('WINDOWS_BROWSER_PROOF_SCENARIO_NOT_ALLOWED');
    }
    const proofTarget = String(command.proofTarget || 'PULL_REQUEST_HEAD');
    if (!WINDOWS_BROWSER_PROOF_TARGETS.includes(proofTarget)) {
      return fail('WINDOWS_BROWSER_PROOF_TARGET_NOT_ALLOWED');
    }
    if (proofTarget === 'MERGED_MAIN' && !SHA_PATTERN.test(String(command.pullRequestHead || ''))) {
      return fail('WINDOWS_BROWSER_PROOF_PR_PROVENANCE_HEAD_REQUIRED');
    }
    if (proofTarget === 'PULL_REQUEST_HEAD' && hasValue(command.pullRequestHead)) {
      return fail('WINDOWS_BROWSER_PROOF_PR_PROVENANCE_HEAD_NOT_ALLOWED');
    }
  } else if (hasValue(command.prNumber) || hasValue(command.proofScenario)
    || hasValue(command.proofTarget) || hasValue(command.pullRequestHead)) {
    return fail('WINDOWS_BROWSER_PROOF_FIELD_NOT_ALLOWED');
  }
  let musicSpotifyCandidate = null;
  if (command.operation === MUSIC_SPOTIFY_LINK_OPERATION) {
    const unsafeField = unsafeAutomationField(command);
    if (unsafeField) return fail('MUSIC_SPOTIFY_UNSAFE_FIELD_PRESENT', { field: unsafeField });
    if (!SHA_PATTERN.test(String(command.expectedHead || ''))) return fail('MUSIC_SPOTIFY_EXPECTED_HEAD_REQUIRED');
    const validation = validateMusicSpotifyLinkCandidate({
      ...command,
      source: command.source,
      requestedAtUtc: command.requestedAtUtc,
    });
    if (!validation.ok) return fail(validation.blocker);
    musicSpotifyCandidate = validation.candidate;
  } else {
    const unexpectedMusicField = MUSIC_SPOTIFY_FIELDS.find((field) => hasValue(command[field]));
    if (unexpectedMusicField) return fail('MUSIC_SPOTIFY_FIELD_NOT_ALLOWED', { field: unexpectedMusicField });
  }
  if (command.operation === CODEX_BANKED_RESET_STATUS_OPERATION) {
    const unsafeField = unsafeAutomationField(command);
    if (unsafeField) return fail('RESET_STATUS_COMMAND_UNSAFE_FIELD_PRESENT', { field: unsafeField });
  }
  const targetRequestId = String(command.targetRequestId || '');
  if (command.operation === 'READ_MAILBOX_RECEIPT' && !REQUEST_ID_PATTERN.test(targetRequestId)) {
    return fail('COMMAND_TARGET_REQUEST_ID_INVALID');
  }
  if (command.operation !== 'READ_MAILBOX_RECEIPT' && targetRequestId) {
    return fail('COMMAND_TARGET_REQUEST_ID_NOT_ALLOWED');
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

  let reset = null;
  if (command.operation === CODEX_BANKED_RESET_OPERATION) {
    const resetValidation = validateResetFields(command, { nowMs, expiresAtMs });
    if (!resetValidation.ok) return resetValidation;
    reset = resetValidation.reset;
  } else {
    const unexpectedResetField = RESET_COMMAND_FIELDS.find((field) => hasValue(command[field]));
    if (unexpectedResetField) return fail('RESET_COMMAND_FIELD_NOT_ALLOWED', { field: unexpectedResetField });
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
      targetRequestId: command.operation === 'READ_MAILBOX_RECEIPT' ? targetRequestId : '',
      prNumber: command.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF' ? Number(command.prNumber) : 0,
      proofScenario: command.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF' ? String(command.proofScenario) : '',
      proofTarget: command.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF'
        ? String(command.proofTarget || 'PULL_REQUEST_HEAD')
        : '',
      pullRequestHead: command.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF'
        ? String(command.pullRequestHead || '').toLowerCase()
        : '',
      ...(musicSpotifyCandidate ? {
        source: MUSIC_SPOTIFY_LINK_SOURCE,
        spotifyUri: musicSpotifyCandidate.spotifyUri,
        targetTrackId: musicSpotifyCandidate.targetTrackId,
        targetArtist: musicSpotifyCandidate.targetArtist,
        targetTitle: musicSpotifyCandidate.targetTitle,
        requestedAtUtc: musicSpotifyCandidate.requestedAtUtc,
      } : {}),
      expiresAt: new Date(expiresAtMs).toISOString(),
      ...(reset || {}),
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
  readCriticalBacklogStatus,
  readMailboxReceipt,
  runWorkerWatchdogAcceptance,
  runMonitorMultiplexerAcceptance,
  runExactHeadWindowsBrowserProof,
  queueVerifiedSpotifyLink,
  readCodexBankedResetStatus = readCodexBankedResetStatusOnBattleBridge,
  redeemBankedCodexReset = executeCodexBankedResetOnBattleBridge,
} = {}) {
  const handlers = {
    UPDATE_STEPHANOS_FROM_CHAT: updateStephanos,
    INSTALL_UNATTENDED_GITHUB_SYNC: installUnattendedSync,
    RUN_BATTLE_BRIDGE_DIAGNOSTICS: runDiagnostics,
    READ_DEPLOYMENT_STATUS: readDeploymentStatus,
    READ_CAPABILITY_REGISTRY: readCapabilityRegistry,
    READ_SHARED_WORKSPACE_STATUS: readSharedWorkspaceStatus,
    READ_CRITICAL_BACKLOG_STATUS: readCriticalBacklogStatus,
    READ_MAILBOX_RECEIPT: readMailboxReceipt,
    RUN_WORKER_WATCHDOG_ACCEPTANCE: runWorkerWatchdogAcceptance,
    RUN_MONITOR_MULTIPLEXER_ACCEPTANCE: runMonitorMultiplexerAcceptance,
    RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF: runExactHeadWindowsBrowserProof,
    [MUSIC_SPOTIFY_LINK_OPERATION]: queueVerifiedSpotifyLink,
    [CODEX_BANKED_RESET_STATUS_OPERATION]: readCodexBankedResetStatus,
    [CODEX_BANKED_RESET_OPERATION]: redeemBankedCodexReset,
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
    expectedHead: String(command?.expectedHead || ''),
    prNumber: command?.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF' ? Number(command?.prNumber || 0) : 0,
    proofScenario: command?.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF' ? String(command?.proofScenario || '') : '',
    proofTarget: command?.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF'
      ? String(command?.proofTarget || 'PULL_REQUEST_HEAD')
      : '',
    pullRequestHead: command?.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF'
      ? String(command?.pullRequestHead || '').toLowerCase()
      : '',
    resetId: command?.operation === CODEX_BANKED_RESET_OPERATION ? String(command?.resetId || '') : '',
    resetExpiresAtUtc: command?.operation === CODEX_BANKED_RESET_OPERATION ? String(command?.resetExpiresAtUtc || '') : '',
    latestSafeExecutionUtc: command?.operation === CODEX_BANKED_RESET_OPERATION ? String(command?.latestSafeExecutionUtc || '') : '',
    standingOperatorPolicyRef: command?.operation === CODEX_BANKED_RESET_OPERATION ? String(command?.standingOperatorPolicyRef || '') : '',
    fixedUiActionOnly: command?.operation === CODEX_BANKED_RESET_OPERATION ? command?.fixedUiActionOnly === true : false,
    singlePressOnly: command?.operation === CODEX_BANKED_RESET_OPERATION ? command?.singlePressOnly === true : false,
    readOnly: command?.operation === CODEX_BANKED_RESET_STATUS_OPERATION || command?.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF',
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
    arbitraryBrowserAutomationAllowed: false,
    credentialsMayBeReadOrExported: false,
  });
}
