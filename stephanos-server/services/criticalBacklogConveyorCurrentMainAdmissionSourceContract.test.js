import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const coreUrl = new URL('./criticalBacklogConveyorServiceCore.js', import.meta.url);

test('canonical-main source admission is evaluated before the worker-runtime hold without using worker launch env', async () => {
  const source = await readFile(coreUrl, 'utf8');
  const start = source.indexOf('export async function ensureCriticalBacklogMission');
  assert.notEqual(start, -1);
  const admission = source.indexOf('elasticAdmission = await ensureElasticMissions', start);
  assert.notEqual(admission, -1);
  const block = source.slice(start, admission);

  assert.match(block, /authoritative\?\.machineryInventory\?\.sourceHead/);
  assert.match(block, /workerRuntimeHold/);
  assert.match(block, /worker-heartbeat-invalid-or-missing/);
  assert.match(block, /source:mission-worker-heartbeat-unavailable/);
  assert.doesNotMatch(block, /env\.STEPHANOS_MISSION_WORKER_HEAD_SHA/);
});
