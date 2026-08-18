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
