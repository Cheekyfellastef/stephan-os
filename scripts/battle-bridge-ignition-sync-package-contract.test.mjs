import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Battle Bridge ignition keeps the canonical supervisor command and runs sync preflight first', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  assert.equal(
    packageJson.scripts['prestephanos:ignite'],
    'node scripts/battle-bridge-ignition-sync-preflight.mjs',
  );
  assert.equal(
    packageJson.scripts['stephanos:ignite'],
    'node scripts/run-battle-bridge-ignition.mjs',
  );
});
