import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POST_SYNC_REFRESH_CLASSIFICATIONS,
  POST_SYNC_REFRESH_TARGETS,
  classifyPostSyncRefresh,
} from './postSyncRuntimeRefreshCoordinator.mjs';

const QUARANTINE_HARDENING_ESTATE = Object.freeze([
  'shared/agents/durableFlywheelControllerVNext.mjs',
  'shared/agents/durableFlywheelControllerVNext.test.mjs',
  'shared/agents/openClawProviderPoolQualificationV1.mjs',
  'shared/agents/openClawProviderPoolQualificationV1.test.mjs',
  'stephanos-server/services/criticalBacklogConveyorService.js',
  'stephanos-server/services/criticalBacklogConveyorService.test.js',
  'stephanos-server/services/elasticOpenClawProviderPoolService.test.js',
]);

test('execution-surface quarantine hardening estate is automatically refreshable', () => {
  const plan = classifyPostSyncRefresh(QUARANTINE_HARDENING_ESTATE);

  assert.equal(plan.classification, POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY);
  assert.equal(plan.automaticExecutionAllowed, true);
  assert.deepEqual(plan.targetIds, [
    POST_SYNC_REFRESH_TARGETS.BACKEND_8787,
    POST_SYNC_REFRESH_TARGETS.MISSION_WORKER,
  ]);
  assert.equal(plan.changedPathCount, QUARANTINE_HARDENING_ESTATE.length);
  assert.equal(plan.noRuntimePathCount, 4);
  assert.equal(plan.unknownPathCount, 0);
  assert.equal(plan.openClawPathCount, 0);
  assert.equal(plan.unsafePathCount, 0);
  assert.deepEqual(plan.internal.unknownPaths, []);
});
