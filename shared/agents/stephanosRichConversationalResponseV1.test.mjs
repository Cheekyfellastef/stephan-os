import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_RICH_CONVERSATIONAL_RESPONSE_FIELDS,
  STEPHANOS_RICH_CONVERSATIONAL_RESPONSE_SCHEMA_VERSION,
  buildStephanosRichConversationalResponseV1,
} from './stephanosRichConversationalResponseV1.mjs';

function question(overrides = {}) {
  return {
    questionId: 'stephanos-round-001-q02',
    roundId: 'stephanos-round-001',
    questionClass: 'ARCHITECTURE_AND_RELATIONSHIPS',
    ...overrides,
  };
}

function answer(overrides = {}) {
  return {
    answerText: 'Mission Scheduler coordinates governed work while Stephanos owns the product explanation and evidence-bound conversational semantics.',
    epistemicState: 'INFERRED_FROM_EVIDENCE',
    evidenceRefs: ['evidence/receipts/systems-expert-001'],
    freshness: 'FRESH',
    sourcesConsulted: ['live-goal-projection', 'durable-memory'],
    cannotAnswerReason: null,
    answerVerdict: 'ANSWERED_GROUNDED',
    ...overrides,
  };
}

test('rich response exposes the complete provider-neutral semantic presentation model', () => {
  const result = buildStephanosRichConversationalResponseV1({
    question: question(),
    answer: answer(),
    structured: {
      goalsMissions: [{ ref: '#1556', label: 'Mission Scheduler', state: 'ACTIVE', evidenceRefs: ['evidence/receipts/systems-expert-001'] }],
      agentProviderContributions: [{ contributorId: 'stephanos', contributionType: 'SYSTEM_SYNTHESIS', summary: 'Synthesised durable project truth.', evidenceRefs: ['evidence/receipts/systems-expert-001'] }],
      unknowns: [],
      options: [{ optionId: 'option:preserve-route', label: 'Preserve the existing governed route', tradeoff: 'Avoids duplicate machinery.', evidenceRefs: ['evidence/receipts/systems-expert-001'] }],
      recommendedAction: { actionId: 'action:consume-proof', label: 'Consume current exact-head proof', rationale: 'The source lane is already owned.', requiresApproval: 'NO', evidenceRefs: ['evidence/receipts/systems-expert-001'] },
      approvalState: { state: 'NOT_REQUIRED', approvalRef: '', evidenceRefs: ['evidence/receipts/systems-expert-001'] },
      visualisationCandidates: ['SYSTEM_MAP', 'PROOF_STACK'],
    },
  });

  assert.equal(result.valid, true, result.errors.join(','));
  assert.equal(result.schemaVersion, STEPHANOS_RICH_CONVERSATIONAL_RESPONSE_SCHEMA_VERSION);
  assert.deepEqual(STEPHANOS_RICH_CONVERSATIONAL_RESPONSE_FIELDS, [
    'directAnswer', 'epistemicClaims', 'evidenceRefs', 'goalsMissions', 'agentProviderContributions', 'unknowns', 'options', 'recommendedAction', 'approvalState', 'visualisationCandidates', 'continuity',
  ]);
  assert.match(result.responseId, /^rich-response-[0-9a-f]{24}$/);
  assert.equal(result.directAnswer, answer().answerText);
  assert.equal(result.epistemicClaims.length, 1);
  assert.deepEqual(result.epistemicClaims[0].evidenceRefs, ['evidence/receipts/systems-expert-001']);
  assert.equal(result.goalsMissions[0].ref, '#1556');
  assert.equal(result.agentProviderContributions[0].contributorId, 'stephanos');
  assert.equal(result.options[0].optionId, 'option:preserve-route');
  assert.equal(result.recommendedAction.state, 'AVAILABLE');
  assert.equal(result.recommendedAction.requiresApproval, 'NO');
  assert.equal(result.approvalState.state, 'NOT_REQUIRED');
  assert.deepEqual(result.visualisationCandidates, ['SYSTEM_MAP', 'PROOF_STACK']);
  assert.deepEqual(result.continuity, { roundId: 'stephanos-round-001', questionId: 'stephanos-round-001-q02' });
  assert.equal(result.authority.privateUiTruthAllowed, false);
  assert.equal(result.authority.approvalAuthorityAdded, false);
});

test('partial answers make ungrounded uncertainty explicit and derive presentation candidates without inventing facts', () => {
  const result = buildStephanosRichConversationalResponseV1({
    question: question({ questionClass: 'NEXT_BEST_ACTION' }),
    answer: answer({
      answerText: 'The next safe action depends on evidence that is not yet independently resolved.',
      evidenceRefs: [],
      sourcesConsulted: [],
      answerVerdict: 'ANSWERED_PARTIAL',
    }),
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.goalsMissions, []);
  assert.deepEqual(result.agentProviderContributions, []);
  assert.equal(result.unknowns.length, 1);
  assert.match(result.unknowns[0], /not independently grounded/i);
  assert.deepEqual(result.options, []);
  assert.equal(result.recommendedAction.state, 'UNKNOWN');
  assert.equal(result.approvalState.state, 'UNKNOWN');
  assert.deepEqual(result.visualisationCandidates, ['ACTION_CARD', 'APPROVAL_CARD']);
});

test('evidence sources may be projected as contributions but never gain provider or action authority', () => {
  const result = buildStephanosRichConversationalResponseV1({
    question: question({ questionClass: 'AGENT_AND_TOOL_CAPABILITIES' }),
    answer: answer({ sourcesConsulted: ['provider-grounding', 'local-retrieval'] }),
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.agentProviderContributions.map((item) => item.contributorId), ['provider-grounding', 'local-retrieval']);
  assert.equal(result.authority.providerSelectionAuthorityAdded, false);
  assert.equal(result.authority.commandExecutionAllowed, false);
  assert.deepEqual(result.visualisationCandidates, ['PROVIDER_AGENT_MESH', 'CAPABILITY_MATRIX']);
});

test('rich response fails closed on secret-shaped direct text, invalid continuity or unknown structured fields', () => {
  const secret = buildStephanosRichConversationalResponseV1({
    question: question(),
    answer: answer({ answerText: 'api_key=sk-123456789012345678901234567890' }),
  });
  assert.equal(secret.valid, false);
  assert.deepEqual(secret.errors, ['direct-answer-invalid']);

  const invalidContinuity = buildStephanosRichConversationalResponseV1({
    question: question({ questionId: '../escape' }),
    answer: answer(),
  });
  assert.equal(invalidContinuity.valid, false);
  assert.deepEqual(invalidContinuity.errors, ['continuity-identity-invalid']);

  const unknown = buildStephanosRichConversationalResponseV1({
    question: question(),
    answer: answer(),
    structured: { hiddenAuthority: true },
  });
  assert.equal(unknown.valid, false);
  assert.deepEqual(unknown.errors, ['structured-extension-unknown-field:hiddenAuthority']);
});
