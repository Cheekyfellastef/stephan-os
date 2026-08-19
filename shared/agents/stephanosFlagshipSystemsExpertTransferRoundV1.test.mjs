import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_BLOCKER_ID,
  STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_ROUND_ID,
  createStephanosFlagshipSystemsExpertTransferRoundV1,
  stephanosFlagshipSystemsExpertCaseIdsV1,
} from './stephanosFlagshipSystemsExpertTransferRoundV1.mjs';

const EXPECTED_CASES = [
  'provider-outage',
  'zero-codex-routing',
  'openclaw-qualification',
  'forge-capacity',
  'provider-neutral-review',
  'battle-bridge-recovery',
  'ignition-self-healing',
  'long-thread-continuity',
  'evidence-expansion',
  'action-approval-presentation',
];

test('flagship systems-expert transfer fixtures cover the ten required cases and truthfully remain held by canonical novelty authority', () => {
  const built = createStephanosFlagshipSystemsExpertTransferRoundV1({ createdAtUtc: '2026-08-19T12:30:00.000Z' });
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

test('every transfer fixture binds the combined flagship owners and zero-Codex/provider sovereignty architecture', () => {
  const built = createStephanosFlagshipSystemsExpertTransferRoundV1({ createdAtUtc: '2026-08-19T12:30:00.000Z' });
  for (const question of built.candidateRound.questions) {
    assert.equal(question.askerParticipantId, 'chatgpt-bridge');
    assert.equal(question.targetParticipantId, 'stephanos');
    assert.ok(question.noveltyRefs[0].startsWith('transfer:'));
    assert.match(question.intentFingerprint, /^intent-[0-9a-f]{40}$/);
    for (const ref of ['#1776', '#1308', '#1722', '#1556', '#1290', '#1657', '#1694', '#1281', '#1898', '#1899', '#1900', '#1901']) {
      assert.ok(question.contextRefs.includes(ref), `${question.questionId} missing ${ref}`);
    }
    assert.match(question.expectedEvidenceClass, /EVIDENCE$/);
  }
});

test('systems-expert transfer fixtures make the required concepts explicit instead of relying on chat memory', () => {
  const built = createStephanosFlagshipSystemsExpertTransferRoundV1({ createdAtUtc: '2026-08-19T12:30:00.000Z' });
  const text = built.candidateRound.questions.map((question) => question.questionText).join('\n').toLowerCase();
  for (const expected of ['provider', 'zero-codex', 'openclaw', 'forge', 'foundry', 'review', 'battle bridge', 'ignition', 'self-healing', 'conversation', 'evidence', 'approval']) {
    assert.ok(text.includes(expected), `missing systems-expert concept: ${expected}`);
  }
});

test('transfer fixtures cannot manufacture novelty authority even when the cases are materially different', () => {
  const built = createStephanosFlagshipSystemsExpertTransferRoundV1({ createdAtUtc: '2026-08-19T12:30:00.000Z' });
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
