import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const tilePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'OpenClawTile.jsx');

test('OpenClawTile consumes final route truth projection and avoids canonical truth mutation surfaces', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes('finalRouteTruth'), true);
  assert.equal(source.includes('runtimeStatusModel'), true);
  assert.equal(source.includes('setRuntimeStatusModel'), false);
  assert.equal(source.includes('persistStephanosSessionMemory'), false);
  assert.equal(source.includes('runtimeStatusModel.runtimeTruth ='), false);
});


test('OpenClawTile validation button gating consumes shared endpoint-availability truth', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes('openClawReadonlyValidationEndpointAvailable'), true);
  assert.equal(source.includes('validationEndpointAvailable'), true);
});
