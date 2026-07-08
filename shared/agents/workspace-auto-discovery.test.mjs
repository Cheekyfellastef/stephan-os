import test from 'node:test';
import assert from 'node:assert/strict';
import { projectWorkspaceAutoDiscovery } from './workspaceAutoDiscovery.mjs';

test('G17 classifies active, stale, orphaned, and blocked workspaces without cleanup authority', () => {
  const p = projectWorkspaceAutoDiscovery({ nowMs:Date.parse('2026-07-08T00:00:00.000Z'), staleAfterMs:1000, buildLanes:[{ laneId:'a', branch:'feature/a', status:'running', updatedAtUtc:'2026-07-08T00:00:00.000Z' }, { laneId:'b', branch:'feature/b', updatedAtUtc:'2026-07-07T00:00:00.000Z' }, { laneId:'c' }, { laneId:'d', branch:'feature/d', blocker:'needs proof' }] });
  assert.equal(p.branchDeletionAllowed, false);
  assert.equal(p.hardResetAllowed, false);
  assert.deepEqual(p.workspaces.map(w=>w.classification), ['ACTIVE','STALE','ORPHANED','BLOCKED']);
  assert.match(p.workspaces[2].exactNextAction, /do not reset or delete/i);
});
