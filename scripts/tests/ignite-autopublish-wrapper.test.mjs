import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('ignite auto-publish wrapper delegates to canonical ignition script with env flag', async () => {
  const wrapper = await readFile(new URL('../ignite-stephanos-local-autopublish.mjs', import.meta.url), 'utf8');
  assert.match(wrapper, /spawnSync\(/);
  assert.match(wrapper, /scripts\/ignite-stephanos-local\.mjs/);
  assert.match(wrapper, /STEPHANOS_IGNITION_AUTOPUBLISH_DIST:\s*'1'/);
  assert.doesNotMatch(wrapper, /import\('\.\/ignite-stephanos-local\.mjs'\)/);
});
