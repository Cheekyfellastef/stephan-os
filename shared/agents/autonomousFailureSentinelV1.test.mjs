import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTONOMOUS_RECOVERY_CAPABILITY_SCHEMA,
  FAILURE_SENTINEL_STATE,
  planAutonomousFailureSentinelV1,
} from './autonomousFailureSentinelV1.mjs';
import {
  BATTLE_BRIDGE_AVAILABILITY,
  GITHUB_CONTINUITY_MODE_SCHEMA,
  GITHUB_CONTINUITY_STATE,
} from './githubContinuityModeV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = '428960d7d2fd50c6abd80be8d1bd5320fe46456e';
const NOW = '2026-08-16T23:34:00.000Z';

function continuity(overrides = {}) {
  return {
    schemaVersion: GITHUB_CONTINUITY_MODE_SCHEMA,
    repository: REPOSITORY,
    expectedSourceHead: HEAD,
    evaluatedAtUtc: NOW,
    state: GITHUB_CONTINUITY_STATE.GITHUB_CONTINUITY,
    battleBridgeAvailability: BATTLE_BRIDGE_AVAILABILITY.UNKNOWN,
    battleBridgeHostId: '',
    battleBridgeSourceHead: '',
    tasks: [],
    counts: { continue: 1, preserve: 0, runtimeHold: 1, capacityHold: 0, invalid: 0 },
    recoveryHandoffRequired: true,
    recoveryGoalIssue: 1814,
    sourceMutationAuthorityAdded: false,
    mergeAuthorityAdded: false,
    deploymentAuthorityAdded: false,
    runtimeMutationAuthorityAdded: false,
    duplicateDispatchAllowed: false,
    protectedMergeDispatchAllowed: false,
    blockers: ['battle-bridge-health-unproven'],
    finalVerdict: 'GITHUB_CONTINUITY_ACTIVE',
    ...overrides,
  };
}

function capability(actions = ['PROBE_BATTLE_BRIDGE'], overrides = {}) {
  return {
    schemaVersion: AUTONOMOUS_RECOVERY_CAPABILITY_SCHEMA,
    repository: REPOSITORY,
    sourceHead: HEAD,
    observedAtUtc: '2026-08-16T23:33:00.000Z',
    expiresAtUtc: '2026-08-16T23:38:00.000Z',
    actions,
    proofRefs: ['proofs/recovery/capability-1'],
    ...overrides,
  };
}

function plan(overrides = {}) {
  return planAutonomousFailureSentinelV1({
    repository: REPOSITORY,
    expectedSourceHead: HEAD,
    nowUtc: NOW,
    continuityPlan: continuity(),
    recoveryCapability: capability(),
    existingRecoveryDispatch: null,
    automationDetectedFailureAtUtc: '2026-08-16T23:32:00.000Z',
    operatorObservedFailureAtUtc: '',
    ...overrides,
  });
}

test('healthy Battle Bridge remains normal without recovery proposal', () => {
  const result = plan({
    continuityPlan: continuity({
      state: GITHUB_CONTINUITY_STATE.NORMAL,
      battleBridgeAvailability: BATTLE_BRIDGE_AVAILABILITY.READY,
      recoveryHandoffRequired: false,
      finalVerdict: 'GITHUB_CONTINUITY_NORMAL',
    }),
  });
  assert.equal(result.state, FAILURE_SENTINEL_STATE.NORMAL);
  assert.equal(result.failureDetected, false);
  assert.equal(result.recoveryProposal, null);
});

test('unproven Battle Bridge selects read-only probe before any wake', () => {
  const result = plan();
  assert.equal(result.state, FAILURE_SENTINEL_STATE.AUTO_RECOVERING);
  assert.equal(result.recoveryProposal.action, 'PROBE_BATTLE_BRIDGE');
  assert.equal(result.recoveryProposal.dispatchAllowedByThisPlanner, false);
  assert.equal(result.runtimeMutationAuthorityAdded, false);
});

test('selects Recovery Mesh wake only when probe is not qualified', () => {
  const result = plan({ recoveryCapability: capability(['WAKE_CANONICAL_RECOVERY_MESH']) });
  assert.equal(result.recoveryProposal.action, 'WAKE_CANONICAL_RECOVERY_MESH');
  assert.equal(result.recoveryProposal.freshPostActionReceiptRequired, true);
});

test('preserves an active exact-head recovery and never duplicates it', () => {
  const result = plan({
    existingRecoveryDispatch: {
      requestId: 'recovery-current-head-001',
      sourceHead: HEAD,
      action: 'WAKE_CANONICAL_RECOVERY_MESH',
      status: 'RUNNING',
      startedAtUtc: '2026-08-16T23:31:00.000Z',
      proofRefs: ['receipts/recovery/current-001'],
    },
  });
  assert.equal(result.state, FAILURE_SENTINEL_STATE.WAITING_FOR_RECOVERY_RECEIPT);
  assert.equal(result.recoveryProposal, null);
  assert.equal(result.duplicateRecoveryDispatchAllowed, false);
});

test('active recovery bound to another head causes safe hold', () => {
  const result = plan({
    existingRecoveryDispatch: {
      requestId: 'recovery-wrong-head-001',
      sourceHead: '1111111111111111111111111111111111111111',
      action: 'PROBE_BATTLE_BRIDGE',
      status: 'ACCEPTED',
      startedAtUtc: '2026-08-16T23:31:00.000Z',
      proofRefs: ['receipts/recovery/wrong-head-001'],
    },
  });
  assert.equal(result.state, FAILURE_SENTINEL_STATE.SAFE_HOLD);
  assert.deepEqual(result.blockers, ['existing-recovery-source-head-drift']);
});

test('operator-first discovery is an explicit acceptance defect', () => {
  const result = plan({
    operatorObservedFailureAtUtc: '2026-08-16T23:30:00.000Z',
    automationDetectedFailureAtUtc: '2026-08-16T23:32:00.000Z',
  });
  assert.equal(result.operatorFirstDiscoveryDefect, true);
  assert.ok(result.blockers.includes('operator-first-discovery-acceptance-defect'));
});

test('automation-first discovery is not an operator-first defect', () => {
  const result = plan({
    automationDetectedFailureAtUtc: '2026-08-16T23:29:00.000Z',
    operatorObservedFailureAtUtc: '2026-08-16T23:30:00.000Z',
  });
  assert.equal(result.operatorFirstDiscoveryDefect, false);
});

test('missing automation detection still records operator-first discovery', () => {
  const result = plan({
    automationDetectedFailureAtUtc: '',
    operatorObservedFailureAtUtc: '2026-08-16T23:30:00.000Z',
  });
  assert.equal(result.operatorFirstDiscoveryDefect, true);
});

test('authority-widened continuity evidence fails closed', () => {
  const result = plan({ continuityPlan: continuity({ runtimeMutationAuthorityAdded: true }) });
  assert.equal(result.state, FAILURE_SENTINEL_STATE.SAFE_HOLD);
  assert.equal(result.recoveryProposal, null);
  assert.deepEqual(result.blockers, ['github-continuity-plan-invalid-or-authority-widened']);
});

test('stale recovery capability cannot create a recovery proposal', () => {
  const result = plan({
    recoveryCapability: capability(['PROBE_BATTLE_BRIDGE'], {
      observedAtUtc: '2026-08-16T23:20:00.000Z',
      expiresAtUtc: '2026-08-16T23:25:00.000Z',
    }),
  });
  assert.equal(result.state, FAILURE_SENTINEL_STATE.WAITING_FOR_PROVEN_RECOVERY_ROUTE);
  assert.equal(result.recoveryProposal, null);
});

test('wrong-head recovery capability fails closed without dispatch', () => {
  const result = plan({
    recoveryCapability: capability(['PROBE_BATTLE_BRIDGE'], {
      sourceHead: '2222222222222222222222222222222222222222',
    }),
  });
  assert.equal(result.state, FAILURE_SENTINEL_STATE.WAITING_FOR_PROVEN_RECOVERY_ROUTE);
  assert.equal(result.recoveryProposal, null);
});

test('planner cannot forge an owner-authored mobile recovery request', () => {
  const result = plan();
  assert.equal(result.recoveryProposal.ownerAuthoredRequestMayBeForged, false);
  assert.equal(result.recoveryProposal.arbitraryCommandAllowed, false);
  assert.equal(result.recoveryProposal.destructiveGitAllowed, false);
  assert.equal(result.recoveryProposal.pcRestartAllowed, false);
});
