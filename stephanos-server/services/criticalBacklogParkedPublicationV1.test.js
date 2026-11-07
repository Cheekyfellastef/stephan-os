import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { publishCriticalBacklogProjection, resolveCriticalBacklogRuntimePaths } from './criticalBacklogConveyorService.js';

async function roots() {
  const root = await mkdtemp(join(tmpdir(), 'critical-conveyor-parked-publication-'));
  return resolveCriticalBacklogRuntimePaths({
    repoRoot: join(root, 'repo'),
    workspaceRoot: join(root, 'workspace'),
    worktreeRoot: join(root, 'worktrees'),
    orchestratorRoot: join(root, 'orchestrator'),
    snapshotRoot: join(root, 'snapshots'),
  });
}

function projection(parkedMissionIds) {
  return {
    decision: 'CREATE_NEXT_MISSION',
    finalVerdict: 'CRITICAL_BACKLOG_MISSION_READY',
    selectedItem: { itemId: 'critical-next' },
    activeMission: null,
    completedItemIds: [],
    parkedItemIds: parkedMissionIds.map((id) => `item-${id}`),
    parkedMissionIds,
    parkedApprovalCount: parkedMissionIds.length,
    remainingItemIds: ['critical-next'],
    exactNextAction: 'Create bounded mission critical-next; parked approval packets consume zero construction capacity.',
    oneActiveMissionEnforced: true,
    elasticGoalMissionsUseSchedulerCapacity: false,
  };
}

test('durable status publishes parked approval identities and count', async () => {
  const paths = await roots();
  const current = projection(['parked-a', 'parked-b']);
  const result = await publishCriticalBacklogProjection(current, {
    paths,
    now: new Date('2026-09-08T01:40:00.000Z'),
  });
  assert.equal(result.ok, true);
  const status = JSON.parse(await readFile(join(paths.workspaceRoot, 'status', 'critical-backlog-conveyor-current.json'), 'utf8'));
  assert.deepEqual(status.parkedItemIds, ['item-parked-a', 'item-parked-b']);
  assert.deepEqual(status.parkedMissionIds, ['parked-a', 'parked-b']);
  assert.equal(status.parkedApprovalCount, 2);
});

test('parked-set-only changes emit a durable transition event', async () => {
  const paths = await roots();
  const first = await publishCriticalBacklogProjection(projection(['parked-a']), {
    paths,
    now: new Date('2026-09-08T01:41:00.000Z'),
  });
  const second = await publishCriticalBacklogProjection(projection(['parked-b']), {
    paths,
    now: new Date('2026-09-08T01:42:00.000Z'),
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.changed, true);
  const events = await readdir(join(paths.workspaceRoot, 'events', 'critical-backlog-conveyor'));
  assert.equal(events.length, 2);
});
