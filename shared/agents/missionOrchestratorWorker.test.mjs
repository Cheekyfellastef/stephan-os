import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { buildMissionWorkerAction, issueMissionWorkerAuthorization } from './missionOrchestratorWorker.mjs';
import { verifyOpenClawGitHubAuthorization } from './openClawGitHubAuthorization.mjs';
import {
  PROVIDER_CLASS,
  PROVIDER_DEPENDENCY_MODE,
} from './providerIndependenceAdmissionGateV1.mjs';

const now = new Date('2026-06-24T22:00:00.000Z');
const base = {
  missionId: 'goal-1900-worker-test-mission', goalIssue: 1900, revision: 4, title: 'Worker test mission', intendedOutcome: 'A bounded change is promoted safely.', currentPhase: 'CREATE_WORKTREE',
  repository: 'Cheekyfellastef/stephan-os', repositoryRoot: 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os', baseBranch: 'main',
  allowedFiles: ['shared/agents/**'], requiredTests: ['node --test focused.test.mjs'], requiredEvidence: ['focused test output'],
  git: { branch: 'openclaw/worker-test-mission', baseBranch: 'main', worktreePath: 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os-worktrees\\worker-test-mission', changedFiles: ['shared/agents/example.mjs'] },
  pullRequest: { number: 1267, headSha: 'a'.repeat(40), mergeCommitSha: '' },
  approval: { requiredToken: `APPROVE_OPENCLAW_SQUASH_MERGE:1267:${'a'.repeat(40)}` }, repair: { currentRound: 0 },
  deployment: { sync: { status: 'pending' }, build: { status: 'pending' }, verify: { status: 'pending' }, restart: { status: 'pending' } }, evidenceReceipts: [],
};

function explicitCodexCapacityRouting() {
  return {
    nowUtc: now.toISOString(),
    codexStatus: {
      schemaVersion: 'shared-agent-workspace-record.v1',
      statusId: 'codex-capacity-current',
      truthState: 'CURRENT',
      meterTruthUsable: true,
      observedAtUtc: '2026-06-24T21:59:00.000Z',
      remainingPercent: 80,
      availability: 'AVAILABLE',
      confidence: 'high',
      naturalResetAtUtc: '',
    },
    githubLaneReceipt: null,
    forgeLaneReceipt: null,
    forgeSidecar: null,
  };
}

function providerIndependenceInput(overrides = {}) {
  const parityRoute = {
    routeId: 'github-review-v1',
    provider: PROVIDER_CLASS.GITHUB_HOSTED,
    taskClass: 'EXACT_HEAD_REVIEW',
    qualificationState: 'PRODUCTION_ELIGIBLE',
    active: true,
    portableCheckpointContract: 'mission-checkpoint-v1',
    receiptContract: 'execution-receipt-v1',
    proofRefs: ['proofs/provider-parity/github-review.json'],
  };
  return {
    nowUtc: now.toISOString(),
    dependency: {
      providerDependencyId: 'exact-head-review-provider',
      capabilityClass: 'EXACT_HEAD_REVIEW',
      provider: PROVIDER_CLASS.CODEX,
      mode: PROVIDER_DEPENDENCY_MODE.OPTIONAL_SPECIALIST_WITH_QUALIFIED_FALLBACK,
      whyProviderSpecific: 'Codex may provide optional specialist review capacity.',
      criticalPathImpact: 'CRITICAL_PATH',
      requiredTaskClass: 'EXACT_HEAD_REVIEW',
      nonProviderSpecificContract: 'provider-neutral-exact-head-review-v1',
      qualifiedAlternatives: ['github-review-v1'],
      portableCheckpointContract: 'mission-checkpoint-v1',
      receiptContract: 'execution-receipt-v1',
      failureBehaviour: 'ROUTE_AROUND_PROVIDER',
      operatorImpact: 'No operator impact while the qualified fallback remains healthy.',
      hardExternalBoundaryReason: '',
      parityProofRefs: ['proofs/provider-parity/github-review.json'],
    },
    parityRoutes: [parityRoute],
    retiringRouteIds: [],
    exception: null,
    ...overrides,
  };
}

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
  assert.equal(verifyOpenClawGitHubAuthorization(request.authorization, publicKey.export({ type: 'spki', format: 'pem' }), { now }).finalVerdict, 'STEPHANOS_AUTHORIZATION_VERIFIED');
});

test('routes PR checks through read-only GitHub inspection so failed checks remain repairable', () => {
  const action = buildMissionWorkerAction({ ...base, currentPhase: 'CHECK_PULL_REQUEST' }, { now });
  assert.equal(action.actionKind, 'github-inspection');
  assert.equal(action.adapter, 'openclaw-github-readonly');
  assert.equal(action.operation, 'check-pr');
  assert.equal(action.activeWriter, 'none');
  assert.equal(Object.hasOwn(action, 'authorization'), false);
});

test('routes implementation and repair to Codex only when explicit fresh Codex capacity is proven', () => {
  for (const currentPhase of ['AGENT_IMPLEMENTATION', 'REPAIR_REQUIRED']) {
    const action = buildMissionWorkerAction({ ...base, currentPhase }, {
      now,
      capacityRouting: explicitCodexCapacityRouting(),
    });
    assert.equal(action.adapter, 'codex');
    assert.equal(action.activeWriter, 'Codex');
  }
});

test('provider-independence mission admission blocks a new provider-concentrated dispatch before capacity routing', () => {
  const input = providerIndependenceInput({
    dependency: {
      ...providerIndependenceInput().dependency,
      mode: PROVIDER_DEPENDENCY_MODE.CODEX_ONLY_CRITICAL_PATH,
      qualifiedAlternatives: [],
    },
    parityRoutes: [],
  });
  const action = buildMissionWorkerAction({ ...base, currentPhase: 'AGENT_IMPLEMENTATION' }, {
    now,
    capacityRouting: explicitCodexCapacityRouting(),
    providerIndependenceInput: input,
  });
  assert.equal(action.actionKind, 'blocked');
  assert.equal(action.executable, false);
  assert.match(action.blockers.join(' '), /provider-independence:codex-or-work-is-sole-critical-path-provider/);
  assert.match(action.blockers.join(' '), /BLOCK_NEW_CODEX_ONLY_CRITICAL_PATH/);
});

test('provider-independence mission admission allows eligible work to continue into the existing capacity router', () => {
  const action = buildMissionWorkerAction({ ...base, currentPhase: 'AGENT_IMPLEMENTATION' }, {
    now,
    capacityRouting: explicitCodexCapacityRouting(),
    providerIndependenceInput: providerIndependenceInput(),
  });
  assert.equal(action.actionKind, 'agent-handoff');
  assert.equal(action.adapter, 'codex');
  assert.equal(action.executable, true);
});

test('routes live runtime investigation to read-only OpenClaw', () => {
  const action = buildMissionWorkerAction({ ...base, currentPhase: 'LIVE_RUNTIME_INVESTIGATION', browserProofRequired: true }, { now });
  assert.equal(action.adapter, 'openclaw-readonly');
  assert.equal(action.activeWriter, 'none');
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
});

test('approval, terminal, and blocked phases do not execute automatically', () => {
  for (const currentPhase of ['AWAITING_OPERATOR_APPROVAL', 'COMPLETE', 'CANCELLED', 'BLOCKED']) {
    const action = buildMissionWorkerAction({ ...base, currentPhase }, { now });
    assert.equal(action.actionKind, 'wait');
    assert.equal(action.executable, false);
  }
});
