import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_BRIDGE_LIFEBOAT_BANK_SCHEMA,
  BATTLE_BRIDGE_MOBILE_RECOVERY_ATTESTATION_SCHEMA,
  BATTLE_BRIDGE_MOBILE_RECOVERY_REQUEST_SCHEMA,
  BATTLE_BRIDGE_RECOVERY_ISSUE,
  BATTLE_BRIDGE_RECOVERY_OWNER,
  BATTLE_BRIDGE_RECOVERY_REPOSITORY,
  BATTLE_BRIDGE_RECOVERY_WORKFLOW,
  normalizeMobileRecoveryRequest,
  planAttestedMobileRecovery,
  planLifeboatBankPromotion,
  recoveryRequestSha256,
  validateMobileRecoveryAttestation,
} from './battleBridgeMobileRecoveryLifeboatV1.mjs';

const NOW = Date.parse('2026-08-16T14:30:00.000Z');

function request(overrides = {}) {
  return {
    schemaVersion: BATTLE_BRIDGE_MOBILE_RECOVERY_REQUEST_SCHEMA,
    repository: BATTLE_BRIDGE_RECOVERY_REPOSITORY,
    issueNumber: BATTLE_BRIDGE_RECOVERY_ISSUE,
    requestId: 'mobile-recovery-20260816-1430',
    nonce: '0123456789abcdef0123456789abcdef',
    action: 'FULL_BATTLE_BRIDGE_RECOVERY',
    requesterLogin: BATTLE_BRIDGE_RECOVERY_OWNER,
    authorAssociation: 'OWNER',
    requestedAtUtc: '2026-08-16T14:30:00.000Z',
    expiresAtUtc: '2026-08-16T14:35:00.000Z',
    ...overrides,
  };
}

function attestation(req = request(), overrides = {}) {
  return {
    schemaVersion: BATTLE_BRIDGE_MOBILE_RECOVERY_ATTESTATION_SCHEMA,
    repository: BATTLE_BRIDGE_RECOVERY_REPOSITORY,
    issueNumber: BATTLE_BRIDGE_RECOVERY_ISSUE,
    requestId: req.requestId,
    requestSha256: recoveryRequestSha256(req),
    action: req.action,
    workflowPath: BATTLE_BRIDGE_RECOVERY_WORKFLOW,
    reviewerLogin: 'github-actions[bot]',
    verdict: 'ATTESTED',
    attestedAtUtc: '2026-08-16T14:30:10.000Z',
    expiresAtUtc: req.expiresAtUtc,
    ...overrides,
  };
}

test('owner-authored bounded request is accepted and hash is deterministic', () => {
  const candidate = request();
  const result = normalizeMobileRecoveryRequest(candidate, { nowMs: NOW });
  assert.equal(result.ok, true);
  assert.match(recoveryRequestSha256(candidate), /^[a-f0-9]{64}$/);
  assert.equal(recoveryRequestSha256(candidate), recoveryRequestSha256({ ...candidate }));
});

test('foreign author, non-owner association, stale request and unknown action fail closed', () => {
  assert.equal(normalizeMobileRecoveryRequest(request({ requesterLogin: 'other-user' }), { nowMs: NOW }).ok, false);
  assert.equal(normalizeMobileRecoveryRequest(request({ authorAssociation: 'CONTRIBUTOR' }), { nowMs: NOW }).ok, false);
  assert.equal(normalizeMobileRecoveryRequest(request({ expiresAtUtc: '2026-08-16T14:29:59.000Z' }), { nowMs: NOW }).ok, false);
  assert.equal(normalizeMobileRecoveryRequest(request({ action: 'RUN_POWERSHELL' }), { nowMs: NOW }).ok, false);
});

test('edited, accessor-backed and extra-field requests are rejected before field use', () => {
  assert.equal(normalizeMobileRecoveryRequest({ ...request(), command: 'whoami' }, { nowMs: NOW }).ok, false);
  const candidate = request();
  Object.defineProperty(candidate, 'action', { get() { throw new Error('must not run'); }, enumerable: true });
  assert.doesNotThrow(() => normalizeMobileRecoveryRequest(candidate, { nowMs: NOW }));
  assert.equal(normalizeMobileRecoveryRequest(candidate, { nowMs: NOW }).ok, false);
});

test('replayed request id is rejected', () => {
  const candidate = request();
  const result = normalizeMobileRecoveryRequest(candidate, { nowMs: NOW, consumedRequestIds: [candidate.requestId] });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes('request-replayed'));
});

test('GitHub-hosted attestation binds the exact request, workflow and expiry', () => {
  const req = request();
  assert.equal(validateMobileRecoveryAttestation(attestation(req), req, { nowMs: NOW }).ok, true);
  assert.equal(validateMobileRecoveryAttestation(attestation(req, { requestSha256: '0'.repeat(64) }), req, { nowMs: NOW }).ok, false);
  assert.equal(validateMobileRecoveryAttestation(attestation(req, { reviewerLogin: 'someone' }), req, { nowMs: NOW }).ok, false);
  assert.equal(validateMobileRecoveryAttestation(attestation(req, { workflowPath: '.github/workflows/other.yml' }), req, { nowMs: NOW }).ok, false);
});

test('raw owner request without attestation cannot mint a recovery plan', () => {
  const result = planAttestedMobileRecovery({ request: request(), attestation: null, nowMs: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.plan, null);
});

test('attested full recovery plans only fixed steps and preserves zero general authority', () => {
  const req = request();
  const result = planAttestedMobileRecovery({ request: req, attestation: attestation(req), nowMs: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.plan.action, 'FULL_BATTLE_BRIDGE_RECOVERY');
  assert.equal(result.plan.preservationRequired, true);
  assert.deepEqual(result.plan.steps, [
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
  ]);
  for (const key of [
    'arbitraryShellAllowed',
    'callerSelectedPathAllowed',
    'callerSelectedExecutableAllowed',
    'callerSelectedUrlAllowed',
    'callerSelectedTaskAllowed',
    'destructiveGitAllowed',
    'forcePushAllowed',
    'pcRestartAllowed',
    'mergeAllowed',
    'deploymentAllowed',
    'podmanForgeExecutionAllowed',
  ]) assert.equal(result.plan[key], false, key);
});

test('probe-only request does not falsely require runtime preservation mutation', () => {
  const req = request({ action: 'PROBE_BATTLE_BRIDGE' });
  const result = planAttestedMobileRecovery({ request: req, attestation: attestation(req), nowMs: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.plan.preservationRequired, false);
  assert.deepEqual(result.plan.steps, ['PROBE_BATTLE_BRIDGE']);
});

function bankState(overrides = {}) {
  return {
    schemaVersion: BATTLE_BRIDGE_LIFEBOAT_BANK_SCHEMA,
    activeBank: 'A',
    bankA: {
      bankId: 'A',
      version: '1.0.0',
      manifestSha256: 'a'.repeat(64),
      selfTestVerdict: 'PASS',
      heartbeatFresh: true,
    },
    bankB: {
      bankId: 'B',
      version: '1.1.0',
      manifestSha256: 'b'.repeat(64),
      selfTestVerdict: 'PASS',
      heartbeatFresh: true,
    },
    ...overrides,
  };
}

test('A/B promotion keeps the active bank as rollback and never permits dual overwrite', () => {
  const plan = planLifeboatBankPromotion(bankState());
  assert.equal(plan.ok, true);
  assert.equal(plan.activeBankBefore, 'A');
  assert.equal(plan.promoteBank, 'B');
  assert.equal(plan.rollbackBank, 'A');
  assert.equal(plan.atomicSwitchRequired, true);
  assert.equal(plan.overwriteBothBanksAllowed, false);
  assert.equal(plan.rollbackRetentionRequired, true);
});

test('unproved inactive bank or unhealthy active bank cannot be promoted', () => {
  assert.equal(planLifeboatBankPromotion(bankState({
    bankB: { ...bankState().bankB, selfTestVerdict: 'FAIL' },
  })).ok, false);
  assert.equal(planLifeboatBankPromotion(bankState({
    bankA: { ...bankState().bankA, heartbeatFresh: false },
  })).ok, false);
});

test('identical bank manifests are rejected as fake redundancy', () => {
  const state = bankState();
  const plan = planLifeboatBankPromotion({
    ...state,
    bankB: { ...state.bankB, manifestSha256: state.bankA.manifestSha256 },
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.blocker, 'inactive-bank-not-distinct');
});
