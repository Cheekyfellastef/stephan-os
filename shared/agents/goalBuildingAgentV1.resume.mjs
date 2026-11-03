import {
  GOAL_BUILDING_AGENT_SCHEMA_VERSION,
  SHA_40,
  boundedText,
  list,
  safeId,
  text,
  unique,
} from './goalBuildingAgentV1.contract.mjs';

export const GOAL_BUILDING_RESUME_SCHEMA_VERSION = `${GOAL_BUILDING_AGENT_SCHEMA_VERSION}.resume.v1`;

export const GOAL_BUILDING_RESUME_STATES = Object.freeze({
  RESUMABLE: 'RESUMABLE',
  APPROVAL_PARKED: 'APPROVAL_PARKED',
  BLOCKED_WITH_OWNER: 'BLOCKED_WITH_OWNER',
  REPROVE_REQUIRED: 'REPROVE_REQUIRED',
  SAFE_HOLD: 'SAFE_HOLD',
});

function sha(value) {
  const normalized = text(value).toLowerCase();
  return SHA_40.test(normalized) ? normalized : '';
}

function boundedPath(value) {
  const normalized = text(value).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || normalized.length > 240) return '';
  return normalized;
}

function normalizedLease(value = {}) {
  return Object.freeze({
    leaseId: safeId(value.leaseId),
    resourceId: boundedText(value.resourceId, '', 180),
    ownerId: safeId(value.ownerId),
    disposition: boundedText(value.disposition, 'UNKNOWN', 40).toUpperCase(),
  });
}

export function createGoalBuildResumeCheckpoint(input = {}) {
  const allowedPaths = unique(list(input.allowedPaths).map(boundedPath).filter(Boolean));
  const leases = list(input.leases).map(normalizedLease);
  const blockers = unique(list(input.blockers).map((value) => boundedText(value, '', 240)).filter(Boolean));
  const operatorGate = input.operatorGate === true;

  return Object.freeze({
    schemaVersion: GOAL_BUILDING_RESUME_SCHEMA_VERSION,
    checkpointId: safeId(input.checkpointId),
    missionId: safeId(input.missionId),
    goalId: safeId(input.goalId),
    canonicalOwnerId: safeId(input.canonicalOwnerId),
    repository: boundedText(input.repository, '', 160),
    prNumber: Number.isInteger(input.prNumber) && input.prNumber > 0 ? input.prNumber : null,
    branch: boundedText(input.branch, '', 180),
    protectedMainHead: sha(input.protectedMainHead),
    sourceHead: sha(input.sourceHead),
    sourceTree: sha(input.sourceTree),
    phase: boundedText(input.phase, 'UNKNOWN', 80).toUpperCase(),
    allowedPaths: Object.freeze(allowedPaths),
    leases: Object.freeze(leases),
    lastMaterialReceiptId: safeId(input.lastMaterialReceiptId),
    lastMaterialReceiptHead: sha(input.lastMaterialReceiptHead),
    blockers: Object.freeze(blockers),
    operatorGate,
    nextLegalAction: boundedText(input.nextLegalAction, '', 320),
    createdAtUtc: text(input.createdAtUtc),
    authority: Object.freeze({
      sourceBuildWithinExistingOwner: true,
      protectedMerge: false,
      readyTransition: false,
      runtimeMutation: false,
      windowsMutation: false,
      openClawMutation: false,
      credentialsOrSpending: false,
      destructiveGit: false,
      authorityWidening: false,
    }),
  });
}

export function evaluateGoalBuildResumeCheckpoint(checkpoint, current = {}) {
  const reasons = [];
  if (!checkpoint || checkpoint.schemaVersion !== GOAL_BUILDING_RESUME_SCHEMA_VERSION) reasons.push('resume-schema-invalid');
  if (!checkpoint?.checkpointId) reasons.push('checkpoint-id-invalid');
  if (!checkpoint?.missionId) reasons.push('mission-id-invalid');
  if (!checkpoint?.goalId) reasons.push('goal-id-invalid');
  if (!checkpoint?.canonicalOwnerId) reasons.push('canonical-owner-invalid');
  if (!checkpoint?.repository) reasons.push('repository-invalid');
  if (!checkpoint?.branch) reasons.push('branch-invalid');
  if (!checkpoint?.protectedMainHead) reasons.push('protected-main-head-invalid');
  if (!checkpoint?.sourceHead) reasons.push('source-head-invalid');
  if (!checkpoint?.nextLegalAction) reasons.push('next-legal-action-missing');
  if (!checkpoint?.createdAtUtc || !Number.isFinite(Date.parse(checkpoint.createdAtUtc))) reasons.push('created-at-invalid');

  const currentProtectedMain = sha(current.protectedMainHead);
  const currentSourceHead = sha(current.sourceHead);
  const currentOwnerId = safeId(current.canonicalOwnerId);
  const competingOwnerId = safeId(current.competingOwnerId);

  if (currentProtectedMain && currentProtectedMain !== checkpoint?.protectedMainHead) reasons.push('protected-main-moved-reprove-required');
  if (currentSourceHead && currentSourceHead !== checkpoint?.sourceHead) reasons.push('source-head-moved-reprove-required');
  if (currentOwnerId && currentOwnerId !== checkpoint?.canonicalOwnerId) reasons.push('canonical-owner-changed');
  if (competingOwnerId && competingOwnerId !== checkpoint?.canonicalOwnerId) reasons.push('competing-mutation-owner');

  for (const lease of list(checkpoint?.leases)) {
    if (!lease.leaseId || !lease.resourceId || !lease.ownerId) reasons.push('lease-identity-invalid');
    if (!['ACTIVE', 'RELEASED', 'PARKED'].includes(lease.disposition)) reasons.push('lease-disposition-invalid');
    if (lease.disposition === 'ACTIVE' && lease.ownerId !== checkpoint?.canonicalOwnerId) reasons.push('active-lease-owner-mismatch');
  }

  const authority = checkpoint?.authority || {};
  for (const forbidden of [
    'protectedMerge',
    'readyTransition',
    'runtimeMutation',
    'windowsMutation',
    'openClawMutation',
    'credentialsOrSpending',
    'destructiveGit',
    'authorityWidening',
  ]) {
    if (authority[forbidden] !== false) reasons.push(`authority-widened:${forbidden}`);
  }

  let state = GOAL_BUILDING_RESUME_STATES.RESUMABLE;
  if (reasons.some((reason) => reason.includes('moved-reprove-required'))) state = GOAL_BUILDING_RESUME_STATES.REPROVE_REQUIRED;
  else if (reasons.length > 0) state = GOAL_BUILDING_RESUME_STATES.SAFE_HOLD;
  else if (checkpoint.operatorGate) state = GOAL_BUILDING_RESUME_STATES.APPROVAL_PARKED;
  else if (checkpoint.blockers.length > 0) state = GOAL_BUILDING_RESUME_STATES.BLOCKED_WITH_OWNER;

  return Object.freeze({
    schemaVersion: GOAL_BUILDING_RESUME_SCHEMA_VERSION,
    checkpointId: checkpoint?.checkpointId || '',
    state,
    resumable: state === GOAL_BUILDING_RESUME_STATES.RESUMABLE,
    mustReprove: state === GOAL_BUILDING_RESUME_STATES.REPROVE_REQUIRED,
    operatorGate: checkpoint?.operatorGate === true,
    reasons: Object.freeze(unique(reasons)),
    canonicalOwnerId: checkpoint?.canonicalOwnerId || '',
    missionId: checkpoint?.missionId || '',
    goalId: checkpoint?.goalId || '',
    nextLegalAction: checkpoint?.nextLegalAction || '',
  });
}

export function reconstructGoalBuildHandoff(input = {}) {
  const checkpoint = createGoalBuildResumeCheckpoint(input.checkpoint || input);
  const evaluation = evaluateGoalBuildResumeCheckpoint(checkpoint, input.current || {});
  return Object.freeze({
    checkpoint,
    evaluation,
    handoff: Object.freeze({
      sameMissionRequired: true,
      sameGoalRequired: true,
      sameCanonicalOwnerRequired: true,
      duplicateBranchOrPrForbidden: true,
      freshProtectedMainReadRequired: true,
      freshSourceHeadReadRequired: true,
      preserveExistingLeasesAndReceipts: true,
      continueIndependentCapacityWhileParked: true,
      nextLegalAction: evaluation.nextLegalAction,
    }),
  });
}
