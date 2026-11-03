import {
  createSharedWorkspaceHandoffRecord,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import { boundedText, list, safeId, text } from './goalBuildingAgentV1.contract.mjs';
import { projectStephanosGoalContinuation } from './goalBuildingAgentV1.continuation.mjs';

export const GOAL_BUILDING_SHARED_WORKSPACE_SCHEMA_VERSION = 'stephanos.goal-building-shared-workspace.v1';

function recordId(input = {}) {
  return safeId(input.handoffId)
    || safeId(`goal-build-${input.checkpoint?.checkpointId || input.checkpointId || 'continuation'}`)
    || 'goal-build-continuation';
}

function proofRefs(input = {}) {
  return list(input.proofRefs).map(String).filter(Boolean);
}

export function createGoalBuildingSharedWorkspaceContinuationRecord(input = {}) {
  const continuation = input.continuation || projectStephanosGoalContinuation({
    checkpoint: input.checkpoint,
    current: input.current,
    schedulerCandidate: input.schedulerCandidate,
  });
  const refs = proofRefs(input);
  const handoffId = recordId(input);
  const target = continuation.mayRequestExistingControllerContinuation
    ? 'mission-orchestrator'
    : continuation.mayRequestCapacityRefill
      ? 'goal-building-agent'
      : 'goal-building-agent';

  const body = JSON.stringify({
    schemaVersion: GOAL_BUILDING_SHARED_WORKSPACE_SCHEMA_VERSION,
    checkpoint: input.checkpoint || null,
    continuation,
    canonicalTargets: {
      scheduler: '1556',
      continuityController: '1557',
      capacityRefill: '1947',
      goalBuildingAgent: '2002',
    },
    constraints: {
      sameMissionRequired: true,
      sameCanonicalOwnerRequired: true,
      duplicateControllerForbidden: true,
      duplicateMissionForbidden: true,
      duplicateBranchOrPrForbidden: true,
      protectedMergeAuthority: false,
      runtimeMutationAuthority: false,
    },
  });

  return createSharedWorkspaceHandoffRecord({
    handoffId,
    participantId: 'goal-building-agent',
    fromParticipantId: 'goal-building-agent',
    toParticipantId: target,
    timestampUtc: text(input.timestampUtc, new Date().toISOString()),
    correlationId: safeId(input.correlationId) || continuation.missionId || handoffId,
    relatedIssue: '#2002',
    relatedPr: '#2003',
    summary: boundedText(
      input.summary || `Goal ${continuation.goalId || 'unknown'} continuation state: ${continuation.state}.`,
      'Goal-building continuation state published.',
      300,
    ),
    body,
    proofRefs: refs,
  });
}

export function validateGoalBuildingSharedWorkspaceContinuationRecord(input = {}) {
  const record = input.record || createGoalBuildingSharedWorkspaceContinuationRecord(input);
  const validation = validateSharedWorkspaceRecord(record, input.validationOptions || {});
  const body = (() => {
    try { return JSON.parse(record.body || '{}'); } catch { return {}; }
  })();
  const reasons = [...validation.errors];
  if (body?.schemaVersion !== GOAL_BUILDING_SHARED_WORKSPACE_SCHEMA_VERSION) reasons.push('goal-building-workspace-schema-invalid');
  if (!body?.checkpoint) reasons.push('goal-building-checkpoint-missing');
  if (!body?.continuation) reasons.push('goal-building-continuation-missing');
  if (body?.constraints?.protectedMergeAuthority !== false) reasons.push('protected-merge-authority-widened');
  if (body?.constraints?.runtimeMutationAuthority !== false) reasons.push('runtime-mutation-authority-widened');
  if (body?.constraints?.duplicateControllerForbidden !== true) reasons.push('duplicate-controller-guard-missing');
  return Object.freeze({
    valid: reasons.length === 0,
    reasons: Object.freeze([...new Set(reasons)]),
    record,
    continuation: body?.continuation || null,
    checkpoint: body?.checkpoint || null,
  });
}

export async function publishGoalBuildingSharedWorkspaceContinuation(input = {}) {
  const checked = validateGoalBuildingSharedWorkspaceContinuationRecord(input);
  if (!checked.valid) return Object.freeze({ ok: false, reason: checked.reasons[0] || 'GOAL_BUILDING_SHARED_WORKSPACE_RECORD_BLOCKED', validation: checked });
  const result = await writeAtomicJson(
    input.root,
    ['handoffs', `${checked.record.handoffId}.json`],
    checked.record,
    input.validationOptions || {},
  );
  return Object.freeze({
    ...result,
    handoffId: checked.record.handoffId,
    continuationState: checked.continuation?.state || '',
    missionId: checked.continuation?.missionId || '',
    goalId: checked.continuation?.goalId || '',
    continuationTarget: checked.continuation?.continuationTarget || '',
    refillTarget: checked.continuation?.refillTarget || '',
  });
}
