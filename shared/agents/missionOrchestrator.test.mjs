import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MISSION_ORCHESTRATOR_MAX_REPAIR_ROUNDS,
  applyMissionOrchestratorEvent,
  buildMissionOperationsSnapshot,
  createMissionOrchestratorState,
} from './missionOrchestrator.mjs';

const base = {
  missionId: 'mission-orchestrator-test',
  title: 'Mission Orchestrator test',
  operatorIntent: 'Implement a bounded source change and promote it through a verified pull request.',
  intendedOutcome: 'The source change is merged, locally rebuilt, verified, and restarted.',
  missionKind: 'implementation',
  repository: 'Cheekyfellastef/stephan-os',
  repositoryRoot: 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os',
  branch: 'orchestrator/mission-orchestrator-test',
  worktreePath: 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os-worktrees\\mission-orchestrator-test',
  allowedFiles: ['shared/agents/**', 'tests/**'],
  requiredEvidence: ['focused test output', 'build verification'],
  requiredTests: ['node --test shared/agents/missionOrchestrator.test.mjs', 'npm run stephanos:verify'],
};

const timestamp = (minute) => `2026-06-24T21:${String(minute).padStart(2, '0')}:00.000Z`;

function receipt(requirement, id, extra = {}) {
  return {
    receiptId: id,
    requirement,
    source: extra.source || 'deterministic-test',
    evidenceType: extra.evidenceType || 'command-output',
    verified: true,
    exitCode: 0,
    createdAt: extra.createdAt || timestamp(0),
    ...extra,
  };
}

function event(state, eventType, fields = {}, minute = state.revision + 1) {
  return applyMissionOrchestratorEvent(state, {
    eventType,
    missionId: state.missionId,
    timestamp: timestamp(minute),
    ...fields,
  });
}

function advanceToOpenPullRequest() {
  let state = createMissionOrchestratorState(base, { now: new Date(timestamp(0)) });
  state = event(state, 'WORKTREE_READY', {
    worktreePath: base.worktreePath,
    clean: true,
    receipt: receipt('isolated worktree', 'worktree-receipt'),
  });
  state = event(state, 'AGENT_DISPATCHED', {
    agentId: 'codex',
    actionId: 'codex-action-1',
    workerId: 'codex',
  });
  state = event(state, 'AGENT_RESULT_RECEIVED', {
    actionId: 'codex-action-1',
    workerId: 'codex',
    success: true,
    resultId: 'codex-result-1',
    changedFiles: ['shared/agents/missionOrchestrator.mjs', 'shared/agents/missionOrchestrator.test.mjs'],
    receipt: receipt('codex result', 'codex-result-receipt'),
  });
  state = event(state, 'EVIDENCE_RECORDED', {
    receipts: [
      receipt('focused test output', 'focused-tests'),
      receipt('build verification', 'build-verification', { sha256: 'a'.repeat(64) }),
    ],
  });
  state = event(state, 'GIT_OPERATION_COMPLETED', {
    operation: 'commit',
    commitSha: '1'.repeat(40),
    clean: true,
    receipt: receipt('signed git commit', 'commit-receipt'),
  });
  state = event(state, 'GIT_OPERATION_COMPLETED', {
    operation: 'push',
    success: true,
    receipt: receipt('signed git push', 'push-receipt'),
  });
  state = event(state, 'PULL_REQUEST_OPENED', {
    prNumber: 1300,
    prUrl: 'https://github.com/Cheekyfellastef/stephan-os/pull/1300',
    headSha: '2'.repeat(40),
    mergeable: true,
    receipt: receipt('pull request creation', 'pr-receipt'),
  });
  return state;
}

test('implementation intake chooses OpenClaw worktree setup then Codex as the sole source writer', () => {
  const state = createMissionOrchestratorState(base, { now: new Date(timestamp(0)) });
  assert.equal(state.currentPhase, 'CREATE_WORKTREE');
  assert.equal(state.activeAgent.agentId, 'openclaw-standalone');
  assert.equal(state.activeWriter, 'none');
  assert.equal(state.simultaneousWritersAllowed, false);
  assert.deepEqual(state.nextAction, {
    type: 'OPENCLAW_SIGNED_OPERATION',
    operation: 'create-worktree',
    owner: 'OpenClaw',
    approvalRequired: false,
  });

  const afterWorktree = event(state, 'WORKTREE_READY', {
    worktreePath: base.worktreePath,
    clean: true,
    receipt: receipt('isolated worktree', 'worktree-receipt'),
  });
  assert.equal(afterWorktree.currentPhase, 'AGENT_IMPLEMENTATION');
  assert.equal(afterWorktree.activeAgent.agentId, 'codex');
  assert.equal(afterWorktree.activeWriter, 'Codex');
});

test('qualified OpenClaw local is a registered implementation adapter', () => {
  let state = createMissionOrchestratorState(base, { now: new Date(timestamp(0)) });
  state = event(state, 'WORKTREE_READY', {
    worktreePath: base.worktreePath,
    clean: true,
    receipt: receipt('isolated worktree', 'worktree-openclaw-local'),
  });
  state = event(state, 'AGENT_DISPATCHED', {
    agentId: 'openclaw-local',
    adapter: 'openclaw-local',
    actionId: 'openclaw-local-action-001',
    workerId: 'battle-bridge-openclaw-01',
  });
  assert.equal(state.currentPhase, 'AGENT_IMPLEMENTATION');
  assert.equal(state.dispatch.adapter, 'openclaw-local');
  assert.equal(state.dispatch.status, 'running');
  assert.equal(state.dispatch.actionId, 'openclaw-local-action-001');
  assert.equal(state.dispatch.workerId, 'battle-bridge-openclaw-01');
  assert.equal(state.activeWriter, 'openclaw-local');
});

test('every new agent handoff and result requires the same exact action and worker identity', () => {
  let ready = createMissionOrchestratorState(base, { now: new Date(timestamp(0)) });
  ready = event(ready, 'WORKTREE_READY', {
    worktreePath: base.worktreePath,
    clean: true,
    receipt: receipt('isolated worktree', 'worktree-exact-binding'),
  });
  for (const incomplete of [
    { agentId: 'codex', workerId: 'codex' },
    { agentId: 'codex', actionId: 'codex-exact-action' },
  ]) {
    const blocked = event(ready, 'AGENT_DISPATCHED', incomplete);
    assert.equal(blocked.currentPhase, 'BLOCKED');
    assert.match(blocked.blockers.join(' '), /exact action and worker identity/i);
  }

  const running = event(ready, 'AGENT_DISPATCHED', {
    agentId: 'codex',
    actionId: 'codex-exact-action',
    workerId: 'codex',
  });
  const stale = event(running, 'AGENT_RESULT_RECEIVED', {
    actionId: 'codex-stale-action',
    workerId: 'codex',
    success: true,
    receipt: receipt('codex result', 'codex-stale-result'),
  });
  assert.equal(stale.currentPhase, 'BLOCKED');
  assert.match(stale.blockers.join(' '), /active action and worker/i);
});

test('unsafe, vague, or evidence-free intent blocks before dispatch', () => {
  const unsafe = createMissionOrchestratorState({
    ...base,
    missionId: 'unknown',
    operatorIntent: '',
    allowedFiles: ['apps/stephanos/dist/**', '.env'],
    requiredEvidence: [],
  });
  assert.equal(unsafe.currentPhase, 'BLOCKED');
  assert.equal(unsafe.activeWriter, 'none');
  assert.match(unsafe.blockers.join(' '), /intent|required evidence|forbidden/i);
});

test('full implementation lifecycle requires evidence, exact approval, merge receipt, and all local deployment steps', () => {
  let state = advanceToOpenPullRequest();
  assert.equal(state.currentPhase, 'CHECK_PULL_REQUEST');

  state = event(state, 'PULL_REQUEST_CHECKS_UPDATED', {
    prNumber: 1300,
    headSha: '2'.repeat(40),
    prState: 'open',
    mergeable: true,
    checks: [
      { name: 'PR Clean Guard', status: 'success', required: true },
      { name: 'Build Stephanos UI', status: 'success', required: true },
    ],
    receipt: receipt('pull request checks', 'checks-receipt'),
  });
  assert.equal(state.currentPhase, 'AWAITING_OPERATOR_APPROVAL');
  assert.equal(state.operatorActionRequired, true);
  assert.equal(state.approval.requiredToken, `APPROVE_OPENCLAW_SQUASH_MERGE:1300:${'2'.repeat(40)}`);

  state = event(state, 'OPERATOR_APPROVAL_RECORDED', {
    approvalToken: state.approval.requiredToken,
    approvalTokenHash: 'b'.repeat(64),
  });
  assert.equal(state.currentPhase, 'MERGE_PULL_REQUEST');
  assert.equal(state.approval.status, 'approved');

  state = event(state, 'PULL_REQUEST_MERGED', {
    mergeCommitSha: '3'.repeat(40),
    receipt: receipt('approved squash merge', 'merge-receipt'),
  });
  assert.equal(state.currentPhase, 'LOCAL_DEPLOYMENT');

  for (const [index, step] of ['sync', 'build', 'verify', 'restart'].entries()) {
    state = event(state, 'LOCAL_DEPLOYMENT_STEP_RECORDED', {
      step,
      success: true,
      commitSha: '3'.repeat(40),
      receipt: receipt(`local ${step}`, `local-${step}-receipt`),
    }, 20 + index);
  }

  assert.equal(state.currentPhase, 'COMPLETE');
  assert.equal(state.finalVerdict, 'MISSION_ORCHESTRATOR_COMPLETE');
  assert.equal(state.operatorActionRequired, false);
});

test('stale or incorrect merge approval blocks instead of advancing', () => {
  let state = advanceToOpenPullRequest();
  state = event(state, 'PULL_REQUEST_CHECKS_UPDATED', {
    prNumber: 1300,
    headSha: '2'.repeat(40),
    prState: 'open',
    mergeable: true,
    checks: [{ name: 'required', status: 'success', required: true }],
  });
  state = event(state, 'OPERATOR_APPROVAL_RECORDED', {
    approvalToken: `APPROVE_OPENCLAW_SQUASH_MERGE:1300:${'9'.repeat(40)}`,
  });
  assert.equal(state.currentPhase, 'BLOCKED');
  assert.match(state.blockers.join(' '), /exact pull request head/i);
  assert.equal(state.pullRequest.merged, false);
});

test('failed checks route to bounded Codex repair and the third failed round blocks', () => {
  let state = advanceToOpenPullRequest();
  state.repair.currentRound = MISSION_ORCHESTRATOR_MAX_REPAIR_ROUNDS;
  state = event(state, 'PULL_REQUEST_CHECKS_UPDATED', {
    prNumber: 1300,
    headSha: '2'.repeat(40),
    prState: 'open',
    mergeable: true,
    checks: [{ name: 'Build', status: 'failure', required: true }],
  });
  assert.equal(state.currentPhase, 'BLOCKED');
  assert.match(state.blockers.join(' '), /maximum repair rounds/i);
  assert.equal(state.activeWriter, 'none');
});

test('a repair round resets only implementation promotion state and keeps evidence history', () => {
  let state = advanceToOpenPullRequest();
  const evidenceCount = state.evidenceReceipts.length;
  state = event(state, 'PULL_REQUEST_CHECKS_UPDATED', {
    prNumber: 1300,
    headSha: '2'.repeat(40),
    prState: 'open',
    mergeable: true,
    checks: [{ name: 'Build', status: 'failure', required: true }],
  });
  assert.equal(state.currentPhase, 'REPAIR_REQUIRED');

  state = event(state, 'REPAIR_STARTED');
  assert.equal(state.repair.currentRound, 1);
  assert.equal(state.currentPhase, 'AGENT_IMPLEMENTATION');
  assert.equal(state.activeWriter, 'Codex');
  assert.equal(state.git.worktreeReady, true);
  assert.equal(state.git.commitSha, '');
  assert.equal(state.git.pushed, false);
  assert.equal(state.evidenceReceipts.length, evidenceCount);
});

test('live runtime investigation dispatches OpenClaw read-only and completes only with verified evidence', () => {
  let state = createMissionOrchestratorState({
    missionId: 'runtime-investigation',
    operatorIntent: 'Inspect the live browser runtime and collect screenshot proof.',
    intendedOutcome: 'The runtime behavior is deterministically verified.',
    missionKind: 'live-runtime-investigation',
    repository: 'Cheekyfellastef/stephan-os',
    branch: 'orchestrator/runtime-investigation',
    allowedFiles: [],
    requiredEvidence: ['browser proof'],
    requiredTests: [],
    browserProofRequired: true,
  });
  assert.equal(state.currentPhase, 'LIVE_RUNTIME_INVESTIGATION');
  assert.equal(state.activeAgent.agentId, 'openclaw-standalone');
  assert.equal(state.activeWriter, 'none');

  state = event(state, 'AGENT_DISPATCHED', {
    agentId: 'openclaw-standalone',
    actionId: 'openclaw-readonly-action-1',
    workerId: 'openclaw-standalone',
  });
  state = event(state, 'AGENT_RESULT_RECEIVED', {
    actionId: 'openclaw-readonly-action-1',
    workerId: 'openclaw-standalone',
    success: true,
    resultId: 'openclaw-browser-result',
    changedFiles: [],
    receipt: receipt('browser proof', 'browser-proof', { receiptPath: 'proof/browser/runtime.png' }),
  });
  assert.equal(state.currentPhase, 'COMPLETE');
  assert.equal(state.activeWriter, 'none');
});

test('Mission Operations snapshot exposes phase, agents, repair, approval, Git, receipts, and deployment progress', () => {
  const state = advanceToOpenPullRequest();
  const snapshot = buildMissionOperationsSnapshot(state, { now: new Date(timestamp(30)) });
  assert.equal(snapshot.schemaVersion, 'stephanos.mission-operations-snapshot.v1');
  assert.equal(snapshot.missionId, state.missionId);
  assert.equal(snapshot.currentPhase, 'CHECK_PULL_REQUEST');
  assert.equal(snapshot.activeAgent.agentId, 'openclaw-standalone');
  assert.equal(snapshot.github.branch, base.branch);
  assert.equal(snapshot.github.prNumber, 1300);
  assert.equal(snapshot.approvals[0].status, 'pending');
  assert.equal(snapshot.repair.maximumRounds, 3);
  assert.equal(snapshot.deployment.sync.status, 'pending');
  assert.ok(snapshot.receipts.length >= 1);
  assert.match(snapshot.warnings.join(' '), /Repair round 0\/3/);
});
