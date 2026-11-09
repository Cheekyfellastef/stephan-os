import { SHA_40, boundedText, list, safeId, text, unique } from './goalBuildingAgentV1.contract.mjs';
import {
  GOAL_BUILDING_RESUME_STATES,
  reconstructGoalBuildHandoff,
} from './goalBuildingAgentV1.resume.mjs';

export const GOAL_BUILDING_CONTINUATION_SCHEMA_VERSION = 'stephanos.goal-building-continuation.v1';

export const GOAL_BUILDING_CONTINUATION_STATES = Object.freeze({
  AUTO_CONTINUE_ELIGIBLE: 'AUTO_CONTINUE_ELIGIBLE',
  APPROVAL_PARKED_REFILL_ELIGIBLE: 'APPROVAL_PARKED_REFILL_ELIGIBLE',
  BLOCKED_ROUTE_OWNER_REQUIRED: 'BLOCKED_ROUTE_OWNER_REQUIRED',
  REPROVE_BEFORE_CONTINUE: 'REPROVE_BEFORE_CONTINUE',
  SAFE_HOLD: 'SAFE_HOLD',
});

export const NON_MATERIAL_CONTROLLER_SIGNALS = Object.freeze([
  'ACTION_DISPATCHED',
  'HEARTBEAT',
  'QUEUE_RECORD_WRITTEN',
  'STATUS_REFRESHED',
  'WORK_CLASSIFIED',
]);

const REPROOF_REASONS = new Set([
  'protected-main-moved-reprove-required',
  'source-head-moved-reprove-required',
]);

// Resource identities are custody keys, not display strings. Never permit a
// truncated or whitespace-normalized value to alias an ACTIVE lease.
function exactResourceId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 180
    && value === value.trim()
    && !/[\r\n\t]/.test(value)
    ? value : '';
}

function normalizeCandidate(candidate = {}) {
  return Object.freeze({
    goalId: safeId(candidate.goalId),
    missionId: safeId(candidate.missionId),
    canonicalOwnerId: safeId(candidate.canonicalOwnerId),
    resourceIds: Object.freeze(unique(list(candidate.resourceIds).map(exactResourceId).filter(Boolean))),
    nextLegalAction: boundedText(candidate.nextLegalAction, '', 320),
    schedulerEligible: candidate.schedulerEligible === true,
    qualifiedProviderAvailable: candidate.qualifiedProviderAvailable === true,
    operatorGate: candidate.operatorGate === true,
  });
}


// This is read-only eligibility, not source-lease admission. An old ACTIVE
// checkpoint cannot prove the lease still exists. The original #1557 owner
// must independently authenticate the same live lease before any execution.
function currentLeaseReadbackGaps(checkpoint, candidate, current = {}) {
  const readback = current?.leaseReadback;
  if (!readback || typeof readback !== 'object' || Array.isArray(readback)
    || !Array.isArray(readback.leases)) {
    return ['continuation-current-lease-readback-unproven'];
  }

  const gaps = [];
  const now = Date.now();
  const observed = Date.parse(readback.observedAtUtc);
  if (!Number.isFinite(observed) || observed > now + 30_000 || now - observed > 60_000) {
    gaps.push('continuation-current-lease-readback-stale');
  }
  if (readback.protectedMainHead !== checkpoint.protectedMainHead
    || readback.sourceHead !== checkpoint.sourceHead
    || readback.canonicalOwnerId !== checkpoint.canonicalOwnerId) {
    gaps.push('continuation-current-lease-readback-identity-mismatch');
  }

  const byResource = new Map();
  const leaseIds = new Set();
  for (const lease of readback.leases) {
    const leaseId = lease?.leaseId;
    const resourceId = exactResourceId(lease?.resourceId);
    const expiresAt = Date.parse(lease?.expiresAtUtc);
    if (typeof leaseId !== 'string' || !leaseId || safeId(leaseId) !== leaseId
      || !resourceId || typeof lease?.ownerId !== 'string'
      || safeId(lease.ownerId) !== lease.ownerId
      || lease.disposition !== 'ACTIVE'
      || !Number.isFinite(expiresAt) || expiresAt <= now) {
      gaps.push('continuation-current-lease-record-invalid');
    }
    if (leaseIds.has(leaseId) || (resourceId && byResource.has(resourceId))) {
      gaps.push('continuation-current-lease-identity-conflict');
    }
    leaseIds.add(leaseId);
    if (resourceId) byResource.set(resourceId, lease);
  }

  for (const resourceId of candidate.resourceIds) {
    const saved = list(checkpoint.leases).find((lease) =>
      lease.resourceId === resourceId && lease.ownerId === checkpoint.canonicalOwnerId
      && lease.disposition === 'ACTIVE');
    const live = byResource.get(resourceId);
    if (!saved || !live || live.leaseId !== saved.leaseId
      || live.resourceId !== saved.resourceId
      || live.ownerId !== saved.ownerId
      || live.disposition !== 'ACTIVE'
      || Date.parse(live.expiresAtUtc) <= now) {
      gaps.push('continuation-current-active-lease-unproven');
    }
  }
  return gaps;
}

// Presentation-only eligibility must never turn an unclaimed or receipt-free
// mission into an executable continuation. The existing #1557 controller still
// owns admission and lease acquisition; this check grants no source authority.
function continuationProofGaps(checkpoint, candidate) {
  const gaps = [];
  const hasActiveOwnedResourceLease = candidate.resourceIds.length > 0
    && candidate.resourceIds.every((resourceId) => list(checkpoint.leases).some((lease) =>
      lease.disposition === 'ACTIVE'
      && lease.ownerId === checkpoint.canonicalOwnerId
      && lease.resourceId === resourceId));
  if (!hasActiveOwnedResourceLease) gaps.push('continuation-active-owned-resource-lease-unproven');
  if (!SHA_40.test(text(checkpoint.sourceTree))) gaps.push('continuation-source-tree-unproven');
  if (!checkpoint.lastMaterialReceiptId
    || checkpoint.lastMaterialReceiptHead !== checkpoint.sourceHead) {
    gaps.push('continuation-exact-head-material-receipt-unproven');
  }
  return gaps;
}

export function projectStephanosGoalContinuation(input = {}) {
  const reconstructed = reconstructGoalBuildHandoff({
    checkpoint: input.checkpoint,
    current: input.current,
  });
  const evaluation = reconstructed.evaluation;
  const candidate = normalizeCandidate(input.schedulerCandidate || {});
  const reasons = [...evaluation.reasons];

  // The resume checkpoint normalizes lease resource strings for presentation.
  // Check the original input before normalization can erase an oversize suffix.
  // A single malformed scheduler key is a contradiction, even when another
  // valid candidate resource has an ACTIVE lease.
  if (list(input.schedulerCandidate?.resourceIds).some((id) => !exactResourceId(id))) {
    reasons.push('scheduler-resource-identity-invalid');
  }
  if (list(input.checkpoint?.leases).some((lease) => !exactResourceId(lease?.resourceId))) {
    reasons.push('checkpoint-lease-resource-identity-invalid');
  }

  // The resume checkpoint is a current custody snapshot, not a historical
  // event log. A lease identity cannot name two scopes or dispositions, and
  // one resource cannot be concurrently projected under multiple leases.
  // Refuse ambiguous snapshots rather than granting a continuation hint.
  const observedLeaseIds = new Set();
  const observedResources = new Set();
  for (const lease of list(input.checkpoint?.leases)) {
    const leaseId = lease?.leaseId;
    const resourceId = exactResourceId(lease?.resourceId);
    if (typeof leaseId !== 'string' || !leaseId || safeId(leaseId) !== leaseId) {
      reasons.push('checkpoint-lease-id-invalid');
    } else if (observedLeaseIds.has(leaseId)) {
      reasons.push('checkpoint-lease-identity-conflict');
    } else {
      observedLeaseIds.add(leaseId);
    }
    if (resourceId) {
      if (observedResources.has(resourceId)) reasons.push('checkpoint-lease-resource-conflict');
      else observedResources.add(resourceId);
    }
  }

  // A scheduler candidate must prove its three principal identities before a
  // status projection can request existing-controller continuation. Omitted
  // identities are not wildcards; this grants no runtime or source authority.
  if (!candidate.goalId) reasons.push('scheduler-goal-unproven');
  else if (candidate.goalId !== evaluation.goalId) reasons.push('scheduler-goal-mismatch');
  if (!candidate.missionId) reasons.push('scheduler-mission-unproven');
  else if (candidate.missionId !== evaluation.missionId) reasons.push('scheduler-mission-mismatch');
  if (!candidate.canonicalOwnerId) reasons.push('scheduler-owner-unproven');
  else if (candidate.canonicalOwnerId !== evaluation.canonicalOwnerId) reasons.push('scheduler-owner-mismatch');

  let state = GOAL_BUILDING_CONTINUATION_STATES.SAFE_HOLD;
  let mayRequestExistingControllerContinuation = false;
  let mayRequestCapacityRefill = false;

  if (reasons.length > 0) {
    const exclusivelyReproof = evaluation.mustReprove && reasons.every((reason) => REPROOF_REASONS.has(reason));
    state = exclusivelyReproof
      ? GOAL_BUILDING_CONTINUATION_STATES.REPROVE_BEFORE_CONTINUE
      : GOAL_BUILDING_CONTINUATION_STATES.SAFE_HOLD;
    mayRequestCapacityRefill = exclusivelyReproof;
  } else if (evaluation.state === GOAL_BUILDING_RESUME_STATES.RESUMABLE) {
    const proofGaps = [...continuationProofGaps(reconstructed.checkpoint, candidate),
      ...currentLeaseReadbackGaps(reconstructed.checkpoint, candidate, input.current)];
    if (proofGaps.length > 0) {
      // Only this lane is unqualified. Reproof belongs to the original owner
      // while resource-disjoint work remains available to existing refill.
      reasons.push(...proofGaps);
      state = GOAL_BUILDING_CONTINUATION_STATES.BLOCKED_ROUTE_OWNER_REQUIRED;
      mayRequestCapacityRefill = true;
    } else if (candidate.schedulerEligible && candidate.qualifiedProviderAvailable && !candidate.operatorGate) {
      state = GOAL_BUILDING_CONTINUATION_STATES.AUTO_CONTINUE_ELIGIBLE;
      mayRequestExistingControllerContinuation = true;
    } else {
      state = GOAL_BUILDING_CONTINUATION_STATES.BLOCKED_ROUTE_OWNER_REQUIRED;
      mayRequestCapacityRefill = true;
    }
  } else if (evaluation.state === GOAL_BUILDING_RESUME_STATES.APPROVAL_PARKED) {
    state = GOAL_BUILDING_CONTINUATION_STATES.APPROVAL_PARKED_REFILL_ELIGIBLE;
    mayRequestCapacityRefill = true;
  } else if (evaluation.state === GOAL_BUILDING_RESUME_STATES.REPROVE_REQUIRED) {
    state = GOAL_BUILDING_CONTINUATION_STATES.REPROVE_BEFORE_CONTINUE;
    mayRequestCapacityRefill = true;
  } else if (evaluation.state === GOAL_BUILDING_RESUME_STATES.BLOCKED_WITH_OWNER) {
    state = GOAL_BUILDING_CONTINUATION_STATES.BLOCKED_ROUTE_OWNER_REQUIRED;
    mayRequestCapacityRefill = true;
  }

  const materialProgressRequiredBeforeControllerReturn = state !== GOAL_BUILDING_CONTINUATION_STATES.SAFE_HOLD;

  return Object.freeze({
    schemaVersion: GOAL_BUILDING_CONTINUATION_SCHEMA_VERSION,
    state,
    missionId: evaluation.missionId,
    goalId: evaluation.goalId,
    canonicalOwnerId: evaluation.canonicalOwnerId,
    checkpointId: evaluation.checkpointId,
    protectedMainHead: text(reconstructed.checkpoint.protectedMainHead),
    sourceHead: text(reconstructed.checkpoint.sourceHead),
    nextLegalAction: evaluation.nextLegalAction,
    mayRequestExistingControllerContinuation,
    mayRequestCapacityRefill,
    materialProgressRequiredBeforeControllerReturn,
    nonMaterialSignalsDoNotSatisfyProgress: NON_MATERIAL_CONTROLLER_SIGNALS,
    continuationTarget: mayRequestExistingControllerContinuation ? 'EXISTING_1557_CONTINUITY_CONTROLLER' : '',
    refillTarget: mayRequestCapacityRefill ? 'EXISTING_1947_CAPACITY_REFILL' : '',
    duplicateControllerForbidden: true,
    duplicateMissionForbidden: true,
    duplicateBranchOrPrForbidden: true,
    protectedMergeAuthority: false,
    runtimeMutationAuthority: false,
    reasons: Object.freeze(unique(reasons)),
  });
}
