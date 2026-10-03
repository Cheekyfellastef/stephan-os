import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createSharedWorkspaceEventRecord } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { reconcileFlywheelLearningGoalsV1 } from './flywheelLearningGoalBridgeService.js';

const NOW = '2026-10-03T12:00:00.000Z';

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'flywheel-learning-goal-bridge-'));
  const root = join(parent, 'workspace');
  const repoRoot = join(parent, 'repo');
  const candidateDirectory = join(parent, 'build-concierge');
  await Promise.all([
    mkdir(join(root, 'events'), { recursive: true }),
    mkdir(repoRoot, { recursive: true }),
    mkdir(candidateDirectory, { recursive: true }),
  ]);
  return { root, repoRoot, candidateDirectory };
}

async function writeEvent(root, name, event) {
  await writeFile(join(root, 'events', `${name}.json`), `${JSON.stringify(event, null, 2)}\n`, 'utf8');
}

function capabilityGap(overrides = {}) {
  return createSharedWorkspaceEventRecord({
    eventId: overrides.eventId || 'guarded-runtime-inspection-gap',
    participantId: 'sovereign-commander',
    timestampUtc: NOW,
    eventKind: 'capability-gap',
    summary: 'Guarded runtime inspection is missing.',
    capabilityFailure: {
      failureClass: 'CAPABILITY_GAP',
      genuineCapabilityFailure: true,
      capabilityId: 'guarded-runtime-inspection',
      targetRefs: overrides.targetRefs || ['stephanos-ui'],
      teacherHint: 'sovereign-commander',
    },
  });
}

test('unowned actionable learning gap creates one bounded goal candidate and repeat cycles dedupe it', async () => {
  const { root, repoRoot, candidateDirectory } = await fixture();
  await writeEvent(root, 'gap', capabilityGap());

  const options = {
    root,
    repoRoot,
    nowUtc: NOW,
    buildConciergeGoalOptions: { directory: candidateDirectory },
  };
  const first = await reconcileFlywheelLearningGoalsV1(options);
  assert.equal(first.ok, true);
  assert.equal(first.observedActionableEventCount, 1);
  assert.equal(first.createdGoalCandidateCount, 1);
  assert.equal(first.attachedExistingOwnerCount, 0);
  assert.equal(first.authority.githubIssueCreationAllowed, false);
  assert.equal(first.authority.dispatchAllowed, false);

  const second = await reconcileFlywheelLearningGoalsV1(options);
  assert.equal(second.ok, true);
  assert.equal(second.createdGoalCandidateCount, 0);
  assert.equal(second.dedupedGoalCandidateCount, 1);
  assert.equal(second.attachments[0].disposition, 'DEDUPED_EXISTING_GOAL_CANDIDATE');
});

test('explicit canonical owner is reused instead of creating duplicate work', async () => {
  const { root, repoRoot, candidateDirectory } = await fixture();
  await writeEvent(root, 'owned-gap', capabilityGap({
    eventId: 'sovereign-parity-gap',
    targetRefs: ['goal:#2573'],
  }));

  const result = await reconcileFlywheelLearningGoalsV1({
    root,
    repoRoot,
    nowUtc: NOW,
    buildConciergeGoalOptions: { directory: candidateDirectory },
  });

  assert.equal(result.ok, true);
  assert.equal(result.observedActionableEventCount, 1);
  assert.equal(result.attachedExistingOwnerCount, 1);
  assert.equal(result.createdGoalCandidateCount, 0);
  assert.deepEqual(result.attachments[0].ownerGoals, ['#2573']);
});

test('umbrella learning owner does not hide a genuinely unowned root gap', async () => {
  const { root, repoRoot, candidateDirectory } = await fixture();
  await writeEvent(root, 'umbrella-only', capabilityGap({
    eventId: 'umbrella-only-gap',
    targetRefs: ['goal:#2647'],
  }));

  const result = await reconcileFlywheelLearningGoalsV1({
    root,
    repoRoot,
    nowUtc: NOW,
    buildConciergeGoalOptions: { directory: candidateDirectory },
  });

  assert.equal(result.createdGoalCandidateCount, 1);
  assert.equal(result.attachedExistingOwnerCount, 0);
});

test('ordinary historical events do not silently become goals', async () => {
  const { root, repoRoot, candidateDirectory } = await fixture();
  await writeEvent(root, 'heartbeat', createSharedWorkspaceEventRecord({
    eventId: 'ordinary-heartbeat',
    participantId: 'flywheel',
    timestampUtc: NOW,
    eventKind: 'heartbeat',
    summary: 'Flywheel heartbeat.',
  }));

  const result = await reconcileFlywheelLearningGoalsV1({
    root,
    repoRoot,
    nowUtc: NOW,
    buildConciergeGoalOptions: { directory: candidateDirectory },
  });

  assert.equal(result.observedActionableEventCount, 0);
  assert.equal(result.createdGoalCandidateCount, 0);
});


test('production-authorized unowned gap becomes one canonical scheduler goal before Build Concierge fallback', async () => {
  const { root, repoRoot, candidateDirectory } = await fixture();
  await writeEvent(root, 'canonical-gap', capabilityGap({
    eventId: 'canonical-runtime-gap',
  }));

  let candidateCalls = 0;
  const result = await reconcileFlywheelLearningGoalsV1({
    root,
    repoRoot,
    nowUtc: NOW,
    canonicalGoalAdmissionAuthorized: true,
    buildConciergeGoalOptions: { directory: candidateDirectory },
    admitCanonicalGoal: async (input) => {
      assert.equal(input.canonicalGoalAdmissionAuthorized, true);
      assert.equal(input.eventId, 'canonical-runtime-gap');
      assert.equal(input.capabilityId, 'guarded-runtime-inspection');
      return {
        ok: true,
        created: true,
        issue: { number: 3003, title: 'Goal: Close learned capability gap' },
        schedulerGoal: { goalId: 'goal-3003' },
      };
    },
    createGoalCandidate: async () => {
      candidateCalls += 1;
      return { ok: false, reason: 'SHOULD_NOT_RUN' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.createdCanonicalGoalCount, 1);
  assert.deepEqual(result.createdCanonicalGoalIssueNumbers, [3003]);
  assert.equal(result.createdGoalCandidateCount, 0);
  assert.equal(candidateCalls, 0);
  assert.equal(result.attachments[0].disposition, 'CANONICAL_GOAL_CREATED_AND_ADMITTED');
  assert.deepEqual(result.attachments[0].ownerGoals, ['#3003']);
  assert.equal(result.authority.boundedCanonicalGoalAdmissionAllowed, true);
  assert.equal(result.authority.githubIssueCreationAllowed, true);
  assert.equal(result.authority.sourceMutationAllowed, false);
});

test('canonical admission failure falls back to the existing bounded candidate path', async () => {
  const { root, repoRoot, candidateDirectory } = await fixture();
  await writeEvent(root, 'canonical-held', capabilityGap({
    eventId: 'canonical-held-gap',
  }));

  const result = await reconcileFlywheelLearningGoalsV1({
    root,
    repoRoot,
    nowUtc: NOW,
    canonicalGoalAdmissionAuthorized: true,
    buildConciergeGoalOptions: { directory: candidateDirectory },
    admitCanonicalGoal: async () => ({
      ok: false,
      reason: 'SIMULATED_GITHUB_UNAVAILABLE',
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.canonicalGoalAdmissionHeldCount, 1);
  assert.match(result.canonicalGoalAdmissionBlockers[0], /SIMULATED_GITHUB_UNAVAILABLE/);
  assert.equal(result.createdGoalCandidateCount, 1);
});
