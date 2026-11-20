import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POST_SYNC_REFRESH_CLASSIFICATIONS,
  POST_SYNC_REFRESH_TARGETS,
  classifyPostSyncRefresh,
  executePostSyncRefreshPlan,
} from './postSyncRuntimeRefreshCoordinator.mjs';

const invocationOnlyRecoveryPaths = [
  'scripts/qwen35-canary.mjs',
  'scripts/windows/read-sovereign-maintenance-owner-v2.ps1',
  'scripts/windows/stephanos-core-process-observation.ps1',
  'scripts/sovereign-fixed-runtime-empty-version-quarantine-v1.mjs',
  'scripts/windows/quarantine-sovereign-fixed-runtime-empty-version-v1.ps1',
];

test('exact invocation-only recovery source uses only the established natural-adoption adapter', async () => {
  const calls = [];
  const forbidden = () => assert.fail('source adoption invoked a runtime or attended operation');
  const afterHead = 'b'.repeat(40);
  const result = await executePostSyncRefreshPlan({ beforeHead: 'a'.repeat(40), afterHead,
    changedPaths: invocationOnlyRecoveryPaths,
    adapters: {
      confirmNaturalReload: async input => { calls.push(input.targetId); return { ok: true, exactHeadProofOk: true, sourceHead: afterHead }; },
      refreshUi: forbidden, restartBackend: forbidden, restartMissionWorker: forbidden,
      restartGitHubMailbox: forbidden, refreshSovereignCommander: forbidden,
      quarantineEmptyVersion: forbidden, runCanary: forbidden,
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD]);
  assert.equal(result.plan.unknownPathCount, 0);
  assert.equal(result.plan.pluginHostActivationRequired, false);
  for (const path of invocationOnlyRecoveryPaths) {
    const plan = classifyPostSyncRefresh([path]);
    assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD], path);
    const unknown = classifyPostSyncRefresh([path.replace(/\.(?:mjs|ps1)$/, '-unreviewed$&')]);
    assert.equal(unknown.unknownPathCount, 1, 'no family-wide allow rule: ' + path);
  }
});

test('natural helper adoption cannot discharge resident Governor, Spatial or desktop-plugin debt', async () => {
  const governor = classifyPostSyncRefresh([...invocationOnlyRecoveryPaths, 'scripts/windows/run-vr-resource-governor.ps1']);
  assert.equal(governor.governorRefreshRequired, true);
  assert.deepEqual(governor.targetIds, ['sovereign-commander', 'natural-reload']);
  const denied = await executePostSyncRefreshPlan({ beforeHead: 'a'.repeat(40), afterHead: 'b'.repeat(40),
    changedPaths: [...invocationOnlyRecoveryPaths, 'scripts/windows/run-vr-resource-governor.ps1'],
    adapters: { refreshSovereignCommander: async () => ({ ok: true, exactHeadProofOk: true, sourceHead: 'b'.repeat(40) }) },
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.blocker, 'SOVEREIGN_GOVERNOR_REFRESH_PROOF_UNPROVEN');
  const spatial = classifyPostSyncRefresh([...invocationOnlyRecoveryPaths, 'scripts/spatial-window-host.mjs']);
  assert.equal(spatial.spatialAdoptionRequired, true);
  assert.equal(spatial.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_SPATIAL_ADOPTION_REQUIRED);
  const plugin = classifyPostSyncRefresh([...invocationOnlyRecoveryPaths, 'plugins/sovereign-commander/plugin.json']);
  assert.equal(plugin.pluginHostActivationRequired, true);
  assert.ok(plugin.targetIds.includes(POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER));
});

test('Recovery Mesh fixed probe naturally reloads instead of blocking post-sync refresh', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/battle-bridge-recovery-mesh-runtime-dist.test.mjs',
    'scripts/windows/probe-battle-bridge-recovery-mesh.ps1',
  ]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD]);
  assert.equal(plan.noRuntimePathCount, 1);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('merge-signal publisher contracts are no-runtime while sync installer naturally reloads', () => {
  const plan = classifyPostSyncRefresh([
    '.github/workflows/battle-bridge-main-advance-express-sync-v1.yml',
    'scripts/battle-bridge-github-sync-installer.test.mjs',
    'scripts/publish-battle-bridge-main-advance-signal.mjs',
    'scripts/windows/install-battle-bridge-github-sync.ps1',
    'shared/agents/battleBridgeMainAdvanceSignalV1.mjs',
    'shared/agents/battleBridgeMainAdvanceSignalV1.test.mjs',
  ]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD]);
  assert.equal(plan.noRuntimePathCount, 5);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('outbound health beacon control-plane estate coalesces as natural reload without OpenClaw approval', () => {
  const plan = classifyPostSyncRefresh([
    '.github/workflows/battle-bridge-resilience-proof.yml',
    'scripts/battle-bridge-control-plane-self-repair.test.mjs',
    'scripts/battle-bridge-outbound-health-beacon.mjs',
    'scripts/battle-bridge-outbound-health-beacon.test.mjs',
    'scripts/windows/install-battle-bridge-outbound-health-beacon.ps1',
    'scripts/windows/run-battle-bridge-outbound-health-beacon-hidden.ps1',
    'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
    'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs',
  ]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD]);
  assert.equal(plan.changedPathCount, 8);
  assert.equal(plan.noRuntimePathCount, 3);
  assert.equal(plan.openClawPathCount, 0);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.unsafePathCount, 0);
  assert.equal(plan.openClawApprovalRequired, false);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('Desktop Commander watchdog self-heal naturally reloads through the Battle Bridge control plane', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/desktop-commander-watchdog.test.mjs',
    'scripts/windows/install-desktop-commander-watchdog.ps1',
    'scripts/windows/run-desktop-commander-watchdog-hidden.ps1',
    'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
    'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs',
    'shared/agents/postSyncRuntimeRefreshCoordinator.mjs',
  ]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [
    POST_SYNC_REFRESH_TARGETS.GITHUB_MAILBOX,
    POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD,
  ]);
  assert.equal(plan.changedPathCount, 6);
  assert.equal(plan.noRuntimePathCount, 1);
  assert.equal(plan.openClawPathCount, 0);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.unsafePathCount, 0);
  assert.equal(plan.openClawApprovalRequired, false);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('worker watchdog and Recovery Mesh liveness repair coalesces as natural reload only', () => {
  const plan = classifyPostSyncRefresh([
    '.github/workflows/battle-bridge-resilience-proof.yml',
    'scripts/battle-bridge-control-plane-self-repair.test.mjs',
    'scripts/battle-bridge-outbound-health-beacon.mjs',
    'scripts/battle-bridge-outbound-health-beacon.test.mjs',
    'scripts/battle-bridge-recovery-mesh-launch-liveness.test.mjs',
    'scripts/windows/run-battle-bridge-recovery-mesh-hidden.ps1',
    'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs',
    'shared/agents/postSyncRuntimeRefreshControlPlaneClassification.test.mjs',
    'shared/agents/postSyncRuntimeRefreshCoordinator.mjs',
  ]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [
    POST_SYNC_REFRESH_TARGETS.GITHUB_MAILBOX,
    POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD,
  ]);
  assert.equal(plan.changedPathCount, 9);
  assert.equal(plan.noRuntimePathCount, 5);
  assert.equal(plan.openClawPathCount, 0);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.unsafePathCount, 0);
  assert.equal(plan.openClawApprovalRequired, false);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('windowless Lifeboat delivery and its fixed control-plane reconciler naturally reload without stranding sync', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/battle-bridge-recovery-lifeboat-hidden-window.test.mjs',
    'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1',
    'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs',
    'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs',
  ]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD]);
  assert.equal(plan.noRuntimePathCount, 1);
  assert.equal(plan.openClawPathCount, 0);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.unsafePathCount, 0);
  assert.equal(plan.openClawApprovalRequired, false);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('Lifeboat bounded-tail recovery consumer refreshes through the existing control plane instead of blocking sync', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/windows/invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1',
    'shared/agents/battleBridgeRecoveryLifeboatGitHubClaimV1.mjs',
    'shared/agents/battleBridgeRecoveryLifeboatGitHubClaimV1.test.mjs',
    'shared/agents/battleBridgeRecoveryLifeboatGitHubConsumerV1.test.mjs',
    'shared/agents/battleBridgeRecoveryLifeboatVerificationJournalV1.test.mjs',
    'shared/agents/windowsAuthorityMobileRecoveryVerificationJournalReviewV1.mjs',
    'shared/agents/windowsAuthorityMobileRecoveryVerificationJournalReviewV1.test.mjs',
    'shared/agents/windowsAuthoritySpecialistReviewV1.mjs',
    'shared/agents/windowsAuthoritySpecialistReviewV1Base.mjs',
    'shared/agents/windowsAuthoritySpecialistReviewV1LegacyRouter.mjs',
  ]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [
    POST_SYNC_REFRESH_TARGETS.BACKEND_8787,
    POST_SYNC_REFRESH_TARGETS.MISSION_WORKER,
    POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD,
  ]);
  assert.equal(plan.changedPathCount, 10);
  assert.equal(plan.openClawPathCount, 0);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.unsafePathCount, 0);
  assert.equal(plan.openClawApprovalRequired, false);
  assert.equal(plan.automaticExecutionAllowed, true);
});


test('S4U recovery identity repair estate reaches bounded control-plane reconciliation automatically', () => {
  const changedPaths = [
    'scripts/battle-bridge-recovery-mesh-installer.test.mjs',
    'scripts/windows/battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1',
    'scripts/windows/request-battle-bridge-recovery-openclaw.ps1',
    'scripts/windows/request-battle-bridge-recovery.ps1',
    'scripts/windows/run-battle-bridge-recovery-mesh-guardian-hidden.ps1',
    'shared/agents/openClawBattleBridgeRecoveryExecutorV1.test.mjs',
    'shared/agents/windowsAuthorityMailboxRecoveryGuardianReviewV1.mjs',
    'shared/agents/windowsAuthorityMailboxRecoveryGuardianReviewV1.test.mjs',
    'shared/agents/windowsAuthorityMobileRecoveryExecutorReviewV1.mjs',
    'shared/agents/windowsAuthorityMobileRecoveryExecutorReviewV1.test.mjs',
    'shared/agents/windowsAuthorityOpenClawRecoveryReviewV1.mjs',
    'shared/agents/windowsAuthorityOpenClawRecoveryReviewV1.test.mjs',
    'shared/agents/windowsAuthorityRecoveryMeshGuardianReviewV1.mjs',
    'shared/agents/windowsAuthorityRecoveryMeshGuardianReviewV1.test.mjs',
    'shared/agents/windowsAuthoritySpecialistReviewLegacyV1.mjs',
    'shared/agents/windowsAuthoritySpecialistReviewV1.mjs',
    'shared/agents/windowsAuthoritySpecialistReviewV1.test.mjs',
    'shared/agents/windowsAuthoritySpecialistReviewV1Base.mjs',
    'shared/agents/windowsAuthoritySpecialistReviewV1LegacyRouter.mjs',
  ];

  const plan = classifyPostSyncRefresh(changedPaths);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD]);
  assert.equal(plan.changedPathCount, changedPaths.length);
  assert.equal(plan.noRuntimePathCount, 7);
  assert.equal(plan.openClawPathCount, 0);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.unsafePathCount, 0);
  assert.equal(plan.openClawApprovalRequired, false);
  assert.equal(plan.automaticExecutionAllowed, true);
});


test('Recovery Mesh installer change is a bounded natural reload target', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/windows/install-battle-bridge-recovery-mesh.ps1',
    'scripts/battle-bridge-recovery-mesh-installer.test.mjs',
  ]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD]);
  assert.equal(plan.changedPathCount, 2);
  assert.equal(plan.noRuntimePathCount, 1);
  assert.equal(plan.openClawPathCount, 0);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});


test('outbound beacon core telemetry change reaches the bounded natural reload path', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/battle-bridge-outbound-health-beacon-core.mjs',
    'scripts/battle-bridge-outbound-health-beacon.test.mjs',
  ]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD]);
  assert.equal(plan.changedPathCount, 2);
  assert.equal(plan.noRuntimePathCount, 1);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('Virtual Air Link acceptance delivery is fully classified for bounded post-sync refresh', () => {
  const changedPaths = [
    'scripts/sovereign-commander-http.mjs',
    'scripts/sovereign-commander-ignition-autoheal.mjs',
    'scripts/sovereign-commander-ignition-autoheal.test.mjs',
    'scripts/windows/run-vr-virtual-airlink-acceptance.ps1',
    'shared/agents/sovereignCommanderBattleBridgeV1.mjs',
    'shared/agents/sovereignCommanderBattleBridgeV1.test.mjs',
    'shared/agents/sovereignCommanderRemoteMailboxV1.mjs',
    'shared/agents/sovereignCommanderRemoteMailboxV1.test.mjs',
    'shared/agents/sovereignCommanderVrResourceGovernor.test.mjs',
    'shared/agents/stephanosCoreDaemonSovereign.test.mjs',
  ];

  const plan = classifyPostSyncRefresh(changedPaths);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [
    POST_SYNC_REFRESH_TARGETS.BACKEND_8787,
    POST_SYNC_REFRESH_TARGETS.MISSION_WORKER,
    POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER,
    POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD,
  ]);
  assert.equal(plan.changedPathCount, changedPaths.length);
  assert.equal(plan.noRuntimePathCount, 5);
  assert.equal(plan.openClawPathCount, 0);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.unsafePathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});
