import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  publishMissionWorkerResultAtomicallyV1,
  quarantineInvalidMissionWorkerResultV1,
} from './missionWorkerResultPublicationV1.js';

function result(actionId = 'action-1') {
  return {
    schemaVersion: 'stephanos.mission-worker-consumption-result.v1',
    actionId,
    missionId: 'critical-2002-result-publication',
    adapter: 'foundry-forge',
    finalVerdict: 'MISSION_WORKER_ITEM_COMPLETE',
  };
}

test('Mission Worker result publication is atomic and idempotent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mission-worker-result-'));
  const path = join(root, 'completed', 'action-1.result.json');
  try {
    const first = await publishMissionWorkerResultAtomicallyV1(path, result());
    assert.equal(first.ok, true);
    assert.equal(first.published, true);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), result());

    const repeated = await publishMissionWorkerResultAtomicallyV1(path, result());
    assert.equal(repeated.ok, true);
    assert.equal(repeated.idempotent, true);
    assert.equal(repeated.reason, 'MISSION_WORKER_RESULT_ALREADY_PUBLISHED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('different valid result is preserved as a conflict', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mission-worker-result-conflict-'));
  const path = join(root, 'completed', 'action-1.result.json');
  try {
    assert.equal((await publishMissionWorkerResultAtomicallyV1(path, result())).ok, true);
    const conflict = await publishMissionWorkerResultAtomicallyV1(path, result('action-2'));
    assert.equal(conflict.ok, false);
    assert.equal(conflict.reason, 'MISSION_WORKER_RESULT_EXISTING_CONFLICT');
    assert.equal(JSON.parse(await readFile(path, 'utf8')).actionId, 'action-1');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('malformed legacy result can be quarantined only when exact bytes are unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mission-worker-result-quarantine-'));
  const path = join(root, 'completed', 'action-1.result.json');
  try {
    await import('node:fs/promises').then(({ mkdir }) => mkdir(join(root, 'completed'), { recursive: true }));
    await writeFile(path, '{"truncated":', 'utf8');
    const publication = await publishMissionWorkerResultAtomicallyV1(path, result());
    assert.equal(publication.ok, false);
    assert.equal(publication.reason, 'MISSION_WORKER_RESULT_EXISTING_INVALID');

    await writeFile(path, '{"changed":true}\n', 'utf8');
    const stale = await quarantineInvalidMissionWorkerResultV1(path, publication.existingBytes);
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, 'MISSION_WORKER_RESULT_QUARANTINE_IDENTITY_CHANGED');

    await writeFile(path, '{"truncated":', 'utf8');
    const fresh = await publishMissionWorkerResultAtomicallyV1(path, result());
    const quarantined = await quarantineInvalidMissionWorkerResultV1(path, fresh.existingBytes);
    assert.equal(quarantined.ok, true);
    await assert.rejects(access(path));
    assert.equal(await readFile(quarantined.quarantinePath, 'utf8'), '{"truncated":');

    const repaired = await publishMissionWorkerResultAtomicallyV1(path, result());
    assert.equal(repaired.ok, true);
    assert.equal(repaired.published, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
