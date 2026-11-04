import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reconcileFlywheelLearningGoalsV1 } from './flywheelLearningGoalBridgeService.js';

async function workspace() {
  const base = await mkdtemp(join(tmpdir(), 'conversation-uplift-bridge-'));
  const root = join(base, 'shared');
  const repoRoot = join(base, 'repo');
  const directory = join(base, 'candidates');
  await Promise.all([mkdir(join(root, 'events'), { recursive: true }), mkdir(repoRoot), mkdir(directory)]);
  return { root, repoRoot, directory };
}
const observation = {
  state: 'ready',
  turnCount: 301,
  candidates: [{
    id: 'github-api-quota',
    title: 'Investigate recurring GitHub API throttling',
    mentionCount: 3,
    eligibleForBoundedInvestigation: true,
    provenCapabilityFailure: false,
    sourceTurnRefs: [
      'workspace://shared-thread/shared-operator-primary/turn-a',
      'workspace://shared-thread/shared-operator-primary/turn-b',
    ],
  }],
};

test('existing Flywheel creates one investigation candidate from repeated conversation hints, then dedupes', async () => {
  const { root, repoRoot, directory } = await workspace();
  const input = {
    root, repoRoot, buildConciergeGoalOptions: { directory },
    readConversationUplift: async () => observation,
    nowUtc: '2026-10-12T14:00:00.000Z',
  };
  const first = await reconcileFlywheelLearningGoalsV1(input);
  assert.equal(first.conversationUplift.turnCount, 301);
  assert.equal(first.conversationUplift.createdCandidateCount, 1);
  assert.equal(first.createdCanonicalGoalCount, 0);
  assert.equal(first.authority.sourceMutationAllowed, false);
  assert.equal(first.authority.dispatchAllowed, false);
  const second = await reconcileFlywheelLearningGoalsV1(input);
  assert.equal(second.conversationUplift.createdCandidateCount, 0);
  assert.equal(second.conversationUplift.dedupedCandidateCount, 1);
});

test('partial history and insufficient evidence cannot create a new candidate', async () => {
  const { root, repoRoot, directory } = await workspace();
  let calls = 0;
  const result = await reconcileFlywheelLearningGoalsV1({
    root, repoRoot, buildConciergeGoalOptions: { directory },
    readConversationUplift: async () => ({ ...observation, state: 'partial' }),
    createGoalCandidate: async () => { calls += 1; return { ok: true }; },
    nowUtc: '2026-10-12T14:00:00.000Z',
  });
  assert.equal(result.conversationUplift.eligibleCount, 0);
  assert.equal(result.conversationUplift.createdCandidateCount, 0);
  assert.equal(calls, 0);
});
