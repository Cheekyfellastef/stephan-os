import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WORKSPACE_INTEGRITY_ISSUE,
  WORKSPACE_INTEGRITY_MISSION_ID,
  buildWorkspaceIntegritySeedV1,
} from './workspaceIntegritySeedV1.mjs';

test('workspace integrity seed makes end-to-end provenance a persistent project invariant without widening authority', () => {
  const seed = buildWorkspaceIntegritySeedV1({ refreshedAtUtc: '2026-10-07T20:00:00.000Z' });
  assert.equal(seed.missionId, WORKSPACE_INTEGRITY_MISSION_ID);
  assert.equal(seed.issueRef, WORKSPACE_INTEGRITY_ISSUE);
  assert.equal(seed.persistent, true);
  assert.match(seed.northStar, /canonical source through transport and transformation/i);
  assert.equal(seed.growthContract.everyVisibleComponentNeedsStableIdentity, true);
  assert.equal(seed.growthContract.syntheticProofRequiredForGreen, true);
  assert.equal(seed.growthContract.orphanConsumersBecomeGaps, true);
  assert.equal(seed.growthContract.unconsumedImportantSourcesBecomeGaps, true);
  assert.equal(seed.growthContract.staleOrUnknownNeverCountsAsGreen, true);
  assert.equal(seed.authority.sourceMutationAllowedBySeed, false);
  assert.equal(seed.authority.mergeAllowedBySeed, false);
  assert.equal(seed.authority.duplicateRegistryAllowed, false);
});
