import { boundedText, list, safeId, text, unique } from './goalBuildingAgentV1.contract.mjs';
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

function normalizeCandidate(candidate = {}) {
  return Object.freeze({
    goalId: safeId(candidate.goalId),
    missionId: safeId(candidate.missionId),
    canonicalOwnerId: safeId(candidate.canonicalOwnerId),
    resourceIds: Object.freeze(unique(list(candidate.resourceIds).map((value) => boundedText(value, '', 180)).filter(Boolean))),
    nextLegalAction: boundedText(candidate.nextLegalAction, '', 320),
    schedulerEligible: candidate.schedulerEligible === true,
    qualifiedProviderAvailable: candidate.qualifiedProviderAvailable === true,
    operatorGate: candidate.operatorGate === true,
  });
}

export function projectStephanosGoalContinuation(input = {}) {
  const reconstructed = reconstructGoalBuildHandoff({
    checkpoint: input.checkpoint,
    current: input.current,
  });
  const evaluation = reconstructed.evaluation;
  const candidate = normalizeCandidate(input.schedulerCandidate || {});
  const reasons = [...evaluation.reasons];

  if (candidate.goalId && candidate.goalId !== evaluation.goalId) reasons.push('scheduler-goal-mismatch');
  if (candidate.missionId && candidate.missionId !== evaluation.missionId) reasons.push('scheduler-mission-mismatch');
  if (candidate.canonicalOwnerId && candidate.canonicalOwnerId !== evaluation.canonicalOwnerId) reasons.push('scheduler-owner-mismatch');

  let state = GOAL_BUILDING_CONTINUATION_STATES.SAFE_HOLD;
  let mayRequestExistingControllerContinuation = false;
  let mayRequestCapacityRefill = false;

  if (reasons.length > 0) {
    state = evaluation.mustReprove
      ? GOAL_BUILDING_CONTINUATION_STATES.REPROVE_BEFORE_CONTINUE
      : GOAL_BUILDING_CONTINUATION_STATES.SAFE_HOLD;
  } else if (evaluation.state === GOAL_BUILDING_RESUME_STATES.RESUMABLE) {
    if (candidate.schedulerEligible && candidate.qualifiedProviderAvailable && !candidate.operatorGate) {
      state = GOAL_BUILDING_CONTINUATION_STATES.AUTO_CONTINUE_ELIGIBLE;
      mayRequestExistingControllerContinuation = true;
    } else {
      state = GOAL_BUILDING_CONTINUATION_STATES.BLOCKED_ROUTE_OWNER_REQUIRED;
    }
  } else if (evaluation.state === GOAL_BUILDING_RESUME_STATES.APPROVAL_PARKED) {
    state = GOAL_BUILDING_CONTINUATION_STATES.APPROVAL_PARKED_REFILL_ELIGIBLE;
    mayRequestCapacityRefill = true;
  } else if (evaluation.state === GOAL_BUILDING_RESUME_STATES.REPROVE_REQUIRED) {
    state = GOAL_BUILDING_CONTINUATION_STATES.REPROVE_BEFORE_CONTINUE;
  } else if (evaluation.state === GOAL_BUILDING_RESUME_STATES.BLOCKED_WITH_OWNER) {
    state = GOAL_BUILDING_CONTINUATION_STATES.BLOCKED_ROUTE_OWNER_REQUIRED;
  }

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
