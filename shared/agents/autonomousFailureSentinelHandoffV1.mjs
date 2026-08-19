import { createHash } from 'node:crypto';

import {
  AUTONOMOUS_FAILURE_SENTINEL_SCHEMA,
  FAILURE_SENTINEL_STATE,
  planAutonomousFailureSentinelV1,
} from './autonomousFailureSentinelV1.mjs';

export const AUTONOMOUS_FAILURE_SENTINEL_HANDOFF_SCHEMA =
  'stephanos.autonomous-failure-sentinel-handoff.v1';
export const AUTONOMOUS_FAILURE_RECOVERY_HANDOFF_SCHEMA =
  'stephanos.autonomous-failure-recovery-handoff.v1';

export const AUTONOMOUS_FAILURE_HANDOFF_STATE = Object.freeze({
  NORMAL: 'NORMAL',
  HANDOFF_CANDIDATE_READY: 'HANDOFF_CANDIDATE_READY',
  EXISTING_HANDOFF_OWNS_RECOVERY: 'EXISTING_HANDOFF_OWNS_RECOVERY',
  WAITING_FOR_RECOVERY_RECEIPT: 'WAITING_FOR_RECOVERY_RECEIPT',
  WAITING_FOR_PROVEN_RECOVERY_ROUTE: 'WAITING_FOR_PROVEN_RECOVERY_ROUTE',
  SAFE_HOLD: 'SAFE_HOLD',
});

export const AUTONOMOUS_FAILURE_HANDOFF_STATUS = Object.freeze([
  'CANDIDATE_READY',
  'SUBMITTED',
  'ACCEPTED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'INTERRUPTED',
]);

const ACTIVE_HANDOFF_STATUSES = new Set(['CANDIDATE_READY', 'SUBMITTED', 'ACCEPTED', 'RUNNING']);
const TERMINAL_HANDOFF_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'INTERRUPTED']);
const SHA = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_DEPTH = 12;
const MAX_NODES = 2_048;
const MAX_ARRAY_ITEMS = 256;
const MAX_STRING = 16_384;

const INPUT_KEYS = new Set([
  'repository',
  'expectedSourceHead',
  'nowUtc',
  'continuityPlan',
  'recoveryCapability',
  'existingRecoveryDispatch',
  'existingRecoveryHandoff',
  'operatorObservedFailureAtUtc',
  'automationDetectedFailureAtUtc',
]);

const HANDOFF_KEYS = Object.freeze([
  'schemaVersion',
  'handoffId',
  'repository',
  'sourceHead',
  'recoveryGoalIssue',
  'action',
  'createdAtUtc',
  'proofRefs',
  'status',
  'operatorFirstDiscoveryDefect',
  'preserveRunningDispatchOwnership',
  'ownerRequestRequired',
  'githubAttestationRequired',
  'executionAllowedByThisAdapter',
  'sourceMutationAllowed',
  'mergeAllowed',
  'deploymentAllowed',
  'runtimeMutationAllowed',
  'arbitraryCommandAllowed',
  'destructiveGitAllowed',
  'pcRestartAllowed',
]);

const ZERO_AUTHORITY = Object.freeze({
  ownerRequestMayBeForged: false,
  githubAttestationMayBeForged: false,
  queueWriteAllowed: false,
  recoveryExecutionAllowed: false,
  sourceMutationAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
  arbitraryCommandAllowed: false,
  arbitraryPathAllowed: false,
  arbitraryExecutableAllowed: false,
  destructiveGitAllowed: false,
  pcRestartAllowed: false,
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function canonicalTimestamp(value) {
  const normalized = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(normalized)) return null;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString() === normalized ? parsed : null;
}

function snapshotDataOnly(value, state = { nodes: 0 }, depth = 0, seen = new Set()) {
  state.nodes += 1;
  if (state.nodes > MAX_NODES || depth > MAX_DEPTH) return null;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.length <= MAX_STRING ? value : null;
  if (!value || typeof value !== 'object' || seen.has(value)) return null;

  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return null;
      if (Object.getOwnPropertySymbols(value).length > 0) return null;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const lengthDescriptor = descriptors.length;
      const length = lengthDescriptor?.value;
      if (!lengthDescriptor || lengthDescriptor.get || lengthDescriptor.set
          || !Number.isSafeInteger(length) || length < 0 || length > MAX_ARRAY_ITEMS) return null;
      const descriptorKeys = Object.keys(descriptors);
      const expectedKeys = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
      if (descriptorKeys.some((key) => !expectedKeys.has(key))) return null;
      seen.add(value);
      const result = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
          seen.delete(value);
          return null;
        }
        const normalized = snapshotDataOnly(descriptor.value, state, depth + 1, seen);
        if (normalized === null && descriptor.value !== null) {
          seen.delete(value);
          return null;
        }
        result.push(normalized);
      }
      seen.delete(value);
      return Object.freeze(result);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    seen.add(value);
    const result = Object.create(null);
    for (const key of Object.keys(descriptors).sort()) {
      if (RESERVED_KEYS.has(key)) {
        seen.delete(value);
        return null;
      }
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        seen.delete(value);
        return null;
      }
      const normalized = snapshotDataOnly(descriptor.value, state, depth + 1, seen);
      if (normalized === null && descriptor.value !== null) {
        seen.delete(value);
        return null;
      }
      Object.defineProperty(result, key, {
        value: normalized,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    seen.delete(value);
    return Object.freeze(result);
  } catch {
    return null;
  }
}

function snapshotInput(input) {
  const snapshot = snapshotDataOnly(input);
  if (!snapshot || Array.isArray(snapshot)) return null;
  if (Object.keys(snapshot).some((key) => !INPUT_KEYS.has(key))) return null;
  return snapshot;
}

function exactKeys(record, keys) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function safeProofRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) return null;
  const refs = value.map(text);
  if (refs.some((ref) => !SAFE_REF.test(ref) || ref.includes('..'))) return null;
  if (new Set(refs).size !== refs.length) return null;
  return Object.freeze(refs);
}

function handoffId({ repository, sourceHead, action }) {
  const digest = createHash('sha256')
    .update(`${repository}\n${sourceHead}\n1814\n${action}`, 'utf8')
    .digest('hex');
  return `failure-handoff-${digest.slice(0, 24)}`;
}

function blockedResult(input, sentinelState, blocker) {
  return Object.freeze({
    schemaVersion: AUTONOMOUS_FAILURE_SENTINEL_HANDOFF_SCHEMA,
    state: AUTONOMOUS_FAILURE_HANDOFF_STATE.SAFE_HOLD,
    repository: text(input?.repository),
    expectedSourceHead: text(input?.expectedSourceHead).toLowerCase(),
    sentinelState: text(sentinelState),
    failureDetected: true,
    operatorFirstDiscoveryDefect: false,
    preserveRunningDispatchOwnership: true,
    sourceContinuityDisposition: 'SAFE_HOLD',
    recoveryHandoffDisposition: 'SAFE_HOLD',
    recoveryGoalIssue: 1814,
    handoffCandidate: null,
    existingHandoffId: '',
    blockers: Object.freeze([blocker]),
    authority: ZERO_AUTHORITY,
    finalVerdict: 'AUTONOMOUS_FAILURE_SENTINEL_HANDOFF_SAFE_HOLD',
  });
}

function validateExistingHandoff(record, expected) {
  if (record === undefined || record === null) {
    return Object.freeze({ present: false, valid: true, active: false, terminal: false, sameIdentity: false, handoffId: '' });
  }
  if (!exactKeys(record, HANDOFF_KEYS)) {
    return Object.freeze({ present: true, valid: false, active: false, terminal: false, sameIdentity: false, handoffId: '' });
  }
  const proofRefs = safeProofRefs(record.proofRefs);
  const status = text(record.status).toUpperCase();
  const expectedId = handoffId(expected);
  const valid = record.schemaVersion === AUTONOMOUS_FAILURE_RECOVERY_HANDOFF_SCHEMA
    && text(record.handoffId) === expectedId
    && record.repository === expected.repository
    && text(record.sourceHead).toLowerCase() === expected.sourceHead
    && record.recoveryGoalIssue === 1814
    && record.action === expected.action
    && canonicalTimestamp(record.createdAtUtc) !== null
    && proofRefs !== null
    && AUTONOMOUS_FAILURE_HANDOFF_STATUS.includes(status)
    && typeof record.operatorFirstDiscoveryDefect === 'boolean'
    && record.preserveRunningDispatchOwnership === true
    && record.ownerRequestRequired === true
    && record.githubAttestationRequired === true
    && record.executionAllowedByThisAdapter === false
    && record.sourceMutationAllowed === false
    && record.mergeAllowed === false
    && record.deploymentAllowed === false
    && record.runtimeMutationAllowed === false
    && record.arbitraryCommandAllowed === false
    && record.destructiveGitAllowed === false
    && record.pcRestartAllowed === false;
  return Object.freeze({
    present: true,
    valid,
    active: valid && ACTIVE_HANDOFF_STATUSES.has(status),
    terminal: valid && TERMINAL_HANDOFF_STATUSES.has(status),
    sameIdentity: valid,
    handoffId: valid ? expectedId : '',
    status,
  });
}

function resultForSentinel(input, sentinel) {
  const base = {
    schemaVersion: AUTONOMOUS_FAILURE_SENTINEL_HANDOFF_SCHEMA,
    repository: input.repository,
    expectedSourceHead: input.expectedSourceHead,
    sentinelState: sentinel.state,
    failureDetected: sentinel.failureDetected === true,
    operatorFirstDiscoveryDefect: sentinel.operatorFirstDiscoveryDefect === true,
    preserveRunningDispatchOwnership: true,
    sourceContinuityDisposition: 'PRESERVE_CANONICAL_GITHUB_CONTINUITY',
    recoveryGoalIssue: 1814,
    authority: ZERO_AUTHORITY,
  };

  if (sentinel.state === FAILURE_SENTINEL_STATE.NORMAL) {
    return Object.freeze({
      ...base,
      state: AUTONOMOUS_FAILURE_HANDOFF_STATE.NORMAL,
      recoveryHandoffDisposition: 'NO_RECOVERY_REQUIRED',
      handoffCandidate: null,
      existingHandoffId: '',
      blockers: Object.freeze([]),
      finalVerdict: 'AUTONOMOUS_FAILURE_SENTINEL_HANDOFF_NORMAL',
    });
  }

  if (sentinel.state === FAILURE_SENTINEL_STATE.WAITING_FOR_RECOVERY_RECEIPT) {
    return Object.freeze({
      ...base,
      state: AUTONOMOUS_FAILURE_HANDOFF_STATE.WAITING_FOR_RECOVERY_RECEIPT,
      recoveryHandoffDisposition: 'EXISTING_RECOVERY_DISPATCH_OWNS_RECOVERY',
      handoffCandidate: null,
      existingHandoffId: '',
      blockers: Object.freeze([...sentinel.blockers]),
      finalVerdict: 'AUTONOMOUS_FAILURE_SENTINEL_HANDOFF_WAITING_FOR_RECOVERY_RECEIPT',
    });
  }

  if (sentinel.state === FAILURE_SENTINEL_STATE.WAITING_FOR_PROVEN_RECOVERY_ROUTE) {
    return Object.freeze({
      ...base,
      state: AUTONOMOUS_FAILURE_HANDOFF_STATE.WAITING_FOR_PROVEN_RECOVERY_ROUTE,
      recoveryHandoffDisposition: 'NO_CURRENT_QUALIFIED_RECOVERY_ROUTE',
      handoffCandidate: null,
      existingHandoffId: '',
      blockers: Object.freeze([...sentinel.blockers]),
      finalVerdict: 'AUTONOMOUS_FAILURE_SENTINEL_HANDOFF_WAITING_FOR_PROVEN_RECOVERY_ROUTE',
    });
  }

  if (sentinel.state === FAILURE_SENTINEL_STATE.SAFE_HOLD) {
    return Object.freeze({
      ...base,
      state: AUTONOMOUS_FAILURE_HANDOFF_STATE.SAFE_HOLD,
      sourceContinuityDisposition: 'SAFE_HOLD',
      recoveryHandoffDisposition: 'SAFE_HOLD',
      handoffCandidate: null,
      existingHandoffId: '',
      blockers: Object.freeze([...sentinel.blockers]),
      finalVerdict: 'AUTONOMOUS_FAILURE_SENTINEL_HANDOFF_SAFE_HOLD',
    });
  }

  if (sentinel.state !== FAILURE_SENTINEL_STATE.AUTO_RECOVERING || !sentinel.recoveryProposal) {
    return blockedResult(input, sentinel.state, 'sentinel-state-not-admissible-for-handoff');
  }

  const action = text(sentinel.recoveryProposal.action);
  const proofRefs = safeProofRefs(sentinel.recoveryProposal.proofRefs);
  if (!action || !proofRefs || sentinel.recoveryProposal.recoveryGoalIssue !== 1814
      || sentinel.recoveryProposal.useExistingCanonicalRecoverySurfaceOnly !== true
      || sentinel.recoveryProposal.freshPostActionReceiptRequired !== true
      || sentinel.recoveryProposal.dispatchAllowedByThisPlanner !== false
      || sentinel.recoveryProposal.ownerAuthoredRequestMayBeForged !== false
      || sentinel.recoveryProposal.arbitraryCommandAllowed !== false
      || sentinel.recoveryProposal.arbitraryPathAllowed !== false
      || sentinel.recoveryProposal.arbitraryExecutableAllowed !== false
      || sentinel.recoveryProposal.destructiveGitAllowed !== false
      || sentinel.recoveryProposal.pcRestartAllowed !== false) {
    return blockedResult(input, sentinel.state, 'sentinel-recovery-proposal-authority-invalid');
  }

  const expected = Object.freeze({
    repository: input.repository,
    sourceHead: input.expectedSourceHead,
    action,
  });
  const existing = validateExistingHandoff(input.existingRecoveryHandoff, expected);
  if (!existing.valid) {
    return blockedResult(input, sentinel.state, 'existing-recovery-handoff-invalid-or-conflicting');
  }
  if (existing.active && existing.sameIdentity) {
    return Object.freeze({
      ...base,
      state: AUTONOMOUS_FAILURE_HANDOFF_STATE.EXISTING_HANDOFF_OWNS_RECOVERY,
      recoveryHandoffDisposition: 'EXISTING_EXACT_HANDOFF_OWNS_RECOVERY',
      handoffCandidate: null,
      existingHandoffId: existing.handoffId,
      blockers: Object.freeze(['existing-autonomous-handoff-owns-recovery']),
      finalVerdict: 'AUTONOMOUS_FAILURE_SENTINEL_HANDOFF_DEDUPED',
    });
  }
  if (existing.terminal && existing.sameIdentity) {
    return Object.freeze({
      ...base,
      state: AUTONOMOUS_FAILURE_HANDOFF_STATE.WAITING_FOR_RECOVERY_RECEIPT,
      recoveryHandoffDisposition: 'TERMINAL_HANDOFF_REQUIRES_SENTINEL_RECONCILIATION',
      handoffCandidate: null,
      existingHandoffId: existing.handoffId,
      blockers: Object.freeze(['terminal-handoff-must-reconcile-before-new-recovery']),
      finalVerdict: 'AUTONOMOUS_FAILURE_SENTINEL_HANDOFF_WAITING_FOR_RECONCILIATION',
    });
  }

  const candidate = Object.freeze({
    schemaVersion: AUTONOMOUS_FAILURE_RECOVERY_HANDOFF_SCHEMA,
    handoffId: handoffId(expected),
    repository: input.repository,
    sourceHead: input.expectedSourceHead,
    recoveryGoalIssue: 1814,
    action,
    createdAtUtc: input.nowUtc,
    proofRefs,
    status: 'CANDIDATE_READY',
    operatorFirstDiscoveryDefect: sentinel.operatorFirstDiscoveryDefect === true,
    preserveRunningDispatchOwnership: true,
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

  return Object.freeze({
    ...base,
    state: AUTONOMOUS_FAILURE_HANDOFF_STATE.HANDOFF_CANDIDATE_READY,
    recoveryHandoffDisposition: 'CANONICAL_1814_HANDOFF_CANDIDATE_READY',
    handoffCandidate: candidate,
    existingHandoffId: '',
    blockers: Object.freeze([...sentinel.blockers]),
    finalVerdict: 'AUTONOMOUS_FAILURE_SENTINEL_HANDOFF_CANDIDATE_READY',
  });
}

export function planAutonomousFailureSentinelHandoffV1(rawInput = {}) {
  const input = snapshotInput(rawInput);
  if (!input) return blockedResult(null, '', 'handoff-envelope-not-data-only-or-closed-world');

  const repository = text(input.repository);
  const expectedSourceHead = text(input.expectedSourceHead).toLowerCase();
  const nowUtc = text(input.nowUtc);
  const nowMs = canonicalTimestamp(nowUtc);
  if (!REPOSITORY.test(repository) || !SHA.test(expectedSourceHead) || nowMs === null) {
    return blockedResult(input, '', 'handoff-identity-invalid');
  }

  const sentinelInput = Object.freeze({
    repository,
    expectedSourceHead,
    nowUtc,
    continuityPlan: input.continuityPlan,
    recoveryCapability: input.recoveryCapability,
    existingRecoveryDispatch: input.existingRecoveryDispatch,
    operatorObservedFailureAtUtc: input.operatorObservedFailureAtUtc,
    automationDetectedFailureAtUtc: input.automationDetectedFailureAtUtc,
  });
  const sentinel = planAutonomousFailureSentinelV1(sentinelInput);
  if (!sentinel || sentinel.schemaVersion !== AUTONOMOUS_FAILURE_SENTINEL_SCHEMA) {
    return blockedResult(input, '', 'sentinel-result-invalid');
  }

  return resultForSentinel(Object.freeze({ ...input, repository, expectedSourceHead, nowUtc }), sentinel);
}
