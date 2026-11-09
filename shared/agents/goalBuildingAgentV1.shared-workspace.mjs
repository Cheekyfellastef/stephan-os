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
  // A handoff is a custody-preserving hint, never permission to switch mission,
  // owner, controller, branch or PR. Check every declared invariant on READ,
  // including records written by another producer or mutated after publication.
  const requiredGuards = [
    ['sameMissionRequired', 'same-mission-guard-missing'],
    ['sameCanonicalOwnerRequired', 'same-canonical-owner-guard-missing'],
    ['duplicateControllerForbidden', 'duplicate-controller-guard-missing'],
    ['duplicateMissionForbidden', 'duplicate-mission-guard-missing'],
    ['duplicateBranchOrPrForbidden', 'duplicate-branch-or-pr-guard-missing'],
  ];
  for (const [field, reason] of requiredGuards) {
    if (body?.constraints?.[field] !== true) reasons.push(reason);
  }
  // Declared guards cannot substitute for the identity they claim to bind.
  // Keep this a read-only handoff consistency test: no grants or execution.
  const checkpoint = body?.checkpoint;
  const continuation = body?.continuation;
  if (checkpoint && continuation) {
    for (const [field, reason] of [
      ['missionId', 'handoff-mission-identity-mismatch'],
      ['goalId', 'handoff-goal-identity-mismatch'],
      ['canonicalOwnerId', 'handoff-owner-identity-mismatch'],
      ['checkpointId', 'handoff-checkpoint-identity-mismatch'],
      ['protectedMainHead', 'handoff-main-identity-mismatch'],
      ['sourceHead', 'handoff-source-identity-mismatch'],
    ]) {
      if (typeof checkpoint[field] !== 'string' || !checkpoint[field]
        || continuation[field] !== checkpoint[field]) reasons.push(reason);
    }
    if (continuation.mayRequestExistingControllerContinuation === true) {
      if (continuation.state !== 'AUTO_CONTINUE_ELIGIBLE'
        || continuation.continuationTarget !== 'EXISTING_1557_CONTINUITY_CONTROLLER') {
        reasons.push('handoff-continuity-controller-target-invalid');
      }
    } else if (continuation.continuationTarget) {
      reasons.push('handoff-continuity-controller-target-invalid');
    }
    if (continuation.mayRequestCapacityRefill === true) {
      if (continuation.refillTarget !== 'EXISTING_1947_CAPACITY_REFILL') {
        reasons.push('handoff-capacity-refill-target-invalid');
      }
    } else if (continuation.refillTarget) {
      reasons.push('handoff-capacity-refill-target-invalid');
    }
    if (record.toParticipantId !== (
      continuation.mayRequestExistingControllerContinuation === true
        ? 'mission-orchestrator' : 'goal-building-agent'
    )) reasons.push('handoff-receiver-identity-mismatch');
  }

  // Canonical targets are fixed original owners, never caller-selectable.
  for (const [key, id] of [
    ['scheduler', '1556'],
    ['continuityController', '1557'],
    ['capacityRefill', '1947'],
    ['goalBuildingAgent', '2002'],
  ]) {
    if (body?.canonicalTargets?.[key] !== id) reasons.push(`handoff-canonical-target-mismatch:${key}`);
  }

  // Bind the record's stored custody snapshot to the original caller-supplied
  // checkpoint whenever a reference is available; this is NOT authentication
  // of that reference or an independent source lease.
  if (input.checkpoint && checkpoint) {
    for (const field of [
      'checkpointId', 'missionId', 'goalId', 'canonicalOwnerId',
      'repository', 'prNumber', 'branch', 'protectedMainHead',
      'sourceHead', 'sourceTree', 'allowedPaths', 'leases',
    ]) {
      if (JSON.stringify(checkpoint[field]) !== JSON.stringify(input.checkpoint[field])) {
        reasons.push(`handoff-original-checkpoint-mismatch:${field}`);
      }
    }
  } else if (input.record && !input.checkpoint) {
    reasons.push('handoff-original-checkpoint-reference-unproven');
  }
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
