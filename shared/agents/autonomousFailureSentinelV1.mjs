import {
  BATTLE_BRIDGE_AVAILABILITY,
  GITHUB_CONTINUITY_MODE_SCHEMA,
  GITHUB_CONTINUITY_STATE,
} from './githubContinuityModeV1.mjs';

export const AUTONOMOUS_FAILURE_SENTINEL_SCHEMA = 'stephanos.autonomous-failure-sentinel.v1';
export const AUTONOMOUS_RECOVERY_CAPABILITY_SCHEMA = 'stephanos.autonomous-recovery-capability.v1';

export const FAILURE_SENTINEL_STATE = Object.freeze({
  NORMAL: 'NORMAL',
  AUTO_RECOVERING: 'AUTO_RECOVERING',
  WAITING_FOR_RECOVERY_RECEIPT: 'WAITING_FOR_RECOVERY_RECEIPT',
  WAITING_FOR_PROVEN_RECOVERY_ROUTE: 'WAITING_FOR_PROVEN_RECOVERY_ROUTE',
  SAFE_HOLD: 'SAFE_HOLD',
});

export const FAILURE_SENTINEL_RECOVERY_ACTIONS = Object.freeze([
  'PROBE_BATTLE_BRIDGE',
  'WAKE_CANONICAL_RECOVERY_MESH',
  'WAKE_CANONICAL_MAILBOX',
]);

const ACTION_SET = new Set(FAILURE_SENTINEL_RECOVERY_ACTIONS);
const SHA = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const MAX_CAPABILITY_LIFETIME_MS = 10 * 60 * 1000;
const ACTIVE_RECOVERY_STATUSES = new Set(['PENDING', 'ACCEPTED', 'RUNNING']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function canonicalTimestamp(value) {
  const normalized = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized)) return null;
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString() === normalized ? ms : null;
}

function exactOwnDataRecord(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(value).length) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).sort();
  const expected = [...expectedKeys].sort();
  if (keys.length !== expected.length || !keys.every((key, index) => key === expected[index])) return null;
  const result = Object.create(null);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function ownDataRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(value).length) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result = Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function validateContinuityPlan(plan, { repository, expectedSourceHead }) {
  const record = ownDataRecord(plan);
  const state = text(record?.state);
  const availability = text(record?.battleBridgeAvailability);
  const sourceHead = text(record?.expectedSourceHead).toLowerCase();
  const valid = Boolean(record)
    && record.schemaVersion === GITHUB_CONTINUITY_MODE_SCHEMA
    && record.repository === repository
    && sourceHead === expectedSourceHead
    && Object.values(GITHUB_CONTINUITY_STATE).includes(state)
    && Object.values(BATTLE_BRIDGE_AVAILABILITY).includes(availability)
    && record.recoveryGoalIssue === 1814
    && typeof record.recoveryHandoffRequired === 'boolean'
    && record.sourceMutationAuthorityAdded === false
    && record.mergeAuthorityAdded === false
    && record.deploymentAuthorityAdded === false
    && record.runtimeMutationAuthorityAdded === false
    && record.duplicateDispatchAllowed === false
    && record.protectedMergeDispatchAllowed === false
    && ((availability === BATTLE_BRIDGE_AVAILABILITY.READY && record.recoveryHandoffRequired === false)
      || (availability !== BATTLE_BRIDGE_AVAILABILITY.READY && record.recoveryHandoffRequired === true));
  return Object.freeze({ valid, state, availability });
}

function validateRecoveryCapability(receipt, { repository, expectedSourceHead, nowMs }) {
  const keys = [
    'schemaVersion', 'repository', 'sourceHead', 'observedAtUtc', 'expiresAtUtc', 'actions', 'proofRefs',
  ];
  const record = exactOwnDataRecord(receipt, keys);
  if (!record) return Object.freeze({ valid: false, current: false, actions: Object.freeze([]), blocker: 'recovery-capability-invalid' });
  const observedAtMs = canonicalTimestamp(record.observedAtUtc);
  const expiresAtMs = canonicalTimestamp(record.expiresAtUtc);
  const actions = Array.isArray(record.actions) ? record.actions.map(text) : [];
  const proofRefs = Array.isArray(record.proofRefs) ? record.proofRefs.map(text) : [];
  const uniqueActions = actions.length === new Set(actions).size;
  const uniqueProofs = proofRefs.length === new Set(proofRefs).size;
  const valid = record.schemaVersion === AUTONOMOUS_RECOVERY_CAPABILITY_SCHEMA
    && record.repository === repository
    && text(record.sourceHead).toLowerCase() === expectedSourceHead
    && observedAtMs !== null
    && expiresAtMs !== null
    && observedAtMs <= nowMs + 60_000
    && expiresAtMs > observedAtMs
    && expiresAtMs - observedAtMs <= MAX_CAPABILITY_LIFETIME_MS
    && actions.length > 0
    && actions.length <= FAILURE_SENTINEL_RECOVERY_ACTIONS.length
    && uniqueActions
    && actions.every((action) => ACTION_SET.has(action))
    && proofRefs.length > 0
    && proofRefs.length <= 16
    && uniqueProofs
    && proofRefs.every((ref) => SAFE_REF.test(ref) && !ref.includes('..'));
  if (!valid) return Object.freeze({ valid: false, current: false, actions: Object.freeze([]), blocker: 'recovery-capability-invalid' });
  const current = expiresAtMs > nowMs;
  return Object.freeze({
    valid: true,
    current,
    actions: Object.freeze(actions),
    proofRefs: Object.freeze(proofRefs),
    blocker: current ? '' : 'recovery-capability-stale',
  });
}

function validateExistingRecovery(dispatch, expectedSourceHead) {
  if (dispatch === null || dispatch === undefined) return Object.freeze({ present: false, active: false, sourceHeadMatches: true });
  const keys = ['requestId', 'sourceHead', 'action', 'status', 'startedAtUtc', 'proofRefs'];
  const record = exactOwnDataRecord(dispatch, keys);
  if (!record) return Object.freeze({ present: true, active: false, sourceHeadMatches: false, invalid: true });
  const requestId = text(record.requestId);
  const sourceHead = text(record.sourceHead).toLowerCase();
  const action = text(record.action);
  const status = text(record.status).toUpperCase();
  const startedAtMs = canonicalTimestamp(record.startedAtUtc);
  const proofRefs = Array.isArray(record.proofRefs) ? record.proofRefs.map(text) : [];
  const valid = /^recovery-[a-z0-9][a-z0-9-]{7,95}$/.test(requestId)
    && SHA.test(sourceHead)
    && ACTION_SET.has(action)
    && ['PENDING', 'ACCEPTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(status)
    && startedAtMs !== null
    && proofRefs.length > 0
    && proofRefs.length <= 16
    && proofRefs.every((ref) => SAFE_REF.test(ref) && !ref.includes('..'));
  if (!valid) return Object.freeze({ present: true, active: false, sourceHeadMatches: false, invalid: true });
  return Object.freeze({
    present: true,
    active: ACTIVE_RECOVERY_STATUSES.has(status),
    sourceHeadMatches: sourceHead === expectedSourceHead,
    invalid: false,
    requestId,
    action,
    status,
  });
}

function chooseRecoveryAction(actions) {
  for (const action of FAILURE_SENTINEL_RECOVERY_ACTIONS) {
    if (actions.includes(action)) return action;
  }
  return '';
}

function operatorFirstDiscoveryDefect({ failureDetected, operatorObservedFailureAtUtc, automationDetectedFailureAtUtc }) {
  if (!failureDetected) return false;
  const operatorMs = canonicalTimestamp(operatorObservedFailureAtUtc);
  if (operatorMs === null) return false;
  const automationMs = canonicalTimestamp(automationDetectedFailureAtUtc);
  return automationMs === null || operatorMs < automationMs;
}

function frozenResult(value) {
  return Object.freeze(value);
}

export function planAutonomousFailureSentinelV1(input = {}) {
  const repository = text(input.repository);
  const expectedSourceHead = text(input.expectedSourceHead).toLowerCase();
  const nowMs = canonicalTimestamp(input.nowUtc);
  const envelopeValid = REPOSITORY.test(repository) && SHA.test(expectedSourceHead) && nowMs !== null;
  if (!envelopeValid) {
    return frozenResult({
      schemaVersion: AUTONOMOUS_FAILURE_SENTINEL_SCHEMA,
      state: FAILURE_SENTINEL_STATE.SAFE_HOLD,
      failureDetected: true,
      operatorFirstDiscoveryDefect: false,
      preserveRunningDispatchOwnership: true,
      sourceDiagnosticLaneRequired: false,
      runtimeRecoveryHandoffRequired: false,
      recoveryProposal: null,
      recoveryGoalIssue: 1814,
      sourceMutationAuthorityAdded: false,
      mergeAuthorityAdded: false,
      deploymentAuthorityAdded: false,
      runtimeMutationAuthorityAdded: false,
      arbitraryCommandAuthorityAdded: false,
      duplicateRecoveryDispatchAllowed: false,
      blockers: Object.freeze(['failure-sentinel-envelope-invalid']),
      finalVerdict: 'AUTONOMOUS_FAILURE_SENTINEL_SAFE_HOLD',
    });
  }

  const continuity = validateContinuityPlan(input.continuityPlan, { repository, expectedSourceHead });
  if (!continuity.valid) {
    return frozenResult({
      schemaVersion: AUTONOMOUS_FAILURE_SENTINEL_SCHEMA,
      state: FAILURE_SENTINEL_STATE.SAFE_HOLD,
      failureDetected: true,
      operatorFirstDiscoveryDefect: operatorFirstDiscoveryDefect({
        failureDetected: true,
        operatorObservedFailureAtUtc: input.operatorObservedFailureAtUtc,
        automationDetectedFailureAtUtc: input.automationDetectedFailureAtUtc,
      }),
      preserveRunningDispatchOwnership: true,
      sourceDiagnosticLaneRequired: true,
      runtimeRecoveryHandoffRequired: true,
      recoveryProposal: null,
      recoveryGoalIssue: 1814,
      sourceMutationAuthorityAdded: false,
      mergeAuthorityAdded: false,
      deploymentAuthorityAdded: false,
      runtimeMutationAuthorityAdded: false,
      arbitraryCommandAuthorityAdded: false,
      duplicateRecoveryDispatchAllowed: false,
      blockers: Object.freeze(['github-continuity-plan-invalid-or-authority-widened']),
      finalVerdict: 'AUTONOMOUS_FAILURE_SENTINEL_SAFE_HOLD',
    });
  }

  const failureDetected = continuity.availability !== BATTLE_BRIDGE_AVAILABILITY.READY
    || continuity.state !== GITHUB_CONTINUITY_STATE.NORMAL;
  const discoveryDefect = operatorFirstDiscoveryDefect({
    failureDetected,
    operatorObservedFailureAtUtc: input.operatorObservedFailureAtUtc,
    automationDetectedFailureAtUtc: input.automationDetectedFailureAtUtc,
  });

  if (!failureDetected) {
    return frozenResult({
      schemaVersion: AUTONOMOUS_FAILURE_SENTINEL_SCHEMA,
      state: FAILURE_SENTINEL_STATE.NORMAL,
      failureDetected: false,
      operatorFirstDiscoveryDefect: false,
      preserveRunningDispatchOwnership: true,
      sourceDiagnosticLaneRequired: false,
      runtimeRecoveryHandoffRequired: false,
      recoveryProposal: null,
      recoveryGoalIssue: 1814,
      sourceMutationAuthorityAdded: false,
      mergeAuthorityAdded: false,
      deploymentAuthorityAdded: false,
      runtimeMutationAuthorityAdded: false,
      arbitraryCommandAuthorityAdded: false,
      duplicateRecoveryDispatchAllowed: false,
      blockers: Object.freeze([]),
      finalVerdict: 'AUTONOMOUS_FAILURE_SENTINEL_NORMAL',
    });
  }

  const existing = validateExistingRecovery(input.existingRecoveryDispatch, expectedSourceHead);
  if (existing.invalid || (existing.active && !existing.sourceHeadMatches)) {
    return frozenResult({
      schemaVersion: AUTONOMOUS_FAILURE_SENTINEL_SCHEMA,
      state: FAILURE_SENTINEL_STATE.SAFE_HOLD,
      failureDetected: true,
      operatorFirstDiscoveryDefect: discoveryDefect,
      preserveRunningDispatchOwnership: true,
      sourceDiagnosticLaneRequired: true,
      runtimeRecoveryHandoffRequired: true,
      recoveryProposal: null,
      recoveryGoalIssue: 1814,
      sourceMutationAuthorityAdded: false,
      mergeAuthorityAdded: false,
      deploymentAuthorityAdded: false,
      runtimeMutationAuthorityAdded: false,
      arbitraryCommandAuthorityAdded: false,
      duplicateRecoveryDispatchAllowed: false,
      blockers: Object.freeze([existing.invalid ? 'existing-recovery-evidence-invalid' : 'existing-recovery-source-head-drift']),
      finalVerdict: 'AUTONOMOUS_FAILURE_SENTINEL_SAFE_HOLD',
    });
  }

  if (existing.active && existing.sourceHeadMatches) {
    return frozenResult({
      schemaVersion: AUTONOMOUS_FAILURE_SENTINEL_SCHEMA,
      state: FAILURE_SENTINEL_STATE.WAITING_FOR_RECOVERY_RECEIPT,
      failureDetected: true,
      operatorFirstDiscoveryDefect: discoveryDefect,
      preserveRunningDispatchOwnership: true,
      sourceDiagnosticLaneRequired: true,
      runtimeRecoveryHandoffRequired: true,
      recoveryProposal: null,
      existingRecoveryRequestId: existing.requestId,
      recoveryGoalIssue: 1814,
      sourceMutationAuthorityAdded: false,
      mergeAuthorityAdded: false,
      deploymentAuthorityAdded: false,
      runtimeMutationAuthorityAdded: false,
      arbitraryCommandAuthorityAdded: false,
      duplicateRecoveryDispatchAllowed: false,
      blockers: Object.freeze(['existing-recovery-dispatch-owns-recovery']),
      finalVerdict: 'AUTONOMOUS_FAILURE_SENTINEL_WAITING_FOR_RECOVERY_RECEIPT',
    });
  }

  const capability = validateRecoveryCapability(input.recoveryCapability, { repository, expectedSourceHead, nowMs });
  if (!capability.valid || !capability.current) {
    return frozenResult({
      schemaVersion: AUTONOMOUS_FAILURE_SENTINEL_SCHEMA,
      state: FAILURE_SENTINEL_STATE.WAITING_FOR_PROVEN_RECOVERY_ROUTE,
      failureDetected: true,
      operatorFirstDiscoveryDefect: discoveryDefect,
      preserveRunningDispatchOwnership: true,
      sourceDiagnosticLaneRequired: true,
      runtimeRecoveryHandoffRequired: true,
      recoveryProposal: null,
      recoveryGoalIssue: 1814,
      sourceMutationAuthorityAdded: false,
      mergeAuthorityAdded: false,
      deploymentAuthorityAdded: false,
      runtimeMutationAuthorityAdded: false,
      arbitraryCommandAuthorityAdded: false,
      duplicateRecoveryDispatchAllowed: false,
      blockers: Object.freeze([capability.blocker || 'recovery-capability-unproven']),
      finalVerdict: 'AUTONOMOUS_FAILURE_SENTINEL_WAITING_FOR_PROVEN_RECOVERY_ROUTE',
    });
  }

  const action = chooseRecoveryAction(capability.actions);
  if (!action) {
    return frozenResult({
      schemaVersion: AUTONOMOUS_FAILURE_SENTINEL_SCHEMA,
      state: FAILURE_SENTINEL_STATE.WAITING_FOR_PROVEN_RECOVERY_ROUTE,
      failureDetected: true,
      operatorFirstDiscoveryDefect: discoveryDefect,
      preserveRunningDispatchOwnership: true,
      sourceDiagnosticLaneRequired: true,
      runtimeRecoveryHandoffRequired: true,
      recoveryProposal: null,
      recoveryGoalIssue: 1814,
      sourceMutationAuthorityAdded: false,
      mergeAuthorityAdded: false,
      deploymentAuthorityAdded: false,
      runtimeMutationAuthorityAdded: false,
      arbitraryCommandAuthorityAdded: false,
      duplicateRecoveryDispatchAllowed: false,
      blockers: Object.freeze(['no-qualified-closed-world-recovery-action']),
      finalVerdict: 'AUTONOMOUS_FAILURE_SENTINEL_WAITING_FOR_PROVEN_RECOVERY_ROUTE',
    });
  }

  return frozenResult({
    schemaVersion: AUTONOMOUS_FAILURE_SENTINEL_SCHEMA,
    state: FAILURE_SENTINEL_STATE.AUTO_RECOVERING,
    failureDetected: true,
    operatorFirstDiscoveryDefect: discoveryDefect,
    preserveRunningDispatchOwnership: true,
    sourceDiagnosticLaneRequired: true,
    runtimeRecoveryHandoffRequired: true,
    recoveryProposal: Object.freeze({
      action,
      expectedSourceHead,
      recoveryGoalIssue: 1814,
      proofRefs: capability.proofRefs,
      useExistingCanonicalRecoverySurfaceOnly: true,
      freshPostActionReceiptRequired: true,
      dispatchAllowedByThisPlanner: false,
      ownerAuthoredRequestMayBeForged: false,
      arbitraryCommandAllowed: false,
      arbitraryPathAllowed: false,
      arbitraryExecutableAllowed: false,
      destructiveGitAllowed: false,
      pcRestartAllowed: false,
    }),
    recoveryGoalIssue: 1814,
    sourceMutationAuthorityAdded: false,
    mergeAuthorityAdded: false,
    deploymentAuthorityAdded: false,
    runtimeMutationAuthorityAdded: false,
    arbitraryCommandAuthorityAdded: false,
    duplicateRecoveryDispatchAllowed: false,
    blockers: Object.freeze(discoveryDefect ? ['operator-first-discovery-acceptance-defect'] : []),
    finalVerdict: 'AUTONOMOUS_FAILURE_SENTINEL_AUTO_RECOVERY_HANDOFF_READY',
  });
}
