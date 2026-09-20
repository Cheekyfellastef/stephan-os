import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStephanosRepairLearningCompletionV1,
} from './stephanosRepairLearningContinuationV1.mjs';

const VERIFIED_AT = '2026-09-20T12:45:00.000Z';

function gap() {
  return {
    gapId: 'gap-procedural-memory-001',
    gapSignature: 'gap-signature-procedural-memory-001',
    rootCauseClass: 'TOOL_OR_DATA_SOURCE_MISSING',
    affectedCapability: 'project-state-retrieval',
    summary: 'Current project truth was not available through the expected capability path.',
    occurrenceCount: 2,
    lastSeenAtUtc: '2026-09-20T12:40:00.000Z',
  };
}

function goal() {
  return {
    goalId: 'goal-1903',
    issueNumber: 1903,
    repository: 'Cheekyfellastef/stephan-os',
    sourceHead: '0123456789abcdef0123456789abcdef01234567',
  };
}

test('proven repair is projected into reusable procedural memory before flywheel completion', () => {
  const result = buildStephanosRepairLearningCompletionV1({
    gapObservation: gap(),
    existingGoalRecord: goal(),
    evidenceRefs: ['proof/replay-procedural-memory-001', 'evidence/repair-current-head'],
    verifiedAtUtc: VERIFIED_AT,
  });

  assert.equal(result.status, 'REPAIR_VERIFIED_AND_LEARNING_READY');
  assert.equal(result.blocker, '');
  assert.equal(result.successfulRepairRecord.recordClass, 'SUCCESSFUL_REPAIR');
  assert.equal(result.reusableMethodRecord.recordClass, 'REUSABLE_METHOD');
  assert.equal(result.proceduralMemoryProjection.valid, true);
  assert.equal(result.proceduralMemoryProjection.verdict, 'PROCEDURAL_MEMORY_PROJECTED');
  assert.equal(result.proceduralMemoryProjection.reusableMethods.length, 1);
  assert.equal(
    result.proceduralMemoryProjection.reusableMethods[0].recordId,
    result.proceduralMethodRecord.recordId,
  );
  assert.equal(result.proceduralMethodRecord.validationState, 'VALIDATED');
  assert.equal(result.proceduralMethodRecord.authorityClass, 'SHARED_AUTHORITY');
  assert.equal(result.proceduralMethodRecord.state, 'CURRENT');
  assert.equal(result.proceduralMethodRecord.freshness, 'FRESH');
  assert.equal(result.proceduralMethodRecord.validatedAtUtc, VERIFIED_AT);
  assert.deepEqual(result.proceduralMethodRecord.prerequisiteRefs, [
    'goal://1903',
    'component://project-state-retrieval',
  ]);
  assert.deepEqual(result.proceduralMethodRecord.evidenceRefs, [
    'proof://replay-procedural-memory-001',
    'evidence://repair-current-head',
  ]);
  assert.equal(result.proceduralMethodRecord.steps.length, 5);
  assert.equal(result.reusableCapabilityId, result.proceduralMethodRecord.recordId);
  assert.equal(result.proceduralMemoryProjectionId, result.proceduralMemoryProjection.projectionId);
  assert.equal(result.proceduralMemoryProjection.authority.proceduralMemoryWriteAllowed, false);
  assert.equal(result.authority.memoryMutationAllowed, false);
  assert.equal(result.authority.methodPromotionAllowed, false);
});

test('procedural method identity is deterministic for the same proven repair', () => {
  const input = {
    gapObservation: gap(),
    existingGoalRecord: goal(),
    evidenceRefs: ['proof/replay-procedural-memory-001'],
    verifiedAtUtc: VERIFIED_AT,
  };
  const left = buildStephanosRepairLearningCompletionV1(input);
  const right = buildStephanosRepairLearningCompletionV1(input);

  assert.equal(left.status, 'REPAIR_VERIFIED_AND_LEARNING_READY');
  assert.equal(left.proceduralMethodRecord.recordId, right.proceduralMethodRecord.recordId);
  assert.equal(left.proceduralMethodRecord.methodId, right.proceduralMethodRecord.methodId);
  assert.equal(left.proceduralMemoryProjectionId, right.proceduralMemoryProjectionId);
  assert.equal(left.reusableCapabilityId, right.reusableCapabilityId);
});
