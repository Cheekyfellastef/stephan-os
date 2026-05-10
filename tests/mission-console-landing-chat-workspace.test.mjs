import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appJson = JSON.parse(readFileSync(new URL('../apps/mission-console/app.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../stephanos-ui/src/components/MissionConsoleTile.jsx', import.meta.url), 'utf8');

test('landing mission console tile resolves to canonical mission-console workspace with mounted chat diagnostics', () => {
  assert.match(appJson.entry, /surface=mission-console/);
  assert.match(appJson.entry, /destination=mission-console/);
  assert.match(source, /Opened route:\s*<\/strong>\s*mission-console/);
  assert.match(source, /Canonical route:\s*<\/strong>\s*mission-console/);
  assert.match(source, /Chat surface mounted:\s*<\/strong>\s*yes/);
});
