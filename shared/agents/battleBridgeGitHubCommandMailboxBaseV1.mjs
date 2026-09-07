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
import {
  FORGE_SHADOW_BATTLE_BRIDGE_OPERATION,
  executeForgeShadowM2OnBattleBridge,
  forgeShadowBattleBridgeFields,
  validateForgeShadowBattleBridgeCommand,
} from './forgeShadowBattleBridgeAdapterV1.mjs';
import {
  FORGE_SHADOW_M3_EXECUTE_OPERATION,
  FORGE_SHADOW_M3_MAILBOX_OPERATIONS,
  FORGE_SHADOW_M3_PREPARE_OPERATION,
  executeForgeShadowM3ArtifactPreparationOnBattleBridge,
  executeForgeShadowM3OnBattleBridge,
  forgeShadowM3MailboxFields,
  validateForgeShadowM3MailboxCommand,
} from './forgeShadowM3MailboxAdapterV1.mjs';
import { MUSIC_SPOTIFY_LINK_OPERATION, MUSIC_SPOTIFY_LINK_SOURCE, validateMusicSpotifyLinkCandidate } from './musicSpotifyLinkBridge.mjs';
import {
  PROTECTED_OPENCLAW_MERGE_OPERATION,
  executeProtectedOpenClawMergeOnBattleBridge,
  protectedOpenClawMergeFields,
  validateProtectedOpenClawMergeCommand,
} from './protectedOpenClawMergeMailboxAdapter.mjs';

export const BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA = 'stephanos.battle-bridge-github-command.v1';
export const BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE = 1507;
export const BATTLE_BRIDGE_GITHUB_COMMAND_AUTHOR = 'Cheekyfellastef';
export const BATTLE_BRIDGE_GITHUB_COMMAND_MARKER = 'stephanos-battle-bridge-command';
export const MISSION_ORCHESTRATOR_CANCEL_OPERATION = 'CANCEL_MISSION_ORCHESTRATOR_MISSION';

export const BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS = Object.freeze([
  'UPDATE_STEPHANOS_FROM_CHAT',
  'INSTALL_UNATTENDED_GITHUB_SYNC',
  'RUN_BATTLE_BRIDGE_DIAGNOSTICS',
  'READ_DEPLOYMENT_STATUS',
  'READ_CAPABILITY_REGISTRY',
  'READ_SHARED_WORKSPACE_STATUS',
  'READ_CRITICAL_BACKLOG_STATUS',
  'READ_MAILBOX_RECEIPT',
  MISSION_ORCHESTRATOR_CANCEL_OPERATION,
  'RUN_WORKER_WATCHDOG_ACCEPTANCE',
  'INSTALL_BATTLE_BRIDGE_RECOVERY_MESH',
  'WAKE_BATTLE_BRIDGE_RECOVERY_MESH',
  'RUN_MONITOR_MULTIPLEXER_ACCEPTANCE',
  'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF',
  FORGE_SHADOW_BATTLE_BRIDGE_OPERATION,
  ...FORGE_SHADOW_M3_MAILBOX_OPERATIONS,
  PROTECTED_OPENCLAW_MERGE_OPERATION,
  MUSIC_SPOTIFY_LINK_OPERATION,
  CODEX_BANKED_RESET_STATUS_OPERATION,
  CODEX_BANKED_RESET_OPERATION,
]);

export const BATTLE_BRIDGE_MAILBOX_MAX_BATCH = 4;
export const BATTLE_BRIDGE_MAILBOX_PARTITION = Object.freeze({
  CONTROL: 'CONTROL',
  OBSERVATION: 'OBSERVATION',
});

const OBSERVATION_OPERATIONS = new Set([
  'RUN_BATTLE_BRIDGE_DIAGNOSTICS',
  'READ_DEPLOYMENT_STATUS',
  'READ_CAPABILITY_REGISTRY',
  'READ_SHARED_WORKSPACE_STATUS',
  'READ_CRITICAL_BACKLOG_STATUS',
  'READ_MAILBOX_RECEIPT',
  CODEX_BANKED_RESET_STATUS_OPERATION,
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
const MISSION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const MISSION_COMMAND_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{7,127}$/;
const MAX_FUTURE_WINDOW_MS = 6 * 60 * 60 * 1000;
const MISSION_CANCEL_REASON_MAX_LENGTH = 512;
const MISSION_CANCEL_ALLOWED_FIELDS = new Set([
  'schemaVersion',
  'requestId',
  'operation',
  'repository',
  'issueNumber',
  'branch',
  'operatorApproval',
  'expectedHead',
  'missionId',
  'commandId',
  'reason',
  'expiresAt',
]);
const MISSION_CANCEL_ONLY_FIELDS = Object.freeze(['missionId', 'commandId', 'reason']);
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
const SCOPED_DELIVERY_ALLOWED_OPERATIONS = new Set([
  'UPDATE_STEPHANOS_FROM_CHAT',
  'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF',
]);
const SCOPED_DELIVERY_FIELDS = new Set([
  'prNumber',
  'mergeCommit',
  'deploymentRequestId',
  'featureId',
]);
const SCOPED_DELIVERY_FEATURE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,120}$/;
const TERMINALIZABLE_OWNER_COMMAND_BLOCKERS = new Set([
  'COMMAND_BRANCH_NOT_ALLOWED',
  'COMMAND_EXPECTED_HEAD_INVALID',
  'COMMAND_EXPIRED',
  'COMMAND_EXPIRY_INVALID',
  'COMMAND_EXPIRY_TOO_FAR_AHEAD',
  'COMMAND_ISSUE_MISMATCH',
  'COMMAND_OPERATION_NOT_ALLOWED',
  'COMMAND_OPERATOR_APPROVAL_REQUIRED',
  'COMMAND_REPOSITORY_MISMATCH',
  'COMMAND_REQUEST_ID_INVALID',
  'COMMAND_SCHEMA_MISMATCH',
  'COMMAND_TARGET_REQUEST_ID_INVALID',
  'COMMAND_TARGET_REQUEST_ID_NOT_ALLOWED',
  'FORGE_SHADOW_COMMAND_EXPECTED_HEAD_INVALID',
  'FORGE_SHADOW_COMMAND_IMAGE_DIGEST_INVALID',
  'FORGE_SHADOW_COMMAND_M2_ONLY_REQUIRED',
  'FORGE_SHADOW_COMMAND_REPOSITORY_MISMATCH',
  'FORGE_SHADOW_COMMAND_RUNTIME_BOUNDARY_INVALID',
  'FORGE_SHADOW_COMMAND_UNSAFE_FIELD_PRESENT',
  'FORGE_SHADOW_COMMAND_VERSION_MISMATCH',
  'FORGE_SHADOW_FIELD_NOT_ALLOWED',
  'MISSION_CANCEL_COMMAND_ID_INVALID',
  'MISSION_CANCEL_EXPECTED_HEAD_REQUIRED',
  'MISSION_CANCEL_FIELD_NOT_ALLOWED',
  'MISSION_CANCEL_MISSION_ID_INVALID',
  'MISSION_CANCEL_REASON_INVALID',
  'MUSIC_SPOTIFY_EXPECTED_HEAD_REQUIRED',
  'MUSIC_SPOTIFY_FIELD_NOT_ALLOWED',
  'MUSIC_SPOTIFY_REQUEST_ID_INVALID',
  'MUSIC_SPOTIFY_REQUEST_TIME_INVALID',
  'MUSIC_SPOTIFY_SOURCE_NOT_ALLOWED',
  'MUSIC_SPOTIFY_TARGET_IDENTITY_REQUIRED',
  'MUSIC_SPOTIFY_TARGET_TRACK_ID_INVALID',
  'MUSIC_SPOTIFY_TRACK_URI_INVALID',
  'MUSIC_SPOTIFY_UNSAFE_FIELD_PRESENT',
  'PROTECTED_MERGE_APPROVAL_TOKEN_INVALID',
  'PROTECTED_MERGE_ARTIFACT_DIGEST_INVALID',
  'PROTECTED_MERGE_BASE_INVALID',
  'PROTECTED_MERGE_EXPIRED',
  'PROTECTED_MERGE_FINDING_INVALID',
  'PROTECTED_MERGE_HEAD_INVALID',
  'PROTECTED_MERGE_METHOD_INVALID',
  'PROTECTED_MERGE_PAYLOAD_DIGEST_INVALID',
  'PROTECTED_MERGE_PR_NUMBER_INVALID',
  'PROTECTED_MERGE_REVIEW_IDENTITY_INVALID',
  'PROTECTED_MERGE_REVIEW_MODE_INVALID',
  'PROTECTED_MERGE_UNSAFE_FIELD_PRESENT',
  'PROTECTED_MERGE_FIELD_NOT_ALLOWED',
  'RECOVERY_MESH_EXPECTED_HEAD_REQUIRED',
  'RESET_COMMAND_ACTION_EXPIRED',
  'RESET_COMMAND_EXECUTION_SURFACE_MISMATCH',
  'RESET_COMMAND_FIELD_NOT_ALLOWED',
  'RESET_COMMAND_FIXED_UI_ACTION_REQUIRED',
  'RESET_COMMAND_LATEST_SAFE_AFTER_COMMAND_EXPIRY',
  'RESET_COMMAND_LATEST_SAFE_AFTER_RESET_EXPIRY',
  'RESET_COMMAND_POLICY_MISMATCH',
  'RESET_COMMAND_RESET_ID_INVALID',
  'RESET_COMMAND_SELECTED_RESET_EXPIRED',
  'RESET_COMMAND_SINGLE_PRESS_REQUIRED',
  'RESET_COMMAND_TIME_INVALID',
  'RESET_COMMAND_UNSAFE_FIELD_PRESENT',
  'RESET_STATUS_COMMAND_UNSAFE_FIELD_PRESENT',
  'SCOPED_DELIVERY_DEPLOYMENT_HEAD_REQUIRED',
  'SCOPED_DELIVERY_FEATURE_ID_INVALID',
  'SCOPED_DELIVERY_FIELD_NOT_ALLOWED',
  'SCOPED_DELIVERY_INVALID',
  'SCOPED_DELIVERY_MERGE_COMMIT_INVALID',
  'SCOPED_DELIVERY_PR_NUMBER_INVALID',
  'SCOPED_DELIVERY_PR_NUMBER_MISMATCH',
  'SCOPED_DELIVERY_REQUEST_ID_INVALID',
  'SCOPED_DELIVERY_REQUEST_ID_MISMATCH',
  'WINDOWS_BROWSER_PROOF_EXPECTED_HEAD_REQUIRED',
  'WINDOWS_BROWSER_PROOF_FIELD_NOT_ALLOWED',
  'WINDOWS_BROWSER_PROOF_PR_NUMBER_INVALID',
  'WINDOWS_BROWSER_PROOF_PR_PROVENANCE_HEAD_NOT_ALLOWED',
  'WINDOWS_BROWSER_PROOF_PR_PROVENANCE_HEAD_REQUIRED',
  'WINDOWS_BROWSER_PROOF_SCENARIO_NOT_ALLOWED',
  'WINDOWS_BROWSER_PROOF_TARGET_NOT_ALLOWED',
]);

export function isTerminalizableOwnerCommandBlocker(value) {
  return TERMINALIZABLE_OWNER_COMMAND_BLOCKERS.has(String(value || ''));
}

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validateMissionCancellation(command = {}) {
  const unexpectedField = Object.keys(command).find((field) => !MISSION_CANCEL_ALLOWED_FIELDS.has(field));
  if (unexpectedField) return fail('MISSION_CANCEL_FIELD_NOT_ALLOWED', { field: unexpectedField });
  if (!SHA_PATTERN.test(String(command.expectedHead || ''))) {
    return fail('MISSION_CANCEL_EXPECTED_HEAD_REQUIRED');
  }
  const missionId = String(command.missionId || '').trim().toLowerCase();
  if (!MISSION_ID_PATTERN.test(missionId)) return fail('MISSION_CANCEL_MISSION_ID_INVALID');
  const commandId = String(command.commandId || '').trim().toLowerCase();
  if (!MISSION_COMMAND_ID_PATTERN.test(commandId)) return fail('MISSION_CANCEL_COMMAND_ID_INVALID');
  const reason = String(command.reason || '').trim();
  if (!reason || reason.length > MISSION_CANCEL_REASON_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(reason)) {
    return fail('MISSION_CANCEL_REASON_INVALID');
  }
  return Object.freeze({
    ok: true,
    cancellation: Object.freeze({ missionId, commandId, reason }),
  });
}

function validateScopedDelivery(command = {}) {
  if (!hasValue(command.scopedDelivery)) return Object.freeze({ ok: true, scopedDelivery: null });
  if (!SCOPED_DELIVERY_ALLOWED_OPERATIONS.has(command.operation)) {
    return fail('SCOPED_DELIVERY_FIELD_NOT_ALLOWED');
  }
  if (!plainObject(command.scopedDelivery)) return fail('SCOPED_DELIVERY_INVALID');

  const unexpectedField = Object.keys(command.scopedDelivery)
    .find((field) => !SCOPED_DELIVERY_FIELDS.has(field));
  if (unexpectedField) {
    return fail('SCOPED_DELIVERY_FIELD_NOT_ALLOWED', { field: 'scopedDelivery.' + unexpectedField });
  }

  const prNumber = Number(command.scopedDelivery.prNumber);
  const mergeCommit = String(command.scopedDelivery.mergeCommit || '').toLowerCase();
  const deploymentRequestId = String(command.scopedDelivery.deploymentRequestId || '');
  const featureId = String(command.scopedDelivery.featureId || '');
  const deploymentHead = String(command.expectedHead || '').toLowerCase();

  if (!PR_NUMBER_PATTERN.test(String(prNumber))) return fail('SCOPED_DELIVERY_PR_NUMBER_INVALID');
  if (!SHA_PATTERN.test(mergeCommit)) return fail('SCOPED_DELIVERY_MERGE_COMMIT_INVALID');
  if (!SHA_PATTERN.test(deploymentHead)) return fail('SCOPED_DELIVERY_DEPLOYMENT_HEAD_REQUIRED');
  if (!REQUEST_ID_PATTERN.test(deploymentRequestId)) return fail('SCOPED_DELIVERY_REQUEST_ID_INVALID');
  if (!SCOPED_DELIVERY_FEATURE_ID_PATTERN.test(featureId)) return fail('SCOPED_DELIVERY_FEATURE_ID_INVALID');
  if (command.operation === 'UPDATE_STEPHANOS_FROM_CHAT' && deploymentRequestId !== String(command.requestId)) {
    return fail('SCOPED_DELIVERY_REQUEST_ID_MISMATCH');
  }
  if (command.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF' && prNumber !== Number(command.prNumber)) {
    return fail('SCOPED_DELIVERY_PR_NUMBER_MISMATCH');
  }

  return Object.freeze({
    ok: true,
    scopedDelivery: Object.freeze({
      repository: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
      relatedPr: '#' + prNumber,
      prNumber,
      mergeCommit,
      deploymentHead,
      deploymentRequestId,
      featureId,
    }),
  });
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
  authoredAt = now,
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

  let missionCancellation = null;
  if (command.operation === MISSION_ORCHESTRATOR_CANCEL_OPERATION) {
    const validation = validateMissionCancellation(command);
    if (!validation.ok) return validation;
    missionCancellation = validation.cancellation;
  } else {
    const unexpectedMissionCancelField = MISSION_CANCEL_ONLY_FIELDS.find((field) => hasValue(command[field]));
    if (unexpectedMissionCancelField) return fail('MISSION_CANCEL_FIELD_NOT_ALLOWED', { field: unexpectedMissionCancelField });
  }

  if (['INSTALL_BATTLE_BRIDGE_RECOVERY_MESH', 'WAKE_BATTLE_BRIDGE_RECOVERY_MESH'].includes(command.operation)
    && !SHA_PATTERN.test(String(command.expectedHead || ''))) {
    return fail('RECOVERY_MESH_EXPECTED_HEAD_REQUIRED');
  }
  let forgeShadow = null;
  if (command.operation === FORGE_SHADOW_BATTLE_BRIDGE_OPERATION) {
    const validation = validateForgeShadowBattleBridgeCommand(command);
    if (!validation.ok) return fail(validation.blocker, validation.details || {});
    forgeShadow = validation.command;
  } else {
    const unexpectedForgeField = forgeShadowBattleBridgeFields().find((field) => hasValue(command[field]));
    if (unexpectedForgeField) return fail('FORGE_SHADOW_FIELD_NOT_ALLOWED', { field: unexpectedForgeField });
  }
  let forgeShadowM3 = null;
  if (FORGE_SHADOW_M3_MAILBOX_OPERATIONS.includes(command.operation)) {
    const validation = validateForgeShadowM3MailboxCommand(command, { now });
    if (!validation.ok) return fail(validation.blocker, { field: validation.field || '' });
    forgeShadowM3 = validation.command;
  } else {
    const unexpectedM3Field = forgeShadowM3MailboxFields().find((field) => hasValue(command[field]));
    if (unexpectedM3Field) return fail('FORGE_M3_FIELD_NOT_ALLOWED', { field: unexpectedM3Field });
  }
  let protectedMerge = null;
  if (command.operation === PROTECTED_OPENCLAW_MERGE_OPERATION) {
    const validation = validateProtectedOpenClawMergeCommand(command, { now });
    if (!validation.ok) return fail(validation.blocker, validation.details || {});
    protectedMerge = validation.command;
  } else {
    const unexpectedProtectedMergeField = protectedOpenClawMergeFields().find((field) => hasValue(command[field]));
    if (unexpectedProtectedMergeField) {
      return fail('PROTECTED_MERGE_FIELD_NOT_ALLOWED', { field: unexpectedProtectedMergeField });
    }
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
  } else if (command.operation !== PROTECTED_OPENCLAW_MERGE_OPERATION
    && (hasValue(command.prNumber) || hasValue(command.proofScenario)
      || hasValue(command.proofTarget) || hasValue(command.pullRequestHead))) {
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
  const scopedDeliveryValidation = validateScopedDelivery(command);
  if (!scopedDeliveryValidation.ok) return scopedDeliveryValidation;

  const targetRequestId = String(command.targetRequestId || '');
  if (command.operation === 'READ_MAILBOX_RECEIPT' && !REQUEST_ID_PATTERN.test(targetRequestId)) {
    return fail('COMMAND_TARGET_REQUEST_ID_INVALID');
  }
  if (command.operation !== 'READ_MAILBOX_RECEIPT' && targetRequestId) {
    return fail('COMMAND_TARGET_REQUEST_ID_NOT_ALLOWED');
  }

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const authoredAtMs = authoredAt instanceof Date ? authoredAt.getTime() : new Date(authoredAt).getTime();
  const expiresAtMs = new Date(command.expiresAt || '').getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(authoredAtMs) || !Number.isFinite(expiresAtMs)) {
    return fail('COMMAND_EXPIRY_INVALID');
  }
  if (expiresAtMs <= authoredAtMs || expiresAtMs <= nowMs) return fail('COMMAND_EXPIRED');
  if (expiresAtMs - authoredAtMs > MAX_FUTURE_WINDOW_MS) {
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
      prNumber: ['RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF', PROTECTED_OPENCLAW_MERGE_OPERATION].includes(command.operation)
        ? Number(command.prNumber)
        : 0,
      proofScenario: command.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF' ? String(command.proofScenario) : '',
      proofTarget: command.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF'
        ? String(command.proofTarget || 'PULL_REQUEST_HEAD')
        : '',
      pullRequestHead: command.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF'
        ? String(command.pullRequestHead || '').toLowerCase()
        : '',
      ...(missionCancellation || {}),
      ...(scopedDeliveryValidation.scopedDelivery
        ? { scopedDelivery: scopedDeliveryValidation.scopedDelivery }
        : {}),
      ...(forgeShadow || {}),
      ...(forgeShadowM3 || {}),
      ...(protectedMerge || {}),
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

export function classifyBattleBridgeMailboxOperation(operation = '') {
  return OBSERVATION_OPERATIONS.has(String(operation || ''))
    ? BATTLE_BRIDGE_MAILBOX_PARTITION.OBSERVATION
    : BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL;
}

function projectTerminalMailboxRejection(comment = {}, command = {}, validation = {}) {
  const requestId = String(command?.requestId || '');
  const operation = String(command?.operation || '');
  const expectedHead = String(command?.expectedHead || '').toLowerCase();
  const blocker = String(validation?.blocker || '').toUpperCase();
  const commentId = Number(comment?.id || 0);
  if (comment?.user?.login !== BATTLE_BRIDGE_GITHUB_COMMAND_AUTHOR
    || !Number.isSafeInteger(commentId) || commentId < 1
    || !REQUEST_ID_PATTERN.test(requestId)
    || !BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS.includes(operation)
    || command?.repository !== BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY
    || Number(command?.issueNumber) !== BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE
    || command?.branch !== 'main'
    || command?.operatorApproval !== 'operator-approved'
    || (expectedHead && !SHA_PATTERN.test(expectedHead))
    || !TERMINALIZABLE_OWNER_COMMAND_BLOCKERS.has(blocker)) {
    return null;
  }
  return Object.freeze({
    commentId,
    commentUrl: String(comment?.html_url || comment?.url || ''),
    blocker,
    command: Object.freeze({
      schemaVersion: BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
      requestId,
      operation,
      repository: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
      issueNumber: BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
      branch: 'main',
      operatorApproval: 'operator-approved',
      expectedHead,
      expiresAt: Number.isFinite(Date.parse(String(command?.expiresAt || '')))
        ? new Date(command.expiresAt).toISOString()
        : '',
    }),
  });
}

export function selectBattleBridgeGitHubCommandBatch(comments = [], {
  consumedRequestIds = new Set(),
  now = new Date(),
  maxBatch = BATTLE_BRIDGE_MAILBOX_MAX_BATCH,
} = {}) {
  const boundedMaxBatch = Number(maxBatch);
  if (!Number.isSafeInteger(boundedMaxBatch) || boundedMaxBatch < 1 || boundedMaxBatch > BATTLE_BRIDGE_MAILBOX_MAX_BATCH) {
    return fail('MAILBOX_BATCH_SIZE_INVALID', { maxBatch });
  }
  const ordered = [...comments].sort((a, b) => Number(a?.id || 0) - Number(b?.id || 0));
  const rejected = [];
  const terminalRejections = [];
  const ready = [];
  const seenRequestIds = new Set();
  for (const comment of ordered) {
    const extracted = extractBattleBridgeGitHubCommand(comment?.body || '');
    if (!extracted.ok) continue;
    const validated = validateBattleBridgeGitHubCommand(extracted.command, {
      authorLogin: comment?.user?.login || '',
      now,
      authoredAt: comment?.created_at || now,
    });
    if (!validated.ok) {
      rejected.push(Object.freeze({ commentId: comment?.id || null, ...validated }));
      const terminal = projectTerminalMailboxRejection(comment, extracted.command, validated);
      if (terminal && !consumedRequestIds.has(terminal.command.requestId)
        && !seenRequestIds.has(terminal.command.requestId)) {
        seenRequestIds.add(terminal.command.requestId);
        terminalRejections.push(terminal);
      }
      continue;
    }
    if (consumedRequestIds.has(validated.command.requestId)) continue;
    if (seenRequestIds.has(validated.command.requestId)) continue;
    seenRequestIds.add(validated.command.requestId);
    ready.push(Object.freeze({
      commentId: comment?.id || null,
      commentUrl: comment?.html_url || comment?.url || '',
      command: validated.command,
      partition: classifyBattleBridgeMailboxOperation(validated.command.operation),
    }));
  }
  if (ready.length === 0) return Object.freeze({
    ok: true,
    verdict: 'NO_COMMAND_READY',
    rejected,
    terminalRejections: Object.freeze(terminalRejections),
  });
  const commands = Object.freeze(ready.slice(0, boundedMaxBatch));
  const controlCount = commands.filter((entry) => entry.partition === BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL).length;
  const observationCount = commands.length - controlCount;
  return Object.freeze({
    ok: true,
    verdict: 'COMMAND_BATCH_READY',
    commands,
    selectedCount: commands.length,
    readyCount: ready.length,
    deferredCount: Math.max(0, ready.length - commands.length),
    controlCount,
    observationCount,
    maximumBatchSize: BATTLE_BRIDGE_MAILBOX_MAX_BATCH,
    controlSerialized: true,
    duplicateWorkerAllowed: false,
    rejected,
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

export function revalidateBattleBridgeGitHubCommandForExecution(command = {}, {
  now = new Date(),
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const expiresAtMs = Date.parse(String(command?.expiresAt || ''));
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresAtMs)) {
    return fail('COMMAND_REVALIDATION_FAILED', {
      requestId: String(command?.requestId || ''),
      operation: String(command?.operation || ''),
      validationBlocker: 'COMMAND_EXPIRY_INVALID',
    });
  }
  if (expiresAtMs <= nowMs) {
    return fail('COMMAND_EXPIRED_BEFORE_EXECUTION', {
      requestId: String(command?.requestId || ''),
      operation: String(command?.operation || ''),
    });
  }
  return Object.freeze({
    ok: true,
    verdict: 'COMMAND_EXECUTION_SLOT_READY',
    command,
  });
}

export async function executeBattleBridgeGitHubCommandBatch(batch = {}, {
  now = () => new Date(),
  preflightCommand,
  beforeExecute,
  executeCommand,
  onTerminal,
} = {}) {
  const entries = Array.isArray(batch?.commands) ? batch.commands : [];
  if (batch?.verdict !== 'COMMAND_BATCH_READY' || entries.length < 1
    || entries.length > BATTLE_BRIDGE_MAILBOX_MAX_BATCH || typeof now !== 'function'
    || typeof executeCommand !== 'function'
    || (preflightCommand !== undefined && typeof preflightCommand !== 'function')
    || (beforeExecute !== undefined && typeof beforeExecute !== 'function')
    || (onTerminal !== undefined && typeof onTerminal !== 'function')) {
    return fail('MAILBOX_BATCH_EXECUTION_INVALID');
  }
  const results = new Array(entries.length);
  let activeExecutions = 0;
  let maxConcurrencyObserved = 0;
  let terminalCheckpoint = Promise.resolve();
  const checkpointTerminal = (entry, result) => {
    if (!onTerminal) return Promise.resolve(result);
    terminalCheckpoint = terminalCheckpoint
      .catch(() => undefined)
      .then(() => onTerminal(entry, result));
    return terminalCheckpoint;
  };
  const executeEntry = async (entry, index) => {
    const executionValidation = revalidateBattleBridgeGitHubCommandForExecution(entry.command, {
      now: now(),
    });
    if (!executionValidation.ok) {
      results[index] = Object.freeze({
        entry,
        result: await checkpointTerminal(entry, executionValidation),
      });
      return;
    }
    if (preflightCommand) {
      const preflight = await preflightCommand(entry);
      if (!preflight?.ok) {
        results[index] = Object.freeze({
          entry,
          result: await checkpointTerminal(entry, preflight || fail('COMMAND_PREFLIGHT_FAILED')),
        });
        return;
      }
    }
    activeExecutions += 1;
    maxConcurrencyObserved = Math.max(maxConcurrencyObserved, activeExecutions);
    try {
      if (beforeExecute) await beforeExecute(entry);
      const execution = await executeCommand(entry);
      results[index] = Object.freeze({
        entry,
        result: await checkpointTerminal(entry, execution),
      });
    } finally {
      activeExecutions -= 1;
    }
  };

  let index = 0;
  while (index < entries.length) {
    if (entries[index].partition === BATTLE_BRIDGE_MAILBOX_PARTITION.CONTROL) {
      await executeEntry(entries[index], index);
      index += 1;
      continue;
    }
    const observationStart = index;
    while (index < entries.length && entries[index].partition === BATTLE_BRIDGE_MAILBOX_PARTITION.OBSERVATION) index += 1;
    await Promise.all(entries.slice(observationStart, index).map((entry, offset) => executeEntry(entry, observationStart + offset)));
  }

  return Object.freeze({
    ok: true,
    verdict: 'COMMAND_BATCH_EXECUTION_COMPLETE',
    results: Object.freeze(results),
    selectedCount: entries.length,
    maxConcurrencyObserved,
    controlSerialized: true,
    observationParallelismBounded: true,
    duplicateWorkerAllowed: false,
  });
}

function validateScopedDeliveryExecution(command = {}, result = {}) {
  const scopedDelivery = command?.scopedDelivery;
  if (!scopedDelivery || result?.ok === false) return null;

  const sourceHead = String(result?.sourceHead || result?.expectedHead || '').toLowerCase();
  if (sourceHead && sourceHead !== scopedDelivery.deploymentHead) {
    return fail('SCOPED_DELIVERY_DEPLOYMENT_HEAD_MISMATCH', { sourceHead });
  }

  if (command.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF') {
    const mergeCommitHead = String(result?.mergeCommitHead || '').toLowerCase();
    const githubMainHead = String(result?.githubMainHead || '').toLowerCase();
    const localHead = String(result?.localHead || '').toLowerCase();
    if (mergeCommitHead !== scopedDelivery.mergeCommit) {
      return fail('SCOPED_DELIVERY_MERGE_COMMIT_MISMATCH', { mergeCommitHead });
    }
    if (githubMainHead && githubMainHead !== scopedDelivery.deploymentHead) {
      return fail('SCOPED_DELIVERY_DEPLOYMENT_HEAD_MISMATCH', { sourceHead: githubMainHead });
    }
    if (localHead && localHead !== scopedDelivery.deploymentHead) {
      return fail('SCOPED_DELIVERY_DEPLOYMENT_HEAD_MISMATCH', { sourceHead: localHead });
    }
  }

  return null;
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
  cancelMissionOrchestratorMission,
  runWorkerWatchdogAcceptance,
  installRecoveryMesh,
  wakeRecoveryMesh,
  runMonitorMultiplexerAcceptance,
  runExactHeadWindowsBrowserProof,
  queueVerifiedSpotifyLink,
  executeForgeShadowM2 = executeForgeShadowM2OnBattleBridge,
  prepareForgeShadowM3Artifacts = executeForgeShadowM3ArtifactPreparationOnBattleBridge,
  executeForgeShadowM3 = executeForgeShadowM3OnBattleBridge,
  executeProtectedOpenClawMerge = executeProtectedOpenClawMergeOnBattleBridge,
  readCodexBankedResetStatus = readCodexBankedResetStatusOnBattleBridge,
  redeemBankedCodexReset = executeCodexBankedResetOnBattleBridge,
  publishCodexCapacityStatus,
  sharedWorkspaceRoot = '',
  repoRoot = '',
  capacityPublicationTimestampUtc = new Date().toISOString(),
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
    [MISSION_ORCHESTRATOR_CANCEL_OPERATION]: cancelMissionOrchestratorMission,
    RUN_WORKER_WATCHDOG_ACCEPTANCE: runWorkerWatchdogAcceptance,
    INSTALL_BATTLE_BRIDGE_RECOVERY_MESH: installRecoveryMesh,
    WAKE_BATTLE_BRIDGE_RECOVERY_MESH: wakeRecoveryMesh,
    RUN_MONITOR_MULTIPLEXER_ACCEPTANCE: runMonitorMultiplexerAcceptance,
    RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF: runExactHeadWindowsBrowserProof,
    [FORGE_SHADOW_BATTLE_BRIDGE_OPERATION]: executeForgeShadowM2,
    [FORGE_SHADOW_M3_PREPARE_OPERATION]: prepareForgeShadowM3Artifacts,
    [FORGE_SHADOW_M3_EXECUTE_OPERATION]: executeForgeShadowM3,
    [PROTECTED_OPENCLAW_MERGE_OPERATION]: executeProtectedOpenClawMerge,
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
    const scopedDeliveryBlocker = validateScopedDeliveryExecution(command, result);
    if (scopedDeliveryBlocker) {
      return Object.freeze({
        ...scopedDeliveryBlocker,
        operation: command.operation,
        requestId: command.requestId,
        result,
      });
    }
    let sharedWorkspacePublication = null;
    if (command.operation === CODEX_BANKED_RESET_STATUS_OPERATION && typeof publishCodexCapacityStatus === 'function') {
      const publication = await publishCodexCapacityStatus(sharedWorkspaceRoot, {
        statusResult: result,
        timestampUtc: capacityPublicationTimestampUtc,
        proofRefs: result?.proofRefs,
      }, {
        repoRoot,
        nowMs: Date.parse(capacityPublicationTimestampUtc),
      });
      const publishedRemainingPercent = publication?.slice?.remainingPercent;
      sharedWorkspacePublication = Object.freeze({
        ok: publication?.ok === true,
        reason: String(publication?.reason || 'CODEX_CAPACITY_WORKSPACE_PUBLISH_UNKNOWN'),
        truthState: String(publication?.slice?.truthState || 'UNKNOWN'),
        observedAtUtc: String(publication?.slice?.observedAtUtc || ''),
        remainingPercent: publishedRemainingPercent !== null
          && publishedRemainingPercent !== undefined
          && publishedRemainingPercent !== ''
          && Number.isFinite(Number(publishedRemainingPercent))
          ? Number(publishedRemainingPercent)
          : null,
        capacityUsable: publication?.slice?.capacityUsable === true,
        finalVerdict: String(publication?.finalVerdict || 'CODEX_CAPACITY_WORKSPACE_PUBLISH_BLOCKED'),
      });
      if (!sharedWorkspacePublication.ok) {
        return fail('CODEX_CAPACITY_WORKSPACE_PUBLISH_FAILED', {
          operation: command.operation,
          requestId: command.requestId,
          result,
          sharedWorkspacePublication,
        });
      }
    }
    return Object.freeze({
      ok: result?.ok !== false,
      verdict: result?.ok === false ? 'COMMAND_EXECUTION_BLOCKED' : 'COMMAND_EXECUTION_COMPLETE',
      operation: command.operation,
      requestId: command.requestId,
      result,
      ...(sharedWorkspacePublication ? { sharedWorkspacePublication } : {}),
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
  const scopedDelivery = command?.scopedDelivery || null;
  return Object.freeze({
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: String(command?.requestId || ''),
    operation: String(command?.operation || ''),
    repository: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
    issueNumber: BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
    branch: 'main',
    expectedHead: String(command?.expectedHead || ''),
    missionId: command?.operation === MISSION_ORCHESTRATOR_CANCEL_OPERATION ? String(command?.missionId || '') : '',
    commandId: command?.operation === MISSION_ORCHESTRATOR_CANCEL_OPERATION ? String(command?.commandId || '') : '',
    expectedTree: FORGE_SHADOW_M3_MAILBOX_OPERATIONS.includes(command?.operation)
      ? String(command?.expectedTree || '')
      : '',
    relatedPr: scopedDelivery ? String(scopedDelivery.relatedPr || '') : '',
    mergeCommit: scopedDelivery ? String(scopedDelivery.mergeCommit || '') : '',
    deploymentHead: scopedDelivery ? String(scopedDelivery.deploymentHead || '') : '',
    deploymentRequestId: scopedDelivery ? String(scopedDelivery.deploymentRequestId || '') : '',
    featureId: scopedDelivery ? String(scopedDelivery.featureId || '') : '',
    forgejoVersion: command?.operation === FORGE_SHADOW_BATTLE_BRIDGE_OPERATION ? String(command?.forgejoVersion || '') : '',
    forgejoImageDigest: command?.operation === FORGE_SHADOW_BATTLE_BRIDGE_OPERATION ? String(command?.forgejoImageDigest || '') : '',
    runtimeBoundary: command?.operation === FORGE_SHADOW_BATTLE_BRIDGE_OPERATION ? String(command?.runtimeBoundary || '') : '',
    m2Only: command?.operation === FORGE_SHADOW_BATTLE_BRIDGE_OPERATION ? command?.m2Only === true : false,
    m3Only: FORGE_SHADOW_M3_MAILBOX_OPERATIONS.includes(command?.operation) ? command?.m3Only === true : false,
    observationId: command?.operation === FORGE_SHADOW_M3_PREPARE_OPERATION ? String(command?.observationId || '') : '',
    m2RequestId: command?.operation === FORGE_SHADOW_M3_EXECUTE_OPERATION ? String(command?.m2RequestId || '') : '',
    artifactRequestId: command?.operation === FORGE_SHADOW_M3_EXECUTE_OPERATION ? String(command?.artifactRequestId || '') : '',
    runtimeAuthorizationId: command?.operation === FORGE_SHADOW_M3_EXECUTE_OPERATION
      ? String(command?.runtimeAuthorizationId || '')
      : '',
    runtimePlanDigest: command?.operation === FORGE_SHADOW_M3_EXECUTE_OPERATION ? String(command?.runtimePlanDigest || '') : '',
    planAtUtc: command?.operation === FORGE_SHADOW_M3_EXECUTE_OPERATION ? String(command?.planAtUtc || '') : '',
    runtimeExpiresAtUtc: command?.operation === FORGE_SHADOW_M3_EXECUTE_OPERATION
      ? String(command?.runtimeExpiresAtUtc || '')
      : '',
    prNumber: ['RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF', PROTECTED_OPENCLAW_MERGE_OPERATION].includes(command?.operation)
      ? Number(command?.prNumber || 0)
      : 0,
    expectedBase: command?.operation === PROTECTED_OPENCLAW_MERGE_OPERATION ? String(command?.expectedBase || '') : '',
    reviewRunId: command?.operation === PROTECTED_OPENCLAW_MERGE_OPERATION ? Number(command?.reviewRunId || 0) : 0,
    reviewRunAttempt: command?.operation === PROTECTED_OPENCLAW_MERGE_OPERATION ? Number(command?.reviewRunAttempt || 0) : 0,
    reviewJobId: command?.operation === PROTECTED_OPENCLAW_MERGE_OPERATION ? Number(command?.reviewJobId || 0) : 0,
    reviewArtifactId: command?.operation === PROTECTED_OPENCLAW_MERGE_OPERATION ? Number(command?.reviewArtifactId || 0) : 0,
    reviewArtifactDigest: command?.operation === PROTECTED_OPENCLAW_MERGE_OPERATION ? String(command?.reviewArtifactDigest || '') : '',
    reviewPayloadSha256: command?.operation === PROTECTED_OPENCLAW_MERGE_OPERATION ? String(command?.reviewPayloadSha256 || '') : '',
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
