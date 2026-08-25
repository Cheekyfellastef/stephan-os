import { createHash } from 'node:crypto';

import {
  OPENCLAW_PRESERVATION_CLASS,
  OPENCLAW_UPDATE_PREFLIGHT_SCHEMA,
  OPENCLAW_UPDATE_PREFLIGHT_STATUS,
} from './openClawUpdatePreflightV1.mjs';

export const OPENCLAW_STAGED_UPDATE_SCHEMA = 'stephanos.openclaw-staged-update.v1';
export const OPENCLAW_STAGED_UPDATE_VERSION = '1.0.0';
export const OPENCLAW_UPDATE_APPROVAL_SCHEMA = 'stephanos.openclaw-update-approval.v1';
export const OPENCLAW_UPDATE_STAGE_SCHEMA = 'stephanos.openclaw-update-stage.v1';
export const OPENCLAW_UPDATE_BACKUP_SCHEMA = 'stephanos.openclaw-update-backup-set.v1';
export const OPENCLAW_UPDATE_APPLY_RECEIPT_SCHEMA = 'stephanos.openclaw-update-apply-receipt.v1';
export const OPENCLAW_UPDATE_POST_PROOF_SCHEMA = 'stephanos.openclaw-update-post-proof.v1';
export const OPENCLAW_UPDATE_PRESERVATION_COMPARISON_SCHEMA = 'stephanos.openclaw-preservation-comparison.v1';
export const OPENCLAW_UPDATE_ROLLBACK_RECEIPT_SCHEMA = 'stephanos.openclaw-update-rollback-receipt.v1';
export const OPENCLAW_UPDATE_ROLLBACK_PROOF_SCHEMA = 'stephanos.openclaw-update-rollback-proof.v1';

export const OPENCLAW_STAGED_UPDATE_STATUS = Object.freeze({
  BLOCKED_WITH_RESTORE_PATH: 'BLOCKED_WITH_RESTORE_PATH',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  STAGING_REQUIRED: 'STAGING_REQUIRED',
  READY_TO_APPLY: 'READY_TO_APPLY',
  POST_UPDATE_PROOF_REQUIRED: 'POST_UPDATE_PROOF_REQUIRED',
  ROLLBACK_REQUIRED: 'ROLLBACK_REQUIRED',
  UPDATED_AND_VERIFIED: 'UPDATED_AND_VERIFIED',
  ROLLED_BACK_AND_VERIFIED: 'ROLLED_BACK_AND_VERIFIED',
});

export const OPENCLAW_STAGED_UPDATE_ACTION = Object.freeze({
  VERIFY_PREFLIGHT: 'VERIFY_EXACT_PREFLIGHT_MANIFEST',
  VERIFY_APPROVAL: 'VERIFY_EXACT_SINGLE_USE_APPROVAL',
  VERIFY_STAGE: 'VERIFY_ISOLATED_PINNED_UPDATE_STAGE',
  VERIFY_BACKUP: 'VERIFY_COMPLETE_PROTECTED_BACKUP_SET',
  APPLY_UPDATE: 'APPLY_PINNED_OPENCLAW_UPDATE',
  VERIFY_HEALTH: 'VERIFY_POST_UPDATE_HEALTH',
  COMPARE_PRESERVATION: 'COMPARE_PROTECTED_IDENTITIES',
  ROLLBACK_PACKAGE: 'ROLLBACK_PINNED_OPENCLAW_PACKAGE',
  RESTORE_BACKUP: 'RESTORE_PROTECTED_BACKUP_SET',
  VERIFY_ROLLBACK: 'VERIFY_ROLLBACK_HEALTH_AND_IDENTITIES',
});

export const OPENCLAW_BOUNDED_UPDATE_ADAPTER_ID = 'openclaw-bounded-update-adapter-v1';
export const OPENCLAW_EXPECTED_OPERATOR = 'Cheekyfellastef';
export const OPENCLAW_APPROVED_GATEWAY_ENDPOINT = 'http://127.0.0.1:18789';
export const OPENCLAW_STAGED_UPDATE_MAX_ENTRIES = 512;
export const OPENCLAW_STAGED_UPDATE_MAX_TEXT = 512;

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:/+-]{0,127}$/i;
const SAFE_VERSION_PATTERN = /^[a-z0-9][a-z0-9._+-]{0,63}$/i;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const PROTECTED_CLASSES = new Set([
  OPENCLAW_PRESERVATION_CLASS.PRESERVE_SOURCE,
  OPENCLAW_PRESERVATION_CLASS.PRESERVE_CONFIG,
  OPENCLAW_PRESERVATION_CLASS.PRESERVE_RUNTIME,
]);
const REQUIRED_HEALTH_CHECKS = Object.freeze([
  'openClawGateway',
  'stephanosBackend',
  'stephanosUi',
  'missionWorker',
  'sharedWorkspaceWrite',
]);
const APPLY_STEPS = Object.freeze([
  OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_PREFLIGHT,
  OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_APPROVAL,
  OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_STAGE,
  OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_BACKUP,
  OPENCLAW_STAGED_UPDATE_ACTION.APPLY_UPDATE,
]);
const ROLLBACK_STEPS = Object.freeze([
  OPENCLAW_STAGED_UPDATE_ACTION.ROLLBACK_PACKAGE,
  OPENCLAW_STAGED_UPDATE_ACTION.RESTORE_BACKUP,
  OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_ROLLBACK,
]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized.length <= OPENCLAW_STAGED_UPDATE_MAX_TEXT ? (normalized || fallback) : '';
}

function lower(value) {
  return text(value).toLowerCase();
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
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
  const normalized = text(value);
  return SAFE_ID_PATTERN.test(normalized) ? normalized : '';
}

function safeVersion(value) {
  const normalized = text(value);
  return SAFE_VERSION_PATTERN.test(normalized) ? normalized : '';
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function sameExact(left, right) {
  return Boolean(left) && left === right;
}

function requiredProtectedEntries(preflight, blockers) {
  const entries = preflight?.preservationManifest?.entries;
  if (!Array.isArray(entries)) {
    blockers.push('PREFLIGHT_MANIFEST_ENTRIES_MISSING');
    return [];
  }
  if (entries.length > OPENCLAW_STAGED_UPDATE_MAX_ENTRIES) {
    blockers.push('PREFLIGHT_MANIFEST_ENTRIES_LIMIT_EXCEEDED');
    return [];
  }
  const protectedEntries = [];
  const fingerprints = new Set();
  for (const entry of entries) {
    const fingerprint = exactSha256(entry?.pathFingerprintSha256);
    const digest = exactSha256(entry?.digestSha256);
    const classification = text(entry?.classification);
    if (!PROTECTED_CLASSES.has(classification)) continue;
    if (!fingerprint || !digest || entry?.exists !== true) {
      blockers.push('PREFLIGHT_PROTECTED_ENTRY_INCOMPLETE');
      continue;
    }
    if (fingerprints.has(fingerprint)) {
      blockers.push(`PREFLIGHT_PROTECTED_ENTRY_DUPLICATE:${fingerprint}`);
      continue;
    }
    fingerprints.add(fingerprint);
    protectedEntries.push(Object.freeze({
      pathFingerprintSha256: fingerprint,
      sourceDigestSha256: digest,
      classification,
    }));
  }
  if (!protectedEntries.length) blockers.push('PREFLIGHT_PROTECTED_ENTRY_SET_EMPTY');
  return protectedEntries.sort((a, b) => a.pathFingerprintSha256.localeCompare(b.pathFingerprintSha256));
}

function normalizePreflight(value, blockers) {
  const preflight = object(value);
  if (!preflight) {
    blockers.push('PREFLIGHT_REQUIRED');
    return null;
  }
  if (text(preflight.schema) !== OPENCLAW_UPDATE_PREFLIGHT_SCHEMA) blockers.push('PREFLIGHT_SCHEMA_MISMATCH');
  if (text(preflight.status) !== OPENCLAW_UPDATE_PREFLIGHT_STATUS.APPROVAL_REQUIRED) blockers.push('PREFLIGHT_NOT_APPROVAL_READY');
  if (Array.isArray(preflight.blockers) && preflight.blockers.length) blockers.push('PREFLIGHT_HAS_BLOCKERS');
  if (preflight?.safety?.mutationAllowed === true || preflight?.safety?.updateAttempted === true) {
    blockers.push('PREFLIGHT_ALREADY_CLAIMS_MUTATION');
  }

  const repository = safeId(preflight.repository);
  const sourceHead = exactSha(preflight.sourceHead);
  const manifestSha256 = exactSha256(preflight?.preservationManifest?.manifestSha256);
  const packetId = safeId(preflight?.updatePacket?.packetId);
  const packetSha256 = exactSha256(preflight?.updatePacket?.packetSha256);
  const targetVersion = safeVersion(preflight?.updatePacket?.targetVersion);
  const currentVersion = safeVersion(preflight?.currentOpenClaw?.version);
  const gatewayEndpoint = text(preflight?.currentOpenClaw?.gatewayEndpoint);

  if (!repository || !repository.includes('/')) blockers.push('PREFLIGHT_REPOSITORY_INVALID');
  if (!sourceHead) blockers.push('PREFLIGHT_SOURCE_HEAD_INVALID');
  if (!manifestSha256) blockers.push('PREFLIGHT_MANIFEST_DIGEST_INVALID');
  if (!packetId) blockers.push('PREFLIGHT_PACKET_ID_INVALID');
  if (!packetSha256) blockers.push('PREFLIGHT_PACKET_DIGEST_INVALID');
  if (!targetVersion) blockers.push('PREFLIGHT_TARGET_VERSION_INVALID');
  if (!currentVersion) blockers.push('PREFLIGHT_CURRENT_VERSION_INVALID');
  if (gatewayEndpoint !== OPENCLAW_APPROVED_GATEWAY_ENDPOINT) blockers.push('PREFLIGHT_GATEWAY_ENDPOINT_MISMATCH');

  const protectedEntries = requiredProtectedEntries(preflight, blockers);
  return Object.freeze({
    repository,
    sourceHead,
    manifestSha256,
    packetId,
    packetSha256,
    targetVersion,
    currentVersion,
    gatewayEndpoint,
    protectedEntries: Object.freeze(protectedEntries),
  });
}

function normalizeApproval(value, expected, nowMs, blockers) {
  if (value === undefined || value === null) return null;
  const approval = object(value);
  if (!approval) {
    blockers.push('APPROVAL_MALFORMED');
    return null;
  }
  const approvedAtMs = exactTime(approval.approvedAtUtc);
  const expiresAtMs = exactTime(approval.expiresAtUtc);
  const normalized = {
    schema: text(approval.schema),
    approvalId: safeId(approval.approvalId),
    approvedBy: text(approval.approvedBy),
    repository: safeId(approval.repository),
    sourceHead: exactSha(approval.sourceHead),
    manifestSha256: exactSha256(approval.manifestSha256),
    packetId: safeId(approval.packetId),
    packetSha256: exactSha256(approval.packetSha256),
    targetVersion: safeVersion(approval.targetVersion),
    mutationScope: text(approval.mutationScope),
    singleUse: approval.singleUse === true,
    approvedAtUtc: approvedAtMs === null ? '' : new Date(approvedAtMs).toISOString(),
    expiresAtUtc: expiresAtMs === null ? '' : new Date(expiresAtMs).toISOString(),
  };
  if (normalized.schema !== OPENCLAW_UPDATE_APPROVAL_SCHEMA) blockers.push('APPROVAL_SCHEMA_MISMATCH');
  if (!normalized.approvalId) blockers.push('APPROVAL_ID_INVALID');
  if (normalized.approvedBy !== OPENCLAW_EXPECTED_OPERATOR) blockers.push('APPROVAL_OPERATOR_MISMATCH');
  if (!sameExact(normalized.repository, expected?.repository)) blockers.push('APPROVAL_REPOSITORY_MISMATCH');
  if (!sameExact(normalized.sourceHead, expected?.sourceHead)) blockers.push('APPROVAL_SOURCE_HEAD_MISMATCH');
  if (!sameExact(normalized.manifestSha256, expected?.manifestSha256)) blockers.push('APPROVAL_MANIFEST_MISMATCH');
  if (!sameExact(normalized.packetId, expected?.packetId)) blockers.push('APPROVAL_PACKET_ID_MISMATCH');
  if (!sameExact(normalized.packetSha256, expected?.packetSha256)) blockers.push('APPROVAL_PACKET_DIGEST_MISMATCH');
  if (!sameExact(normalized.targetVersion, expected?.targetVersion)) blockers.push('APPROVAL_TARGET_VERSION_MISMATCH');
  if (normalized.mutationScope !== OPENCLAW_STAGED_UPDATE_ACTION.APPLY_UPDATE) blockers.push('APPROVAL_SCOPE_MISMATCH');
  if (!normalized.singleUse) blockers.push('APPROVAL_NOT_SINGLE_USE');
  if (approvedAtMs === null || expiresAtMs === null || expiresAtMs <= approvedAtMs) blockers.push('APPROVAL_TIME_INVALID');
  if (approvedAtMs !== null && approvedAtMs > nowMs + 60_000) blockers.push('APPROVAL_FROM_FUTURE');
  if (expiresAtMs !== null && expiresAtMs <= nowMs) blockers.push('APPROVAL_EXPIRED');
  return Object.freeze(normalized);
}

function normalizeStage(value, expected, nowMs, blockers) {
  if (value === undefined || value === null) return null;
  const stage = object(value);
  if (!stage) {
    blockers.push('STAGE_MALFORMED');
    return null;
  }
  const observedAtMs = exactTime(stage.observedAtUtc);
  const normalized = {
    schema: text(stage.schema),
    stageId: safeId(stage.stageId),
    packetId: safeId(stage.packetId),
    packetSha256: exactSha256(stage.packetSha256),
    targetVersion: safeVersion(stage.targetVersion),
    isolationClass: text(stage.isolationClass),
    insideRepository: stage.insideRepository === true,
    insideOpenClawInstall: stage.insideOpenClawInstall === true,
    packageEntryCount: Number(stage.packageEntryCount),
    executableEntryCount: Number(stage.executableEntryCount),
    observedAtUtc: observedAtMs === null ? '' : new Date(observedAtMs).toISOString(),
  };
  if (normalized.schema !== OPENCLAW_UPDATE_STAGE_SCHEMA) blockers.push('STAGE_SCHEMA_MISMATCH');
  if (!normalized.stageId) blockers.push('STAGE_ID_INVALID');
  if (!sameExact(normalized.packetId, expected?.packetId)) blockers.push('STAGE_PACKET_ID_MISMATCH');
  if (!sameExact(normalized.packetSha256, expected?.packetSha256)) blockers.push('STAGE_PACKET_DIGEST_MISMATCH');
  if (!sameExact(normalized.targetVersion, expected?.targetVersion)) blockers.push('STAGE_TARGET_VERSION_MISMATCH');
  if (normalized.isolationClass !== 'ISOLATED_EXTERNAL_STAGING') blockers.push('STAGE_NOT_ISOLATED');
  if (normalized.insideRepository) blockers.push('STAGE_INSIDE_REPOSITORY');
  if (normalized.insideOpenClawInstall) blockers.push('STAGE_INSIDE_OPENCLAW_INSTALL');
  if (!Number.isSafeInteger(normalized.packageEntryCount) || normalized.packageEntryCount <= 0) blockers.push('STAGE_PACKAGE_ENTRY_COUNT_INVALID');
  if (!Number.isSafeInteger(normalized.executableEntryCount) || normalized.executableEntryCount !== 1) blockers.push('STAGE_EXECUTABLE_ENTRY_COUNT_INVALID');
  if (observedAtMs === null || observedAtMs > nowMs + 60_000) blockers.push('STAGE_OBSERVED_TIME_INVALID');
  return Object.freeze(normalized);
}

function normalizeBackupSet(value, expected, nowMs, blockers) {
  if (value === undefined || value === null) return null;
  const backup = object(value);
  if (!backup) {
    blockers.push('BACKUP_SET_MALFORMED');
    return null;
  }
  const createdAtMs = exactTime(backup.createdAtUtc);
  const entriesInput = Array.isArray(backup.entries) ? backup.entries : [];
  if (!Array.isArray(backup.entries)) blockers.push('BACKUP_ENTRIES_NOT_ARRAY');
  if (entriesInput.length > OPENCLAW_STAGED_UPDATE_MAX_ENTRIES) blockers.push('BACKUP_ENTRIES_LIMIT_EXCEEDED');

  const expectedByFingerprint = new Map(
    (expected?.protectedEntries ?? []).map((entry) => [entry.pathFingerprintSha256, entry]),
  );
  const entries = [];
  const seen = new Map();
  for (const item of entriesInput.slice(0, OPENCLAW_STAGED_UPDATE_MAX_ENTRIES)) {
    const entry = object(item);
    if (!entry) {
      blockers.push('BACKUP_ENTRY_MALFORMED');
      continue;
    }
    const normalized = Object.freeze({
      pathFingerprintSha256: exactSha256(entry.pathFingerprintSha256),
      sourceDigestSha256: exactSha256(entry.sourceDigestSha256),
      backupDigestSha256: exactSha256(entry.backupDigestSha256),
      backupObjectId: safeId(entry.backupObjectId),
    });
    if (!normalized.pathFingerprintSha256 || !normalized.sourceDigestSha256
        || !normalized.backupDigestSha256 || !normalized.backupObjectId) {
      blockers.push('BACKUP_ENTRY_IDENTITY_INVALID');
      continue;
    }
    const prior = seen.get(normalized.pathFingerprintSha256);
    if (prior && canonicalJson(prior) !== canonicalJson(normalized)) {
      blockers.push(`BACKUP_ENTRY_CONFLICT:${normalized.pathFingerprintSha256}`);
      continue;
    }
    if (prior) {
      blockers.push(`BACKUP_ENTRY_DUPLICATE:${normalized.pathFingerprintSha256}`);
      continue;
    }
    seen.set(normalized.pathFingerprintSha256, normalized);
    entries.push(normalized);
    const expectedEntry = expectedByFingerprint.get(normalized.pathFingerprintSha256);
    if (!expectedEntry) blockers.push(`BACKUP_ENTRY_NOT_PROTECTED:${normalized.pathFingerprintSha256}`);
    else if (expectedEntry.sourceDigestSha256 !== normalized.sourceDigestSha256) {
      blockers.push(`BACKUP_SOURCE_DIGEST_MISMATCH:${normalized.pathFingerprintSha256}`);
    }
  }
  for (const expectedEntry of expected?.protectedEntries ?? []) {
    if (!seen.has(expectedEntry.pathFingerprintSha256)) {
      blockers.push(`BACKUP_ENTRY_MISSING:${expectedEntry.pathFingerprintSha256}`);
    }
  }

  const normalized = {
    schema: text(backup.schema),
    backupSetId: safeId(backup.backupSetId),
    manifestSha256: exactSha256(backup.manifestSha256),
    storageClass: text(backup.storageClass),
    insideRepository: backup.insideRepository === true,
    insideOpenClawInstall: backup.insideOpenClawInstall === true,
    createdAtUtc: createdAtMs === null ? '' : new Date(createdAtMs).toISOString(),
    entries: Object.freeze(entries.sort((a, b) => a.pathFingerprintSha256.localeCompare(b.pathFingerprintSha256))),
  };
  normalized.backupSetSha256 = sha256(canonicalJson({
    schema: normalized.schema,
    backupSetId: normalized.backupSetId,
    manifestSha256: normalized.manifestSha256,
    storageClass: normalized.storageClass,
    createdAtUtc: normalized.createdAtUtc,
    entries: normalized.entries,
  }));
  if (normalized.schema !== OPENCLAW_UPDATE_BACKUP_SCHEMA) blockers.push('BACKUP_SCHEMA_MISMATCH');
  if (!normalized.backupSetId) blockers.push('BACKUP_SET_ID_INVALID');
  if (!sameExact(normalized.manifestSha256, expected?.manifestSha256)) blockers.push('BACKUP_MANIFEST_MISMATCH');
  if (normalized.storageClass !== 'ISOLATED_EXTERNAL_BACKUP') blockers.push('BACKUP_NOT_ISOLATED');
  if (normalized.insideRepository) blockers.push('BACKUP_INSIDE_REPOSITORY');
  if (normalized.insideOpenClawInstall) blockers.push('BACKUP_INSIDE_OPENCLAW_INSTALL');
  if (createdAtMs === null || createdAtMs > nowMs + 60_000) blockers.push('BACKUP_CREATED_TIME_INVALID');
  return Object.freeze(normalized);
}

function exactStepSet(value, required, blockerPrefix, blockers) {
  if (!Array.isArray(value)) {
    blockers.push(`${blockerPrefix}_STEPS_NOT_ARRAY`);
    return [];
  }
  const steps = value.map((item) => text(item)).filter(Boolean);
  if (steps.length !== required.length || steps.some((step, index) => step !== required[index])) {
    blockers.push(`${blockerPrefix}_STEPS_MISMATCH`);
  }
  return Object.freeze(steps);
}

function normalizeApplyReceipt(value, expected, approval, backupSet, nowMs, blockers) {
  if (value === undefined || value === null) return null;
  const receipt = object(value);
  if (!receipt) {
    blockers.push('APPLY_RECEIPT_MALFORMED');
    return null;
  }
  const observedAtMs = exactTime(receipt.observedAtUtc);
  const normalized = {
    schema: text(receipt.schema),
    receiptId: safeId(receipt.receiptId),
    adapterId: text(receipt.adapterId),
    repository: safeId(receipt.repository),
    sourceHead: exactSha(receipt.sourceHead),
    manifestSha256: exactSha256(receipt.manifestSha256),
    approvalId: safeId(receipt.approvalId),
    stageId: safeId(receipt.stageId),
    backupSetId: safeId(receipt.backupSetId),
    packetId: safeId(receipt.packetId),
    packetSha256: exactSha256(receipt.packetSha256),
    beforeVersion: safeVersion(receipt.beforeVersion),
    targetVersion: safeVersion(receipt.targetVersion),
    mutationAttempted: receipt.mutationAttempted === true,
    observedAtUtc: observedAtMs === null ? '' : new Date(observedAtMs).toISOString(),
    steps: exactStepSet(receipt.steps, APPLY_STEPS, 'APPLY_RECEIPT', blockers),
  };
  if (normalized.schema !== OPENCLAW_UPDATE_APPLY_RECEIPT_SCHEMA) blockers.push('APPLY_RECEIPT_SCHEMA_MISMATCH');
  if (!normalized.receiptId) blockers.push('APPLY_RECEIPT_ID_INVALID');
  if (normalized.adapterId !== OPENCLAW_BOUNDED_UPDATE_ADAPTER_ID) blockers.push('APPLY_RECEIPT_ADAPTER_MISMATCH');
  if (!sameExact(normalized.repository, expected?.repository)) blockers.push('APPLY_RECEIPT_REPOSITORY_MISMATCH');
  if (!sameExact(normalized.sourceHead, expected?.sourceHead)) blockers.push('APPLY_RECEIPT_SOURCE_HEAD_MISMATCH');
  if (!sameExact(normalized.manifestSha256, expected?.manifestSha256)) blockers.push('APPLY_RECEIPT_MANIFEST_MISMATCH');
  if (!sameExact(normalized.approvalId, approval?.approvalId)) blockers.push('APPLY_RECEIPT_APPROVAL_MISMATCH');
  if (!sameExact(normalized.stageId, expected?.stageId)) blockers.push('APPLY_RECEIPT_STAGE_MISMATCH');
  if (!sameExact(normalized.backupSetId, backupSet?.backupSetId)) blockers.push('APPLY_RECEIPT_BACKUP_MISMATCH');
  if (!sameExact(normalized.packetId, expected?.packetId)) blockers.push('APPLY_RECEIPT_PACKET_ID_MISMATCH');
  if (!sameExact(normalized.packetSha256, expected?.packetSha256)) blockers.push('APPLY_RECEIPT_PACKET_DIGEST_MISMATCH');
  if (!sameExact(normalized.beforeVersion, expected?.currentVersion)) blockers.push('APPLY_RECEIPT_BEFORE_VERSION_MISMATCH');
  if (!sameExact(normalized.targetVersion, expected?.targetVersion)) blockers.push('APPLY_RECEIPT_TARGET_VERSION_MISMATCH');
  if (!normalized.mutationAttempted) blockers.push('APPLY_RECEIPT_MUTATION_NOT_ATTESTED');
  if (observedAtMs === null || observedAtMs > nowMs + 60_000) blockers.push('APPLY_RECEIPT_OBSERVED_TIME_INVALID');
  return Object.freeze(normalized);
}

function normalizeHealthProof(value, expected, nowMs, blockers, { rollback = false } = {}) {
  if (value === undefined || value === null) return null;
  const proof = object(value);
  if (!proof) {
    blockers.push(rollback ? 'ROLLBACK_PROOF_MALFORMED' : 'POST_UPDATE_PROOF_MALFORMED');
    return null;
  }
  const prefix = rollback ? 'ROLLBACK_PROOF' : 'POST_UPDATE_PROOF';
  const observedAtMs = exactTime(proof.observedAtUtc);
  const expectedSchema = rollback ? OPENCLAW_UPDATE_ROLLBACK_PROOF_SCHEMA : OPENCLAW_UPDATE_POST_PROOF_SCHEMA;
  const expectedVersion = rollback ? expected?.currentVersion : expected?.targetVersion;
  const health = object(proof.health) ?? {};
  const normalizedHealth = Object.freeze(REQUIRED_HEALTH_CHECKS.reduce((result, name) => {
    result[name] = health[name] === true;
    if (health[name] !== true) blockers.push(`${prefix}_HEALTH_FAILED:${name}`);
    return result;
  }, {}));
  const normalized = {
    schema: text(proof.schema),
    proofId: safeId(proof.proofId),
    repository: safeId(proof.repository),
    sourceHead: exactSha(proof.sourceHead),
    manifestSha256: exactSha256(proof.manifestSha256),
    observedVersion: safeVersion(proof.observedVersion),
    gatewayEndpoint: text(proof.gatewayEndpoint),
    observedAtUtc: observedAtMs === null ? '' : new Date(observedAtMs).toISOString(),
    health: normalizedHealth,
  };
  if (normalized.schema !== expectedSchema) blockers.push(`${prefix}_SCHEMA_MISMATCH`);
  if (!normalized.proofId) blockers.push(`${prefix}_ID_INVALID`);
  if (!sameExact(normalized.repository, expected?.repository)) blockers.push(`${prefix}_REPOSITORY_MISMATCH`);
  if (!sameExact(normalized.sourceHead, expected?.sourceHead)) blockers.push(`${prefix}_SOURCE_HEAD_MISMATCH`);
  if (!sameExact(normalized.manifestSha256, expected?.manifestSha256)) blockers.push(`${prefix}_MANIFEST_MISMATCH`);
  if (!sameExact(normalized.observedVersion, expectedVersion)) blockers.push(`${prefix}_VERSION_MISMATCH`);
  if (normalized.gatewayEndpoint !== OPENCLAW_APPROVED_GATEWAY_ENDPOINT) blockers.push(`${prefix}_GATEWAY_ENDPOINT_MISMATCH`);
  if (observedAtMs === null || observedAtMs > nowMs + 60_000) blockers.push(`${prefix}_OBSERVED_TIME_INVALID`);
  return Object.freeze(normalized);
}

function normalizePreservationComparison(value, expected, blockers, { rollback = false } = {}) {
  if (value === undefined || value === null) return null;
  const comparison = object(value);
  const prefix = rollback ? 'ROLLBACK_COMPARISON' : 'PRESERVATION_COMPARISON';
  if (!comparison) {
    blockers.push(`${prefix}_MALFORMED`);
    return null;
  }
  const entriesInput = Array.isArray(comparison.entries) ? comparison.entries : [];
  if (!Array.isArray(comparison.entries)) blockers.push(`${prefix}_ENTRIES_NOT_ARRAY`);
  if (entriesInput.length > OPENCLAW_STAGED_UPDATE_MAX_ENTRIES) blockers.push(`${prefix}_ENTRIES_LIMIT_EXCEEDED`);
  const expectedByFingerprint = new Map(
    (expected?.protectedEntries ?? []).map((entry) => [entry.pathFingerprintSha256, entry]),
  );
  const seen = new Set();
  const entries = [];
  for (const item of entriesInput.slice(0, OPENCLAW_STAGED_UPDATE_MAX_ENTRIES)) {
    const entry = object(item);
    if (!entry) {
      blockers.push(`${prefix}_ENTRY_MALFORMED`);
      continue;
    }
    const normalized = Object.freeze({
      pathFingerprintSha256: exactSha256(entry.pathFingerprintSha256),
      beforeDigestSha256: exactSha256(entry.beforeDigestSha256),
      afterDigestSha256: exactSha256(entry.afterDigestSha256),
    });
    if (!normalized.pathFingerprintSha256 || !normalized.beforeDigestSha256 || !normalized.afterDigestSha256) {
      blockers.push(`${prefix}_ENTRY_IDENTITY_INVALID`);
      continue;
    }
    if (seen.has(normalized.pathFingerprintSha256)) {
      blockers.push(`${prefix}_ENTRY_DUPLICATE:${normalized.pathFingerprintSha256}`);
      continue;
    }
    seen.add(normalized.pathFingerprintSha256);
    entries.push(normalized);
    const expectedEntry = expectedByFingerprint.get(normalized.pathFingerprintSha256);
    if (!expectedEntry) blockers.push(`${prefix}_ENTRY_NOT_PROTECTED:${normalized.pathFingerprintSha256}`);
    else {
      if (normalized.beforeDigestSha256 !== expectedEntry.sourceDigestSha256) {
        blockers.push(`${prefix}_BEFORE_DIGEST_MISMATCH:${normalized.pathFingerprintSha256}`);
      }
      if (normalized.afterDigestSha256 !== expectedEntry.sourceDigestSha256) {
        blockers.push(`${prefix}_AFTER_DIGEST_MISMATCH:${normalized.pathFingerprintSha256}`);
      }
    }
  }
  for (const expectedEntry of expected?.protectedEntries ?? []) {
    if (!seen.has(expectedEntry.pathFingerprintSha256)) {
      blockers.push(`${prefix}_ENTRY_MISSING:${expectedEntry.pathFingerprintSha256}`);
    }
  }
  const normalized = {
    schema: text(comparison.schema),
    comparisonId: safeId(comparison.comparisonId),
    manifestSha256: exactSha256(comparison.manifestSha256),
    entries: Object.freeze(entries.sort((a, b) => a.pathFingerprintSha256.localeCompare(b.pathFingerprintSha256))),
  };
  if (normalized.schema !== OPENCLAW_UPDATE_PRESERVATION_COMPARISON_SCHEMA) blockers.push(`${prefix}_SCHEMA_MISMATCH`);
  if (!normalized.comparisonId) blockers.push(`${prefix}_ID_INVALID`);
  if (!sameExact(normalized.manifestSha256, expected?.manifestSha256)) blockers.push(`${prefix}_MANIFEST_MISMATCH`);
  return Object.freeze(normalized);
}

function normalizeRollbackReceipt(value, expected, backupSet, nowMs, blockers) {
  if (value === undefined || value === null) return null;
  const receipt = object(value);
  if (!receipt) {
    blockers.push('ROLLBACK_RECEIPT_MALFORMED');
    return null;
  }
  const observedAtMs = exactTime(receipt.observedAtUtc);
  const normalized = {
    schema: text(receipt.schema),
    receiptId: safeId(receipt.receiptId),
    adapterId: text(receipt.adapterId),
    repository: safeId(receipt.repository),
    sourceHead: exactSha(receipt.sourceHead),
    manifestSha256: exactSha256(receipt.manifestSha256),
    backupSetId: safeId(receipt.backupSetId),
    restoredVersion: safeVersion(receipt.restoredVersion),
    mutationAttempted: receipt.mutationAttempted === true,
    observedAtUtc: observedAtMs === null ? '' : new Date(observedAtMs).toISOString(),
    steps: exactStepSet(receipt.steps, ROLLBACK_STEPS, 'ROLLBACK_RECEIPT', blockers),
  };
  if (normalized.schema !== OPENCLAW_UPDATE_ROLLBACK_RECEIPT_SCHEMA) blockers.push('ROLLBACK_RECEIPT_SCHEMA_MISMATCH');
  if (!normalized.receiptId) blockers.push('ROLLBACK_RECEIPT_ID_INVALID');
  if (normalized.adapterId !== OPENCLAW_BOUNDED_UPDATE_ADAPTER_ID) blockers.push('ROLLBACK_RECEIPT_ADAPTER_MISMATCH');
  if (!sameExact(normalized.repository, expected?.repository)) blockers.push('ROLLBACK_RECEIPT_REPOSITORY_MISMATCH');
  if (!sameExact(normalized.sourceHead, expected?.sourceHead)) blockers.push('ROLLBACK_RECEIPT_SOURCE_HEAD_MISMATCH');
  if (!sameExact(normalized.manifestSha256, expected?.manifestSha256)) blockers.push('ROLLBACK_RECEIPT_MANIFEST_MISMATCH');
  if (!sameExact(normalized.backupSetId, backupSet?.backupSetId)) blockers.push('ROLLBACK_RECEIPT_BACKUP_MISMATCH');
  if (!sameExact(normalized.restoredVersion, expected?.currentVersion)) blockers.push('ROLLBACK_RECEIPT_VERSION_MISMATCH');
  if (!normalized.mutationAttempted) blockers.push('ROLLBACK_RECEIPT_MUTATION_NOT_ATTESTED');
  if (observedAtMs === null || observedAtMs > nowMs + 60_000) blockers.push('ROLLBACK_RECEIPT_OBSERVED_TIME_INVALID');
  return Object.freeze(normalized);
}

function buildApplyPlan() {
  return Object.freeze([
    Object.freeze({ step: 1, actionId: OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_PREFLIGHT, mutating: false, executed: false }),
    Object.freeze({ step: 2, actionId: OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_APPROVAL, mutating: false, executed: false }),
    Object.freeze({ step: 3, actionId: OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_STAGE, mutating: false, executed: false }),
    Object.freeze({ step: 4, actionId: OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_BACKUP, mutating: false, executed: false }),
    Object.freeze({ step: 5, actionId: OPENCLAW_STAGED_UPDATE_ACTION.APPLY_UPDATE, mutating: true, executed: false }),
    Object.freeze({ step: 6, actionId: OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_HEALTH, mutating: false, executed: false }),
    Object.freeze({ step: 7, actionId: OPENCLAW_STAGED_UPDATE_ACTION.COMPARE_PRESERVATION, mutating: false, executed: false }),
  ]);
}

function buildRollbackPlan() {
  return Object.freeze([
    Object.freeze({ step: 1, actionId: OPENCLAW_STAGED_UPDATE_ACTION.ROLLBACK_PACKAGE, mutating: true, executed: false }),
    Object.freeze({ step: 2, actionId: OPENCLAW_STAGED_UPDATE_ACTION.RESTORE_BACKUP, mutating: true, executed: false }),
    Object.freeze({ step: 3, actionId: OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_ROLLBACK, mutating: false, executed: false }),
  ]);
}

function stageStatus({ structuralBlockers, approval, stage, backupSet, applyReceipt, postUpdateProof,
  preservationComparison, rollbackReceipt, rollbackProof, rollbackComparison, mutationEvidencePresent }) {
  if (rollbackReceipt || rollbackProof || rollbackComparison) {
    return structuralBlockers.length
      ? OPENCLAW_STAGED_UPDATE_STATUS.ROLLBACK_REQUIRED
      : OPENCLAW_STAGED_UPDATE_STATUS.ROLLED_BACK_AND_VERIFIED;
  }
  if (applyReceipt) {
    if (structuralBlockers.length) return OPENCLAW_STAGED_UPDATE_STATUS.ROLLBACK_REQUIRED;
    if (!postUpdateProof || !preservationComparison) return OPENCLAW_STAGED_UPDATE_STATUS.POST_UPDATE_PROOF_REQUIRED;
    return OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED;
  }
  if (mutationEvidencePresent) return OPENCLAW_STAGED_UPDATE_STATUS.ROLLBACK_REQUIRED;
  if (structuralBlockers.length) return OPENCLAW_STAGED_UPDATE_STATUS.BLOCKED_WITH_RESTORE_PATH;
  if (!approval) return OPENCLAW_STAGED_UPDATE_STATUS.APPROVAL_REQUIRED;
  if (!stage || !backupSet) return OPENCLAW_STAGED_UPDATE_STATUS.STAGING_REQUIRED;
  return OPENCLAW_STAGED_UPDATE_STATUS.READY_TO_APPLY;
}

export function buildOpenClawStagedUpdateV1(input = {}) {
  const blockers = [];
  const nowMs = exactTime(input.nowUtc ?? input.observedAtUtc ?? new Date().toISOString());
  if (nowMs === null) blockers.push('NOW_UTC_INVALID');
  const safeNowMs = nowMs ?? Date.now();
  const preflight = normalizePreflight(input.preflight, blockers);
  const approvalBlockerStart = blockers.length;
  const approval = normalizeApproval(input.approval, preflight, safeNowMs, blockers);
  const approvalValid = approval && blockers.length === approvalBlockerStart;

  const stageBlockerStart = blockers.length;
  const stage = normalizeStage(input.stage, preflight, safeNowMs, blockers);
  const stageValid = stage && blockers.length === stageBlockerStart;

  const backupBlockerStart = blockers.length;
  const backupSet = normalizeBackupSet(input.backupSet, preflight, safeNowMs, blockers);
  const backupValid = backupSet && blockers.length === backupBlockerStart;

  const applyBlockerStart = blockers.length;
  const applyReceipt = normalizeApplyReceipt(input.applyReceipt, {
    ...preflight,
    stageId: stage?.stageId,
  }, approval, backupSet, safeNowMs, blockers);
  const applyValid = applyReceipt && blockers.length === applyBlockerStart;

  const postProofBlockerStart = blockers.length;
  const postUpdateProof = normalizeHealthProof(input.postUpdateProof, preflight, safeNowMs, blockers);
  const postProofValid = postUpdateProof && blockers.length === postProofBlockerStart;

  const comparisonBlockerStart = blockers.length;
  const preservationComparison = normalizePreservationComparison(
    input.preservationComparison,
    preflight,
    blockers,
  );
  const comparisonValid = preservationComparison && blockers.length === comparisonBlockerStart;

  const rollbackBlockerStart = blockers.length;
  const rollbackReceipt = normalizeRollbackReceipt(
    input.rollbackReceipt,
    preflight,
    backupSet,
    safeNowMs,
    blockers,
  );
  const rollbackProof = normalizeHealthProof(
    input.rollbackProof,
    preflight,
    safeNowMs,
    blockers,
    { rollback: true },
  );
  const rollbackComparison = normalizePreservationComparison(
    input.rollbackComparison,
    preflight,
    blockers,
    { rollback: true },
  );
  const rollbackValid = rollbackReceipt && rollbackProof && rollbackComparison
    && blockers.length === rollbackBlockerStart;

  const mutationEvidencePresent = input.applyReceipt !== undefined && input.applyReceipt !== null;
  const structuralBlockers = uniqueSorted(blockers);
  let status = stageStatus({
    structuralBlockers,
    approval: approvalValid ? approval : null,
    stage: stageValid ? stage : null,
    backupSet: backupValid ? backupSet : null,
    applyReceipt: applyValid ? applyReceipt : null,
    postUpdateProof: postProofValid ? postUpdateProof : null,
    preservationComparison: comparisonValid ? preservationComparison : null,
    rollbackReceipt: rollbackValid ? rollbackReceipt : null,
    rollbackProof: rollbackValid ? rollbackProof : null,
    rollbackComparison: rollbackValid ? rollbackComparison : null,
    mutationEvidencePresent,
  });

  if (applyValid && (!input.postUpdateProof || !input.preservationComparison) && structuralBlockers.length === 0) {
    status = OPENCLAW_STAGED_UPDATE_STATUS.POST_UPDATE_PROOF_REQUIRED;
  }
  if (applyValid && postProofValid && comparisonValid && structuralBlockers.length === 0) {
    status = OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED;
  }
  const rollbackEvidencePresent = [
    input.rollbackReceipt,
    input.rollbackProof,
    input.rollbackComparison,
  ].some((value) => value !== undefined && value !== null);
  if (rollbackEvidencePresent && !rollbackValid) {
    status = OPENCLAW_STAGED_UPDATE_STATUS.ROLLBACK_REQUIRED;
  }
  if (rollbackValid && structuralBlockers.length === 0) {
    status = OPENCLAW_STAGED_UPDATE_STATUS.ROLLED_BACK_AND_VERIFIED;
  }

  const evidence = Object.freeze({
    preflight,
    approval: approvalValid ? approval : approval,
    stage: stageValid ? stage : stage,
    backupSet: backupValid ? backupSet : backupSet,
    applyReceipt: applyValid ? applyReceipt : applyReceipt,
    postUpdateProof: postProofValid ? postUpdateProof : postUpdateProof,
    preservationComparison: comparisonValid ? preservationComparison : preservationComparison,
    rollbackReceipt,
    rollbackProof,
    rollbackComparison,
  });

  const nextAction = status === OPENCLAW_STAGED_UPDATE_STATUS.APPROVAL_REQUIRED
    ? 'Issue one exact, expiring, single-use approval bound to the source head, manifest and pinned update packet.'
    : status === OPENCLAW_STAGED_UPDATE_STATUS.STAGING_REQUIRED
      ? 'Create the isolated packet stage and complete protected backup set through the future bounded Battle Bridge adapter.'
      : status === OPENCLAW_STAGED_UPDATE_STATUS.READY_TO_APPLY
        ? 'Submit the exact approval, stage and backup identities to the future bounded update adapter; this source harness cannot execute the update.'
        : status === OPENCLAW_STAGED_UPDATE_STATUS.POST_UPDATE_PROOF_REQUIRED
          ? 'Collect complete post-update health and preservation-comparison proof before claiming success.'
          : status === OPENCLAW_STAGED_UPDATE_STATUS.ROLLBACK_REQUIRED
            ? 'Run only the fixed rollback plan through the bounded adapter, then prove the prior version, health and protected identities.'
            : status === OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED
              ? 'Publish UPDATED_AND_VERIFIED with the exact receipt and proof identities.'
              : status === OPENCLAW_STAGED_UPDATE_STATUS.ROLLED_BACK_AND_VERIFIED
                ? 'Publish the rollback receipt and keep the update blocked until a new preflight and approval are produced.'
                : 'Repair the first named blocker without mutating OpenClaw.';

  return Object.freeze({
    schema: OPENCLAW_STAGED_UPDATE_SCHEMA,
    version: OPENCLAW_STAGED_UPDATE_VERSION,
    observedAtUtc: new Date(safeNowMs).toISOString(),
    status,
    blocker: structuralBlockers[0] ?? null,
    blockers: Object.freeze(structuralBlockers),
    exactIdentity: Object.freeze({
      repository: preflight?.repository ?? null,
      sourceHead: preflight?.sourceHead ?? null,
      manifestSha256: preflight?.manifestSha256 ?? null,
      packetId: preflight?.packetId ?? null,
      packetSha256: preflight?.packetSha256 ?? null,
      currentVersion: preflight?.currentVersion ?? null,
      targetVersion: preflight?.targetVersion ?? null,
    }),
    evidence,
    applyPlan: buildApplyPlan(),
    rollbackPlan: buildRollbackPlan(),
    safety: Object.freeze({
      sourceHarnessOnly: true,
      mutationAllowed: false,
      arbitraryShellAllowed: false,
      arbitraryPathAllowed: false,
      sourceMutationAllowed: false,
      mergeAuthority: false,
      deploymentAuthority: false,
      battleBridgeAdapterRequired: true,
      operatorApprovalRequired: ![
        OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED,
        OPENCLAW_STAGED_UPDATE_STATUS.ROLLED_BACK_AND_VERIFIED,
      ].includes(status),
      secretsIncluded: false,
      absolutePathsPublished: false,
    }),
    nextAction,
  });
}

export function renderOpenClawStagedUpdateSummary(result) {
  const value = object(result) ?? {};
  return [
    `OPENCLAW_STAGED_UPDATE=${text(value.status, 'UNKNOWN')}`,
    `SOURCE_HEAD=${text(value.exactIdentity?.sourceHead, 'UNKNOWN')}`,
    `CURRENT_VERSION=${text(value.exactIdentity?.currentVersion, 'UNKNOWN')}`,
    `TARGET_VERSION=${text(value.exactIdentity?.targetVersion, 'UNKNOWN')}`,
    `MANIFEST_SHA256=${text(value.exactIdentity?.manifestSha256, 'UNKNOWN')}`,
    `BLOCKER=${text(value.blocker, 'NONE')}`,
    `MUTATION_ALLOWED=${value.safety?.mutationAllowed === true ? 'YES' : 'NO'}`,
    `BATTLE_BRIDGE_ADAPTER_REQUIRED=${value.safety?.battleBridgeAdapterRequired === true ? 'YES' : 'NO'}`,
    `NEXT_ACTION=${text(value.nextAction, 'UNKNOWN')}`,
  ].join('\n');
}
