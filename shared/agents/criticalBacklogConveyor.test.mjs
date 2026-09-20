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
  assert.equal(projection.approvalReadyConsumesConstructionCapacity, false);
  assert.equal(projection.blockedMissionConsumesConstructionCapacity, false);
  assert.equal(projection.blockedMissionParkingReleasesConstructionCapacity, true);
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

test('parks approval-ready work and immediately refills the construction slot', () => {
  const first = DEFAULT_CRITICAL_BACKLOG[0];
  const second = DEFAULT_CRITICAL_BACKLOG[1];
  const projection = buildCriticalBacklogProjection({
    missionRecords: [{ missionId: first.mission.missionId, currentPhase: 'AWAITING_OPERATOR_APPROVAL' }],
  });
  assert.equal(projection.decision, CRITICAL_BACKLOG_DECISION.CREATE_NEXT_MISSION);
  assert.equal(projection.selectedItem.itemId, second.itemId);
  assert.deepEqual(projection.parkedItemIds, [first.itemId]);
  assert.deepEqual(projection.parkedMissionIds, [first.mission.missionId]);
  assert.deepEqual(projection.parkedApprovalMissionIds, [first.mission.missionId]);
  assert.deepEqual(projection.parkedBlockedMissionIds, []);
  assert.equal(projection.parkedApprovalCount, 1);
  assert.equal(projection.parkedBlockedCount, 0);
  assert.equal(projection.approvalReadyConsumesConstructionCapacity, false);
  assert.equal(projection.remainingItemIds.includes(first.itemId), false);
  assert.match(projection.exactNextAction, /zero construction capacity/i);
});

test('resumed approval merge follow-through does not collide with a refilled builder', () => {
  const first = DEFAULT_CRITICAL_BACKLOG[0];
  const second = DEFAULT_CRITICAL_BACKLOG[1];
  const projection = buildCriticalBacklogProjection({
    missionRecords: [
      { missionId: first.mission.missionId, currentPhase: 'MERGE_PULL_REQUEST' },
      { missionId: second.mission.missionId, currentPhase: 'AGENT_IMPLEMENTATION' },
    ],
  });
  assert.equal(projection.decision, CRITICAL_BACKLOG_DECISION.WAIT_ACTIVE_MISSION);
  assert.equal(projection.activeMission?.missionId, second.mission.missionId);
  assert.deepEqual(projection.parkedMissionIds, [first.mission.missionId]);
  assert.deepEqual(projection.parkedItemIds, [first.itemId]);
  assert.equal(projection.parkedApprovalCount, 1);
  assert.equal(projection.approvalReadyConsumesConstructionCapacity, false);
});

test('parks a genuinely blocked mission and refills the legacy construction slot', () => {
  const first = DEFAULT_CRITICAL_BACKLOG[0];
  const second = DEFAULT_CRITICAL_BACKLOG[1];
  const projection = buildCriticalBacklogProjection({
    missionRecords: [{ missionId: first.mission.missionId, currentPhase: 'BLOCKED', blockers: ['runtime acceptance unavailable'] }],
  });
  assert.equal(projection.decision, CRITICAL_BACKLOG_DECISION.CREATE_NEXT_MISSION);
  assert.equal(projection.selectedItem.itemId, second.itemId);
  assert.deepEqual(projection.parkedBlockedMissionIds, [first.mission.missionId]);
  assert.deepEqual(projection.parkedMissionIds, [first.mission.missionId]);
  assert.equal(projection.parkedBlockedCount, 1);
  assert.equal(projection.blockedMissionConsumesConstructionCapacity, false);
  assert.match(projection.exactNextAction, /blocked repair-owned missions consume zero construction capacity/i);
});

test('a parked blocked mission does not collide with the next active legacy builder', () => {
  const first = DEFAULT_CRITICAL_BACKLOG[0];
  const second = DEFAULT_CRITICAL_BACKLOG[1];
  const projection = buildCriticalBacklogProjection({
    missionRecords: [
      { missionId: first.mission.missionId, currentPhase: 'BLOCKED', blockers: ['waiting for bounded repair'] },
      { missionId: second.mission.missionId, currentPhase: 'AGENT_IMPLEMENTATION' },
    ],
  });
  assert.equal(projection.decision, CRITICAL_BACKLOG_DECISION.WAIT_ACTIVE_MISSION);
  assert.equal(projection.activeMission?.missionId, second.mission.missionId);
  assert.deepEqual(projection.parkedBlockedMissionIds, [first.mission.missionId]);
  assert.equal(projection.finalVerdict, 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE');
});

test('a repaired blocked mission is automatically active again when its mission phase leaves BLOCKED', () => {
  const first = DEFAULT_CRITICAL_BACKLOG[0];
  const projection = buildCriticalBacklogProjection({
    missionRecords: [{ missionId: first.mission.missionId, currentPhase: 'REPAIR_REQUIRED' }],
  });
  assert.equal(projection.decision, CRITICAL_BACKLOG_DECISION.WAIT_ACTIVE_MISSION);
  assert.equal(projection.activeMission?.missionId, first.mission.missionId);
  assert.deepEqual(projection.parkedBlockedMissionIds, []);
  assert.match(projection.exactNextAction, /Continue critical-1291-worker-watchdog-repair/i);
});

test('reports parked blockers instead of complete when every remaining legacy mission is blocked', () => {
  const missionRecords = DEFAULT_CRITICAL_BACKLOG.map((entry) => ({
    missionId: entry.mission.missionId,
    currentPhase: 'BLOCKED',
    blockers: ['bounded repair pending'],
  }));
  const projection = buildCriticalBacklogProjection({ missionRecords });
  assert.equal(projection.decision, CRITICAL_BACKLOG_DECISION.PARKED_BLOCKERS_ONLY);
  assert.equal(projection.finalVerdict, 'CRITICAL_BACKLOG_CONVEYOR_PARKED');
  assert.equal(projection.parkedBlockedCount, DEFAULT_CRITICAL_BACKLOG.length);
  assert.deepEqual(projection.remainingItemIds, []);
  assert.match(projection.exactNextAction, /re-admit the same mission identity/i);
});

test('parked external approval work does not create a false duplicate-active block', () => {
  const first = DEFAULT_CRITICAL_BACKLOG[0];
  const projection = buildCriticalBacklogProjection({
    missionRecords: [
      { missionId: first.mission.missionId, currentPhase: 'AGENT_IMPLEMENTATION' },
      { missionId: 'external-approval-ready-mission', currentPhase: 'AWAITING_OPERATOR_APPROVAL' },
    ],
  });
  assert.equal(projection.decision, CRITICAL_BACKLOG_DECISION.WAIT_ACTIVE_MISSION);
  assert.equal(projection.activeMission?.missionId, first.mission.missionId);
  assert.deepEqual(projection.parkedMissionIds, ['external-approval-ready-mission']);
});

test('advances to the next item after the previous mission is complete', () => {
  const first = DEFAULT_CRITICAL_BACKLOG[0];
  const projection = buildCriticalBacklogProjection({
    missionRecords: [{ missionId: first.mission.missionId, currentPhase: 'COMPLETE' }],
  });
  assert.equal(projection.decision, CRITICAL_BACKLOG_DECISION.CREATE_NEXT_MISSION);
  assert.equal(projection.selectedItem.itemId, 'post-sync-runtime-refresh');
  assert.deepEqual(projection.completedItemIds, [first.itemId]);
});

test('fails closed when more than one construction mission is active including external work', () => {
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

test('reports parked rather than complete when only approval packets remain', () => {
  const missionRecords = DEFAULT_CRITICAL_BACKLOG.map((entry) => ({
    missionId: entry.mission.missionId,
    currentPhase: 'AWAITING_OPERATOR_APPROVAL',
  }));
  const projection = buildCriticalBacklogProjection({ missionRecords });
  assert.equal(projection.decision, CRITICAL_BACKLOG_DECISION.PARKED_APPROVALS_ONLY);
  assert.equal(projection.finalVerdict, 'CRITICAL_BACKLOG_CONVEYOR_PARKED');
  assert.equal(projection.completedItemIds.length, 0);
  assert.equal(projection.parkedItemIds.length, DEFAULT_CRITICAL_BACKLOG.length);
  assert.equal(projection.parkedApprovalCount, DEFAULT_CRITICAL_BACKLOG.length);
  assert.equal(projection.parkedBlockedCount, 0);
  assert.deepEqual(projection.remainingItemIds, []);
});

test('reports complete only when every critical mission completed', () => {
  const missionRecords = DEFAULT_CRITICAL_BACKLOG.map((entry) => ({
    missionId: entry.mission.missionId,
    currentPhase: 'COMPLETE',
  }));
  const projection = buildCriticalBacklogProjection({ missionRecords });
  assert.equal(projection.decision, CRITICAL_BACKLOG_DECISION.BACKLOG_COMPLETE);
  assert.equal(projection.completedItemIds.length, DEFAULT_CRITICAL_BACKLOG.length);
  assert.deepEqual(projection.parkedItemIds, []);
  assert.deepEqual(projection.remainingItemIds, []);
});
