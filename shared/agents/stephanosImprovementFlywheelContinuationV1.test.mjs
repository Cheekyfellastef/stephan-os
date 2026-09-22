import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStephanosImprovementFlywheelContinuationV1 } from './stephanosImprovementFlywheelContinuationV1.mjs';

const SOURCE_HEAD = '0123456789abcdef0123456789abcdef01234567';

function gap(overrides = {}) {
  return {
    gapId: 'gap-tool-access-001',
    gapSignature: 'tool-or-data-source-missing:project-truth',
    rootCauseClass: 'TOOL_OR_DATA_SOURCE_MISSING',
    affectedCapability: 'project-truth-answering',
    summary: 'Current project truth cannot be reached through the active capability path.',
    occurrenceCount: 1,
    lastSeenAtUtc: '2026-09-20T12:30:00.000Z',
    ...overrides,
  };
}

function goal(overrides = {}) {
  return {
    goalId: 'goal-1308',
    issueNumber: 1308,
    title: 'Goal: Project Intelligence and Conversational Understanding V1',
    status: 'READY',
    repository: 'Cheekyfellastef/stephan-os',
    sourceHead: SOURCE_HEAD,
    operatorAuthorizationState: 'PROPOSAL_ONLY',
    ...overrides,
  };
}

function build(goalOverrides = {}) {
  return buildStephanosImprovementFlywheelContinuationV1({
    gapObservation: gap(),
    existingGoalRecord: goal(goalOverrides),
    evidenceRefs: ['proof/qa-gap-evidence'],
  });
}

test('owned repair remains attached when bounded source implementation authority has not been proven', () => {
  const result = build();
  assert.equal(result.status, 'IMPROVEMENT_PROPOSAL_READY_EXISTING_OWNER');
  assert.equal(result.proposalReady, true);
  assert.equal(result.executionPlan.action, 'ATTACH_TO_EXISTING_GOAL');
  assert.equal(result.executionDisposition, 'ATTACH_AND_AWAIT_REQUIRED_SOURCE_AUTHORITY');
  assert.equal(result.authority.dispatchAllowed, false);
  assert.equal(result.authority.mergeAllowed, false);
});

test('owned repair routes into existing construction machinery when bounded source implementation authority already exists', () => {
  const result = build({ operatorAuthorizationState: 'SOURCE_IMPLEMENTATION_AUTHORIZED' });
  assert.equal(result.status, 'IMPROVEMENT_PROPOSAL_READY_EXISTING_OWNER');
  assert.equal(result.proposalReady, true);
  assert.equal(result.executionPlan.action, 'IMPLEMENT_UNDER_EXISTING_AUTHORITY');
  assert.equal(result.executionDisposition, 'ROUTE_IMPLEMENTATION_UNDER_EXISTING_AUTHORITY');
  assert.equal(result.nextAction, 'ROUTE_TO_EXISTING_GOAL_CONSTRUCTION_MACHINERY');
  assert.equal(result.executionPlan.newSchedulerOrWorkerAllowed, false);
  assert.equal(result.authority.dispatchAllowed, false);
  assert.equal(result.authority.mergeAllowed, false);
  assert.equal(result.authority.deploymentAllowed, false);
  assert.equal(result.authority.runtimeMutationAllowed, false);
});

test('an unrelated or higher-risk authorization cannot be reinterpreted as bounded source implementation authority', () => {
  const result = build({ operatorAuthorizationState: 'WINDOWS_RUNTIME_MUTATION_AUTHORIZED' });
  assert.equal(result.executionPlan.action, 'ATTACH_TO_EXISTING_GOAL');
  assert.equal(result.executionDisposition, 'ATTACH_AND_AWAIT_REQUIRED_SOURCE_AUTHORITY');
  assert.equal(result.authority.runtimeMutationAllowed, false);
});

test('missing exact source identity stays held before any implementation routing decision', () => {
  const result = buildStephanosImprovementFlywheelContinuationV1({
    gapObservation: gap(),
    existingGoalRecord: goal({ sourceHead: '' }),
    evidenceRefs: ['proof/qa-gap-evidence'],
  });
  assert.equal(result.status, 'EXACT_SOURCE_HEAD_REQUIRED');
  assert.equal(result.executionPlan, null);
  assert.equal(result.executionDisposition, 'HOLD');
  assert.equal(result.nextAction, 'REFRESH_EXACT_SOURCE_IDENTITY');
});
