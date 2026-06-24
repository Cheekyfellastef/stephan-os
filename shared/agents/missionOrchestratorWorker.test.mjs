import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { buildMissionWorkerAction, issueMissionWorkerAuthorization } from './missionOrchestratorWorker.mjs';
import { verifyOpenClawGitHubAuthorization } from './openClawGitHubAuthorization.mjs';

const now = new Date('2026-06-24T22:00:00.000Z');
const base = {
  missionId: 'worker-test-mission', revision: 4, title: 'Worker test mission',
  intendedOutcome: 'A bounded change is promoted safely.', currentPhase: 'CREATE_WORKTREE',
  repository: 'Cheekyfellastef/stephan-os', repositoryRoot: 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os',
  baseBranch: 'main', allowedFiles: ['shared/agents/**'], requiredTests: ['node --test focused.test.mjs'], requiredEvidence: ['focused test output'],
  git: { branch: 'openclaw/worker-test-mission', baseBranch: 'main', worktreePath: 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os-worktrees\\worker-test-mission', changedFiles: ['shared/agents/example.mjs'] },
  pullRequest: { number: 1267, headSha: 'a'.repeat(40), mergeCommitSha: '' },
  approval: { requiredToken: `APPROVE_OPENCLAW_SQUASH_MERGE:1267:${'a'.repeat(40)}` },
  repair: { currentRound: 0 },
  deployment: { sync: { status: 'pending' }, build: { status: 'pending' }, verify: { status: 'pending' }, restart: { status: 'pending' } },
  evidenceReceipts: [],
};

test('creates a bounded signed worktree action on the OpenClaw branch family', () => {
  const action = buildMissionWorkerAction(base, { now });
  assert.equal(action.finalVerdict, 'READY_TO_ISSUE_AUTHORIZATION');
  assert.equal(action.operation, 'create-worktree');
  assert.equal(action.claims.repositoryRoot, base.repositoryRoot);
  assert.equal(action.claims.singleUse, true);
});

test('blocks signed mutation when mission branch is outside openclaw/*', () => {
  const action = buildMissionWorkerAction({ ...base, git: { ...base.git, branch: 'orchestrator/worker-test-mission' } }, { now });
  assert.equal(action.finalVerdict, 'BLOCKED');
  assert.match(action.blockers.join(' '), /openclaw/i);
});

test('issues an Ed25519 single-use authorization that the existing executor verifies', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const action = buildMissionWorkerAction(base, { now });
  const request = issueMissionWorkerAuthorization(action, privateKey.export({ type: 'pkcs8', format: 'pem' }), { now });
  assert.equal(request.finalVerdict, 'MISSION_WORKER_REQUEST_ISSUED');
  const verification = verifyOpenClawGitHubAuthorization(request.authorization, publicKey.export({ type: 'spki', format: 'pem' }), { now });
  assert.equal(verification.finalVerdict, 'STEPHANOS_AUTHORIZATION_VERIFIED');
  assert.equal(verification.claims.operation, 'create-worktree');
});

test('routes implementation and repair to Codex as the sole active writer', () => {
  for (const currentPhase of ['AGENT_IMPLEMENTATION', 'REPAIR_REQUIRED']) {
    const action = buildMissionWorkerAction({ ...base, currentPhase }, { now });
    assert.equal(action.adapter, 'codex');
    assert.equal(action.activeWriter, 'Codex');
  }
});

test('routes live runtime investigation to read-only OpenClaw', () => {
  const action = buildMissionWorkerAction({ ...base, currentPhase: 'LIVE_RUNTIME_INVESTIGATION', browserProofRequired: true }, { now });
  assert.equal(action.adapter, 'openclaw-readonly');
  assert.equal(action.activeWriter, 'none');
  assert.equal(action.browserProofRequired, true);
});

test('merge request remains head-bound and carries only the exact recorded approval', () => {
  const action = buildMissionWorkerAction({ ...base, currentPhase: 'MERGE_PULL_REQUEST' }, { now });
  assert.equal(action.operation, 'merge-pr');
  assert.equal(action.claims.expectedHeadSha, base.pullRequest.headSha);
  assert.equal(action.approvalToken, base.approval.requiredToken);
});

test('local deployment resumes only unfinished ordered steps', () => {
  const action = buildMissionWorkerAction({ ...base, currentPhase: 'LOCAL_DEPLOYMENT', pullRequest: { ...base.pullRequest, mergeCommitSha: 'b'.repeat(40) }, deployment: { ...base.deployment, sync: { status: 'success' } } }, { now });
  assert.deepEqual(action.steps, ['build', 'verify', 'restart']);
  assert.equal(action.mergeCommitSha, 'b'.repeat(40));
});

test('approval, terminal, and blocked phases do not execute automatically', () => {
  for (const currentPhase of ['AWAITING_OPERATOR_APPROVAL', 'COMPLETE', 'CANCELLED', 'BLOCKED']) {
    const action = buildMissionWorkerAction({ ...base, currentPhase }, { now });
    assert.equal(action.actionKind, 'wait');
    assert.equal(action.executable, false);
  }
});
