import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CRITICAL_BACKLOG_DECISION,
  DEFAULT_CRITICAL_BACKLOG,
  buildCriticalBacklogMissionInput,
  buildCriticalBacklogProjection,
  validateCriticalBacklog,
} from './criticalBacklogConveyor.mjs';

test('default critical backlog is deterministic, bounded and ordered', () => {
  const validation = validateCriticalBacklog();
  assert.equal(validation.valid, true, validation.errors.join(','));
  assert.equal(validation.itemCount, 5);
  assert.deepEqual(DEFAULT_CRITICAL_BACKLOG.map((entry) => entry.priority), [10, 20, 30, 40, 50]);
  assert.equal(new Set(DEFAULT_CRITICAL_BACKLOG.map((entry) => entry.mission.missionId)).size, 5);
});

test('creates only the first missing critical mission when idle', () => {
  const projection = buildCriticalBacklogProjection();
  assert.equal(projection.decision, CRITICAL_BACKLOG_DECISION.CREATE_NEXT_MISSION);
  assert.equal(projection.selectedItem.itemId, 'worker-watchdog-self-heal');
  assert.equal(projection.oneActiveMissionEnforced, true);
  assert.equal(projection.duplicateCodexDispatchAllowed, false);
  assert.equal(projection.mergeAuthority, false);
  assert.equal(projection.exactHeadApprovalRequired, true);
});

test('waits for one active mission and does not create a duplicate lane', () => {
  const first = DEFAULT_CRITICAL_BACKLOG[0];
  const projection = buildCriticalBacklogProjection({
    missionRecords: [{ missionId: first.mission.missionId, currentPhase: 'AGENT_IMPLEMENTATION' }],
  });
  assert.equal(projection.decision, CRITICAL_BACKLOG_DECISION.WAIT_ACTIVE_MISSION);
  assert.equal(projection.selectedItem.itemId, first.itemId);
  assert.equal(projection.finalVerdict, 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE');
});

test('holds on approval and blocker states rather than skipping critical work', () => {
  for (const currentPhase of ['AWAITING_OPERATOR_APPROVAL', 'BLOCKED']) {
    const first = DEFAULT_CRITICAL_BACKLOG[0];
    const projection = buildCriticalBacklogProjection({
      missionRecords: [{ missionId: first.mission.missionId, currentPhase }],
    });
    assert.equal(projection.decision, CRITICAL_BACKLOG_DECISION.WAIT_ACTIVE_MISSION);
    assert.equal(projection.finalVerdict, 'CRITICAL_BACKLOG_CONVEYOR_HELD');
    assert.match(projection.exactNextAction, new RegExp(currentPhase));
  }
});

test('advances to the next item only after the previous mission is complete', () => {
  const first = DEFAULT_CRITICAL_BACKLOG[0];
  const projection = buildCriticalBacklogProjection({
    missionRecords: [{ missionId: first.mission.missionId, currentPhase: 'COMPLETE' }],
  });
  assert.equal(projection.decision, CRITICAL_BACKLOG_DECISION.CREATE_NEXT_MISSION);
  assert.equal(projection.selectedItem.itemId, 'post-sync-runtime-refresh');
  assert.deepEqual(projection.completedItemIds, [first.itemId]);
});

test('fails closed when more than one mission is active including external work', () => {
  const projection = buildCriticalBacklogProjection({
    missionRecords: [
      { missionId: DEFAULT_CRITICAL_BACKLOG[0].mission.missionId, currentPhase: 'AGENT_IMPLEMENTATION' },
      { missionId: 'external-active-mission', currentPhase: 'CHECK_PULL_REQUEST' },
    ],
  });
  assert.equal(projection.decision, CRITICAL_BACKLOG_DECISION.BLOCKED_BY_MULTIPLE_ACTIVE_MISSIONS);
  assert.deepEqual(projection.activeMissionIds, ['critical-1291-worker-watchdog-repair', 'external-active-mission']);
});

test('waits for an external active mission before starting the critical queue', () => {
  const projection = buildCriticalBacklogProjection({
    missionRecords: [{ missionId: 'external-active-mission', currentPhase: 'CHECK_PULL_REQUEST' }],
  });
  assert.equal(projection.decision, CRITICAL_BACKLOG_DECISION.WAIT_EXTERNAL_ACTIVE_MISSION);
  assert.equal(projection.selectedItem, null);
});

test('builds a bounded mission intake without merge authority', () => {
  const built = buildCriticalBacklogMissionInput(DEFAULT_CRITICAL_BACKLOG[0], {
    repositoryRoot: 'C:/canonical/repo',
    worktreePath: 'C:/canonical/worktrees/critical-1291-worker-watchdog-repair',
  });
  assert.equal(built.ok, true);
  assert.equal(built.mission.missionId, 'critical-1291-worker-watchdog-repair');
  assert.equal(built.mission.branch, 'openclaw/critical-1291-worker-watchdog-repair');
  assert.ok(built.mission.allowedFiles.includes('scripts/battle-bridge-worker-watchdog.mjs'));
  assert.ok(built.mission.requiredTests.length > 0);
  assert.match(built.mission.worktreePath, /critical-1291-worker-watchdog-repair$/);
});

test('invalid backlog definitions fail closed', () => {
  const invalid = [{ ...DEFAULT_CRITICAL_BACKLOG[0], headlineApprovalRef: '' }];
  const projection = buildCriticalBacklogProjection({ backlog: invalid });
  assert.equal(projection.decision, CRITICAL_BACKLOG_DECISION.BLOCKED_BY_INVALID_BACKLOG);
  assert.match(projection.validation.errors.join(','), /missing-headline-approval/);
});

test('reports complete only when every critical mission completed', () => {
  const missionRecords = DEFAULT_CRITICAL_BACKLOG.map((entry) => ({
    missionId: entry.mission.missionId,
    currentPhase: 'COMPLETE',
  }));
  const projection = buildCriticalBacklogProjection({ missionRecords });
  assert.equal(projection.decision, CRITICAL_BACKLOG_DECISION.BACKLOG_COMPLETE);
  assert.equal(projection.completedItemIds.length, DEFAULT_CRITICAL_BACKLOG.length);
  assert.deepEqual(projection.remainingItemIds, []);
});
