import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_OPERATOR_KNOWLEDGE_SCOPE,
  buildStephanosOperatorKnowledgeTwinV1,
} from './stephanosOperatorKnowledgeTwinV1.mjs';
import {
  buildStephanosOperatorAlignedDigitalHandsV1,
} from './stephanosOperatorAlignedDigitalHandsV1.mjs';

const now = '2026-09-25T18:00:00.000Z';

function twin(items) {
  return buildStephanosOperatorKnowledgeTwinV1({
    observedAtUtc: now,
    operatorConsent: {
      visibilityAllowed: true,
      learningCandidatesAllowed: true,
      durableLearningAllowed: true,
      scope: STEPHANOS_OPERATOR_KNOWLEDGE_SCOPE.ALL_AUTHORISED_CHATS,
    },
    items,
  });
}

function item(overrides = {}) {
  return {
    chatId: 'chat-001',
    messageId: 'msg-001',
    role: 'operator',
    sourceSurface: 'chatgpt-web',
    createdAtUtc: '2026-09-25T17:59:00.000Z',
    text: 'Use the existing Shared Workspace and avoid duplicate controllers.',
    knowledgeClass: 'DECISION',
    retentionIntent: 'REMEMBER_DURABLY',
    explicitOperatorTeaching: true,
    supersedesKnowledgeId: '',
    sourceRefs: ['project://stephan-os'],
    ...overrides,
  };
}

function request(knowledgeTwin, overrides = {}) {
  return {
    observedAtUtc: now,
    operatorIntent: {
      intentId: 'intent-001',
      statement: 'Build the shared chat while preserving the existing control plane.',
      sourceRefs: ['chat://chat-001'],
    },
    knowledgeTwin,
    proposedAction: {
      actionId: 'action-001',
      actionClass: 'DELEGATE_BOUNDED_WORK',
      summary: 'Delegate Shared Workspace integration work through the existing mission worker.',
      targetSystem: 'mission-worker',
      requestedBy: 'stephanos',
      sourceRefs: ['goal://1290'],
      ...overrides,
    },
  };
}

test('read-only and bounded delegation can proceed to executive planning when aligned', () => {
  const knowledgeTwin = twin([item()]);
  assert.equal(knowledgeTwin.valid, true);
  const result = buildStephanosOperatorAlignedDigitalHandsV1(request(knowledgeTwin));
  assert.equal(result.valid, true, result.validationErrors.join(', '));
  assert.equal(result.decision, 'ALIGNED_FOR_DELEGATION_PLANNING');
  assert.equal(result.requiredNextGate, 'STEPHANOS_EXECUTIVE_COMMAND_PLANE_V1');
  assert.equal(result.authority.commandExecutionAllowed, false);
  assert.equal(result.authority.dispatchThroughCanonicalFabricRequired, true);
});

test('reserved mutations remain operator approval gated even when aligned', () => {
  const knowledgeTwin = twin([item()]);
  const result = buildStephanosOperatorAlignedDigitalHandsV1(request(knowledgeTwin, {
    actionClass: 'MERGE',
    summary: 'Merge an exact-head reviewed pull request through the protected merge path.',
    targetSystem: 'review-fabric',
  }));
  assert.equal(result.valid, true);
  assert.equal(result.decision, 'OPERATOR_APPROVAL_REQUIRED');
  assert.equal(result.requiredNextGate, 'EXISTING_OPERATOR_APPROVAL_GATE');
  assert.equal(result.authority.mergeAllowed, false);
});

test('superseded guidance is excluded from current alignment evidence', () => {
  const oldTwin = twin([item({
    messageId: 'old',
    text: 'Use exactly two fixed builder lanes.',
  })]);
  const oldId = oldTwin.visibleItems[0].knowledgeId;
  const knowledgeTwin = twin([
    item({ messageId: 'old', text: 'Use exactly two fixed builder lanes.' }),
    item({
      messageId: 'new',
      createdAtUtc: '2026-09-25T17:59:30.000Z',
      text: 'Use elastic builder lanes instead of a fixed two lane ceiling.',
      knowledgeClass: 'CORRECTION',
      supersedesKnowledgeId: oldId,
    }),
  ]);
  const result = buildStephanosOperatorAlignedDigitalHandsV1(request(knowledgeTwin));
  assert.equal(result.valid, true);
  assert.equal(result.alignmentEvidence.some((entry) => entry.knowledgeId === oldId), false);
  assert.equal(result.alignmentEvidence.some((entry) => entry.text.includes('elastic builder lanes')), true);
});

test('explicit current negative guidance blocks conflicting delegation', () => {
  const knowledgeTwin = twin([item({
    text: 'Do not create duplicate controllers for the Shared Workspace.',
  })]);
  const result = buildStephanosOperatorAlignedDigitalHandsV1(request(knowledgeTwin, {
    summary: 'Create duplicate controllers for the Shared Workspace control plane.',
  }));
  assert.equal(result.valid, true);
  assert.equal(result.decision, 'CONFLICTING_OPERATOR_GUIDANCE');
  assert.equal(result.requiredNextGate, 'DO_NOT_DISPATCH_UNTIL_CONFLICT_IS_RESOLVED_BY_OPERATOR_OR_GOVERNED_CORRECTION');
  assert.ok(result.conflictingGuidance.length >= 1);
});

test('invalid or empty knowledge twin does not become guessed alignment', () => {
  const knowledgeTwin = twin([item({
    role: 'chatgpt',
    knowledgeClass: 'NONE',
    retentionIntent: 'CONTEXT_ONLY',
    explicitOperatorTeaching: false,
    text: 'Assistant context only.',
  })]);
  const result = buildStephanosOperatorAlignedDigitalHandsV1(request(knowledgeTwin));
  assert.equal(result.valid, true);
  assert.equal(result.decision, 'ALIGNMENT_EVIDENCE_INSUFFICIENT');
  assert.equal(result.authority.commandExecutionAllowed, false);
});

test('provider or caller cannot widen execution authority through action input', () => {
  const knowledgeTwin = twin([item()]);
  const hostile = request(knowledgeTwin);
  hostile.proposedAction.commandExecutionAllowed = true;
  const result = buildStephanosOperatorAlignedDigitalHandsV1(hostile);
  assert.equal(result.valid, false);
  assert.match(result.validationErrors.join('\n'), /proposedAction-invalid-exact-data-shape/);
});

test('accessors fail without executing caller code', () => {
  const knowledgeTwin = twin([item()]);
  let calls = 0;
  const proposedAction = request(knowledgeTwin).proposedAction;
  Object.defineProperty(proposedAction, 'summary', {
    enumerable: true,
    get() {
      calls += 1;
      throw new Error('must not execute');
    },
  });
  const input = request(knowledgeTwin);
  input.proposedAction = proposedAction;
  const result = buildStephanosOperatorAlignedDigitalHandsV1(input);
  assert.equal(result.valid, false);
  assert.equal(calls, 0);
});
