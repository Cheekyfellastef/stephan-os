import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveConversationLearningJourneyV1 } from './conversationLearningJourneyV1.mjs';

const uplift = {
  state: 'ready',
  threadId: 'shared-operator-primary',
  turnCount: 301,
  candidates: [
    { id: 'a', title: 'Investigate conveyor', classification: 'CONVERSATION_HINT_REVIEW_REQUIRED', provenCapabilityFailure: false,
      mentionCount: 4, eligibleForBoundedInvestigation: true, sourceTurnRefs: ['workspace://a', 'workspace://b'] },
    { id: 'b', title: 'Investigate parity', classification: 'CONVERSATION_HINT_REVIEW_REQUIRED', provenCapabilityFailure: false,
      mentionCount: 1, eligibleForBoundedInvestigation: false, sourceTurnRefs: ['workspace://c'] },
  ],
};

test('both workspaces get the same high-level evidence-based journey beyond 256 turns', () => {
  const view = deriveConversationLearningJourneyV1({ uplift, feedState: 'ready' });
  assert.equal(view.indexedTurns, 301);
  assert.equal(view.gapHints, 2);
  assert.equal(view.investigationEligible, 1);
  assert.equal(view.admittedGoals, null);
  assert.equal(view.builderPickups, null);
  assert.equal(view.provenImprovements, null);
  assert.equal(view.candidates[0].evidenceCount, 2);
  assert.equal(view.state, 'REPORTED');
  assert.doesNotMatch(JSON.stringify(view), /workspace:\/\/a/); // source excerpts/IDs remain in canonical store
});

test('offline and partial data cannot masquerade as live counts or completed builds', () => {
  for (const feedState of ['unavailable', 'connecting', 'offline']) {
    const view = deriveConversationLearningJourneyV1({ uplift, feedState });
    assert.equal(view.indexedTurns, null);
    assert.equal(view.investigationEligible, null);
    assert.equal(view.provenImprovements, null);
    assert.notEqual(view.state, 'REPORTED');
  }
  // Unrelated programme staleness must not hide a separately ready conversation index.
  assert.equal(deriveConversationLearningJourneyV1({ uplift, feedState: 'stale' }).indexedTurns, 301);
  const partial = deriveConversationLearningJourneyV1({ uplift: { ...uplift, state: 'partial' }, feedState: 'ready' });
  assert.equal(partial.indexedTurns, null);
  assert.equal(partial.gapHints, null);
  assert.equal(partial.candidates.length, 0);
});

test('unsupported or falsely proven hints are excluded', () => {
  const view = deriveConversationLearningJourneyV1({
    feedState: 'ready',
    uplift: {
      ...uplift,
      candidates: [
        { ...uplift.candidates[0], provenCapabilityFailure: true },
        { ...uplift.candidates[0], classification: 'UNVALIDATED_NOTE' },
      ],
    },
  });
  assert.equal(view.gapHints, 0);
  assert.equal(view.investigationEligible, 0);
  assert.equal(view.builderPickups, null);
});
