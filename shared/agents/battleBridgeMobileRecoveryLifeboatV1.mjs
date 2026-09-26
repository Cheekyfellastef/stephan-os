import { createHash } from 'node:crypto';

export const BATTLE_BRIDGE_MOBILE_RECOVERY_REQUEST_SCHEMA = 'stephanos.battle-bridge-mobile-recovery-request.v1';
export const BATTLE_BRIDGE_MOBILE_RECOVERY_ATTESTATION_SCHEMA = 'stephanos.battle-bridge-mobile-recovery-attestation.v1';
export const BATTLE_BRIDGE_LIFEBOAT_BANK_SCHEMA = 'stephanos.battle-bridge-lifeboat-bank-state.v1';
export const BATTLE_BRIDGE_LIFEBOAT_PLAN_SCHEMA = 'stephanos.battle-bridge-lifeboat-plan.v1';

export const BATTLE_BRIDGE_RECOVERY_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const BATTLE_BRIDGE_RECOVERY_ISSUE = 1814;
export const BATTLE_BRIDGE_RECOVERY_OWNER = 'Cheekyfellastef';
export const BATTLE_BRIDGE_RECOVERY_WORKFLOW = '.github/workflows/battle-bridge-mobile-recovery-attestation-v1.yml';
export const BATTLE_BRIDGE_RECOVERY_TTL_MS = 5 * 60 * 1000;

export const BATTLE_BRIDGE_MOBILE_RECOVERY_ACTIONS = Object.freeze([
  'PROBE_BATTLE_BRIDGE',
  'REPAIR_CONTROL_PLANE_TASKS',
  'RESTORE_CANONICAL_MAIN_PRESERVING_RUNTIME_STATE',
  'RESTART_CANONICAL_BACKEND',
  'REBUILD_AND_RESTART_CANONICAL_UI',
  'WAKE_CANONICAL_MAILBOX',
  'WAKE_CANONICAL_RECOVERY_MESH',
  'ROLLBACK_LIFEBOAT_TO_LAST_KNOWN_GOOD',
  'FULL_BATTLE_BRIDGE_RECOVERY',
]);

const ACTION_SET = new Set(BATTLE_BRIDGE_MOBILE_RECOVERY_ACTIONS);
const REQUEST_KEYS = Object.freeze([
  'schemaVersion',
  'repository',
  'issueNumber',
  'requestId',
  'nonce',
  'action',
  'requesterLogin',
  'authorAssociation',
  'requestedAtUtc',
  'expiresAtUtc',
]);
const ATTESTATION_KEYS = Object.freeze([
  'schemaVersion',
  'repository',
  'issueNumber',
  'requestId',
  'requestSha256',
  'action',
  'workflowPath',
  'reviewerLogin',
  'verdict',
  'attestedAtUtc',
  'expiresAtUtc',
]);
const BANK_KEYS = Object.freeze(['bankId', 'version', 'manifestSha256', 'selfTestVerdict', 'heartbeatFresh']);
const DATE_MAX_MS = 8.64e15;

function ownDataRecord(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(value).length) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).sort();
  const expected = [...expectedKeys].sort();
  if (keys.length !== expected.length || !keys.every((key, index) => key === expected[index])) return null;
  const out = Object.create(null);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    out[key] = descriptor.value;
  }
  return out;
}

function canonicalIso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return '';
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || Math.abs(ms) > DATE_MAX_MS) return '';
  return new Date(ms).toISOString() === value ? value : '';
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function stableRequestJson(request) {
  return JSON.stringify(REQUEST_KEYS.reduce((out, key) => {
    out[key] = request[key];
    return out;
  }, {}));
}

export function recoveryRequestSha256(request) {
  const normalized = normalizeMobileRecoveryRequest(request, { nowMs: Date.parse(request?.requestedAtUtc || '') });
  if (!normalized.ok) return '';
  return sha256(stableRequestJson(normalized.request));
}

export function normalizeMobileRecoveryRequest(input, { nowMs = Date.now(), consumedRequestIds = [] } = {}) {
  const request = ownDataRecord(input, REQUEST_KEYS);
  const blockers = [];
  if (!request) return Object.freeze({ ok: false, blockers: Object.freeze(['request-shape-invalid']), request: null });

  if (request.schemaVersion !== BATTLE_BRIDGE_MOBILE_RECOVERY_REQUEST_SCHEMA) blockers.push('request-schema-invalid');
  if (request.repository !== BATTLE_BRIDGE_RECOVERY_REPOSITORY) blockers.push('request-repository-invalid');
  if (request.issueNumber !== BATTLE_BRIDGE_RECOVERY_ISSUE) blockers.push('request-issue-invalid');
  if (request.requesterLogin !== BATTLE_BRIDGE_RECOVERY_OWNER) blockers.push('request-owner-invalid');
  if (request.authorAssociation !== 'OWNER') blockers.push('request-author-association-invalid');
  if (typeof request.requestId !== 'string' || !/^mobile-recovery-[a-z0-9][a-z0-9-]{7,63}$/.test(request.requestId)) blockers.push('request-id-invalid');
  if (typeof request.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(request.nonce)) blockers.push('request-nonce-invalid');
  if (!ACTION_SET.has(request.action)) blockers.push('request-action-invalid');

  const requestedAtUtc = canonicalIso(request.requestedAtUtc);
  const expiresAtUtc = canonicalIso(request.expiresAtUtc);
  const requestedAtMs = requestedAtUtc ? Date.parse(requestedAtUtc) : NaN;
  const expiresAtMs = expiresAtUtc ? Date.parse(expiresAtUtc) : NaN;
  if (!requestedAtUtc) blockers.push('request-time-invalid');
  if (!expiresAtUtc) blockers.push('request-expiry-invalid');
  if (Number.isFinite(requestedAtMs) && requestedAtMs > nowMs + 30_000) blockers.push('request-from-future');
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) blockers.push('request-expired');
  if (Number.isFinite(requestedAtMs) && Number.isFinite(expiresAtMs)
      && (expiresAtMs <= requestedAtMs || expiresAtMs - requestedAtMs > BATTLE_BRIDGE_RECOVERY_TTL_MS)) {
    blockers.push('request-expiry-window-invalid');
  }
  if (new Set(consumedRequestIds).has(request.requestId)) blockers.push('request-replayed');

  const normalized = Object.freeze(REQUEST_KEYS.reduce((out, key) => {
    out[key] = request[key];
    return out;
  }, Object.create(null)));
  return Object.freeze({ ok: blockers.length === 0, blockers: Object.freeze(blockers), request: normalized });
}

export function validateMobileRecoveryAttestation(input, request, { nowMs = Date.now() } = {}) {
  const attestation = ownDataRecord(input, ATTESTATION_KEYS);
  const requestResult = normalizeMobileRecoveryRequest(request, { nowMs });
  const blockers = [];
  if (!requestResult.ok) blockers.push(...requestResult.blockers.map((item) => `request:${item}`));
  if (!attestation) return Object.freeze({ ok: false, blockers: Object.freeze([...blockers, 'attestation-shape-invalid']) });

  if (attestation.schemaVersion !== BATTLE_BRIDGE_MOBILE_RECOVERY_ATTESTATION_SCHEMA) blockers.push('attestation-schema-invalid');
  if (attestation.repository !== BATTLE_BRIDGE_RECOVERY_REPOSITORY) blockers.push('attestation-repository-invalid');
  if (attestation.issueNumber !== BATTLE_BRIDGE_RECOVERY_ISSUE) blockers.push('attestation-issue-invalid');
  if (attestation.workflowPath !== BATTLE_BRIDGE_RECOVERY_WORKFLOW) blockers.push('attestation-workflow-invalid');
  if (attestation.reviewerLogin !== 'github-actions[bot]') blockers.push('attestation-reviewer-invalid');
  if (attestation.verdict !== 'ATTESTED') blockers.push('attestation-verdict-invalid');
  if (attestation.requestId !== requestResult.request?.requestId) blockers.push('attestation-request-id-mismatch');
  if (attestation.action !== requestResult.request?.action) blockers.push('attestation-action-mismatch');
  if (attestation.requestSha256 !== (requestResult.ok ? sha256(stableRequestJson(requestResult.request)) : '')) blockers.push('attestation-request-hash-mismatch');

  const attestedAtUtc = canonicalIso(attestation.attestedAtUtc);
  const expiresAtUtc = canonicalIso(attestation.expiresAtUtc);
  const attestedAtMs = attestedAtUtc ? Date.parse(attestedAtUtc) : NaN;
  const expiresAtMs = expiresAtUtc ? Date.parse(expiresAtUtc) : NaN;
  if (!attestedAtUtc) blockers.push('attestation-time-invalid');
  if (!expiresAtUtc) blockers.push('attestation-expiry-invalid');
  if (Number.isFinite(attestedAtMs) && attestedAtMs > nowMs + 30_000) blockers.push('attestation-from-future');
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) blockers.push('attestation-expired');
  if (Number.isFinite(attestedAtMs) && Number.isFinite(expiresAtMs)
      && (expiresAtMs <= attestedAtMs || expiresAtMs - attestedAtMs > BATTLE_BRIDGE_RECOVERY_TTL_MS)) {
    blockers.push('attestation-expiry-window-invalid');
  }
  if (requestResult.request && expiresAtUtc !== requestResult.request.expiresAtUtc) blockers.push('attestation-expiry-mismatch');

  return Object.freeze({ ok: blockers.length === 0, blockers: Object.freeze(blockers) });
}

function normalizeBank(bank, expectedId) {
  const candidate = ownDataRecord(bank, BANK_KEYS);
  if (!candidate) return null;
  if (candidate.bankId !== expectedId) return null;
  if (typeof candidate.version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(candidate.version)) return null;
  if (typeof candidate.manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.manifestSha256)) return null;
  if (!['PASS', 'FAIL', 'UNKNOWN'].includes(candidate.selfTestVerdict)) return null;
  if (typeof candidate.heartbeatFresh !== 'boolean') return null;
  return Object.freeze({ ...candidate });
}

export function planLifeboatBankPromotion(input) {
  const state = ownDataRecord(input, ['schemaVersion', 'activeBank', 'bankA', 'bankB']);
  if (!state || state.schemaVersion !== BATTLE_BRIDGE_LIFEBOAT_BANK_SCHEMA || !['A', 'B'].includes(state.activeBank)) {
    return Object.freeze({ ok: false, blocker: 'lifeboat-bank-state-invalid' });
  }
  const bankA = normalizeBank(state.bankA, 'A');
  const bankB = normalizeBank(state.bankB, 'B');
  if (!bankA || !bankB) return Object.freeze({ ok: false, blocker: 'lifeboat-bank-state-invalid' });
  const active = state.activeBank === 'A' ? bankA : bankB;
  const inactive = state.activeBank === 'A' ? bankB : bankA;
  if (!active.heartbeatFresh || active.selfTestVerdict !== 'PASS') {
    return Object.freeze({ ok: false, blocker: 'active-bank-not-known-good' });
  }
  if (!inactive.heartbeatFresh || inactive.selfTestVerdict !== 'PASS') {
    return Object.freeze({ ok: false, blocker: 'inactive-bank-not-proved' });
  }
  if (inactive.manifestSha256 === active.manifestSha256) {
    return Object.freeze({ ok: false, blocker: 'inactive-bank-not-distinct' });
  }
  return Object.freeze({
    ok: true,
    schemaVersion: BATTLE_BRIDGE_LIFEBOAT_BANK_SCHEMA,
    activeBankBefore: active.bankId,
    promoteBank: inactive.bankId,
    rollbackBank: active.bankId,
    atomicSwitchRequired: true,
    overwriteBothBanksAllowed: false,
    rollbackRetentionRequired: true,
  });
}

const ACTION_STEPS = Object.freeze({
  PROBE_BATTLE_BRIDGE: Object.freeze(['PROBE_BATTLE_BRIDGE']),
  REPAIR_CONTROL_PLANE_TASKS: Object.freeze(['PRESERVE_RUNTIME_STATE', 'REPAIR_CONTROL_PLANE_TASKS', 'PROVE_CONTROL_PLANE']),
  RESTORE_CANONICAL_MAIN_PRESERVING_RUNTIME_STATE: Object.freeze(['PRESERVE_RUNTIME_STATE', 'STAGE_CANONICAL_MAIN', 'VERIFY_STAGED_MAIN', 'PROMOTE_STAGED_MAIN', 'VERIFY_RUNTIME_STATE_HASHES']),
  RESTART_CANONICAL_BACKEND: Object.freeze(['PRESERVE_RUNTIME_STATE', 'RESTART_CANONICAL_BACKEND', 'PROVE_BACKEND_EXACT_SOURCE']),
  REBUILD_AND_RESTART_CANONICAL_UI: Object.freeze(['REBUILD_AND_RESTART_CANONICAL_UI', 'PROVE_UI_EXACT_SOURCE']),
  WAKE_CANONICAL_MAILBOX: Object.freeze(['WAKE_CANONICAL_MAILBOX', 'PROVE_MAILBOX_RECEIPT_ADVANCE']),
  WAKE_CANONICAL_RECOVERY_MESH: Object.freeze(['WAKE_CANONICAL_RECOVERY_MESH', 'PROVE_RECOVERY_MESH_HEALTH']),
  ROLLBACK_LIFEBOAT_TO_LAST_KNOWN_GOOD: Object.freeze(['ROLLBACK_LIFEBOAT_TO_LAST_KNOWN_GOOD', 'PROVE_LIFEBOAT_HEARTBEAT']),
  FULL_BATTLE_BRIDGE_RECOVERY: Object.freeze([
    'PRESERVE_RUNTIME_STATE',
    'PROBE_BATTLE_BRIDGE',
    'STAGE_CANONICAL_MAIN',
    'VERIFY_STAGED_MAIN',
    'PROMOTE_STAGED_MAIN',
    'REPAIR_CONTROL_PLANE_TASKS',
    'RESTART_CANONICAL_BACKEND',
    'REBUILD_AND_RESTART_CANONICAL_UI',
    'WAKE_CANONICAL_MAILBOX',
    'WAKE_CANONICAL_RECOVERY_MESH',
    'VERIFY_RUNTIME_STATE_HASHES',
    'PROVE_BATTLE_BRIDGE_EXACT_SOURCE',
  ]),
});

export function planAttestedMobileRecovery({ request, attestation, nowMs = Date.now(), consumedRequestIds = [] } = {}) {
  const normalized = normalizeMobileRecoveryRequest(request, { nowMs, consumedRequestIds });
  if (!normalized.ok) return Object.freeze({ ok: false, blockers: normalized.blockers, plan: null });
  const attested = validateMobileRecoveryAttestation(attestation, normalized.request, { nowMs });
  if (!attested.ok) return Object.freeze({ ok: false, blockers: attested.blockers, plan: null });
  return Object.freeze({
    ok: true,
    blockers: Object.freeze([]),
    plan: Object.freeze({
      schemaVersion: BATTLE_BRIDGE_LIFEBOAT_PLAN_SCHEMA,
      requestId: normalized.request.requestId,
      action: normalized.request.action,
      steps: ACTION_STEPS[normalized.request.action],
      preservationRequired: normalized.request.action !== 'PROBE_BATTLE_BRIDGE'
        && normalized.request.action !== 'REBUILD_AND_RESTART_CANONICAL_UI'
        && normalized.request.action !== 'WAKE_CANONICAL_MAILBOX'
        && normalized.request.action !== 'WAKE_CANONICAL_RECOVERY_MESH',
      arbitraryShellAllowed: false,
      callerSelectedPathAllowed: false,
      callerSelectedExecutableAllowed: false,
      callerSelectedUrlAllowed: false,
      callerSelectedTaskAllowed: false,
      destructiveGitAllowed: false,
      forcePushAllowed: false,
      pcRestartAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      podmanForgeExecutionAllowed: false,
    }),
  });
}
