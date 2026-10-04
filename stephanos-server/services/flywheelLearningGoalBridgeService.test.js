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
      capabilityId: overrides.capabilityId || 'guarded-runtime-inspection',
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


test('created canonical issue counts against the per-cycle cap even when scheduler admission fails', async () => {
  const { root, repoRoot, candidateDirectory } = await fixture();
  for (let index = 1; index <= 5; index += 1) {
    await writeEvent(root, `created-held-${index}`, capabilityGap({
      eventId: `created-held-gap-${index}`,
      capabilityId: `created-held-capability-${index}`,
    }));
  }

  let admissionCalls = 0;
  let candidateCalls = 0;
  const result = await reconcileFlywheelLearningGoalsV1({
    root,
    repoRoot,
    nowUtc: NOW,
    canonicalGoalAdmissionAuthorized: true,
    buildConciergeGoalOptions: { directory: candidateDirectory },
    admitCanonicalGoal: async (input) => {
      if (input.allowIssueCreation === false) {
        return {
          ok: false,
          authorized: true,
          retryableHold: true,
          issueCreationHeld: true,
          reason: 'FLYWHEEL_CANONICAL_GOAL_PER_CYCLE_LIMIT',
        };
      }
      admissionCalls += 1;
      return {
        ok: false,
        created: true,
        issue: { number: 3100 + admissionCalls },
        reason: 'FLYWHEEL_CANONICAL_SCHEDULER_GOAL_WRITE_FAILED',
      };
    },
    createGoalCandidate: async () => {
      candidateCalls += 1;
      return { ok: true };
    },
  });

  assert.equal(admissionCalls, 4);
  assert.equal(result.createdCanonicalGoalCount, 4);
  assert.deepEqual(result.createdCanonicalGoalIssueNumbers, [3101, 3102, 3103, 3104]);
  assert.equal(
    result.attachments.filter((item) => item.disposition === 'CANONICAL_GOAL_CREATED_SCHEDULER_ADMISSION_HELD').length,
    4,
  );
  assert.equal(result.canonicalGoalAdmissionBlockers.some((item) => item.includes('CANONICAL_GOAL_PER_CYCLE_LIMIT')), true);
  assert.equal(result.attachments.at(-1).disposition, 'CANONICAL_GOAL_ADMISSION_RETRY_HELD');
  assert.equal(candidateCalls, 0);
});

test('canonical dedupe continues after the new-issue quota is exhausted', async () => {
  const { root, repoRoot, candidateDirectory } = await fixture();
  const capabilities = ['cap-a', 'cap-b', 'cap-c', 'cap-d', 'cap-a'];
  for (let index = 0; index < capabilities.length; index += 1) {
    await writeEvent(root, `quota-dedupe-${index + 1}`, capabilityGap({
      eventId: `quota-dedupe-event-${index + 1}`,
      capabilityId: capabilities[index],
    }));
  }

  const issues = new Map();
  let nextIssue = 3300;
  let admissionCalls = 0;
  let candidateCalls = 0;
  const result = await reconcileFlywheelLearningGoalsV1({
    root,
    repoRoot,
    nowUtc: NOW,
    canonicalGoalAdmissionAuthorized: true,
    buildConciergeGoalOptions: { directory: candidateDirectory },
    admitCanonicalGoal: async (input) => {
      admissionCalls += 1;
      if (issues.has(input.capabilityId)) {
        return {
          ok: true,
          created: false,
          issue: { number: issues.get(input.capabilityId) },
          schedulerGoal: { goalId: `goal-${issues.get(input.capabilityId)}` },
        };
      }
      if (input.allowIssueCreation === false) {
        return {
          ok: false,
          authorized: true,
          retryableHold: true,
          reason: 'FLYWHEEL_CANONICAL_GOAL_PER_CYCLE_LIMIT',
        };
      }
      nextIssue += 1;
      issues.set(input.capabilityId, nextIssue);
      return {
        ok: true,
        created: true,
        issue: { number: nextIssue },
        schedulerGoal: { goalId: `goal-${nextIssue}` },
      };
    },
    createGoalCandidate: async () => {
      candidateCalls += 1;
      return { ok: true };
    },
  });

  assert.equal(admissionCalls, 5);
  assert.equal(result.createdCanonicalGoalCount, 4);
  assert.equal(result.dedupedCanonicalGoalCount, 1);
  assert.equal(result.attachments.at(-1).disposition, 'DEDUPED_CANONICAL_GOAL_ADMITTED');
  assert.deepEqual(result.attachments.at(-1).ownerGoals, ['#3301']);
  assert.equal(candidateCalls, 0);
});


test('existing fallback candidate blocks later canonical issue duplication for the same learning event', async () => {
  const { root, repoRoot, candidateDirectory } = await fixture();
  await writeEvent(root, 'fallback-first', capabilityGap({
    eventId: 'fallback-first-gap',
  }));

  const first = await reconcileFlywheelLearningGoalsV1({
    root,
    repoRoot,
    nowUtc: NOW,
    buildConciergeGoalOptions: { directory: candidateDirectory },
  });
  assert.equal(first.createdGoalCandidateCount, 1);

  let canonicalCalls = 0;
  const second = await reconcileFlywheelLearningGoalsV1({
    root,
    repoRoot,
    nowUtc: NOW,
    canonicalGoalAdmissionAuthorized: true,
    buildConciergeGoalOptions: { directory: candidateDirectory },
    admitCanonicalGoal: async () => {
      canonicalCalls += 1;
      return { ok: true, created: true, issue: { number: 3201 } };
    },
  });

  assert.equal(canonicalCalls, 0);
  assert.equal(second.createdCanonicalGoalCount, 0);
  assert.equal(second.dedupedGoalCandidateCount, 1);
  assert.equal(second.attachments[0].disposition, 'DEDUPED_EXISTING_GOAL_CANDIDATE');
});


test('canonical admission lock contention stays held and never creates a fallback candidate', async () => {
  const { root, repoRoot, candidateDirectory } = await fixture();
  await writeEvent(root, 'lock-held', capabilityGap({
    eventId: 'lock-held-gap',
  }));

  let candidateCalls = 0;
  const result = await reconcileFlywheelLearningGoalsV1({
    root,
    repoRoot,
    nowUtc: NOW,
    canonicalGoalAdmissionAuthorized: true,
    buildConciergeGoalOptions: { directory: candidateDirectory },
    admitCanonicalGoal: async () => ({
      ok: false,
      authorized: true,
      retryableHold: true,
      reason: 'SHARED_WORKSPACE_OPERATION_LOCK_TIMEOUT',
    }),
    createGoalCandidate: async () => {
      candidateCalls += 1;
      return { ok: true };
    },
  });

  assert.equal(candidateCalls, 0);
  assert.equal(result.canonicalGoalAdmissionHeldCount, 1);
  assert.equal(result.createdGoalCandidateCount, 0);
  assert.equal(result.attachments[0].disposition, 'CANONICAL_GOAL_ADMISSION_RETRY_HELD');
  assert.match(result.canonicalGoalAdmissionBlockers[0], /SHARED_WORKSPACE_OPERATION_LOCK_TIMEOUT/);
});


test('matching recovery supersedes historical learning gap before goal admission', async () => {
  const { root, repoRoot, candidateDirectory } = await fixture();
  await writeEvent(root, 'historical-gap', capabilityGap({
    eventId: 'historical-runtime-gap',
    capabilityId: 'guarded-runtime-inspection',
  }));
  await writeEvent(root, 'historical-recovery', {
    ...createSharedWorkspaceEventRecord({
      eventId: 'historical-runtime-recovery',
      participantId: 'sovereign-commander',
      timestampUtc: '2026-10-03T12:05:00.000Z',
      eventKind: 'capability-recovery',
      summary: 'Guarded runtime inspection recovery proved.',
      learningCandidate: {
        capabilityId: 'guarded-runtime-inspection',
        requiresExistingGoalSearch: false,
        repairReplayRequired: false,
        testAndProofRefs: ['proof/guarded-runtime-recovery'],
      },
    }),
    state: 'RECOVERED',
  });

  const result = await reconcileFlywheelLearningGoalsV1({
    root,
    repoRoot,
    nowUtc: '2026-10-03T12:10:00.000Z',
    buildConciergeGoalOptions: { directory: candidateDirectory },
  });

  assert.equal(result.ok, true);
  assert.equal(result.observedActionableEventCount, 0);
  assert.equal(result.resolvedHistoricalEventCount, 1);
  assert.equal(result.createdGoalCandidateCount, 0);
});

test('multiple events for one root capability dedupe to one bounded fallback candidate', async () => {
  const { root, repoRoot, candidateDirectory } = await fixture();
  await writeEvent(root, 'same-root-a', capabilityGap({
    eventId: 'same-root-a',
    capabilityId: 'spatial-container-runtime-proof',
  }));
  await writeEvent(root, 'same-root-b', capabilityGap({
    eventId: 'same-root-b',
    capabilityId: 'spatial-container-runtime-proof',
  }));

  const result = await reconcileFlywheelLearningGoalsV1({
    root,
    repoRoot,
    nowUtc: NOW,
    buildConciergeGoalOptions: { directory: candidateDirectory },
  });

  assert.equal(result.ok, true);
  assert.equal(result.observedActionableEventCount, 2);
  assert.equal(result.createdGoalCandidateCount, 1);
  assert.equal(result.dedupedGoalCandidateCount, 1);
  assert.equal(result.createdGoalCandidateIds.length, 1);
  assert.equal(result.dedupedGoalCandidateIds.length, 1);
});


test('recovery from another participant cannot clear the same capability gap', async () => {
  const { root, repoRoot, candidateDirectory } = await fixture();
  await writeEvent(root, 'participant-a-gap', createSharedWorkspaceEventRecord({
    eventId: 'participant-a-gap',
    participantId: 'vr-agent-a',
    timestampUtc: '2026-10-03T12:00:00.000Z',
    eventKind: 'capability-gap',
    summary: 'Spatial container proof is missing for participant A.',
    capabilityFailure: {
      failureClass: 'CAPABILITY_GAP',
      genuineCapabilityFailure: true,
      capabilityId: 'spatial-container-runtime-proof',
      attemptedBy: 'vr-agent-a',
      taskId: 'participant-a-gap',
    },
  }));
  await writeEvent(root, 'participant-b-recovery', createSharedWorkspaceEventRecord({
    eventId: 'participant-b-recovery',
    participantId: 'vr-agent-b',
    timestampUtc: '2026-10-03T12:05:00.000Z',
    eventKind: 'capability-recovery',
    summary: 'Participant B proved spatial container runtime support.',
    learningCandidate: {
      capabilityId: 'spatial-container-runtime-proof',
      requiresExistingGoalSearch: false,
      repairReplayRequired: false,
    },
  }));

  const result = await reconcileFlywheelLearningGoalsV1({
    root,
    repoRoot,
    nowUtc: '2026-10-03T12:10:00.000Z',
    buildConciergeGoalOptions: { directory: candidateDirectory },
  });

  assert.equal(result.ok, true);
  assert.equal(result.observedActionableEventCount, 1);
  assert.equal(result.resolvedHistoricalEventCount, 0);
  assert.equal(result.createdGoalCandidateCount, 1);
});


test('capability marker dedupe requires an exact token and does not collide with longer IDs', async () => {
  const { root, repoRoot, candidateDirectory } = await fixture();
  await writeEvent(root, 'long-capability', capabilityGap({
    eventId: 'long-capability-event',
    capabilityId: 'foo-bar',
  }));

  const first = await reconcileFlywheelLearningGoalsV1({
    root,
    repoRoot,
    nowUtc: NOW,
    buildConciergeGoalOptions: { directory: candidateDirectory },
  });
  assert.equal(first.createdGoalCandidateCount, 1);

  await writeEvent(root, 'short-capability', capabilityGap({
    eventId: 'short-capability-event',
    capabilityId: 'foo',
  }));

  const second = await reconcileFlywheelLearningGoalsV1({
    root,
    repoRoot,
    nowUtc: NOW,
    buildConciergeGoalOptions: { directory: candidateDirectory },
  });

  assert.equal(second.observedActionableEventCount, 2);
  assert.equal(second.dedupedGoalCandidateCount, 1);
  assert.equal(second.createdGoalCandidateCount, 1);
});


test('failed and incomplete recovery events do not suppress repair admission', async () => {
  const { root, repoRoot, candidateDirectory } = await fixture();
  await writeEvent(root, 'negative-service-gap', capabilityGap({
    eventId: 'negative-service-gap',
    capabilityId: 'negative-service-proof',
  }));
  await writeEvent(root, 'negative-service-incomplete', {
    ...createSharedWorkspaceEventRecord({
      eventId: 'negative-service-incomplete',
      participantId: 'sovereign-commander',
      timestampUtc: '2026-10-03T12:05:00.000Z',
      eventKind: 'capability-recovery',
      summary: 'Recovery attempt incomplete.',
      learningCandidate: {
        capabilityId: 'negative-service-proof',
        requiresExistingGoalSearch: false,
        testAndProofRefs: ['proof/incomplete'],
      },
    }),
    status: 'INCOMPLETE',
  });
  await writeEvent(root, 'negative-service-failed', {
    ...createSharedWorkspaceEventRecord({
      eventId: 'negative-service-failed',
      participantId: 'sovereign-commander',
      timestampUtc: '2026-10-03T12:06:00.000Z',
      eventKind: 'capability-recovery-failed',
      summary: 'Recovery attempt failed.',
      learningCandidate: {
        capabilityId: 'negative-service-proof',
        requiresExistingGoalSearch: false,
        testAndProofRefs: ['proof/failed'],
      },
    }),
    status: 'FAILED',
  });

  const result = await reconcileFlywheelLearningGoalsV1({
    root,
    repoRoot,
    nowUtc: '2026-10-03T12:10:00.000Z',
    buildConciergeGoalOptions: { directory: candidateDirectory },
  });

  assert.equal(result.ok, true);
  assert.equal(result.observedActionableEventCount, 1);
  assert.equal(result.resolvedHistoricalEventCount, 0);
  assert.equal(result.createdGoalCandidateCount, 1);
});

test('failed final verdict keeps repair admission open despite intermediate complete status', async () => {
  const { root, repoRoot, candidateDirectory } = await fixture();
  await writeEvent(root, 'conflict-gap', capabilityGap({
    eventId: 'conflict-gap',
    capabilityId: 'conflicting-recovery-proof',
  }));
  await writeEvent(root, 'conflict-recovery', {
    ...createSharedWorkspaceEventRecord({
      eventId: 'conflict-recovery',
      participantId: 'sovereign-commander',
      timestampUtc: '2026-10-03T12:05:00.000Z',
      eventKind: 'capability-recovery',
      summary: 'Attempt completed but final verdict failed.',
      learningCandidate: {
        capabilityId: 'conflicting-recovery-proof',
        requiresExistingGoalSearch: false,
        repairReplayRequired: false,
        testAndProofRefs: ['proof/conflict-attempt'],
      },
    }),
    status: 'COMPLETE',
    finalVerdict: 'FAILED',
  });

  const result = await reconcileFlywheelLearningGoalsV1({
    root,
    repoRoot,
    nowUtc: '2026-10-03T12:10:00.000Z',
    buildConciergeGoalOptions: { directory: candidateDirectory },
  });

  assert.equal(result.observedActionableEventCount, 1);
  assert.equal(result.resolvedHistoricalEventCount, 0);
  assert.equal(result.createdGoalCandidateCount, 1);
});
