import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATTLE_BRIDGE_AVAILABILITY,
  GITHUB_CONTINUITY_MODE_SCHEMA,
  GITHUB_CONTINUITY_STATE,
} from './githubContinuityModeV1.mjs';
import {
  AUTONOMOUS_RECOVERY_CAPABILITY_SCHEMA,
} from './autonomousFailureSentinelV1.mjs';
import {
  AUTONOMOUS_FAILURE_HANDOFF_STATE,
  AUTONOMOUS_FAILURE_RECOVERY_HANDOFF_SCHEMA,
  planAutonomousFailureSentinelHandoffV1,
} from './autonomousFailureSentinelHandoffV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NOW = '2026-08-17T14:00:00.000Z';
const OBSERVED = '2026-08-17T13:59:00.000Z';
const EXPIRES = '2026-08-17T14:05:00.000Z';

function continuityPlan(overrides = {}) {
  return {
    schemaVersion: GITHUB_CONTINUITY_MODE_SCHEMA,
    repository: REPOSITORY,
    expectedSourceHead: HEAD,
    evaluatedAtUtc: NOW,
    state: GITHUB_CONTINUITY_STATE.GITHUB_CONTINUITY,
    battleBridgeAvailability: BATTLE_BRIDGE_AVAILABILITY.UNAVAILABLE,
    recoveryGoalIssue: 1814,
    recoveryHandoffRequired: true,
    sourceMutationAuthorityAdded: false,
    mergeAuthorityAdded: false,
    deploymentAuthorityAdded: false,
    runtimeMutationAuthorityAdded: false,
    duplicateDispatchAllowed: false,
    protectedMergeDispatchAllowed: false,
    ...overrides,
  };
}

function recoveryCapability(overrides = {}) {
  return {
    schemaVersion: AUTONOMOUS_RECOVERY_CAPABILITY_SCHEMA,
    repository: REPOSITORY,
    sourceHead: HEAD,
    observedAtUtc: OBSERVED,
    expiresAtUtc: EXPIRES,
    actions: ['PROBE_BATTLE_BRIDGE'],
    proofRefs: ['proof/recovery-capability-current'],
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    repository: REPOSITORY,
    expectedSourceHead: HEAD,
    nowUtc: NOW,
    continuityPlan: continuityPlan(),
    recoveryCapability: recoveryCapability(),
    automationDetectedFailureAtUtc: OBSERVED,
    ...overrides,
  };
}

function candidate() {
  const result = planAutonomousFailureSentinelHandoffV1(baseInput());
  assert.equal(result.state, AUTONOMOUS_FAILURE_HANDOFF_STATE.HANDOFF_CANDIDATE_READY);
  assert.ok(result.handoffCandidate);
  return result.handoffCandidate;
}

test('healthy continuity produces no recovery handoff', () => {
  const result = planAutonomousFailureSentinelHandoffV1(baseInput({
    continuityPlan: continuityPlan({
      state: GITHUB_CONTINUITY_STATE.NORMAL,
      battleBridgeAvailability: BATTLE_BRIDGE_AVAILABILITY.READY,
      recoveryHandoffRequired: false,
    }),
  }));

  assert.equal(result.state, AUTONOMOUS_FAILURE_HANDOFF_STATE.NORMAL);
  assert.equal(result.failureDetected, false);
  assert.equal(result.handoffCandidate, null);
  assert.equal(result.recoveryHandoffDisposition, 'NO_RECOVERY_REQUIRED');
  assert.equal(result.sourceContinuityDisposition, 'PRESERVE_CANONICAL_GITHUB_CONTINUITY');
});

test('unhealthy continuity plus proven recovery capability emits exactly one inert #1814 candidate', () => {
  const result = planAutonomousFailureSentinelHandoffV1(baseInput());

  assert.equal(result.state, AUTONOMOUS_FAILURE_HANDOFF_STATE.HANDOFF_CANDIDATE_READY);
  assert.equal(result.recoveryGoalIssue, 1814);
  assert.equal(result.sourceContinuityDisposition, 'PRESERVE_CANONICAL_GITHUB_CONTINUITY');
  assert.equal(result.recoveryHandoffDisposition, 'CANONICAL_1814_HANDOFF_CANDIDATE_READY');
  assert.equal(result.handoffCandidate.schemaVersion, AUTONOMOUS_FAILURE_RECOVERY_HANDOFF_SCHEMA);
  assert.equal(result.handoffCandidate.repository, REPOSITORY);
  assert.equal(result.handoffCandidate.sourceHead, HEAD);
  assert.equal(result.handoffCandidate.recoveryGoalIssue, 1814);
  assert.equal(result.handoffCandidate.action, 'PROBE_BATTLE_BRIDGE');
  assert.deepEqual(result.handoffCandidate.proofRefs, ['proof/recovery-capability-current']);
  assert.equal(result.handoffCandidate.ownerRequestRequired, true);
  assert.equal(result.handoffCandidate.githubAttestationRequired, true);
  assert.equal(result.handoffCandidate.executionAllowedByThisAdapter, false);
  assert.equal(result.authority.queueWriteAllowed, false);
  assert.equal(result.authority.recoveryExecutionAllowed, false);
  assert.equal(result.authority.ownerRequestMayBeForged, false);
  assert.equal(result.authority.githubAttestationMayBeForged, false);
});

test('candidate identity is deterministic for the same exact head and fixed recovery action', () => {
  const first = planAutonomousFailureSentinelHandoffV1(baseInput());
  const second = planAutonomousFailureSentinelHandoffV1(baseInput());
  assert.equal(first.handoffCandidate.handoffId, second.handoffCandidate.handoffId);
  assert.deepEqual(first.handoffCandidate, second.handoffCandidate);
});

test('fixed action priority is inherited from M1 and cannot be caller-selected through M2', () => {
  const result = planAutonomousFailureSentinelHandoffV1(baseInput({
    recoveryCapability: recoveryCapability({
      actions: ['WAKE_CANONICAL_RECOVERY_MESH', 'PROBE_BATTLE_BRIDGE'],
    }),
  }));
  assert.equal(result.handoffCandidate.action, 'PROBE_BATTLE_BRIDGE');

  const wakeOnly = planAutonomousFailureSentinelHandoffV1(baseInput({
    recoveryCapability: recoveryCapability({
      actions: ['WAKE_CANONICAL_RECOVERY_MESH'],
    }),
  }));
  assert.equal(wakeOnly.handoffCandidate.action, 'WAKE_CANONICAL_RECOVERY_MESH');
});

test('an exact active handoff suppresses duplicate recovery handoff creation', () => {
  const existing = { ...candidate(), status: 'SUBMITTED' };
  const result = planAutonomousFailureSentinelHandoffV1(baseInput({
    existingRecoveryHandoff: existing,
  }));

  assert.equal(result.state, AUTONOMOUS_FAILURE_HANDOFF_STATE.EXISTING_HANDOFF_OWNS_RECOVERY);
  assert.equal(result.handoffCandidate, null);
  assert.equal(result.existingHandoffId, existing.handoffId);
  assert.equal(result.recoveryHandoffDisposition, 'EXISTING_EXACT_HANDOFF_OWNS_RECOVERY');
});

test('terminal handoff evidence requires reconciliation rather than automatic replay', () => {
  const existing = { ...candidate(), status: 'SUCCEEDED' };
  const result = planAutonomousFailureSentinelHandoffV1(baseInput({
    existingRecoveryHandoff: existing,
  }));

  assert.equal(result.state, AUTONOMOUS_FAILURE_HANDOFF_STATE.WAITING_FOR_RECOVERY_RECEIPT);
  assert.equal(result.handoffCandidate, null);
  assert.equal(result.recoveryHandoffDisposition, 'TERMINAL_HANDOFF_REQUIRES_SENTINEL_RECONCILIATION');
});

test('conflicting or authority-bearing handoff evidence fails closed', () => {
  const existing = candidate();
  for (const hostile of [
    { ...existing, sourceHead: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    { ...existing, mergeAllowed: true },
    { ...existing, executionAllowedByThisAdapter: true },
    { ...existing, arbitraryCommandAllowed: true },
  ]) {
    const result = planAutonomousFailureSentinelHandoffV1(baseInput({
      existingRecoveryHandoff: hostile,
    }));
    assert.equal(result.state, AUTONOMOUS_FAILURE_HANDOFF_STATE.SAFE_HOLD);
    assert.equal(result.handoffCandidate, null);
    assert.ok(result.blockers.includes('existing-recovery-handoff-invalid-or-conflicting'));
  }
});

test('existing canonical M1 recovery dispatch remains the owner and M2 emits nothing', () => {
  const result = planAutonomousFailureSentinelHandoffV1(baseInput({
    existingRecoveryDispatch: {
      requestId: 'recovery-12345678',
      sourceHead: HEAD,
      action: 'PROBE_BATTLE_BRIDGE',
      status: 'RUNNING',
      startedAtUtc: OBSERVED,
      proofRefs: ['proof/existing-recovery-running'],
    },
  }));

  assert.equal(result.state, AUTONOMOUS_FAILURE_HANDOFF_STATE.WAITING_FOR_RECOVERY_RECEIPT);
  assert.equal(result.handoffCandidate, null);
  assert.equal(result.recoveryHandoffDisposition, 'EXISTING_RECOVERY_DISPATCH_OWNS_RECOVERY');
});

test('missing or stale recovery capability never becomes a handoff candidate', () => {
  const missing = planAutonomousFailureSentinelHandoffV1(baseInput({ recoveryCapability: null }));
  assert.equal(missing.state, AUTONOMOUS_FAILURE_HANDOFF_STATE.WAITING_FOR_PROVEN_RECOVERY_ROUTE);
  assert.equal(missing.handoffCandidate, null);

  const stale = planAutonomousFailureSentinelHandoffV1(baseInput({
    recoveryCapability: recoveryCapability({
      observedAtUtc: '2026-08-17T13:40:00.000Z',
      expiresAtUtc: '2026-08-17T13:45:00.000Z',
    }),
  }));
  assert.equal(stale.state, AUTONOMOUS_FAILURE_HANDOFF_STATE.WAITING_FOR_PROVEN_RECOVERY_ROUTE);
  assert.equal(stale.handoffCandidate, null);
});

test('operator-first discovery is retained as an acceptance defect but grants no authority', () => {
  const result = planAutonomousFailureSentinelHandoffV1(baseInput({
    operatorObservedFailureAtUtc: '2026-08-17T13:57:00.000Z',
    automationDetectedFailureAtUtc: '2026-08-17T13:58:00.000Z',
  }));

  assert.equal(result.operatorFirstDiscoveryDefect, true);
  assert.equal(result.handoffCandidate.operatorFirstDiscoveryDefect, true);
  assert.equal(result.handoffCandidate.executionAllowedByThisAdapter, false);
  assert.equal(result.authority.runtimeMutationAllowed, false);
});

test('closed-world envelope rejects authority smuggling and unexpected orchestration fields', () => {
  for (const extra of [
    { mergeAllowed: true },
    { command: 'powershell -enc synthetic' },
    { taskName: 'caller-selected-task' },
    { queueWriteAllowed: true },
  ]) {
    const result = planAutonomousFailureSentinelHandoffV1({ ...baseInput(), ...extra });
    assert.equal(result.state, AUTONOMOUS_FAILURE_HANDOFF_STATE.SAFE_HOLD);
    assert.equal(result.handoffCandidate, null);
    assert.ok(result.blockers.includes('handoff-envelope-not-data-only-or-closed-world'));
  }
});

test('top-level and nested accessors fail closed without invoking caller code', () => {
  let topCalls = 0;
  const top = baseInput();
  Object.defineProperty(top, 'nowUtc', {
    enumerable: true,
    get() {
      topCalls += 1;
      throw new Error('top getter must not run');
    },
  });
  let topResult;
  assert.doesNotThrow(() => { topResult = planAutonomousFailureSentinelHandoffV1(top); });
  assert.equal(topCalls, 0);
  assert.equal(topResult.state, AUTONOMOUS_FAILURE_HANDOFF_STATE.SAFE_HOLD);

  let nestedCalls = 0;
  const continuity = continuityPlan();
  Object.defineProperty(continuity, 'state', {
    enumerable: true,
    get() {
      nestedCalls += 1;
      throw new Error('nested getter must not run');
    },
  });
  let nestedResult;
  assert.doesNotThrow(() => {
    nestedResult = planAutonomousFailureSentinelHandoffV1(baseInput({ continuityPlan: continuity }));
  });
  assert.equal(nestedCalls, 0);
  assert.equal(nestedResult.state, AUTONOMOUS_FAILURE_HANDOFF_STATE.SAFE_HOLD);
});

test('own toJSON, custom prototypes, sparse arrays and revoked proxies fail closed', () => {
  const withToJson = baseInput();
  withToJson.toJSON = () => ({ fabricated: true });
  assert.equal(
    planAutonomousFailureSentinelHandoffV1(withToJson).state,
    AUTONOMOUS_FAILURE_HANDOFF_STATE.SAFE_HOLD,
  );

  const custom = Object.assign(Object.create({ hidden: true }), baseInput());
  assert.equal(
    planAutonomousFailureSentinelHandoffV1(custom).state,
    AUTONOMOUS_FAILURE_HANDOFF_STATE.SAFE_HOLD,
  );

  const sparse = recoveryCapability();
  sparse.actions = new Array(2);
  sparse.actions[1] = 'PROBE_BATTLE_BRIDGE';
  assert.equal(
    planAutonomousFailureSentinelHandoffV1(baseInput({ recoveryCapability: sparse })).state,
    AUTONOMOUS_FAILURE_HANDOFF_STATE.SAFE_HOLD,
  );

  const revoked = Proxy.revocable(baseInput(), {});
  revoked.revoke();
  let revokedResult;
  assert.doesNotThrow(() => { revokedResult = planAutonomousFailureSentinelHandoffV1(revoked.proxy); });
  assert.equal(revokedResult.state, AUTONOMOUS_FAILURE_HANDOFF_STATE.SAFE_HOLD);
});

test('candidate is deeply non-authoritative and cannot replace the #1814 trust chain', () => {
  const handoff = candidate();
  assert.deepEqual({
    ownerRequestRequired: handoff.ownerRequestRequired,
    githubAttestationRequired: handoff.githubAttestationRequired,
    executionAllowedByThisAdapter: handoff.executionAllowedByThisAdapter,
    sourceMutationAllowed: handoff.sourceMutationAllowed,
    mergeAllowed: handoff.mergeAllowed,
    deploymentAllowed: handoff.deploymentAllowed,
    runtimeMutationAllowed: handoff.runtimeMutationAllowed,
    arbitraryCommandAllowed: handoff.arbitraryCommandAllowed,
    destructiveGitAllowed: handoff.destructiveGitAllowed,
    pcRestartAllowed: handoff.pcRestartAllowed,
  }, {
    ownerRequestRequired: true,
    githubAttestationRequired: true,
    executionAllowedByThisAdapter: false,
    sourceMutationAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    arbitraryCommandAllowed: false,
    destructiveGitAllowed: false,
    pcRestartAllowed: false,
  });
});
