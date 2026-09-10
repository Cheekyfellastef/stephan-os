import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POST_SYNC_REFRESH_CLASSIFICATIONS,
  POST_SYNC_REFRESH_TARGETS,
  buildPostSyncRefreshProjection,
  classifyPostSyncRefresh,
  executePostSyncRefreshPlan,
  parseGitChangedPathStatus,
} from './postSyncRuntimeRefreshCoordinator.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

function pass(sourceHead = B) {
  return { ok: true, exactHeadProofOk: true, sourceHead };
}

test('Git changed-path status parser includes deletions and both rename sides', () => {
  const parsed = parseGitChangedPathStatus([
    'D\tstephanos-server/server.js',
    'R100\tstephanos-server/legacy.js\tdocs/legacy.md',
    'M\tmain.js',
  ].join('\n'));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.paths, [
    'stephanos-server/server.js',
    'stephanos-server/legacy.js',
    'docs/legacy.md',
    'main.js',
  ]);
  assert.equal(parseGitChangedPathStatus('R100\tonly-one-path').ok, false);
});

test('classifies docs and tests as no-runtime changes', () => {
  const plan = classifyPostSyncRefresh(['docs/runbook.md', 'scripts/example.test.mjs']);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.NO_RUNTIME_REFRESH_REQUIRED);
  assert.deepEqual(plan.targetIds, []);
  assert.equal(plan.noRuntimePathCount, 2);
});

test('classifies UI backend worker and natural reload targets deterministically', () => {
  const plan = classifyPostSyncRefresh([
    'stephanos-ui/src/main.jsx',
    'stephanos-server/server.js',
    'shared/agents/missionOrchestratorV1.mjs',
    'scripts/battle-bridge-github-command-mailbox.mjs',
  ]);
  assert.deepEqual(plan.targetIds, [
    POST_SYNC_REFRESH_TARGETS.UI_4173,
    POST_SYNC_REFRESH_TARGETS.BACKEND_8787,
    POST_SYNC_REFRESH_TARGETS.MISSION_WORKER,
    POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD,
  ]);
});

test('exact six-path mailbox starvation delivery is installable through natural reload', () => {
  const plan = classifyPostSyncRefresh([
    '.github/workflows/battle-bridge-mailbox-outbox-starvation-v1.yml',
    'scripts/battle-bridge-github-command-mailbox-outbox-guard-v1.mjs',
    'scripts/battle-bridge-github-command-mailbox-outbox-guard-v1.test.mjs',
    'scripts/battle-bridge-github-command-mailbox.mjs',
    'scripts/battle-bridge-github-command-mailbox.test.mjs',
    'scripts/windows/run-battle-bridge-github-command-mailbox-hidden.ps1',
  ]);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD]);
  assert.equal(plan.changedPathCount, 6);
  assert.equal(plan.noRuntimePathCount, 3);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('complete mailbox ledger and guardian-chain repair range has no unclassified runtime path', () => {
  const changedPaths = [
    '.github/workflows/battle-bridge-mailbox-outbox-starvation-v1.yml',
    'scripts/battle-bridge-github-command-mailbox-outbox-guard-v1.mjs',
    'scripts/battle-bridge-github-command-mailbox-outbox-guard-v1.test.mjs',
    'scripts/battle-bridge-github-command-mailbox-with-receipt-index.test.mjs',
    'scripts/battle-bridge-github-command-mailbox.mjs',
    'scripts/battle-bridge-github-command-mailbox.test.mjs',
    'scripts/battle-bridge-recovery-mesh-guardian.test.mjs',
    'scripts/windows/install-battle-bridge-github-command-mailbox.ps1',
    'scripts/windows/run-battle-bridge-github-command-mailbox-hidden.ps1',
    'scripts/windows/run-battle-bridge-recovery-mesh-guardian-hidden.ps1',
    'shared/agents/postSyncRuntimeRefreshCoordinator.mjs',
    'shared/agents/postSyncRuntimeRefreshCoordinator.test.mjs',
    'shared/agents/windowsAuthorityMailboxRecoveryGuardianReviewV1.mjs',
    'shared/agents/windowsAuthorityMailboxRecoveryGuardianReviewV1.test.mjs',
    'shared/agents/windowsAuthoritySpecialistReviewV1.mjs',
  ];
  const plan = classifyPostSyncRefresh(changedPaths);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD]);
  assert.equal(plan.changedPathCount, changedPaths.length);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('launcher-critical shell sources select the UI refresh target', () => {
  for (const path of [
    'main.js',
    'modules/command-deck/command-deck.js',
    'system/module_loader.js',
    'system/workspace.js',
  ]) {
    const plan = classifyPostSyncRefresh([path]);
    assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
    assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.UI_4173]);
  }
});

test('merged Music Intelligence Centre changes automatically select the served UI refresh', () => {
  const plan = classifyPostSyncRefresh([
    'apps/music-tile/index.html',
    'apps/music-tile/main.js',
    'apps/music-tile/style.css',
  ]);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.UI_4173]);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('actual UI build verify serve and exact-proof tools select UI refresh', () => {
  for (const path of [
    'scripts/build-stephanos-ui.mjs',
    'scripts/clean-stephanos-dist.mjs',
    'scripts/stephanos-build-utils.mjs',
    'scripts/verify-stephanos-dist.mjs',
    'scripts/serve-stephanos-dist.mjs',
    'scripts/refresh-stephanos-ui-4173.mjs',
    'scripts/battle-bridge-ignition-supervisor.mjs',
  ]) {
    const plan = classifyPostSyncRefresh([path]);
    assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY, path);
    assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.UI_4173], path);
  }
});

test('shared runtime refreshes UI and backend', () => {
  const plan = classifyPostSyncRefresh(['shared/runtime/runtimeStatusModel.mjs']);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.UI_4173, POST_SYNC_REFRESH_TARGETS.BACKEND_8787]);
});

test('OpenClaw changes remain approval-gated while safe targets stay classified', () => {
  const plan = classifyPostSyncRefresh(['integrations/openclaw/stephanos-ignite-command/index.mjs', 'stephanos-ui/src/main.jsx']);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.APPROVAL_REQUIRED_OPENCLAW);
  assert.equal(plan.openClawApprovalRequired, true);
  assert.ok(plan.targetIds.includes(POST_SYNC_REFRESH_TARGETS.UI_4173));
});

test('unknown and unsafe runtime paths fail closed', () => {
  assert.equal(classifyPostSyncRefresh(['shared/new-runtime-surface.mjs']).classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH);
  assert.equal(classifyPostSyncRefresh(['scripts/unregistered-long-running-service.mjs']).classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH);
  assert.equal(classifyPostSyncRefresh(['../outside.mjs']).classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNSAFE_CHANGED_PATH);
});

test('executes only selected targets and requires exact after-head proof', async () => {
  const calls = [];
  const result = await executePostSyncRefreshPlan({
    beforeHead: A,
    afterHead: B,
    changedPaths: ['shared/runtime/runtimeStatusModel.mjs'],
    adapters: {
      refreshUi: async () => { calls.push('ui'); return pass(); },
      restartBackend: async () => { calls.push('backend'); return pass(); },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['ui', 'backend']);
  assert.equal(result.exactHeadProofOk, true);

  const failed = await executePostSyncRefreshPlan({
    beforeHead: A,
    afterHead: B,
    changedPaths: ['stephanos-server/server.js'],
    adapters: { restartBackend: async () => pass(A) },
  });
  assert.equal(failed.ok, false);
  assert.match(failed.blocker, /REFRESH_PROOF_FAILED/);
});

test('completes safe refreshes but blocks final completion for OpenClaw approval', async () => {
  let uiCalls = 0;
  const result = await executePostSyncRefreshPlan({
    beforeHead: A,
    afterHead: B,
    changedPaths: ['integrations/openclaw/plugin.mjs', 'stephanos-ui/src/main.jsx'],
    adapters: { refreshUi: async () => { uiCalls += 1; return pass(); }, confirmNaturalReload: async () => pass() },
  });
  assert.equal(uiCalls, 1);
  assert.equal(result.safeRefreshesCompleted, true);
  assert.equal(result.blocker, 'OPENCLAW_REFRESH_APPROVAL_REQUIRED');
});

test('resumes already-proven targets without repeating mutation', async () => {
  const calls = [];
  const checkpoints = [];
  const result = await executePostSyncRefreshPlan({
    beforeHead: A,
    afterHead: B,
    changedPaths: ['shared/runtime/runtimeStatusModel.mjs'],
    completedResults: [{ targetId: POST_SYNC_REFRESH_TARGETS.UI_4173, ...pass() }],
    adapters: {
      refreshUi: async () => { calls.push('ui'); return pass(); },
      restartBackend: async () => { calls.push('backend'); return pass(); },
    },
    onTargetComplete: async (results) => checkpoints.push(results.map((item) => item.targetId)),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['backend']);
  assert.equal(result.results[0].resumed, true);
  assert.deepEqual(checkpoints, [[POST_SYNC_REFRESH_TARGETS.UI_4173, POST_SYNC_REFRESH_TARGETS.BACKEND_8787]]);
});

test('projection publishes counts and target proofs but no changed path values', () => {
  const result = {
    ok: true,
    classification: POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_COMPLETE,
    exactHeadProofOk: true,
    plan: classifyPostSyncRefresh(['stephanos-server/server.js']),
    results: [{ targetId: POST_SYNC_REFRESH_TARGETS.BACKEND_8787, ...pass() }],
  };
  const projection = buildPostSyncRefreshProjection(result, { beforeHead: A, afterHead: B });
  assert.equal(projection.pathValuesPublished, false);
  assert.equal(projection.changedPathCount, 1);
  assert.doesNotMatch(JSON.stringify(projection), /stephanos-server\/server\.js/);
});
