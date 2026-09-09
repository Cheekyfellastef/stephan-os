import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POST_SYNC_REFRESH_CLASSIFICATIONS,
  POST_SYNC_REFRESH_TARGETS,
  classifyPostSyncRefresh,
  parseGitChangedPathStatus,
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

test('required mailbox receipt-index wrapper modification remains natural reload eligible', () => {
  const parsed = parseGitChangedPathStatus(`M\t${WRAPPER}`);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.paths, [WRAPPER]);
  const plan = classifyPostSyncRefresh(parsed.paths);
  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD]);
});

test('required mailbox receipt-index wrapper deletion fails closed before refresh classification', () => {
  const parsed = parseGitChangedPathStatus(`D\t${WRAPPER}`);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.blocker, 'POST_SYNC_REQUIRED_MAILBOX_WRAPPER_REMOVED');
  assert.deepEqual(parsed.paths, []);
});

test('required mailbox receipt-index wrapper rename-away fails closed', () => {
  const parsed = parseGitChangedPathStatus(`R100\t${WRAPPER}\tscripts/battle-bridge-github-command-mailbox-renamed.mjs`);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.blocker, 'POST_SYNC_REQUIRED_MAILBOX_WRAPPER_REMOVED');
  assert.deepEqual(parsed.paths, []);
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
