import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POST_SYNC_REFRESH_CLASSIFICATIONS,
  POST_SYNC_REFRESH_TARGETS,
  classifyPostSyncRefresh,
} from './postSyncRuntimeRefreshCoordinator.mjs';

const GOAL_DASHBOARD_2237_MERGE_ESTATE = Object.freeze([
  '.github/workflows/build-stephanos-ui.yml',
  'scripts/battle-bridge-goal-discovery-heartbeat-autonomy-track.test.mjs',
  'scripts/battle-bridge-goal-discovery-heartbeat.mjs',
  'shared/agents/autonomyBuildTrackV1.mjs',
  'shared/agents/autonomyBuildTrackV1.test.mjs',
  'shared/agents/goalDashboardEstateSummaryV1.mjs',
  'shared/agents/goalDashboardEstateSummaryV1.test.mjs',
  'shared/agents/shared-workspace-dashboard-feed.mjs',
  'stephanos-server/services/sharedWorkspaceDashboardFeedService.js',
  'stephanos-server/services/sharedWorkspaceDashboardFeedService.test.js',
]);

test('merged PR #2237 estate classifies the goal discovery heartbeat as Mission Worker runtime', () => {
  const plan = classifyPostSyncRefresh(GOAL_DASHBOARD_2237_MERGE_ESTATE);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.deepEqual(plan.targetIds, [
    POST_SYNC_REFRESH_TARGETS.BACKEND_8787,
    POST_SYNC_REFRESH_TARGETS.MISSION_WORKER,
  ]);
  assert.equal(plan.changedPathCount, GOAL_DASHBOARD_2237_MERGE_ESTATE.length);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.openClawPathCount, 0);
  assert.equal(plan.unsafePathCount, 0);
  assert.equal(plan.automaticExecutionAllowed, true);
});

test('goal discovery heartbeat classification remains exact and does not admit lookalike runtime scripts', () => {
  const plan = classifyPostSyncRefresh([
    'scripts/battle-bridge-goal-discovery-heartbeat-unregistered.mjs',
  ]);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH);
  assert.deepEqual(plan.targetIds, []);
  assert.equal(plan.unknownPathCount, 1);
  assert.equal(plan.automaticExecutionAllowed, false);
});
