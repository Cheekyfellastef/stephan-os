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


test('public mission feed withholds local receipt and worktree paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stephanos-public-feed-'));
  await writeFile(join(directory, 'snapshot.json'), JSON.stringify({
    schemaVersion: 'stephanos.mission-operations-snapshot.v1',
    missionId: 'mission-public-feed',
    state: 'RUNNING',
    updatedAt: '2026-06-24T18:00:00.000Z',
    github: { worktreePath: 'C:\\Users\\operator\\private-worktree' },
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
  assert.equal(JSON.stringify(feed).includes('Users'), false);
});
