import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMissionHandoffText,
  normalizeMissionDashboardState,
  sortMilestonesForOperations,
} from './missionDashboardModel.js';

test('normalizeMissionDashboardState recovers malformed records safely', () => {
  const normalized = normalizeMissionDashboardState({
    overallSummary: { completionEstimate: 200 },
    milestones: [
      { id: 'A 1', title: '', status: 'bad', percentComplete: -10 },
      { id: 'A 1', title: 'dup', status: 'complete', percentComplete: 30 },
    ],
  });

  assert.equal(normalized.overallSummary.completionEstimate, 100);
  assert.equal(normalized.milestones.length, 1);
  assert.equal(normalized.milestones[0].status, 'not-started');
  assert.equal(normalized.milestones[0].percentComplete, 0);
});

test('sortMilestonesForOperations orders blocked before in-progress before complete', () => {
  const ordered = sortMilestonesForOperations([
    { id: 'c', title: 'Done', status: 'complete', blockerFlag: false, sortOrder: 3 },
    { id: 'b', title: 'Active', status: 'in-progress', blockerFlag: false, sortOrder: 2 },
    { id: 'a', title: 'Blocked', status: 'blocked', blockerFlag: true, sortOrder: 1 },
  ]);

  assert.deepEqual(ordered.map((item) => item.id), ['a', 'b', 'c']);
});

test('buildMissionHandoffText produces deterministic operator sections', () => {
  const text = buildMissionHandoffText({
    overallSummary: { projectHealth: 'watch', completionEstimate: 30, missionNote: 'Operator note', lastUpdatedAt: '2026-01-01T00:00:00.000Z' },
    milestones: [
      {
        id: 'm1',
        title: 'Alpha',
        status: 'blocked',
        percentComplete: 10,
        blockerFlag: true,
        blockerDetails: 'Waiting on dependency',
        notes: 'note',
        nextAction: 'unblock',
        dependencies: ['runtime-truth'],
        linkedSystems: ['shared/runtime/stephanosMemory.mjs'],
        updatedAt: '2026-01-01T00:00:00.000Z',
        description: '',
        category: 'core',
        sortOrder: 1,
      },
    ],
  });

  assert.match(text, /Stephanos Mission Handoff/);
  assert.match(text, /Active Blockers Summary/);
  assert.match(text, /Dependencies Summary/);
  assert.match(text, /Mission Note/);
});
