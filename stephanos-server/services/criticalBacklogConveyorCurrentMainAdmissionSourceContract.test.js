import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const coreUrl = new URL('./criticalBacklogConveyorServiceCore.js', import.meta.url);

test('elastic ignition source revision is derived from authoritative canonical-main truth, never the worker launch env', async () => {
  const source = await readFile(coreUrl, 'utf8');
  const start = source.indexOf('export async function ensureCriticalBacklogMission');
  assert.notEqual(start, -1);
  const elasticStart = source.indexOf('if (elasticProjection)', start);
  assert.notEqual(elasticStart, -1);
  const elasticEnd = source.indexOf('elasticIgnition = await dispatchElasticBuilds', elasticStart);
  assert.notEqual(elasticEnd, -1);
  const block = source.slice(elasticStart, elasticEnd);

  assert.match(block, /authoritative\?\.machineryInventory\?\.sourceHead/);
  assert.doesNotMatch(block, /env\.STEPHANOS_MISSION_WORKER_HEAD_SHA/);
});
