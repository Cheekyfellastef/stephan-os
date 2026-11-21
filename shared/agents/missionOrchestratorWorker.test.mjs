import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { buildMissionWorkerAction, issueMissionWorkerAuthorization,
  missionWorkerActionGrantsMatchV1, projectMissionWorkerSourceFailureV1 } from './missionOrchestratorWorker.mjs';
import { classifyElasticMissionIdentityV1 } from '../runtime/seedGrowthWorkV1.mjs';
import { createExactWorkerActionGrant } from './durableFlywheelControllerVNext.mjs';
import { verifyOpenClawGitHubAuthorization } from './openClawGitHubAuthorization.mjs';

const now = new Date('2026-06-24T22:00:00.000Z');
const base = {
  missionId: 'worker-test-mission', revision: 4, title: 'Worker test mission', intendedOutcome: 'A bounded change is promoted safely.', currentPhase: 'CREATE_WORKTREE',
  repository: 'Cheekyfellastef/stephan-os', repositoryRoot: 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os', baseBranch: 'main',
  allowedFiles: ['shared/agents/**'], requiredTests: ['node --test focused.test.mjs'], requiredEvidence: ['focused test output'],
  git: { branch: 'openclaw/worker-test-mission', baseBranch: 'main', worktreePath: 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os-worktrees\\worker-test-mission', changedFiles: ['shared/agents/example.mjs'] },
  pullRequest: { number: 1267, headSha: 'a'.repeat(40), mergeCommitSha: '' },
  approval: { requiredToken: `APPROVE_OPENCLAW_SQUASH_MERGE:1267:${'a'.repeat(40)}` }, repair: { currentRound: 0 },
  deployment: { sync: { status: 'pending' }, build: { status: 'pending' }, verify: { status: 'pending' }, restart: { status: 'pending' } }, evidenceReceipts: [],
};

test('the entire reserved elastic namespace has one exact accepted identity grammar', () => {
  for (const id of ['1', '1557', String(Number.MAX_SAFE_INTEGER)]) {
    const canonical = `critical-${id}-elastic-goal`, branch = `openclaw/elastic-goal-${id}`;
    assert.equal(classifyElasticMissionIdentityV1(canonical).kind, 'CANONICAL_ELASTIC');
    assert.equal(classifyElasticMissionIdentityV1(canonical, branch).kind, 'CANONICAL_ELASTIC');
    for (const suffix of ['copy', ':copy', '_copy', '-copy', '.copy', '/copy', '\\copy', '\u0000', ' ', '\t']) {
      assert.equal(classifyElasticMissionIdentityV1(canonical + suffix).kind, 'NONCANONICAL_ELASTIC');
      assert.equal(classifyElasticMissionIdentityV1(canonical + suffix, 'openclaw/unit-engine').kind, 'NONCANONICAL_ELASTIC');
    }
  }
  for (const separator of ['-', '_', ':', '.', '/', '\\', ' ', '\t', '']) {
    for (const id of ['1', '0', '01557', 'abc', '', '9007199254740992']) {
      for (const suffix of ['', 'copy', ':copy', '/copy']) {
        const identity = ['critical', id, 'elastic', 'goal'].join(separator) + suffix;
        const expected = separator === '-' && id === '1' && suffix === '' ? 'CANONICAL_ELASTIC' : 'NONCANONICAL_ELASTIC';
        assert.equal(classifyElasticMissionIdentityV1(identity).kind, expected, JSON.stringify(identity));
        assert.equal(classifyElasticMissionIdentityV1(identity, 'openclaw/unit-engine').kind, 'NONCANONICAL_ELASTIC');
      }
    }
  }
  for (const alias of ['CRITICAL-1557-ELASTIC-GOAL', ' critical-1557-elastic-goal',
    'critical-1557-elastic-goal\t', 'critical-1557-elastic', 'ＣＲＩＴＩＣＡＬ－１５５７－ＥＬＡＳＴＩＣ－ＧＯＡＬ'])
    assert.equal(classifyElasticMissionIdentityV1(alias).kind, 'NONCANONICAL_ELASTIC', alias);
  for (const branch of ['OPENCLAW/ELASTIC-GOAL-1557', 'openclaw_elastic_goal_1557',
    'openclaw/elastic-goal-1557copy', 'openclaw/elastic-goal-1558']) {
    assert.equal(classifyElasticMissionIdentityV1('critical-1557-elastic-goal', branch).kind, 'NONCANONICAL_ELASTIC');
    assert.equal(classifyElasticMissionIdentityV1('unit-engine', branch).kind, 'NONCANONICAL_ELASTIC');
  }
  for (const ordinary of ['critical-2009-native-executor', 'critical-3001-offline-forge',
    'unit-source-engine', 'ordinary-critical-1557-elastic-goal'])
    assert.equal(classifyElasticMissionIdentityV1(ordinary, 'openclaw/unit-engine').kind, 'OTHER', ordinary);
});

test('source failure observations cannot become authority or invoke copied accessors', () => {
  const action = { missionId: 'critical-1557-elastic-goal', actionId: 'original-source-action', allowedFiles: ['shared/agents/a.mjs'] };
  assert.equal(projectMissionWorkerSourceFailureV1(new Error('ordinary failure'), action), null);
  let traps = 0;
  const error = new Error('original error');
  Object.defineProperty(error, 'sourceFailure', { get() { traps++; throw new Error('MUST_NOT_RUN'); } });
  const observed = projectMissionWorkerSourceFailureV1(error, action);
  assert.equal(traps, 0); assert.equal(observed.sourceState, 'UNKNOWN');
  assert.equal(observed.rollbackDisposition, 'UNPROVEN');
  assert.equal(observed.recoveryRequired, true); assert.equal(observed.mutationAuthority, false);
});

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

test('creates a bounded signed worktree action on the OpenClaw branch family', () => {
  const action = buildMissionWorkerAction(base, { now });
  assert.equal(action.finalVerdict, 'READY_TO_ISSUE_AUTHORIZATION');
  assert.equal(action.operation, 'create-worktree');
  assert.equal(action.claims.repositoryRoot, base.repositoryRoot);
  assert.equal(action.claims.singleUse, true);
});

test('actual signed lifecycle producer retains a closed non-capacity grant representation', () => {
  const missionId = 'critical-1557-elastic-goal', branch = 'openclaw/elastic-goal-1557';
  // Pure projection fixture only. The server separately proves the mint audit,
  // actual owner decision, current cohort, source and retained contract.
  const state = { ...base, missionId, git: { ...base.git, branch },
    currentOrdinarySourcePlan: { schemaVersion: 'stephanos.current-ordinary-source-plan.v1',
      purpose: 'REAFFIRM_EXISTING_ORDINARY_SOURCE_PLAN', missionId, branch,
      authorityPlanFingerprint: 'b'.repeat(64) } };
  const grant = createExactWorkerActionGrant({ observedAtUtc: now.toISOString(),
    criticalBacklog: { activeMission: state } }, 'a'.repeat(40));
  assert.equal(grant.capacityRoute, '');
  assert.equal(grant.actionKind, 'signed-openclaw-operation');
  assert.equal(grant.adapter, 'openclaw-signed');
  assert.equal(missionWorkerActionGrantsMatchV1(grant, grant), true);
  for (const delta of [{ actionKind: 'agent-handoff' }, { adapter: 'unknown-adapter' },
    { operation: 'arbitrary-command' }, { currentPhase: 'AGENT_IMPLEMENTATION' },
    { capacityReceiptId: 'invented-capacity' }, { capacityProofRefs: ['invented-proof'] },
    { capacityRoute: 'FOUNDRY_FORGE' }, { workerId: 'unrelated-worker' }]) {
    const changed = { ...grant, ...delta };
    assert.equal(missionWorkerActionGrantsMatchV1(changed, changed), false, JSON.stringify(delta));
  }
});

test('actual Forge publication producer retains its exact artifact action without invented capacity', () => {
  const missionId = 'critical-1646-elastic-goal', branch = 'openclaw/elastic-goal-1646';
  const state = { ...base, missionId, currentPhase: 'GITHUB_COMMIT',
    git: { ...base.git, branch }, pullRequest: { number: null, headSha: '' },
    dispatch: { adapter: 'foundry-forge', status: 'complete' },
    sourcePublication: { artifactSha256: '7'.repeat(64), exactParentHead: 'a'.repeat(40),
      exactResultTree: '8'.repeat(40), canonicalBranch: branch,
      outboxId: 'offline-publication-' + '9'.repeat(24) },
    currentOrdinarySourcePlan: { schemaVersion: 'stephanos.current-ordinary-source-plan.v1',
      purpose: 'REAFFIRM_EXISTING_ORDINARY_SOURCE_PLAN', missionId, branch,
      authorityPlanFingerprint: 'b'.repeat(64) } };
  const grant = createExactWorkerActionGrant({ observedAtUtc: now.toISOString(),
    criticalBacklog: { activeMission: state } }, 'a'.repeat(40));
  assert.equal(grant.capacityRoute, '');
  assert.equal(grant.capacityReceiptId, null);
  assert.deepEqual(grant.capacityProofRefs, []);
  assert.equal(grant.actionKind, 'forge-escrow-publication');
  assert.equal(missionWorkerActionGrantsMatchV1(grant, grant), true);
  for (const delta of [{ actionKind: 'agent-handoff' }, { adapter: 'openclaw-signed' },
    { currentPhase: 'GITHUB_PUSH' }, { operation: 'push' }, { workerId: 'unrelated-worker' },
    { capacityReceiptId: 'invented' }, { capacityProofRefs: ['invented'] }]) {
    const changed = { ...grant, ...delta };
    assert.equal(missionWorkerActionGrantsMatchV1(changed, changed), false, JSON.stringify(delta));
  }
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

test('Forge GITHUB_COMMIT uses a dedicated signed escrow publication lane', () => {
  const state = {
    ...base, currentPhase: 'GITHUB_COMMIT',
    dispatch: { adapter: 'foundry-forge', status: 'complete' },
    pullRequest: { number: null, headSha: '' },
    sourcePublication: {
      artifactSha256: 'c'.repeat(64),
      outboxId: 'offline-publication-' + 'd'.repeat(24),
      canonicalBranch: base.git.branch,
      exactParentHead: 'a'.repeat(40),
      exactResultTree: 'b'.repeat(40),
    },
  };
  const action = buildMissionWorkerAction(state, { now });
  assert.equal(action.executable, true);
  assert.equal(action.actionKind, 'forge-escrow-publication');
  assert.equal(action.adapter, 'forge-publication');
  assert.equal(action.operation, 'publish-forge-escrow');
  assert.equal(action.artifactSha256, state.sourcePublication.artifactSha256);
  const invalid = buildMissionWorkerAction({ ...state, sourcePublication: null }, { now });
  assert.equal(invalid.executable, false);
  assert.match(invalid.blockers.join(' '), /escrow/i);
});
