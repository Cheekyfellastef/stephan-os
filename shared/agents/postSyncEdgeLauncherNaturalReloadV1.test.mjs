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

test('the launcher allowance remains exact and does not admit arbitrary Windows PowerShell runtime paths', () => {
  const plan = classifyPostSyncRefresh(['windows/Launch-Stephanos-Other.ps1']);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH);
  assert.deepEqual(plan.targetIds, []);
  assert.equal(plan.unknownPathCount, 1);
  assert.equal(plan.automaticExecutionAllowed, false);
});
