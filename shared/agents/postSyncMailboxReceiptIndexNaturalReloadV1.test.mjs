import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POST_SYNC_REFRESH_CLASSIFICATIONS,
  POST_SYNC_REFRESH_TARGETS,
  classifyPostSyncRefresh,
} from './postSyncRuntimeRefreshCoordinator.mjs';

const WRAPPER = 'scripts/battle-bridge-github-command-mailbox-with-receipt-index.mjs';
const LEASE_TEST = 'scripts/battle-bridge-github-command-mailbox-accepted-lease.test.mjs';

test('merged mailbox accepted-lease repair classifies as bounded natural reload', () => {
  const plan = classifyPostSyncRefresh([WRAPPER, LEASE_TEST]);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.equal(plan.automaticExecutionAllowed, true);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD]);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.noRuntimePathCount, 1);
  assert.deepEqual(plan.internal.unknownPaths, []);
});

test('mailbox receipt-index allowance is exact and does not admit sibling runtime scripts', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/battle-bridge-github-command-mailbox-unregistered-runtime.mjs',
  ]);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH);
  assert.equal(plan.automaticExecutionAllowed, false);
  assert.deepEqual(plan.targetIds, []);
  assert.equal(plan.unknownPathCount, 1);
});
