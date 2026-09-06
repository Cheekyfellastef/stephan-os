import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POST_SYNC_REFRESH_CLASSIFICATIONS,
  POST_SYNC_REFRESH_TARGETS,
  classifyPostSyncRefresh,
} from './postSyncRuntimeRefreshCoordinator.mjs';

test('merged PR #2013 Edge launcher estate is natural-reload safe instead of an unclassified runtime blocker', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/windows-ignition-browser-surfaces.test.mjs',
    'windows/Launch-Stephanos-Local.ps1',
  ]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD]);
  assert.equal(plan.changedPathCount, 2);
  assert.equal(plan.noRuntimePathCount, 1);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.openClawPathCount, 0);
  assert.equal(plan.unsafePathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('merged PR #1991 Forge adapter estate is fully classified with exact installer natural reloads', () => {
  const plan = classifyPostSyncRefresh([
    'docs/architecture/stephanos-forge-shadow-podman-prerequisite-bootstrap-v1.md',
    'docs/architecture/stephanos-forge-shadow-podman-runtime-v1.md',
    'scripts/windows/install-forge-shadow-podman-prerequisite-v1.ps1',
    'scripts/windows/install-forge-shadow-podman-v1.ps1',
    'scripts/windows/install-forge-shadow-podman-v1.test.mjs',
    'shared/agents/forgeShadowBattleBridgeAdapterV1.mjs',
    'shared/agents/forgeShadowBattleBridgeAdapterV1.test.mjs',
    'shared/agents/forgeShadowBattleBridgePrerequisiteBlockerV1.test.mjs',
    'shared/agents/forgeShadowPodmanPrerequisiteV1.test.mjs',
    'shared/agents/forgeShadowPodmanRuntimeV1.mjs',
    'shared/agents/forgeShadowPodmanRuntimeV1.test.mjs',
  ]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [
    POST_SYNC_REFRESH_TARGETS.BACKEND_8787,
    POST_SYNC_REFRESH_TARGETS.MISSION_WORKER,
    POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD,
  ]);
  assert.equal(plan.changedPathCount, 11);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.openClawPathCount, 0);
  assert.equal(plan.unsafePathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('merged PR #2115 Forge prerequisite repair is natural-reload safe instead of an unclassified runtime blocker', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/windows/install-forge-shadow-podman-prerequisite-v1.ps1',
    'shared/agents/forgeShadowPodmanPrerequisiteV1.test.mjs',
  ]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD]);
  assert.equal(plan.changedPathCount, 2);
  assert.equal(plan.noRuntimePathCount, 1);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.openClawPathCount, 0);
  assert.equal(plan.unsafePathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('the exact allowances do not admit arbitrary Windows PowerShell runtime paths', () => {
  for (const path of [
    'windows/Launch-Stephanos-Other.ps1',
    'scripts/windows/install-forge-shadow-podman-other.ps1',
    'scripts/windows/unrelated-runtime-action.ps1',
  ]) {
    const plan = classifyPostSyncRefresh([path]);
    assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH);
    assert.deepEqual(plan.targetIds, []);
    assert.equal(plan.unknownPathCount, 1);
    assert.equal(plan.automaticExecutionAllowed, false);
  }
});
