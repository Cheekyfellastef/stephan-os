import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_BLOCKER_ID,
  STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_ROUND_ID,
  createStephanosFlagshipSystemsExpertTransferRoundV1,
  stephanosFlagshipSystemsExpertCaseIdsV1,
} from './stephanosFlagshipSystemsExpertTransferRoundV1.mjs';

const EXPECTED_CASES = [
  'current-system-map',
  'provider-outage',
  'zero-codex-routing',
  'openclaw-qualification',
  'forge-foundry-review',
  'battle-bridge-ignition-recovery',
  'research-route-evidence-reconciliation',
  'research-agent-disagreement',
  'improvement-proposal-quality',
  'authorization-experience-classification',
];

const REQUIRED_CONTEXT_REFS = [
  '#1776', '#1308', '#1722', '#1556', '#1290', '#1657', '#1694', '#1281',
  '#1596', '#1597', '#1898', '#1899', '#1900', '#1901', '#1902', '#1903', '#1934', '#1945',
];

test('flagship peer-intelligence transfer fixtures cover exactly ten systems, research and improvement cases and remain held by canonical novelty authority', () => {
  const built = createStephanosFlagshipSystemsExpertTransferRoundV1({ createdAtUtc: '2026-08-21T07:20:00.000Z' });
  assert.equal(built.valid, true, built.errors.join(','));
  assert.equal(built.state, 'TRANSFER_FIXTURES_READY_CANONICAL_NOVELTY_AUTHORITY_REQUIRED');
  assert.equal(built.candidateRound.roundId, STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_ROUND_ID);
  assert.equal(built.candidateRound.roundNumber, 2);
  assert.equal(built.candidateRound.questions.length, 10);
  assert.deepEqual(stephanosFlagshipSystemsExpertCaseIdsV1(), EXPECTED_CASES);
  assert.deepEqual(built.cases, EXPECTED_CASES);
  assert.equal(built.roundAdmissionReady, false);
  assert.equal(built.blockerId, STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_BLOCKER_ID);
  assert.equal(built.canonicalRoundValidation.valid, false);
  assert.deepEqual(built.canonicalRoundValidation.errors, [STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_BLOCKER_ID]);
  assert.equal(built.originalRoundReplayRequired, true);
  assert.equal(built.transferRoundReplayRequired, true);
  assert.equal(built.questionGapMachineryOnCognitiveFailure, true);
  assert.equal(built.uiAgentExperienceDebtOnCognitivelyCorrectButHardToUseTurns, true);
  assert.equal(built.liveExecutionClaimAllowed, false);
  assert.equal(built.authority.providerSelectionAuthorityAdded, false);
});

test('every transfer fixture binds the combined flagship, research, improvement and current provider-mesh owners', () => {
  const built = createStephanosFlagshipSystemsExpertTransferRoundV1({ createdAtUtc: '2026-08-21T07:20:00.000Z' });
  for (const question of built.candidateRound.questions) {
    assert.equal(question.askerParticipantId, 'chatgpt-bridge');
    assert.equal(question.targetParticipantId, 'stephanos');
    assert.ok(question.noveltyRefs[0].startsWith('transfer:'));
    assert.match(question.intentFingerprint, /^intent-[0-9a-f]{40}$/);
    for (const ref of REQUIRED_CONTEXT_REFS) {
      assert.ok(question.contextRefs.includes(ref), `${question.questionId} missing ${ref}`);
    }
    assert.match(question.expectedEvidenceClass, /EVIDENCE$/);
  }
});

test('the ten cases explicitly exercise current systems truth, provider outage, research reconciliation and disagreement, improvement quality and authorization classification', () => {
  const built = createStephanosFlagshipSystemsExpertTransferRoundV1({ createdAtUtc: '2026-08-21T07:20:00.000Z' });
  const questionText = built.candidateRound.questions.map((question) => question.questionText).join('\n').toLowerCase();
  for (const expected of [
    'live durable truth',
    'provider',
    'zero-codex',
    'openclaw',
    'forge',
    'foundry',
    'battle bridge',
    'ignition',
    'draft-safe independent-review',
    'research council',
    'primary-source',
    'conflicting evidence',
    'disagree',
    'counterevidence',
    'improve_stephanos',
    'goal flywheel',
    'exact-head',
    'experience debt',
    'question-gap',
  ]) {
    assert.ok(questionText.includes(expected), `missing peer-intelligence concept: ${expected}`);
  }
});

test('research scouts remain subordinate to Stephanos synthesis and provider substitution cannot become private agent truth', () => {
  const built = createStephanosFlagshipSystemsExpertTransferRoundV1({ createdAtUtc: '2026-08-21T07:20:00.000Z' });
  const researchQuestions = built.candidateRound.questions.filter((question) => question.questionId.endsWith('-q07') || question.questionId.endsWith('-q08'));
  assert.equal(researchQuestions.length, 2);
  const text = researchQuestions.map((question) => question.questionText).join('\n').toLowerCase();
  assert.ok(text.includes('scouts'));
  assert.ok(text.includes('final synthesizer'));
  assert.ok(text.includes('substitutes providers'));
  assert.ok(text.includes('private truth'));
});

test('improvement and authorization cases preserve the canonical routing split for cognition failures versus difficult experience', () => {
  const built = createStephanosFlagshipSystemsExpertTransferRoundV1({ createdAtUtc: '2026-08-21T07:20:00.000Z' });
  const improvement = built.candidateRound.questions[8].questionText.toLowerCase();
  const authorization = built.candidateRound.questions[9].questionText.toLowerCase();
  assert.ok(improvement.includes('current owner'));
  assert.ok(improvement.includes('alternatives'));
  assert.ok(improvement.includes('risk and rollback'));
  assert.ok(improvement.includes('goal flywheel'));
  assert.ok(authorization.includes('#1722 experience debt'));
  assert.ok(authorization.includes('question-gap machinery'));
  assert.ok(authorization.includes('physical-headset acceptance'));
  assert.equal(built.questionGapMachineryOnCognitiveFailure, true);
  assert.equal(built.uiAgentExperienceDebtOnCognitivelyCorrectButHardToUseTurns, true);
});

test('transfer fixtures cannot manufacture novelty authority even when the cases are materially different', () => {
  const built = createStephanosFlagshipSystemsExpertTransferRoundV1({ createdAtUtc: '2026-08-21T07:20:00.000Z' });
  assert.equal(built.valid, true);
  assert.equal(built.roundAdmissionReady, false);
  assert.equal(built.canonicalRoundValidation.refusalReason, STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_BLOCKER_ID);
  assert.equal(built.liveExecutionClaimAllowed, false);
});

test('invalid transfer-round timestamps fail closed and never claim live execution', () => {
  const built = createStephanosFlagshipSystemsExpertTransferRoundV1({ createdAtUtc: 'not-a-timestamp' });
  assert.equal(built.valid, false);
  assert.equal(built.candidateRound, null);
  assert.deepEqual(built.errors, ['transfer-round-build-failed-closed']);
  assert.equal(built.roundAdmissionReady, false);
  assert.equal(built.liveExecutionClaimAllowed, false);
});
