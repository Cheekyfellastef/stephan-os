import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoalDashboardStatusProjection } from './goalDashboardStatusProjection.mjs';

test('goal dashboard projection exposes active goal PR, merge, proof, and manual refresh truth', () => {
  const projection = buildGoalDashboardStatusProjection({
    source: 'external-receipt-directory',
    generatedAt: '2026-07-01T00:00:00.000Z',
    missions: [{
      mission: { missionId: '#1385', title: 'Live goal dashboard', state: 'RUNNING', nextAction: 'Open draft PR.' },
      git: { headSha: 'a'.repeat(40) },
      pullRequest: { number: 1385, state: 'open', merged: false },
      receipts: [{ receiptId: 'proof', status: 'PASS' }],
    }, {
      mission: { missionId: '#1200', title: 'Old done goal', state: 'COMPLETE' },
    }],
  });

  assert.equal(projection.liveAdapterStatus, 'MANUAL_REFRESH_REQUIRED');
  assert.equal(projection.githubAutoUpdateTruth, 'MANUAL_REFRESH_REQUIRED');
  assert.equal(projection.activeGoalCount, 1);
  assert.equal(projection.goals[0].issue, '#1385');
  assert.equal(projection.goals[0].latestPr, '#1385');
  assert.match(projection.goals[0].merge, /NOT_MERGED/);
  assert.equal(projection.goals[0].proof, '1/1 receipts reported');
});

test('goal dashboard projection surfaces merged PR update receipts without inventing automation', () => {
  const projection = buildGoalDashboardStatusProjection({
    capabilities: { githubAutoUpdate: false, localAutoUpdate: false },
    missions: [{
      mission: { missionId: '#1300', title: 'Merged goal', state: 'BLOCKED' },
      pullRequest: { number: 1300, state: 'merged', mergeCommitSha: 'b'.repeat(40), merged: true },
    }],
  });

  assert.equal(projection.liveAdapterStatus, 'MANUAL_REFRESH_REQUIRED');
  assert.equal(projection.goals[0].merge, `MERGED ${'b'.repeat(40)}`);
  assert.equal(projection.goals[0].mergedPrUpdateTruth, 'MERGED_PR_UPDATE_REPORTED_BY_RECEIPT');
});
