import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeMissionJsonAtomically } from './missionOrchestratorStore.js';

async function fixture() {
  return mkdtemp(path.join(os.tmpdir(), 'mission-store-atomic-'));
}

test('Windows EPERM rename falls back to serialized in-place fsync write', async () => {
  const root = await fixture();
  const statePath = path.join(root, 'mission.state.json');
  await writeFile(statePath, '{"old":true}\n', 'utf8');

  const result = await writeMissionJsonAtomically(
    statePath,
    { current: true, revision: 7 },
    {
      platform: 'win32',
      pid: 4242,
      nowMs: () => 123456,
      renameFn: async () => {
        const error = new Error('destination handle denies replace');
        error.code = 'EPERM';
        throw error;
      },
    },
  );

  assert.equal(result.fallbackUsed, true);
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), { current: true, revision: 7 });
  assert.deepEqual((await readdir(root)).sort(), ['mission.state.json']);
  await rm(root, { recursive: true, force: true });
});

test('non-Windows or non-EPERM rename failures remain fail-closed', async () => {
  const root = await fixture();
  const statePath = path.join(root, 'mission.state.json');
  await writeFile(statePath, '{"old":true}\n', 'utf8');

  await assert.rejects(
    writeMissionJsonAtomically(
      statePath,
      { current: true },
      {
        platform: 'linux',
        pid: 4243,
        nowMs: () => 123457,
        renameFn: async () => {
          const error = new Error('synthetic rename failure');
          error.code = 'EACCES';
          throw error;
        },
      },
    ),
    /synthetic rename failure/,
  );

  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), { old: true });
  assert.deepEqual((await readdir(root)).sort(), ['mission.state.json']);
  await rm(root, { recursive: true, force: true });
});
