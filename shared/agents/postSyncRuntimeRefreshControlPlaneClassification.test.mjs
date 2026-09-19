import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POST_SYNC_REFRESH_CLASSIFICATIONS,
  POST_SYNC_REFRESH_TARGETS,
  classifyPostSyncRefresh,
} from './postSyncRuntimeRefreshCoordinator.mjs';

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
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD]);
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
