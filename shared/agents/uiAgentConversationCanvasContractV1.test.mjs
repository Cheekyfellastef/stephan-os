import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UI_AGENT_CANONICAL_EXPERIENCE_CONTRACT_SCHEMA_VERSION,
} from './uiAgentCanonicalExperienceContractV1.mjs';
import {
  UI_AGENT_CONVERSATION_CANVAS_ACCEPTANCE_SURFACES,
  UI_AGENT_CONVERSATION_CANVAS_BENCHMARK_METRICS,
  UI_AGENT_CONVERSATION_CANVAS_PRIMITIVES,
  UI_AGENT_CONVERSATION_CANVAS_SCENARIOS,
  UI_AGENT_CONVERSATION_CANVAS_SEMANTIC_SCHEMA,
  UI_AGENT_CONVERSATION_CANVAS_STATES,
  buildUiAgentConversationCanvasContractV1,
} from './uiAgentConversationCanvasContractV1.mjs';

function parent(overrides = {}) {
  return {
    schemaVersion: UI_AGENT_CANONICAL_EXPERIENCE_CONTRACT_SCHEMA_VERSION,
    valid: true,
    state: 'CANONICAL_DESIGN_MAP_READY_FOR_IMPLEMENTATION_PLANNING',
    contractId: 'ui-experience-1234567890abcdef12345678',
    surfaces: [
      { surfaceId: 'ai-console' },
      { surfaceId: 'desktop-browser' },
      { surfaceId: 'ipad' },
      { surfaceId: 'iphone' },
    ],
    ...overrides,
  };
}

test('Conversation Canvas consumes the canonical UI contract and binds to Stephanos rich semantic truth', () => {
  const result = buildUiAgentConversationCanvasContractV1({ experienceContract: parent() });
  assert.equal(result.valid, true, result.validationErrors.join(','));
  assert.match(result.contractId, /^conversation-canvas-[0-9a-f]{24}$/);
  assert.equal(result.semanticResponseSchema, UI_AGENT_CONVERSATION_CANVAS_SEMANTIC_SCHEMA);
  assert.equal(result.semanticResponseSchema, 'stephanos.rich-conversational-response.v1');
  assert.equal(result.truthOwner, 'stephanos');
  assert.equal(result.uiAgentRole, 'governed-specialist');
  assert.equal(result.state, 'CONVERSATION_CANVAS_CONTRACT_READY_FOR_BOUNDED_IMPLEMENTATION');
  assert.equal(result.universalSuperiorityClaimAllowed, false);
  assert.equal(result.experienceGoal, 'STEPHANOS_NATIVE_SUPERIORITY_FOR_REPRESENTATIVE_STEPHANOS_TASKS');
});

test('Conversation Canvas exposes native semantic primitives, responsive states and the required systems-expert scenarios', () => {
  const result = buildUiAgentConversationCanvasContractV1({ experienceContract: parent() });
  assert.deepEqual(result.primitives, UI_AGENT_CONVERSATION_CANVAS_PRIMITIVES);
  assert.deepEqual(result.states, UI_AGENT_CONVERSATION_CANVAS_STATES);
  assert.deepEqual(result.acceptanceSurfaces, UI_AGENT_CONVERSATION_CANVAS_ACCEPTANCE_SURFACES);
  assert.deepEqual(result.scenarios, UI_AGENT_CONVERSATION_CANVAS_SCENARIOS);
  assert.equal(result.presentationRules.summaryFirst, true);
  assert.equal(result.presentationRules.progressiveDisclosure, true);
  assert.equal(result.presentationRules.touchFirstOnIpad, true);
  assert.equal(result.presentationRules.phoneWidthSupported, true);
  assert.equal(result.presentationRules.reducedMotionRequired, true);
  assert.equal(result.presentationRules.genericScrollingMessageLogIsSufficient, false);
  assert.equal(result.presentationRules.decorationMaySubstituteForReasoning, false);
});

test('flagship acceptance keeps real served-head, cross-device, evidence, action and UI-Agent-to-Stephanos proof unsatisfied until observed', () => {
  const result = buildUiAgentConversationCanvasContractV1({ experienceContract: parent() });
  const proofClasses = result.proofPlan.map((entry) => entry.proofClass);
  for (const required of [
    'REAL_SERVED_HEAD',
    'DESKTOP_INTERACTION',
    'IPAD_TOUCH_FIRST',
    'PHONE_WIDTH',
    'REDUCED_MOTION',
    'LONG_CONVERSATION_NAVIGATION',
    'LOADING_PARTIAL_ERROR_STATES',
    'EVIDENCE_PROGRESSIVE_DISCLOSURE',
    'SAFE_ACTION_APPROVAL_CARDS',
    'REAL_UI_AGENT_TO_STEPHANOS_QA_AND_EVIDENCE_RETURN',
    'GENERIC_TEXT_BASELINE_COMPARISON',
  ]) assert.ok(proofClasses.includes(required), `missing proof class ${required}`);
  assert.ok(result.proofPlan.every((entry) => entry.required === true && entry.satisfied === false && entry.evidenceRef === null));
});

test('benchmark contract measures task comprehension and navigation rather than claiming universal chatbot superiority', () => {
  const result = buildUiAgentConversationCanvasContractV1({ experienceContract: parent() });
  assert.deepEqual(result.benchmarkMetrics, UI_AGENT_CONVERSATION_CANVAS_BENCHMARK_METRICS);
  for (const metric of ['TIME_TO_UNDERSTAND', 'NAVIGATION_HOPS', 'NEED_TO_LEAVE_CONVERSATION', 'EVIDENCE_INTELLIGIBILITY', 'NEXT_ACTION_CLARITY', 'CONTINUITY', 'OPERATOR_PREFERENCE']) {
    assert.ok(result.benchmarkMetrics.includes(metric));
  }
  assert.equal(result.universalSuperiorityClaimAllowed, false);
});

test('UI Agent remains answerable to Stephanos and cannot self-promote, self-approve, hide evidence or create private UI truth', () => {
  const result = buildUiAgentConversationCanvasContractV1({ experienceContract: parent() });
  assert.equal(result.authority.stephanosOwnsMission, true);
  assert.equal(result.authority.stephanosOwnsConversationSemantics, true);
  assert.equal(result.authority.stephanosOwnsSystemTruth, true);
  assert.equal(result.authority.stephanosOwnsFinalOperatorExplanation, true);
  assert.equal(result.authority.uiAgentMayResearchAuditProposeImplementBounded, true);
  assert.equal(result.authority.uiAgentMaySelfPromote, false);
  assert.equal(result.authority.uiAgentMaySelfApprove, false);
  assert.equal(result.authority.uiAgentMayRedefineStephanosIdentity, false);
  assert.equal(result.authority.uiAgentMayHideEvidence, false);
  assert.equal(result.authority.uiAgentMayChangeAuthority, false);
  assert.equal(result.authority.uiAgentMayCreatePrivateUiTruth, false);
  assert.equal(result.authority.runtimeMutationAllowedByContract, false);
});

test('Conversation Canvas fails closed without required desktop/iPad/phone parent surfaces', () => {
  for (const missing of ['desktop-browser', 'ipad', 'iphone']) {
    const result = buildUiAgentConversationCanvasContractV1({
      experienceContract: parent({ surfaces: parent().surfaces.filter((entry) => entry.surfaceId !== missing) }),
    });
    assert.equal(result.valid, false);
    assert.deepEqual(result.validationErrors, [`required-surface-missing:${missing}`]);
    assert.equal(result.state, 'SAFE_HOLD');
    assert.equal(result.authority.uiAgentMayCreatePrivateUiTruth, false);
  }
});
