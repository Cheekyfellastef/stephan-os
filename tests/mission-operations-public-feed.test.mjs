import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readPublicMissionOperations,
  resolvePublicMissionOperationsDirectory,
} from '../stephanos-server/services/missionOperationsPublicFeed.js';


test('public feed resolves the canonical Mission Runner receipt directory on Windows', () => {
  const directory = resolvePublicMissionOperationsDirectory({
    USERPROFILE: 'C:\\Users\\Stephan Callear',
  });
  assert.match(
    directory.replace(/\\/g, '/'),
    /Users\/Stephan Callear\/Documents\/OpenClaw-Standalone\/mission-runner\/proof\/mission-operations$/,
  );
});


test('public mission feed withholds local paths and private approval tokens while preserving bounded approval state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stephanos-public-feed-'));
  const privateApprovalToken = `APPROVE_OPENCLAW_SQUASH_MERGE:1270:${'a'.repeat(40)}`;
  await writeFile(join(directory, 'snapshot.json'), JSON.stringify({
    schemaVersion: 'stephanos.mission-operations-snapshot.v1',
    missionId: 'mission-public-feed',
    state: 'AWAITING_APPROVAL',
    updatedAt: '2026-06-24T18:00:00.000Z',
    github: { worktreePath: 'C:\\Users\\operator\\private-worktree' },
    approvals: [{
      approvalId: 'merge-1270',
      kind: 'squash-merge',
      status: 'pending',
      requiredToken: privateApprovalToken,
      requestedAt: '2026-06-24T17:59:00.000Z',
    }],
    receipts: [{
      receiptId: 'receipt-1',
      receiptPath: 'C:\\Users\\operator\\proof\\receipt-1.json',
      sha256: 'a'.repeat(64),
    }],
  }));

  const feed = await readPublicMissionOperations({
    directory,
    now: new Date('2026-06-24T18:01:00.000Z'),
  });

  assert.equal(feed.directory, 'configured-external-receipt-directory');
  assert.equal(feed.missions[0].git.worktreePath, 'configured-isolated-worktree');
  assert.equal(feed.missions[0].receipts[0].path, 'receipt://receipt-1.json');
  assert.equal(feed.missions[0].approvals[0].approvalId, 'merge-1270');
  assert.equal(feed.missions[0].approvals[0].status, 'pending');
  assert.equal(feed.missions[0].approvals[0].approvalRequired, true);
  assert.equal(Object.hasOwn(feed.missions[0].approvals[0], 'requiredToken'), false);
  const serialized = JSON.stringify(feed);
  assert.equal(serialized.includes(privateApprovalToken), false);
  assert.equal(serialized.includes('Users'), false);
});
