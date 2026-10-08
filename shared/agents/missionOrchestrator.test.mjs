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
  state = event(state, 'AGENT_DISPATCHED', { agentId: 'codex' });
  state = event(state, 'AGENT_RESULT_RECEIVED', {
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

test('repository-wide scope permits safe source files but still blocks forbidden runtime paths', () => {
  const scopedBase = { ...base, missionId: 'repo-wide-scope-test', allowedFiles: ['**'], branch: 'openclaw/repo-wide-scope-test' };
  let safe = createMissionOrchestratorState(scopedBase, { now: new Date(timestamp(0)) });
  safe = event(safe, 'WORKTREE_READY', {
    worktreePath: scopedBase.worktreePath,
    clean: true,
    receipt: receipt('isolated worktree', 'repo-wide-worktree'),
  });
  safe = event(safe, 'AGENT_DISPATCHED', { agentId: 'openclaw-standalone' });
  safe = event(safe, 'AGENT_RESULT_RECEIVED', {
    success: true,
    resultId: 'repo-wide-safe-result',
    changedFiles: ['shared/agents/goal-safe.mjs', 'shared/runtime/runtimeAdjudicator.mjs', 'apps/music-tile/data/trackLibrary.js'],
    receipt: receipt('openclaw result', 'repo-wide-safe-result-receipt'),
  });
  assert.equal(safe.currentPhase, 'VERIFYING');

  let blocked = createMissionOrchestratorState(scopedBase, { now: new Date(timestamp(0)) });
  blocked = event(blocked, 'WORKTREE_READY', {
    worktreePath: scopedBase.worktreePath,
    clean: true,
    receipt: receipt('isolated worktree', 'repo-wide-blocked-worktree'),
  });
  blocked = event(blocked, 'AGENT_DISPATCHED', { agentId: 'openclaw-standalone' });
  blocked = event(blocked, 'AGENT_RESULT_RECEIVED', {
    success: true,
    resultId: 'repo-wide-blocked-result',
    changedFiles: ['runtime/unsafe.json'],
    receipt: receipt('openclaw result', 'repo-wide-blocked-result-receipt'),
  });
  assert.equal(blocked.currentPhase, 'BLOCKED');
  assert.match(blocked.blockers.join(' '), /exceeded approved source scope/i);
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

  state = event(state, 'AGENT_DISPATCHED', { agentId: 'openclaw-standalone' });
  state = event(state, 'AGENT_RESULT_RECEIVED', {
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

test('clean exact current main can complete an already-satisfied implementation without a synthetic source change', () => {
  let state = createMissionOrchestratorState(base, { now: new Date(timestamp(0)) });
  state = event(state, 'WORKTREE_READY', {
    worktreePath: base.worktreePath,
    clean: true,
    receipt: receipt('isolated worktree', 'worktree-current-main'),
  });

  const testReceipts = base.requiredTests.map((testCommand, index) => receipt(
    'source deterministic test',
    `current-main-test-${index + 1}`,
    { testCommand },
  ));
  const evidenceReceipts = base.requiredEvidence.map((requirement, index) => receipt(
    requirement,
    `current-main-evidence-${index + 1}`,
  ));

  state = event(state, 'CURRENT_MAIN_SATISFACTION_RECORDED', {
    sourceRevision: '4'.repeat(40),
    canonicalMainHeadSha: '4'.repeat(40),
    worktreeHeadSha: '4'.repeat(40),
    headReceipts: [
      receipt('canonical main head', 'current-main-head', { headSha: '4'.repeat(40), commandOutputHash: '8'.repeat(64) }),
      receipt('worktree head', 'current-worktree-head', { headSha: '4'.repeat(40), commandOutputHash: '9'.repeat(64) }),
    ],
    worktreeClean: true,
    changedFiles: [],
    testReceipts,
    evidenceReceipts,
    receipt: receipt('current main acceptance', 'current-main-acceptance', { sha256: '5'.repeat(64) }),
  });

  assert.equal(state.currentPhase, 'COMPLETE');
  assert.equal(state.finalVerdict, 'MISSION_ORCHESTRATOR_COMPLETE');
  assert.equal(state.currentMainAcceptance.verified, true);
  assert.equal(state.currentMainAcceptance.sourceRevision, '4'.repeat(40));
  assert.deepEqual(state.git.changedFiles, []);
  assert.equal(state.git.commitSha, '');
  assert.equal(state.pullRequest.number, null);
  assert.equal(state.operatorActionRequired, false);
  const snapshot = buildMissionOperationsSnapshot(state, { now: new Date(timestamp(20)) });
  assert.equal(snapshot.github.headSha, '4'.repeat(40));
  assert.equal(snapshot.currentMainAcceptance.verified, true);
  assert.equal(snapshot.currentMainAcceptance.sourceRevision, '4'.repeat(40));
  assert.equal(snapshot.currentMainAcceptance.canonicalMainHeadSha, '4'.repeat(40));
  assert.equal(snapshot.currentMainAcceptance.worktreeHeadSha, '4'.repeat(40));
  assert.equal(snapshot.currentMainAcceptance.receiptId, 'current-main-acceptance');
  assert.deepEqual(snapshot.currentMainAcceptance.headReceiptIds, ['current-main-head', 'current-worktree-head']);
  assert.deepEqual(snapshot.currentMainAcceptance.testCommands, base.requiredTests);
});

test('current-main satisfaction fails closed without complete proof or with a source delta', () => {
  let state = createMissionOrchestratorState(base, { now: new Date(timestamp(0)) });
  state = event(state, 'WORKTREE_READY', {
    worktreePath: base.worktreePath,
    clean: true,
    receipt: receipt('isolated worktree', 'worktree-current-main-negative'),
  });

  state = event(state, 'CURRENT_MAIN_SATISFACTION_RECORDED', {
    sourceRevision: '6'.repeat(40),
    canonicalMainHeadSha: '6'.repeat(40),
    worktreeHeadSha: '6'.repeat(40),
    headReceipts: [
      receipt('canonical main head', 'negative-main-head', { headSha: '6'.repeat(40), commandOutputHash: 'a'.repeat(64) }),
      receipt('worktree head', 'negative-worktree-head', { headSha: '6'.repeat(40), commandOutputHash: 'b'.repeat(64) }),
    ],
    worktreeClean: true,
    changedFiles: ['shared/agents/unexpected.mjs'],
    testReceipts: [],
    evidenceReceipts: [],
    receipt: receipt('current main acceptance', 'current-main-acceptance-negative', { sha256: '7'.repeat(64) }),
  });

  assert.equal(state.currentPhase, 'BLOCKED');
  assert.match(state.blockers.join(' '), /zero source delta/i);
  assert.equal(state.currentMainAcceptance.verified, false);
});


test('current-main satisfaction rejects stale or mismatched canonical and worktree heads', () => {
  let state = createMissionOrchestratorState(base, { now: new Date(timestamp(0)) });
  state = event(state, 'WORKTREE_READY', {
    worktreePath: base.worktreePath,
    clean: true,
    receipt: receipt('isolated worktree', 'worktree-current-main-head-mismatch'),
  });
  const testReceipts = base.requiredTests.map((testCommand, index) => receipt(
    'source deterministic test',
    `head-mismatch-test-${index + 1}`,
    { testCommand },
  ));
  const evidenceReceipts = base.requiredEvidence.map((requirement, index) => receipt(
    requirement,
    `head-mismatch-evidence-${index + 1}`,
  ));
  state = event(state, 'CURRENT_MAIN_SATISFACTION_RECORDED', {
    sourceRevision: 'c'.repeat(40),
    canonicalMainHeadSha: 'd'.repeat(40),
    worktreeHeadSha: 'c'.repeat(40),
    headReceipts: [
      receipt('canonical main head', 'mismatch-main-head', { headSha: 'd'.repeat(40), commandOutputHash: 'd'.repeat(64) }),
      receipt('worktree head', 'mismatch-worktree-head', { headSha: 'c'.repeat(40), commandOutputHash: 'c'.repeat(64) }),
    ],
    worktreeClean: true,
    changedFiles: [],
    testReceipts,
    evidenceReceipts,
    receipt: receipt('current main acceptance', 'mismatch-acceptance', { sha256: 'e'.repeat(64) }),
  });
  assert.equal(state.currentPhase, 'BLOCKED');
  assert.match(state.blockers.join(' '), /canonical main HEAD and worktree HEAD bound to the exact source revision/i);
  assert.equal(state.currentMainAcceptance.verified, false);
});


test('bounded retry admission reopens only a whitelisted failed agent result and consumes one repair round', () => {
  let state = createMissionOrchestratorState({
    ...base,
    missionId: 'retryable-agent-failure-test',
    branch: 'openclaw/retryable-agent-failure-test',
  }, { now: new Date(timestamp(0)) });
  state = event(state, 'WORKTREE_READY', {
    worktreePath: base.worktreePath,
    clean: true,
    receipt: receipt('isolated worktree', 'retry-worktree'),
  });
  state = event(state, 'AGENT_DISPATCHED', { agentId: 'foundry-forge' });
  state = event(state, 'AGENT_RESULT_RECEIVED', {
    success: false,
    error: 'PROVIDER_NEUTRAL_MODEL_STRUCTURED_EDITS_MISSING',
  });
  assert.equal(state.currentPhase, 'BLOCKED');
  assert.equal(state.dispatch.status, 'failed');
  assert.equal(state.repair.currentRound, 0);

  state = event(state, 'AGENT_FAILURE_RETRY_ADMITTED', {
    retryableBlockers: ['PROVIDER_NEUTRAL_MODEL_STRUCTURED_EDITS_MISSING'],
    receipt: receipt(
      'bounded retry admission for retryable agent execution failure',
      'retry-admission-1',
      { evidenceType: 'scheduler-retry-admission' },
    ),
  });
  assert.equal(state.currentPhase, 'AGENT_IMPLEMENTATION');
  assert.equal(state.dispatch.status, 'pending');
  assert.equal(state.repair.currentRound, 1);
  assert.equal(state.blockers.length, 0);
  assert.equal(state.nextAction.type, 'DISPATCH_AGENT');
  assert.equal(state.activeWriter, 'foundry-forge');
});

test('bounded retry admission accepts a semantic edit contract failure with safe path detail', () => {
  const blocker = 'PROVIDER_NEUTRAL_STRUCTURED_EDIT_CONTENT_INVALID:scripts/windows/battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1';
  let state = createMissionOrchestratorState({
    ...base,
    missionId: 'semantic-edit-retry-test',
    branch: 'openclaw/semantic-edit-retry-test',
  }, { now: new Date(timestamp(0)) });
  state = event(state, 'WORKTREE_READY', {
    worktreePath: base.worktreePath,
    clean: true,
    receipt: receipt('isolated worktree', 'semantic-retry-worktree'),
  });
  state = event(state, 'AGENT_DISPATCHED', { agentId: 'foundry-forge' });
  state = event(state, 'AGENT_RESULT_RECEIVED', {
    success: false,
    error: blocker,
  });
  state = event(state, 'AGENT_FAILURE_RETRY_ADMITTED', {
    retryableBlockers: [blocker],
    receipt: receipt(
      'bounded retry admission for retryable agent execution failure',
      'semantic-retry-admission-1',
      { evidenceType: 'scheduler-retry-admission' },
    ),
  });

  assert.equal(state.currentPhase, 'AGENT_IMPLEMENTATION');
  assert.equal(state.dispatch.status, 'pending');
  assert.equal(state.repair.currentRound, 1);
  assert.equal(state.blockers.length, 0);
});

test('bounded retry admission refuses semantic edit retry when path detail is protected', () => {
  const blocker = 'PROVIDER_NEUTRAL_STRUCTURED_EDIT_CONTENT_INVALID:.env';
  let state = createMissionOrchestratorState({
    ...base,
    missionId: 'semantic-edit-protected-path-test',
    branch: 'openclaw/semantic-edit-protected-path-test',
  }, { now: new Date(timestamp(0)) });
  state = event(state, 'WORKTREE_READY', {
    worktreePath: base.worktreePath,
    clean: true,
    receipt: receipt('isolated worktree', 'semantic-protected-worktree'),
  });
  state = event(state, 'AGENT_DISPATCHED', { agentId: 'foundry-forge' });
  state = event(state, 'AGENT_RESULT_RECEIVED', {
    success: false,
    error: blocker,
  });
  state = event(state, 'AGENT_FAILURE_RETRY_ADMITTED', {
    retryableBlockers: [blocker],
    receipt: receipt(
      'bounded retry admission for retryable agent execution failure',
      'semantic-protected-retry-admission',
      { evidenceType: 'scheduler-retry-admission' },
    ),
  });

  assert.equal(state.currentPhase, 'BLOCKED');
  assert.equal(state.dispatch.status, 'failed');
  assert.equal(state.repair.currentRound, 0);
  assert.ok(state.blockers.includes(blocker));
});

test('bounded retry admission refuses to clear unrelated blockers', () => {
  let state = createMissionOrchestratorState({
    ...base,
    missionId: 'nonretryable-agent-failure-test',
    branch: 'openclaw/nonretryable-agent-failure-test',
  }, { now: new Date(timestamp(0)) });
  state = event(state, 'WORKTREE_READY', {
    worktreePath: base.worktreePath,
    clean: true,
    receipt: receipt('isolated worktree', 'nonretry-worktree'),
  });
  state = event(state, 'AGENT_DISPATCHED', { agentId: 'foundry-forge' });
  state = event(state, 'AGENT_RESULT_RECEIVED', {
    success: false,
    error: 'UNRELATED_SOURCE_POLICY_FAILURE',
  });
  state = event(state, 'AGENT_FAILURE_RETRY_ADMITTED', {
    retryableBlockers: ['PROVIDER_NEUTRAL_MODEL_STRUCTURED_EDITS_MISSING'],
    receipt: receipt(
      'bounded retry admission for retryable agent execution failure',
      'retry-admission-invalid',
      { evidenceType: 'scheduler-retry-admission' },
    ),
  });
  assert.equal(state.currentPhase, 'BLOCKED');
  assert.equal(state.dispatch.status, 'failed');
  assert.equal(state.repair.currentRound, 0);
  assert.ok(state.blockers.includes('UNRELATED_SOURCE_POLICY_FAILURE'));
});


test('agent result accepts exact scheduler scope identity across Git path casing without widening scope', () => {
  const scopedBase = {
    ...base,
    missionId: 'case-scope-test',
    allowedFiles: ['shared/agents/battlebridgesupervisor.mjs'],
    branch: 'openclaw/case-scope-test',
  };
  let state = createMissionOrchestratorState(scopedBase, { now: new Date(timestamp(0)) });
  state = event(state, 'WORKTREE_READY', {
    worktreePath: scopedBase.worktreePath,
    clean: true,
    receipt: receipt('isolated worktree', 'case-scope-worktree'),
  });
  state = event(state, 'AGENT_DISPATCHED', { agentId: 'openclaw-standalone' });
  state = event(state, 'AGENT_RESULT_RECEIVED', {
    success: true,
    resultId: 'case-scope-result',
    changedFiles: ['shared/agents/battleBridgeSupervisor.mjs'],
    receipt: receipt('openclaw result', 'case-scope-result-receipt'),
  });
  assert.equal(state.currentPhase, 'VERIFYING');
  assert.deepEqual(state.git.changedFiles, ['shared/agents/battleBridgeSupervisor.mjs']);

  let blocked = createMissionOrchestratorState(scopedBase, { now: new Date(timestamp(0)) });
  blocked = event(blocked, 'WORKTREE_READY', {
    worktreePath: scopedBase.worktreePath,
    clean: true,
    receipt: receipt('isolated worktree', 'case-scope-blocked-worktree'),
  });
  blocked = event(blocked, 'AGENT_DISPATCHED', { agentId: 'openclaw-standalone' });
  blocked = event(blocked, 'AGENT_RESULT_RECEIVED', {
    success: true,
    resultId: 'case-scope-blocked-result',
    changedFiles: ['shared/agents/battleBridgeSupervisor.test.mjs'],
    receipt: receipt('openclaw result', 'case-scope-blocked-result-receipt'),
  });
  assert.equal(blocked.currentPhase, 'BLOCKED');
  assert.match(blocked.blockers.join(' '), /exceeded approved source scope/i);
});

test('Forge signed draft publication atomically advances commit, push, PR without merge authority', () => {
  let state = createMissionOrchestratorState({
    ...base, repository: 'cheekyfellastef/stephan-os',
    missionId: 'critical-2732-elastic-goal', branch: 'openclaw/elastic-goal-2732',
    requiredEvidence: ['focused test output'],
  }, { now: new Date(timestamp(0)) });
  state = event(state, 'WORKTREE_READY', {
    worktreePath: base.worktreePath, clean: true,
    receipt: receipt('isolated worktree', 'forge-worktree-receipt'),
  });
  state = event(state, 'AGENT_DISPATCHED', { agentId: 'foundry-forge' });
  state = event(state, 'AGENT_RESULT_RECEIVED', {
    success: true, resultId: 'forge-source-result', changedFiles: ['shared/agents/missionOrchestrator.mjs'],
    receipt: receipt('forge result', 'forge-result-receipt'),
    sourceArtifactEscrow: {
      schemaVersion: 'stephanos.source-artifact-escrow.v1',
      missionId: 'critical-2732-elastic-goal', repository: base.repository,
      canonicalBranch: 'openclaw/elastic-goal-2732', canonicalPr: null,
      completeArtifactSha256: 'c'.repeat(64),
      exactParentHead: 'd'.repeat(40), exactResultTree: 'b'.repeat(40),
      artifactRef: 'shared-workspace://source-artifacts/' + 'c'.repeat(64) + '.json',
    },
    offlinePublicationOutbox: {
      schemaVersion: 'stephanos.offline-publication-outbox.v1',
      outboxId: 'offline-publication-' + 'e'.repeat(24),
      missionId: 'critical-2732-elastic-goal',
      completeArtifactSha256: 'c'.repeat(64),
      artifactRef: 'shared-workspace://source-artifacts/' + 'c'.repeat(64) + '.json',
      publicationPaused: true, pushAuthority: false, mergeAuthority: false,
    },
  });
  state = event(state, 'EVIDENCE_RECORDED', {
    receipts: [receipt('focused test output', 'forge-tests')],
  });
  assert.equal(state.currentPhase, 'GITHUB_COMMIT');
  const publication = {
    finalVerdict: 'FORGE_PRE_PR_DRAFT_PUBLISHED_WITH_EXACT_TREE_PROOF',
    repository: base.repository, branch: 'openclaw/elastic-goal-2732',
    commitSha: 'a'.repeat(40), exactResultTree: 'b'.repeat(40),
    sourceArtifactSha256: 'c'.repeat(64), prNumber: 3001, draft: true,
    mergeAuthority: false, forcePushAllowed: false,
  };
  const invalid = event(state, 'FORGE_ESCROW_DRAFT_PUBLISHED', {
    publication: { ...publication, forcePushAllowed: true },
    receipt: receipt('draft publication', 'forge-bad-publish'),
  });
  assert.equal(invalid.currentPhase, 'BLOCKED');
  const lookalike = event(state, 'FORGE_ESCROW_DRAFT_PUBLISHED', {
    publication: { ...publication, repository: 'Cheekyfellastef/stephan-os-fork' },
    receipt: receipt('draft publication', 'forge-lookalike-publish'),
  });
  assert.equal(lookalike.currentPhase, 'BLOCKED');
  const published = event(state, 'FORGE_ESCROW_DRAFT_PUBLISHED', {
    publication,
    receipt: receipt('draft publication', 'forge-publish'),
    prUrl: 'https://github.com/Cheekyfellastef/stephan-os/pull/3001',
  });
  assert.equal(published.currentPhase, 'CHECK_PULL_REQUEST');
  assert.equal(published.git.commitSha, publication.commitSha);
  assert.equal(published.git.pushed, true);
  assert.equal(published.pullRequest.number, 3001);
  assert.equal(published.pullRequest.state, 'draft');
  assert.equal(published.approval.status, 'not-requested');
  assert.equal(published.pullRequest.merged, false);
});

test('pilot current-main source cannot silently complete while acceptance is missing', () => {
  for (const issue of [1646,1717,1723]) {
    const mission={...base,missionId:'critical-'+issue+'-elastic-goal'};
    let state=createMissionOrchestratorState(mission,{now:new Date(timestamp(0))});
    state=event(state,'WORKTREE_READY',{
      worktreePath:mission.worktreePath,clean:true,
      receipt:receipt('isolated worktree','pilot-worktree-'+issue),
    });
    const result=event(state,'CURRENT_MAIN_SATISFACTION_RECORDED',{
      sourceRevision:'4'.repeat(40),canonicalMainHeadSha:'4'.repeat(40),
      worktreeHeadSha:'4'.repeat(40),worktreeClean:true,changedFiles:[],
    });
    assert.notEqual(result.currentPhase,'COMPLETE');
    assert.equal(result.currentMainAcceptance?.verified,false);
    assert.match(result.blockers.join(' '),/independent goal-acceptance completion proof/);
  }
});

test('accepted replacement repair prevents duplicate Forge pickup for VR Link',()=>{
 const input={...base,missionId:'critical-1717-elastic-goal'};
 let state=createMissionOrchestratorState(input,{now:new Date(timestamp(0))});
 state=event(state,'WORKTREE_READY',{worktreePath:base.worktreePath,clean:true,receipt:receipt('isolated worktree','replaced-vr-link-worktree')});
 state.continuity.history.push({eventType:'MISSION_REPAIR_PROVEN',receiptId:'verified-replacement-repair-e64fab30f247e954e06dbc73'});
 const next=event(state,'AGENT_DISPATCHED',{agentId:'foundry-forge',adapter:'foundry-forge'});
 assert.notEqual(next.dispatch.status,'running');
 assert.match(next.blockers.join(' '),/REPLACEMENT_SOURCE_ALREADY_MERGED/);
});
