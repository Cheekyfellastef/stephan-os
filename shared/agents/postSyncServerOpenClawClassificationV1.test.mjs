import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POST_SYNC_REFRESH_CLASSIFICATIONS,
  POST_SYNC_REFRESH_TARGETS,
  classifyPostSyncRefresh,
} from './postSyncRuntimeRefreshCoordinator.mjs';

test('server-side OpenClaw-named services use the backend refresh path without OpenClaw approval', () => {
  const plan = classifyPostSyncRefresh([
    'stephanos-server/services/elasticOpenClawProviderPoolService.js',
  ]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [POST_SYNC_REFRESH_TARGETS.BACKEND_8787]);
  assert.equal(plan.openClawApprovalRequired, false);
  assert.equal(plan.openClawPathCount, 0);
  assert.equal(plan.unknownPathCount, 0);
});

test('real OpenClaw runtime/plugin paths remain approval-gated', () => {
  const plan = classifyPostSyncRefresh([
    'integrations/openclaw/stephanos-ignite-command/index.mjs',
  ]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.APPROVAL_REQUIRED_OPENCLAW);
  assert.equal(plan.openClawApprovalRequired, true);
  assert.equal(plan.openClawPathCount, 1);
});

test('OpenClaw-named runtime files outside stephanos-server remain approval-gated', () => {
  const plan = classifyPostSyncRefresh([
    'shared/agents/elasticOpenClawProviderPoolService.mjs',
  ]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.APPROVAL_REQUIRED_OPENCLAW);
  assert.ok(plan.targetIds.includes(POST_SYNC_REFRESH_TARGETS.MISSION_WORKER));
  assert.equal(plan.openClawApprovalRequired, true);
  assert.equal(plan.openClawPathCount, 1);
});
