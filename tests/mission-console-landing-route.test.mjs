import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('landing mission console tile routes to canonical mission-console surface', () => {
  const appJson = JSON.parse(readFileSync(new URL('../apps/mission-console/app.json', import.meta.url), 'utf8'));
  assert.match(appJson.entry, /surface=mission-console/);
  assert.match(appJson.entry, /destination=mission-console/);
});
