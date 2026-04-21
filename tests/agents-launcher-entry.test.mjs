import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('apps index includes launcher-discoverable agents app', () => {
  const appIndex = readJson(new URL('../apps/index.json', import.meta.url));
  assert.equal(appIndex.includes('agents'), true);
});

test('agents app entry points to dedicated agents surface route', () => {
  const appManifest = readJson(new URL('../apps/agents/app.json', import.meta.url));
  const html = readFileSync(new URL('../apps/agents/index.html', import.meta.url), 'utf8');
  assert.equal(appManifest.name, 'Agents');
  assert.equal(appManifest.entry, 'index.html');
  assert.match(html, /surface=agents/);
  assert.match(html, /stephanosLauncherShellUrl/);
});
