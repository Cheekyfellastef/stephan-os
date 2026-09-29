import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POST_SYNC_REFRESH_CLASSIFICATIONS,
  classifyPostSyncRefresh,
} from './postSyncRuntimeRefreshCoordinator.mjs';

const PROTECTED_MERGE_AUTHORITY_ESTATE = Object.freeze([
  'docs/architecture/stephanos-protected-workflow-dispatch-v1.md',
  'scripts/operator-protected-personal-repository-merge.mjs',
  'scripts/repository-native-merge-boundary.test.mjs',
  'shared/agents/operatorPersonalRepositoryMergeV1.mjs',
  'shared/agents/operatorPersonalRepositoryMergeV1.test.mjs',
]);

test('protected personal-repository merge authority changes require no Battle Bridge runtime refresh', () => {
  const plan = classifyPostSyncRefresh(PROTECTED_MERGE_AUTHORITY_ESTATE);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.NO_RUNTIME_REFRESH_REQUIRED);
  assert.deepEqual(plan.targetIds, []);
  assert.equal(plan.changedPathCount, PROTECTED_MERGE_AUTHORITY_ESTATE.length);
  assert.equal(plan.noRuntimePathCount, PROTECTED_MERGE_AUTHORITY_ESTATE.length);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.openClawPathCount, 0);
  assert.equal(plan.unsafePathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('current protected check identity repair subset remains no-runtime', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/operator-protected-personal-repository-merge.mjs',
    'shared/agents/operatorPersonalRepositoryMergeV1.mjs',
    'shared/agents/operatorPersonalRepositoryMergeV1.test.mjs',
  ]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.NO_RUNTIME_REFRESH_REQUIRED);
  assert.deepEqual(plan.targetIds, []);
  assert.equal(plan.noRuntimePathCount, 3);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('current coalesced protected-merge and ignition repair debt has no unclassified runtime paths', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/battle-bridge-ignition-supervisor.mjs',
    'scripts/battle-bridge-ignition-supervisor.test.mjs',
    'scripts/ignite-stephanos-local.mjs',
    'scripts/ignite-stephanos-local.test.mjs',
    'scripts/operator-protected-personal-repository-merge.mjs',
    'shared/agents/operatorPersonalRepositoryMergeV1.mjs',
    'shared/agents/operatorPersonalRepositoryMergeV1.test.mjs',
    'shared/agents/stephanosChatUpdate.mjs',
    'shared/agents/stephanosChatUpdate.test.mjs',
    'shared/agents/postSyncRuntimeRefreshCoordinator.mjs',
    'shared/agents/postSyncProtectedMergeNoRuntimeV1.test.mjs',
  ]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [
    'stephanos-ui-4173',
    'stephanos-backend-8787',
    'mission-orchestrator-worker',
    'natural-reload',
  ]);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.openClawPathCount, 0);
  assert.equal(plan.unsafePathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
  assert.ok(plan.internal.noRuntimePaths.includes('scripts/ignite-stephanos-local.mjs'));
});
