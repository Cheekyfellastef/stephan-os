import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POST_SYNC_REFRESH_CLASSIFICATIONS,
  POST_SYNC_REFRESH_TARGETS,
  classifyPostSyncRefresh,
} from './postSyncRuntimeRefreshCoordinator.mjs';

const CODEX_DISPATCH_MCP = 'scripts/stephanos-codex-dispatch-mcp.mjs';
const CODEX_DISPATCH_TEST = 'shared/agents/codexDispatchMcp.test.mjs';

test('merged PR #2384 Codex dispatch MCP estate classifies as bounded natural reload', () => {
  const plan = classifyPostSyncRefresh([CODEX_DISPATCH_MCP, CODEX_DISPATCH_TEST]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.equal(plan.automaticExecutionAllowed, true);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD]);
  assert.equal(plan.changedPathCount, 2);
  assert.equal(plan.noRuntimePathCount, 1);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.openClawPathCount, 0);
  assert.equal(plan.unsafePathCount, 0);
  assert.deepEqual(plan.internal.unknownPaths, []);
});

test('Codex dispatch MCP natural-reload allowance is exact and does not admit sibling runtime scripts', () => {
  for (const path of [
    'scripts/stephanos-codex-dispatch-mcp-other.mjs',
    'scripts/stephanos-codex-dispatch-worker.mjs',
  ]) {
    const plan = classifyPostSyncRefresh([path]);
    assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH);
    assert.equal(plan.automaticExecutionAllowed, false);
    assert.deepEqual(plan.targetIds, []);
    assert.equal(plan.unknownPathCount, 1);
  }
});
