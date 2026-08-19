import test from 'node:test';
import assert from 'node:assert/strict';

import {
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

test('flagship systems-expert transfer round covers the ten required architecture and presentation cases', () => {
  const built = createStephanosFlagshipSystemsExpertTransferRoundV1({ createdAtUtc: '2026-08-19T12:30:00.000Z' });
  assert.equal(built.valid, true, built.errors.join(','));
  assert.equal(built.round.roundId, STEPHANOS_FLAGSHIP_SYSTEMS_EXPERT_TRANSFER_ROUND_ID);
  assert.equal(built.round.roundNumber, 2);
  assert.equal(built.round.questions.length, 10);
  assert.deepEqual(stephanosFlagshipSystemsExpertCaseIdsV1(), EXPECTED_CASES);
  assert.deepEqual(built.cases, EXPECTED_CASES);
  assert.equal(built.originalRoundReplayRequired, true);
  assert.equal(built.transferRoundReplayRequired, true);
  assert.equal(built.questionGapMachineryOnCognitiveFailure, true);
  assert.equal(built.uiAgentExperienceDebtOnCognitivelyCorrectButHardToUseTurns, true);
  assert.equal(built.liveExecutionClaimAllowed, false);
  assert.equal(built.authority.providerSelectionAuthorityAdded, false);
});

test('every transfer case binds the combined flagship owners and zero-Codex/provider sovereignty architecture', () => {
  const built = createStephanosFlagshipSystemsExpertTransferRoundV1({ createdAtUtc: '2026-08-19T12:30:00.000Z' });
  for (const question of built.round.questions) {
    assert.equal(question.askerParticipantId, 'chatgpt-bridge');
    assert.equal(question.targetParticipantId, 'stephanos');
    assert.ok(question.noveltyRefs[0].startsWith('transfer:'));
    for (const ref of ['#1776', '#1308', '#1722', '#1556', '#1290', '#1657', '#1694', '#1281', '#1898', '#1899', '#1900', '#1901']) {
      assert.ok(question.contextRefs.includes(ref), `${question.questionId} missing ${ref}`);
    }
    assert.match(question.expectedEvidenceClass, /EVIDENCE$/);
  }
});

test('systems-expert transfer fixtures make the required concepts explicit instead of relying on chat memory', () => {
  const built = createStephanosFlagshipSystemsExpertTransferRoundV1({ createdAtUtc: '2026-08-19T12:30:00.000Z' });
  const text = built.round.questions.map((question) => question.questionText).join('\n').toLowerCase();
  for (const expected of ['provider', 'zero-codex', 'openclaw', 'forge', 'foundry', 'review', 'battle bridge', 'ignition', 'self-healing', 'conversation', 'evidence', 'approval']) {
    assert.ok(text.includes(expected), `missing systems-expert concept: ${expected}`);
  }
});

test('invalid transfer-round timestamps fail closed and never claim live execution', () => {
  const built = createStephanosFlagshipSystemsExpertTransferRoundV1({ createdAtUtc: 'not-a-timestamp' });
  assert.equal(built.valid, false);
  assert.equal(built.round, null);
  assert.deepEqual(built.errors, ['transfer-round-build-failed-closed']);
  assert.equal(built.liveExecutionClaimAllowed, false);
});
