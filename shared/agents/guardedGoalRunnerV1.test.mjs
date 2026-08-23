import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GUARDED_GOAL_RUNNER_V1_BLOCKER_CLASSES as C,
  GUARDED_GOAL_RUNNER_V1_BLOCKERS as B,
  GUARDED_GOAL_RUNNER_V1_OUTCOMES as O,
  classifyGuardedGoalRunnerV1,
  readGuardedGoalRunnerV1ProofPacket,
} from './guardedGoalRunnerV1.mjs';

const expectedHeadSha = '37915edd61a319c3a1f3e456605986ab637a59fd';

function packet(blocker, overrides = {}) {
  return {
    authorizedGoal: '1506',
    supervisorCurrentRecord: { blocker, expectedHeadSha, currentPhase: 'repairing', trafficLight: 'yellow' },
    currentSourceHead: { sha: expectedHeadSha },
    prProof: { publicationState: 'pending-automated-publication', prNumber: null, prUrl: null, expectedBaseSha: 'base1', baseSha: 'base1', expectedHeadSha, headSha: expectedHeadSha, mergeable: true, conflicting: false, draft: false, changedFiles: { count: 1 }, testsRun: { allGreen: true }, operatorApprovalRequired: false },
    logPaths: ['logs/openclaw-supervisor.json'],
    allowedTests: ['node --test shared/agents/guardedGoalRunner*.test.mjs'],
    ...overrides,
  };
}

test('#1291 replay advances one known blocker at a time and completes only on green exact-head proof', () => {
  const trace = [
    B.CONFIG_WRITE_REJECTED,
    B.STARTUP_TOKEN_MISSING,
    B.STARTUP_APPROVAL_REQUIRED,
    B.SPAWN_OPENCLAW_ENOENT,
    B.SPAWN_EINVAL,
    B.OPENCLAW_HEALTH_LIVE,
  ];

  const seen = [];
  for (const blocker of trace) {
    const next = classifyGuardedGoalRunnerV1(packet(blocker, { priorBlockers: seen }));
    assert.equal(next.outcome, O.KNOWN_BLOCKER_NEXT_PATCH);
    assert.equal(next.blocker, blocker);
    assert.equal(next.executesShell, false);
    seen.push(blocker);
  }

  const notReady = classifyGuardedGoalRunnerV1(packet(B.SERVED_RUNTIME_EXACT_HEAD_GREEN, {
    priorBlockers: seen,
    supervisorCurrentRecord: { blocker: B.SERVED_RUNTIME_EXACT_HEAD_GREEN, expectedHeadSha, currentPhase: 'starting', trafficLight: 'green' },
  }));
  assert.equal(notReady.outcome, O.KNOWN_BLOCKER_NEXT_PATCH);

  const green = classifyGuardedGoalRunnerV1(packet(B.SERVED_RUNTIME_EXACT_HEAD_GREEN, {
    priorBlockers: seen,
    supervisorCurrentRecord: { blocker: B.SERVED_RUNTIME_EXACT_HEAD_GREEN, expectedHeadSha, currentPhase: 'ready', trafficLight: 'green' },
  }));
  assert.equal(green.outcome, O.ROUTE_TO_AUTOMATED_PUBLICATION);
  assert.equal(green.publication.requiresNewOperatorApproval, false);
  assert.equal(green.publication.authority.inherited, true);
});

test('buildable capability gap advances an existing owning goal under inherited standing authority', () => {
  const result = classifyGuardedGoalRunnerV1(packet('codex-review-trigger-missed', {
    blockerClassification: {
      class: C.BUILDABLE_CAPABILITY_GAP,
      owningGoal: '1509',
      evidenceRefs: ['PR #1513 head 28bc2cb5934dfd9f71eebcb2ae4c9d3c6fe0d32f'],
    },
  }));
  assert.equal(result.outcome, O.ADVANCE_EXISTING_CAPABILITY_GOAL);
  assert.equal(result.capability.owningGoal, '1509');
  assert.equal(result.capability.resumeGoal, '1506');
  assert.equal(result.capability.authority.requiresNewOperatorApproval, false);
  assert.ok(result.capability.authority.allows.includes('bounded-source-build'));
});

test('unsafe mutation guard runs before governed capability dispatch', () => {
  for (const kind of ['secret-access', 'destructive-mutation', 'arbitrary-shell']) {
    const result = classifyGuardedGoalRunnerV1(packet('classified-capability-gap', {
      blockerClassification: { class: C.BUILDABLE_CAPABILITY_GAP, owningGoal: '1509' },
      requestedMutation: { kind },
    }));
    assert.equal(result.outcome, O.ABORT_UNKNOWN_BLOCKER);
    assert.match(result.reason, /Unsafe mutation/);
    assert.equal(result.capability, null);
  }
});

test('buildable capability gap searches existing goals before creating a new one', () => {
  const result = classifyGuardedGoalRunnerV1(packet('missing-proof-return-channel', {
    blockerClassification: { class: C.BUILDABLE_CAPABILITY_GAP },
  }));
  assert.equal(result.outcome, O.SEARCH_CAPABILITY_OWNER);
  assert.equal(result.capability.action, 'search-existing-goals');
});

test('buildable capability gap creates only a minimal goal after duplicate search completes', () => {
  const result = classifyGuardedGoalRunnerV1(packet('missing-review-delivery-watchdog', {
    blockerClassification: {
      class: C.BUILDABLE_CAPABILITY_GAP,
      duplicateSearchComplete: true,
      proposedGoalTitle: 'Review Delivery Watchdog V1',
    },
  }));
  assert.equal(result.outcome, O.CREATE_MINIMAL_CAPABILITY_GOAL);
  assert.equal(result.capability.action, 'create-minimal-goal');
  assert.equal(result.capability.authority.requiresNewOperatorApproval, false);
});

test('governed blockers distinguish genuine operator, hardware, and external gates', () => {
  assert.equal(classifyGuardedGoalRunnerV1(packet('legal-consent', { blockerClassification: C.GENUINE_OPERATOR_APPROVAL_GATE })).outcome, O.WAIT_FOR_GENUINE_OPERATOR_APPROVAL);
  assert.equal(classifyGuardedGoalRunnerV1(packet('physical-cold-boot', { blockerClassification: C.GENUINE_LOCAL_HARDWARE_PROOF })).outcome, O.WAIT_FOR_LOCAL_HARDWARE_PROOF);
  assert.equal(classifyGuardedGoalRunnerV1(packet('third-party-outage', { blockerClassification: C.EXTERNAL_UNBUILDABLE_BLOCKER })).outcome, O.ABORT_EXTERNAL_UNBUILDABLE);
});

test('published clean PR with green exact head emits merge gate but does not merge', () => {
  const result = classifyGuardedGoalRunnerV1(packet(B.SERVED_RUNTIME_EXACT_HEAD_GREEN, {
    supervisorCurrentRecord: { blocker: B.SERVED_RUNTIME_EXACT_HEAD_GREEN, expectedHeadSha, currentPhase: 'ready', trafficLight: 'green' },
    prProof: { publicationState: 'published', prNumber: 1497, prUrl: 'https://github.com/example/repo/pull/1497', expectedBaseSha: 'base1', baseSha: 'base1', expectedHeadSha, headSha: expectedHeadSha, mergeable: true, conflicting: false, draft: false, changedFiles: { count: 1 }, testsRun: { allGreen: true }, operatorApprovalRequired: true },
  }));
  assert.equal(result.outcome, O.SAFE_TO_MERGE_WITH_EXPECTED_HEAD);
  assert.equal(result.mergeGate.performsMerge, false);
  assert.equal(result.performsShellExecution, false);
});

test('aborts on repeated same known blocker', () => {
  const result = classifyGuardedGoalRunnerV1(packet(B.SPAWN_EINVAL, { priorBlockers: [B.SPAWN_EINVAL] }));
  assert.equal(result.outcome, O.ABORT_REPEATED_BLOCKER);
});

test('aborts on unknown blocker without governed classification', () => {
  const result = classifyGuardedGoalRunnerV1(packet('mystery-failure'));
  assert.equal(result.outcome, O.ABORT_UNKNOWN_BLOCKER);
});

test('aborts on missing proof file', () => {
  const result = readGuardedGoalRunnerV1ProofPacket('/tmp/stephanos-missing-proof-file.json');
  assert.equal(result.ok, false);
  assert.equal(result.nextAction.outcome, O.ABORT_MISSING_PROOF);
});

test('aborts on stale PR base', () => {
  const result = classifyGuardedGoalRunnerV1(packet(B.OPENCLAW_HEALTH_LIVE, { prProof: { publicationState: 'published', prNumber: 1, prUrl: 'u', expectedBaseSha: 'base1', baseSha: 'base2', expectedHeadSha, headSha: expectedHeadSha, mergeable: true, conflicting: false, draft: false, testsRun: { allGreen: true } } }));
  assert.equal(result.outcome, O.ABORT_STALE_BASE);
});

test('aborts on conflicting PR', () => {
  const result = classifyGuardedGoalRunnerV1(packet(B.OPENCLAW_HEALTH_LIVE, { prProof: { publicationState: 'published', prNumber: 1, prUrl: 'u', expectedBaseSha: 'base1', baseSha: 'base1', expectedHeadSha, headSha: expectedHeadSha, mergeable: false, conflicting: true, draft: false, testsRun: { allGreen: true } } }));
  assert.equal(result.outcome, O.ABORT_CONFLICTING_PR);
});

test('aborts on missing expected_head_sha', () => {
  const result = classifyGuardedGoalRunnerV1(packet(B.OPENCLAW_HEALTH_LIVE, { prProof: { publicationState: 'published', prNumber: 1, prUrl: 'u', expectedBaseSha: 'base1', baseSha: 'base1', headSha: expectedHeadSha, mergeable: true, conflicting: false, draft: false, testsRun: { allGreen: true } } }));
  assert.equal(result.outcome, O.ABORT_MISSING_EXPECTED_HEAD);
});

test('aborts on unsafe mutation request', () => {
  const result = classifyGuardedGoalRunnerV1(packet(B.STARTUP_TOKEN_MISSING, { requestedMutation: { kind: 'openclaw-config-write' } }));
  assert.equal(result.outcome, O.ABORT_UNKNOWN_BLOCKER);
  assert.match(result.reason, /Unsafe mutation/);
});

test('aborts when PR proof packet is missing', () => {
  const result = classifyGuardedGoalRunnerV1(packet(B.SERVED_RUNTIME_EXACT_HEAD_GREEN, {
    supervisorCurrentRecord: { blocker: B.SERVED_RUNTIME_EXACT_HEAD_GREEN, expectedHeadSha, currentPhase: 'ready', trafficLight: 'green' },
    prProof: null,
  }));
  assert.equal(result.outcome, O.ABORT_MISSING_PROOF);
});

test('stops and reports when PR proof is draft or tests are not green', () => {
  const draft = classifyGuardedGoalRunnerV1(packet(B.SERVED_RUNTIME_EXACT_HEAD_GREEN, {
    supervisorCurrentRecord: { blocker: B.SERVED_RUNTIME_EXACT_HEAD_GREEN, expectedHeadSha, currentPhase: 'ready', trafficLight: 'green' },
    prProof: { publicationState: 'published', prNumber: 1497, prUrl: 'https://github.com/example/repo/pull/1497', expectedBaseSha: 'base1', baseSha: 'base1', expectedHeadSha, headSha: expectedHeadSha, mergeable: true, conflicting: false, draft: true, testsRun: { allGreen: true } },
  }));
  assert.equal(draft.outcome, O.STOP_AND_REPORT);

  const testsMissing = classifyGuardedGoalRunnerV1(packet(B.SERVED_RUNTIME_EXACT_HEAD_GREEN, {
    supervisorCurrentRecord: { blocker: B.SERVED_RUNTIME_EXACT_HEAD_GREEN, expectedHeadSha, currentPhase: 'ready', trafficLight: 'green' },
    prProof: { publicationState: 'published', prNumber: 1497, prUrl: 'https://github.com/example/repo/pull/1497', expectedBaseSha: 'base1', baseSha: 'base1', expectedHeadSha, headSha: expectedHeadSha, mergeable: true, conflicting: false, draft: false, testsRun: { allGreen: false } },
  }));
  assert.equal(testsMissing.outcome, O.STOP_AND_REPORT);
});
