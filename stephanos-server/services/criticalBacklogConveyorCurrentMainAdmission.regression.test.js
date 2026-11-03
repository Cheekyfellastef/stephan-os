import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const coreUrl = new URL('./criticalBacklogConveyorServiceCore.js', import.meta.url);

test('regression: stale worker launch head cannot be the elastic source-admission revision', async () => {
  const source = await readFile(coreUrl, 'utf8');
  const start = source.indexOf('export async function ensureCriticalBacklogMission');
  const end = source.indexOf('let missionRecords = await listMissions', start);
  const elasticController = source.slice(start, end);
  assert.match(elasticController, /authoritative\?\.machineryInventory\?\.sourceHead/);
  assert.doesNotMatch(elasticController, /const sourceRevision = text\(env\.STEPHANOS_MISSION_WORKER_HEAD_SHA\)/);
});
