import {
  OPENCLAW_BOUNDED_UPDATE_ADAPTER_ID,
  OPENCLAW_STAGED_UPDATE_ACTION,
  OPENCLAW_STAGED_UPDATE_STATUS,
} from './openClawStagedUpdateV1.mjs';

export const OPENCLAW_UPDATE_BATTLE_BRIDGE_COMMAND_SCHEMA = 'stephanos.openclaw-update-battle-bridge-command.v1';
export const OPENCLAW_UPDATE_BATTLE_BRIDGE_RECEIPT_SCHEMA = 'stephanos.openclaw-update-battle-bridge-receipt.v1';
export const OPENCLAW_UPDATE_BATTLE_BRIDGE_VERSION = '1.0.0';
export const OPENCLAW_UPDATE_BATTLE_BRIDGE_HOST = 'stephanos-battle-bridge-windows';
export const OPENCLAW_UPDATE_BATTLE_BRIDGE_OPERATOR = 'Cheekyfellastef';
export const OPENCLAW_UPDATE_BATTLE_BRIDGE_MAX_EXPIRY_MS = 2 * 60 * 60 * 1000;
export const OPENCLAW_UPDATE_BATTLE_BRIDGE_MAX_PROOF_REFS = 40;

export const OPENCLAW_UPDATE_BATTLE_BRIDGE_ACTION = Object.freeze({
  APPLY: 'APPLY_PINNED_OPENCLAW_UPDATE',
  ROLLBACK: 'ROLLBACK_PINNED_OPENCLAW_UPDATE',
});

export const OPENCLAW_UPDATE_BATTLE_BRIDGE_VERDICT = Object.freeze({
  READY: 'OPENCLAW_UPDATE_BATTLE_BRIDGE_READY',
  UPDATED_AND_VERIFIED: 'OPENCLAW_UPDATE_BATTLE_BRIDGE_UPDATED_AND_VERIFIED',
  ROLLED_BACK_AND_VERIFIED: 'OPENCLAW_UPDATE_BATTLE_BRIDGE_ROLLED_BACK_AND_VERIFIED',
  BLOCKED: 'OPENCLAW_UPDATE_BATTLE_BRIDGE_BLOCKED_WITH_RESTORE_PATH',
});

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:/+-]{0,127}$/i;
const SAFE_VERSION_PATTERN = /^[a-z0-9][a-z0-9._+-]{0,63}$/i;
const SAFE_PROOF_REF_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,239}$/i;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const ALLOWED_COMMAND_FIELDS = Object.freeze([
  'schema',
  'commandId',
  'action',
  'repository',
  'sourceHead',
  'manifestSha256',
  'packetId',
  'packetSha256',
  'currentVersion',
  'targetVersion',
  'approvalId',
  'stageId',
  'backupSetId',
  'stagedUpdateStatus',
  'hostId',
  'requestedBy',
  'operatorApproval',
  'canaryRequired',
  'issuedAtUtc',
  'expiresAtUtc',
]);
const FORBIDDEN_COMMAND_FIELDS = Object.freeze([
  'command',
  'commands',
  'args',
  'arguments',
  'shell',
  'script',
  'powershell',
  'executable',
  'path',
  'paths',
  'workingDirectory',
  'cwd',
  'environment',
  'env',
  'token',
  'credential',
  'password',
  'secret',
  'session',
  'cookie',
  'url',
]);

const APPLY_PLAN = Object.freeze([
  Object.freeze({ step: 1, actionId: 'VERIFY_BATTLE_BRIDGE_SOURCE_HEAD', mutating: false }),
  Object.freeze({ step: 2, actionId: 'VERIFY_PRIVATE_EXECUTION_PACKET', mutating: false }),
  Object.freeze({ step: 3, actionId: 'VERIFY_ISOLATED_STAGE_AND_PACKET_DIGEST', mutating: false }),
  Object.freeze({ step: 4, actionId: 'VERIFY_COMPLETE_PROTECTED_BACKUP_SET', mutating: false }),
  Object.freeze({ step: 5, actionId: 'STOP_ONLY_VERIFIED_OPENCLAW_GATEWAY', mutating: true }),
  Object.freeze({ step: 6, actionId: OPENCLAW_STAGED_UPDATE_ACTION.APPLY_UPDATE, mutating: true }),
  Object.freeze({ step: 7, actionId: 'START_CANONICAL_OPENCLAW_GATEWAY', mutating: true }),
  Object.freeze({ step: 8, actionId: 'VERIFY_OPENCLAW_GATEWAY_18789', mutating: false }),
  Object.freeze({ step: 9, actionId: 'VERIFY_STEPHANOS_BACKEND_8787', mutating: false }),
  Object.freeze({ step: 10, actionId: 'VERIFY_STEPHANOS_UI_4173', mutating: false }),
  Object.freeze({ step: 11, actionId: 'VERIFY_MISSION_WORKER', mutating: false }),
  Object.freeze({ step: 12, actionId: 'VERIFY_OPENCLAW_PLUGINS_AND_COMMANDS', mutating: false }),
  Object.freeze({ step: 13, actionId: 'VERIFY_SHARED_WORKSPACE_PROOF_WRITE', mutating: false }),
  Object.freeze({ step: 14, actionId: OPENCLAW_STAGED_UPDATE_ACTION.COMPARE_PRESERVATION, mutating: false }),
  Object.freeze({ step: 15, actionId: 'PUBLISH_UPDATED_AND_VERIFIED', mutating: false }),
]);

const ROLLBACK_PLAN = Object.freeze([
  Object.freeze({ step: 1, actionId: 'STOP_ONLY_VERIFIED_UPDATED_OPENCLAW_GATEWAY', mutating: true }),
  Object.freeze({ step: 2, actionId: OPENCLAW_STAGED_UPDATE_ACTION.ROLLBACK_PACKAGE, mutating: true }),
  Object.freeze({ step: 3, actionId: OPENCLAW_STAGED_UPDATE_ACTION.RESTORE_BACKUP, mutating: true }),
  Object.freeze({ step: 4, actionId: 'START_CANONICAL_OPENCLAW_GATEWAY', mutating: true }),
  Object.freeze({ step: 5, actionId: OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_ROLLBACK, mutating: false }),
  Object.freeze({ step: 6, actionId: 'PUBLISH_ROLLBACK_OR_RESTORE_BLOCKER', mutating: false }),
]);

function text(value, maximum = 512) {
  const normalized = String(value ?? '').trim();
  return normalized.length <= maximum ? normalized : '';
}

function lower(value) {
  return text(value).toLowerCase();
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function exactTime(value) {
  const normalized = text(value);
  if (!normalized || !EXPLICIT_TIMEZONE.test(normalized)) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function exactSha(value) {
  const normalized = lower(value);
  return SHA_PATTERN.test(normalized) ? normalized : '';
}

function exactSha256(value) {
  const normalized = lower(value);
  return SHA256_PATTERN.test(normalized) ? normalized : '';
}

function safeId(value) {
  const normalized = text(value, 128);
  return SAFE_ID_PATTERN.test(normalized) ? normalized : '';
}

function safeVersion(value) {
  const normalized = text(value, 64);
  return SAFE_VERSION_PATTERN.test(normalized) ? normalized : '';
}

function safeProofRefs(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, 240)).filter((item) => (
    SAFE_PROOF_REF_PATTERN.test(item) && !item.includes('..')
  )))].slice(0, OPENCLAW_UPDATE_BATTLE_BRIDGE_MAX_PROOF_REFS);
}

function same(left, right) {
  return Boolean(left) && left === right;
}

function fail(blocker, details = {}) {
  return Object.freeze({
    ok: false,
    verdict: OPENCLAW_UPDATE_BATTLE_BRIDGE_VERDICT.BLOCKED,
    blocker,
    ...details,
  });
}

function unexpectedField(command) {
  const allowed = new Set(ALLOWED_COMMAND_FIELDS);
  return Object.keys(command).find((key) => !allowed.has(key)) || '';
}

function forbiddenField(command) {
  return FORBIDDEN_COMMAND_FIELDS.find((key) => (
    Object.prototype.hasOwnProperty.call(command, key)
    && command[key] !== undefined
    && command[key] !== null
    && command[key] !== ''
  )) || '';
}

export function validateOpenClawUpdateBattleBridgeCommand(command = {}, {
  now = new Date(),
} = {}) {
  const value = object(command);
  if (!value) return fail('OPENCLAW_UPDATE_COMMAND_NOT_OBJECT');
  const extra = unexpectedField(value);
  if (extra) return fail('OPENCLAW_UPDATE_COMMAND_FIELD_NOT_ALLOWED', { field: extra });
  const forbidden = forbiddenField(value);
  if (forbidden) return fail('OPENCLAW_UPDATE_COMMAND_UNSAFE_FIELD_PRESENT', { field: forbidden });

  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const issuedAtMs = exactTime(value.issuedAtUtc);
  const expiresAtMs = exactTime(value.expiresAtUtc);
  if (!Number.isFinite(nowMs) || issuedAtMs === null || expiresAtMs === null) {
    return fail('OPENCLAW_UPDATE_COMMAND_TIME_INVALID');
  }
  if (issuedAtMs > nowMs + 60_000) return fail('OPENCLAW_UPDATE_COMMAND_FROM_FUTURE');
  if (expiresAtMs <= nowMs) return fail('OPENCLAW_UPDATE_COMMAND_EXPIRED');
  if (expiresAtMs <= issuedAtMs || expiresAtMs - issuedAtMs > OPENCLAW_UPDATE_BATTLE_BRIDGE_MAX_EXPIRY_MS) {
    return fail('OPENCLAW_UPDATE_COMMAND_EXPIRY_WINDOW_INVALID');
  }

  const normalized = Object.freeze({
    schema: text(value.schema),
    commandId: safeId(value.commandId),
    action: text(value.action),
    repository: safeId(value.repository),
    sourceHead: exactSha(value.sourceHead),
    manifestSha256: exactSha256(value.manifestSha256),
    packetId: safeId(value.packetId),
    packetSha256: exactSha256(value.packetSha256),
    currentVersion: safeVersion(value.currentVersion),
    targetVersion: safeVersion(value.targetVersion),
    approvalId: safeId(value.approvalId),
    stageId: safeId(value.stageId),
    backupSetId: safeId(value.backupSetId),
    stagedUpdateStatus: text(value.stagedUpdateStatus),
    hostId: text(value.hostId),
    requestedBy: text(value.requestedBy),
    operatorApproval: text(value.operatorApproval),
    canaryRequired: value.canaryRequired === true,
    issuedAtUtc: new Date(issuedAtMs).toISOString(),
    expiresAtUtc: new Date(expiresAtMs).toISOString(),
  });

  if (normalized.schema !== OPENCLAW_UPDATE_BATTLE_BRIDGE_COMMAND_SCHEMA) return fail('OPENCLAW_UPDATE_COMMAND_SCHEMA_MISMATCH');
  if (!normalized.commandId) return fail('OPENCLAW_UPDATE_COMMAND_ID_INVALID');
  if (!Object.values(OPENCLAW_UPDATE_BATTLE_BRIDGE_ACTION).includes(normalized.action)) {
    return fail('OPENCLAW_UPDATE_COMMAND_ACTION_NOT_ALLOWED');
  }
  if (normalized.repository !== 'Cheekyfellastef/stephan-os') return fail('OPENCLAW_UPDATE_COMMAND_REPOSITORY_MISMATCH');
  if (!normalized.sourceHead) return fail('OPENCLAW_UPDATE_COMMAND_SOURCE_HEAD_INVALID');
  if (!normalized.manifestSha256) return fail('OPENCLAW_UPDATE_COMMAND_MANIFEST_INVALID');
  if (!normalized.packetId || !normalized.packetSha256) return fail('OPENCLAW_UPDATE_COMMAND_PACKET_IDENTITY_INVALID');
  if (!normalized.currentVersion || !normalized.targetVersion) return fail('OPENCLAW_UPDATE_COMMAND_VERSION_INVALID');
  if (!normalized.approvalId || !normalized.stageId || !normalized.backupSetId) {
    return fail('OPENCLAW_UPDATE_COMMAND_EVIDENCE_IDENTITY_INVALID');
  }
  if (normalized.hostId !== OPENCLAW_UPDATE_BATTLE_BRIDGE_HOST) return fail('OPENCLAW_UPDATE_COMMAND_HOST_MISMATCH');
  if (normalized.requestedBy !== OPENCLAW_UPDATE_BATTLE_BRIDGE_OPERATOR) return fail('OPENCLAW_UPDATE_COMMAND_REQUESTER_MISMATCH');
  if (normalized.operatorApproval !== 'operator-approved') return fail('OPENCLAW_UPDATE_COMMAND_OPERATOR_APPROVAL_REQUIRED');
  if (!normalized.canaryRequired) return fail('OPENCLAW_UPDATE_COMMAND_CANARY_REQUIRED');

  const requiredStatus = normalized.action === OPENCLAW_UPDATE_BATTLE_BRIDGE_ACTION.APPLY
    ? OPENCLAW_STAGED_UPDATE_STATUS.READY_TO_APPLY
    : OPENCLAW_STAGED_UPDATE_STATUS.ROLLBACK_REQUIRED;
  if (normalized.stagedUpdateStatus !== requiredStatus) {
    return fail('OPENCLAW_UPDATE_COMMAND_STAGE_STATUS_MISMATCH', { requiredStatus });
  }
  if (normalized.action === OPENCLAW_UPDATE_BATTLE_BRIDGE_ACTION.APPLY
      && normalized.currentVersion === normalized.targetVersion) {
    return fail('OPENCLAW_UPDATE_COMMAND_NO_VERSION_CHANGE');
  }

  return Object.freeze({
    ok: true,
    verdict: OPENCLAW_UPDATE_BATTLE_BRIDGE_VERDICT.READY,
    command: normalized,
    plan: normalized.action === OPENCLAW_UPDATE_BATTLE_BRIDGE_ACTION.APPLY
      ? APPLY_PLAN
      : ROLLBACK_PLAN,
    safety: Object.freeze({
      fixedActionsOnly: true,
      arbitraryShellAllowed: false,
      arbitraryPathAllowed: false,
      arbitraryEnvironmentAllowed: false,
      destructiveGitAllowed: false,
      sourceMutationAllowed: false,
      mergeAuthority: false,
      updateAuthorityBoundToExactApproval: true,
      rollbackMandatoryAfterPostMutationFailure: true,
    }),
  });
}

function assertHandlers(handlers, names) {
  const missing = names.filter((name) => typeof handlers?.[name] !== 'function');
  return missing.length ? fail('OPENCLAW_UPDATE_HANDLER_NOT_CONFIGURED', { missingHandlers: Object.freeze(missing) }) : null;
}

async function invokeStep(name, handler, command, context) {
  let result;
  try {
    result = await handler(command, Object.freeze({ ...context, step: name }));
  } catch (error) {
    return Object.freeze({
      ok: false,
      step: name,
      blocker: 'OPENCLAW_UPDATE_HANDLER_EXCEPTION',
      error: text(error instanceof Error ? error.message : String(error), 300),
      proofRefs: Object.freeze([]),
    });
  }
  const value = object(result) ?? {};
  return Object.freeze({
    ok: value.ok === true,
    step: name,
    blocker: value.ok === true ? '' : text(value.blocker, 200) || 'OPENCLAW_UPDATE_STEP_FAILED',
    receiptId: safeId(value.receiptId),
    observedSourceHead: exactSha(value.observedSourceHead),
    observedVersion: safeVersion(value.observedVersion),
    proofRefs: Object.freeze(safeProofRefs(value.proofRefs)),
  });
}

function buildReceipt({ command, action, verdict, blocker = '', steps = [], rollback = null }) {
  const proofRefs = safeProofRefs([
    ...steps.flatMap((step) => step.proofRefs ?? []),
    ...(rollback?.steps ?? []).flatMap((step) => step.proofRefs ?? []),
  ]);
  return Object.freeze({
    schema: OPENCLAW_UPDATE_BATTLE_BRIDGE_RECEIPT_SCHEMA,
    version: OPENCLAW_UPDATE_BATTLE_BRIDGE_VERSION,
    adapterId: OPENCLAW_BOUNDED_UPDATE_ADAPTER_ID,
    commandId: command.commandId,
    action,
    repository: command.repository,
    sourceHead: command.sourceHead,
    manifestSha256: command.manifestSha256,
    packetId: command.packetId,
    packetSha256: command.packetSha256,
    currentVersion: command.currentVersion,
    targetVersion: command.targetVersion,
    approvalId: command.approvalId,
    stageId: command.stageId,
    backupSetId: command.backupSetId,
    hostId: command.hostId,
    verdict,
    blocker,
    steps: Object.freeze(steps),
    rollback,
    proofRefs: Object.freeze(proofRefs),
    arbitraryShellAllowed: false,
    arbitraryPathAllowed: false,
    destructiveGitAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
  });
}

async function executeRollback(command, handlers, context = {}) {
  const required = [
    'stopVerifiedGateway',
    'rollbackPinnedPackage',
    'restoreProtectedBackup',
    'startCanonicalGateway',
    'verifyRollbackHealth',
    'compareRollbackPreservation',
    'publishSharedWorkspaceReceipt',
  ];
  const configurationFailure = assertHandlers(handlers, required);
  if (configurationFailure) return configurationFailure;

  const steps = [];
  for (const [stepName, handlerName] of [
    ['STOP_ONLY_VERIFIED_UPDATED_OPENCLAW_GATEWAY', 'stopVerifiedGateway'],
    [OPENCLAW_STAGED_UPDATE_ACTION.ROLLBACK_PACKAGE, 'rollbackPinnedPackage'],
    [OPENCLAW_STAGED_UPDATE_ACTION.RESTORE_BACKUP, 'restoreProtectedBackup'],
    ['START_CANONICAL_OPENCLAW_GATEWAY', 'startCanonicalGateway'],
    [OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_ROLLBACK, 'verifyRollbackHealth'],
    ['COMPARE_ROLLBACK_PROTECTED_IDENTITIES', 'compareRollbackPreservation'],
  ]) {
    const step = await invokeStep(stepName, handlers[handlerName], command, context);
    steps.push(step);
    if (!step.ok) {
      const receipt = buildReceipt({
        command,
        action: OPENCLAW_UPDATE_BATTLE_BRIDGE_ACTION.ROLLBACK,
        verdict: OPENCLAW_UPDATE_BATTLE_BRIDGE_VERDICT.BLOCKED,
        blocker: step.blocker,
        steps,
      });
      await handlers.publishSharedWorkspaceReceipt(command, { ...context, receipt });
      return Object.freeze({ ok: false, blocker: step.blocker, receipt });
    }
  }
  const receipt = buildReceipt({
    command,
    action: OPENCLAW_UPDATE_BATTLE_BRIDGE_ACTION.ROLLBACK,
    verdict: OPENCLAW_UPDATE_BATTLE_BRIDGE_VERDICT.ROLLED_BACK_AND_VERIFIED,
    steps,
  });
  const published = await invokeStep('PUBLISH_ROLLBACK_RECEIPT', handlers.publishSharedWorkspaceReceipt, command, {
    ...context,
    receipt,
  });
  if (!published.ok) {
    return Object.freeze({
      ok: false,
      blocker: published.blocker,
      receipt: buildReceipt({
        command,
        action: OPENCLAW_UPDATE_BATTLE_BRIDGE_ACTION.ROLLBACK,
        verdict: OPENCLAW_UPDATE_BATTLE_BRIDGE_VERDICT.BLOCKED,
        blocker: published.blocker,
        steps: [...steps, published],
      }),
    });
  }
  return Object.freeze({ ok: true, blocker: '', receipt });
}

export async function executeOpenClawUpdateBattleBridgeAdapter(command, handlers = {}) {
  const validation = validateOpenClawUpdateBattleBridgeCommand(command);
  if (!validation.ok) return validation;
  const accepted = validation.command;
  if (accepted.action === OPENCLAW_UPDATE_BATTLE_BRIDGE_ACTION.ROLLBACK) {
    return executeRollback(accepted, handlers, { cause: 'operator-requested-rollback' });
  }

  const required = [
    'readCanonicalSourceIdentity',
    'verifyPrivateExecutionPacket',
    'verifyIsolatedStage',
    'verifyProtectedBackupSet',
    'stopVerifiedGateway',
    'applyPinnedUpdate',
    'startCanonicalGateway',
    'verifyPostUpdateHealth',
    'compareProtectedIdentities',
    'publishSharedWorkspaceReceipt',
    'rollbackPinnedPackage',
    'restoreProtectedBackup',
    'verifyRollbackHealth',
    'compareRollbackPreservation',
  ];
  const configurationFailure = assertHandlers(handlers, required);
  if (configurationFailure) return configurationFailure;

  const steps = [];
  let mutationStarted = false;
  const plan = [
    ['VERIFY_BATTLE_BRIDGE_SOURCE_HEAD', 'readCanonicalSourceIdentity', false],
    ['VERIFY_PRIVATE_EXECUTION_PACKET', 'verifyPrivateExecutionPacket', false],
    ['VERIFY_ISOLATED_STAGE_AND_PACKET_DIGEST', 'verifyIsolatedStage', false],
    ['VERIFY_COMPLETE_PROTECTED_BACKUP_SET', 'verifyProtectedBackupSet', false],
    ['STOP_ONLY_VERIFIED_OPENCLAW_GATEWAY', 'stopVerifiedGateway', true],
    [OPENCLAW_STAGED_UPDATE_ACTION.APPLY_UPDATE, 'applyPinnedUpdate', true],
    ['START_CANONICAL_OPENCLAW_GATEWAY', 'startCanonicalGateway', true],
    ['VERIFY_POST_UPDATE_HEALTH', 'verifyPostUpdateHealth', false],
    [OPENCLAW_STAGED_UPDATE_ACTION.COMPARE_PRESERVATION, 'compareProtectedIdentities', false],
  ];

  for (const [stepName, handlerName, mutating] of plan) {
    if (mutating) mutationStarted = true;
    const step = await invokeStep(stepName, handlers[handlerName], accepted, {
      mutationStarted,
      priorSteps: Object.freeze([...steps]),
    });
    steps.push(step);
    if (!step.ok) {
      if (!mutationStarted) {
        const receipt = buildReceipt({
          command: accepted,
          action: OPENCLAW_UPDATE_BATTLE_BRIDGE_ACTION.APPLY,
          verdict: OPENCLAW_UPDATE_BATTLE_BRIDGE_VERDICT.BLOCKED,
          blocker: step.blocker,
          steps,
        });
        await handlers.publishSharedWorkspaceReceipt(accepted, { receipt, cause: 'pre-mutation-failure' });
        return Object.freeze({ ok: false, blocker: step.blocker, receipt });
      }
      const rollback = await executeRollback(accepted, handlers, {
        cause: step.blocker,
        failedStep: stepName,
        applySteps: Object.freeze([...steps]),
      });
      const receipt = buildReceipt({
        command: accepted,
        action: OPENCLAW_UPDATE_BATTLE_BRIDGE_ACTION.APPLY,
        verdict: rollback.ok
          ? OPENCLAW_UPDATE_BATTLE_BRIDGE_VERDICT.ROLLED_BACK_AND_VERIFIED
          : OPENCLAW_UPDATE_BATTLE_BRIDGE_VERDICT.BLOCKED,
        blocker: rollback.ok ? step.blocker : (rollback.blocker || step.blocker),
        steps,
        rollback: rollback.receipt ?? null,
      });
      await handlers.publishSharedWorkspaceReceipt(accepted, { receipt, cause: 'automatic-rollback' });
      return Object.freeze({ ok: false, blocker: receipt.blocker, receipt });
    }
  }

  const receipt = buildReceipt({
    command: accepted,
    action: OPENCLAW_UPDATE_BATTLE_BRIDGE_ACTION.APPLY,
    verdict: OPENCLAW_UPDATE_BATTLE_BRIDGE_VERDICT.UPDATED_AND_VERIFIED,
    steps,
  });
  const published = await invokeStep('PUBLISH_UPDATED_AND_VERIFIED', handlers.publishSharedWorkspaceReceipt, accepted, {
    receipt,
    cause: 'success',
  });
  if (!published.ok) {
    const rollback = await executeRollback(accepted, handlers, {
      cause: published.blocker,
      failedStep: 'PUBLISH_UPDATED_AND_VERIFIED',
      applySteps: Object.freeze([...steps, published]),
    });
    return Object.freeze({
      ok: false,
      blocker: published.blocker,
      receipt: buildReceipt({
        command: accepted,
        action: OPENCLAW_UPDATE_BATTLE_BRIDGE_ACTION.APPLY,
        verdict: rollback.ok
          ? OPENCLAW_UPDATE_BATTLE_BRIDGE_VERDICT.ROLLED_BACK_AND_VERIFIED
          : OPENCLAW_UPDATE_BATTLE_BRIDGE_VERDICT.BLOCKED,
        blocker: published.blocker,
        steps: [...steps, published],
        rollback: rollback.receipt ?? null,
      }),
    });
  }
  return Object.freeze({ ok: true, blocker: '', receipt });
}
