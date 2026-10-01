import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATUS_ID,
  reconcileSovereignCommanderCapabilityParity,
} from './sovereign-commander-capability-parity-reconcile.mjs';

test('reconcile persists a deduplicated parity gap without needing Remote Commander health', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sovereign-parity-'));
  const repoRoot = 'C:/repo';
  const result = await reconcileSovereignCommanderCapabilityParity({
    paths: { workspaceRoot, repoRoot },
    now: new Date('2026-10-01T20:10:00.000Z'),
    readQueue: async () => [{
      adapter: 'desktop-commander',
      path: 'C:/queue/source-build.json',
      item: {
        missionId: 'critical-2573-parity',
        actionId: 'source-build-1',
        actionGrant: { operation: 'source-construction' },
      },
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.canonicalOwnerGoal, '#2573');
  assert.equal(result.buildableGapCount, 1);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.meterDependencyAccepted, false);

  const persisted = JSON.parse(await readFile(
    join(workspaceRoot, 'status', `${SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATUS_ID}.json`),
    'utf8',
  ));
  assert.equal(persisted.kind, 'status');
  assert.equal(persisted.relatedIssue, '#2573');
  assert.equal(persisted.capabilityParity.buildableGapCount, 1);
  assert.equal(persisted.capabilityParity.capabilities[0].capabilityId, 'source-construction');
  assert.equal(persisted.capabilityParity.capabilities[0].canonicalOwnerGoal, '#2573');
  assert.equal(persisted.capabilityParity.duplicateGoalCreationAllowed, false);
  assert.equal(persisted.standingGoalMustRemainOpen, true);
});
