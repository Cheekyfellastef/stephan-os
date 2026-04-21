import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const tilePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'AgentsTile.jsx');

test('AgentsTile consumes finalAgentView projection and does not read runtime authority directly', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes('runtimeStatusModel'), false);
  assert.equal(source.includes('runtimeTruth'), false);
  assert.equal(source.includes('canonicalRouteRuntimeTruth'), false);
  assert.equal(source.includes('finalAgentView'), true);
});
