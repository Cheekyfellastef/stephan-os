import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GUARDED_GOAL_RUNNER_V1_BLOCKERS as B,
  GUARDED_GOAL_RUNNER_V1_OUTCOMES as O,
  classifyGuardedGoalRunnerV1,
  readGuardedGoalRunnerV1ProofPacket,
} from './guardedGoalRunnerV1.mjs';

const expectedHeadSha = '37915edd61a319c3a1f3e456605986ab637a59fd';

function packet(blocker, overrides = {}) {
  return {
    supervisorCurrentRecord: { blocker, expectedHeadSha, currentPhase: 'repairing', trafficLight: 'yellow' },
    currentSourceHead: { sha: expectedHeadSha },
    prPublicationStatus: { state: 'draft-local' },
    pr: { expectedBaseSha: 'base1', baseSha: 'base1', expectedHeadSha, headSha: expectedHeadSha, mergeable: true, conflicting: false },
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
    prPublicationStatus: { state: 'none' },
  }));
  assert.equal(green.outcome, O.NEEDS_OPERATOR_PR_CREATE_CLICK);
  assert.match(green.operatorApproval.action, /Create PR/);
});

test('published clean PR with green exact head emits merge gate but does not merge', () => {
  const result = classifyGuardedGoalRunnerV1(packet(B.SERVED_RUNTIME_EXACT_HEAD_GREEN, {
    supervisorCurrentRecord: { blocker: B.SERVED_RUNTIME_EXACT_HEAD_GREEN, expectedHeadSha, currentPhase: 'ready', trafficLight: 'green' },
    prPublicationStatus: { state: 'published' },
    pr: { expectedBaseSha: 'base1', baseSha: 'base1', expectedHeadSha, headSha: expectedHeadSha, mergeable: true, conflicting: false, prNumber: 1497 },
  }));
  assert.equal(result.outcome, O.SAFE_TO_MERGE_WITH_EXPECTED_HEAD);
  assert.equal(result.mergeGate.performsMerge, false);
});

test('aborts on repeated same blocker', () => {
  const result = classifyGuardedGoalRunnerV1(packet(B.SPAWN_EINVAL, { priorBlockers: [B.SPAWN_EINVAL] }));
  assert.equal(result.outcome, O.ABORT_REPEATED_BLOCKER);
});

test('aborts on unknown blocker', () => {
  const result = classifyGuardedGoalRunnerV1(packet('mystery-failure'));
  assert.equal(result.outcome, O.ABORT_UNKNOWN_BLOCKER);
});

test('aborts on missing proof file', () => {
  const result = readGuardedGoalRunnerV1ProofPacket('/tmp/stephanos-missing-proof-file.json');
  assert.equal(result.ok, false);
  assert.equal(result.nextAction.outcome, O.ABORT_MISSING_PROOF);
});

test('aborts on stale PR base', () => {
  const result = classifyGuardedGoalRunnerV1(packet(B.OPENCLAW_HEALTH_LIVE, { pr: { expectedBaseSha: 'base1', baseSha: 'base2', expectedHeadSha, headSha: expectedHeadSha, mergeable: true } }));
  assert.equal(result.outcome, O.ABORT_STALE_BASE);
});

test('aborts on conflicting PR', () => {
  const result = classifyGuardedGoalRunnerV1(packet(B.OPENCLAW_HEALTH_LIVE, { pr: { expectedBaseSha: 'base1', baseSha: 'base1', expectedHeadSha, headSha: expectedHeadSha, mergeable: false, conflicting: true } }));
  assert.equal(result.outcome, O.ABORT_CONFLICTING_PR);
});

test('aborts on missing expected_head_sha', () => {
  const result = classifyGuardedGoalRunnerV1(packet(B.OPENCLAW_HEALTH_LIVE, { pr: { expectedBaseSha: 'base1', baseSha: 'base1', headSha: expectedHeadSha, mergeable: true } }));
  assert.equal(result.outcome, O.ABORT_MISSING_PROOF);
});

test('aborts on unsafe mutation request', () => {
  const result = classifyGuardedGoalRunnerV1(packet(B.STARTUP_TOKEN_MISSING, { requestedMutation: { kind: 'openclaw-config-write' } }));
  assert.equal(result.outcome, O.ABORT_UNKNOWN_BLOCKER);
  assert.match(result.reason, /Unsafe mutation/);
});
