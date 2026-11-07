import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  projectBoundedMissionWorkerRestartBlocker,
} from './battle-bridge-worker-watchdog-acceptance.mjs';

const sourceUrl = new URL('./battle-bridge-worker-watchdog-acceptance.mjs', import.meta.url);

test('projects only exact allowlisted Mission Worker restart blockers', () => {
  assert.equal(
    projectBoundedMissionWorkerRestartBlocker('MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT'),
    'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT',
  );
  assert.equal(
    projectBoundedMissionWorkerRestartBlocker('MISSION_WORKER_RESTART_REQUEST_ALREADY_PRESENT'),
    'MISSION_WORKER_RESTART_REQUEST_ALREADY_PRESENT',
  );
  assert.equal(projectBoundedMissionWorkerRestartBlocker('MISSION_WORKER_NOT_ALLOWLISTED'), '');
  assert.equal(projectBoundedMissionWorkerRestartBlocker('prefix MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT'), '');
  assert.equal(projectBoundedMissionWorkerRestartBlocker(''), '');
});

test('degraded acceptance promotes only the bounded restart blocker through the existing blocker field', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  assert.match(source, /const restartBlocker = projectBoundedMissionWorkerRestartBlocker\(latestStatus\?\.restartBlocker\);/);
  assert.match(source, /return blockedRecovery\(restartBlocker \|\| classification, firstResult/);
  assert.doesNotMatch(source, /restartBlocker:\s*text\(latestStatus\?\.restartBlocker\)/);
});
