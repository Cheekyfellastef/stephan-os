import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_CRITICAL_BACKLOG } from './criticalBacklogConveyor.mjs';
import {
  GOAL_BUILDING_SELF_HOSTING_ITEM_ID,
  LEGACY_RECOVERY_NON_BLOCKING_ISSUE,
  LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
  LEGACY_RECOVERY_SUCCESSOR_ISSUES,
  NON_BLOCKING_LEGACY_RECOVERY_ACCEPTANCE,
  SELF_HOSTING_CRITICAL_BACKLOG,
} from './criticalBacklogGoalBuildingBootstrapV1.mjs';

test('legacy #1291 acceptance stays visible but cannot block the production self-hosting backlog', () => {
  const legacy = DEFAULT_CRITICAL_BACKLOG.find(
    (entry) => entry?.mission?.missionId === LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
  );
  assert.ok(legacy, 'historical source backlog should retain the #1291 recovery record');
  assert.equal(legacy.issueNumbers.includes(LEGACY_RECOVERY_NON_BLOCKING_ISSUE), true);

  assert.equal(
    SELF_HOSTING_CRITICAL_BACKLOG.some(
      (entry) => entry?.mission?.missionId === LEGACY_RECOVERY_NON_BLOCKING_MISSION_ID,
    ),
    false,
    '#1291 must not consume the canonical goal-building track',
  );
  assert.equal(
    SELF_HOSTING_CRITICAL_BACKLOG.some((entry) => entry?.itemId === GOAL_BUILDING_SELF_HOSTING_ITEM_ID),
    true,
    'goal-building self-hosting work must remain schedulable',
  );

  assert.equal(NON_BLOCKING_LEGACY_RECOVERY_ACCEPTANCE.issueNumber, 1291);
  assert.equal(NON_BLOCKING_LEGACY_RECOVERY_ACCEPTANCE.state, 'OPEN_NON_BLOCKING');
  assert.deepEqual(LEGACY_RECOVERY_SUCCESSOR_ISSUES, [1814, 1885, 1889, 1818]);
  assert.deepEqual(
    NON_BLOCKING_LEGACY_RECOVERY_ACCEPTANCE.successorIssueNumbers,
    LEGACY_RECOVERY_SUCCESSOR_ISSUES,
  );
});
