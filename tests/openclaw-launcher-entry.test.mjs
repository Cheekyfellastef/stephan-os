import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('apps index includes launcher-discoverable openclaw app', () => {
  const appIndex = readJson(new URL('../apps/index.json', import.meta.url));
  assert.equal(appIndex.includes('openclaw'), true);
});

test('openclaw app entry points to governed runtime destination hint', () => {
  const appManifest = readJson(new URL('../apps/openclaw/app.json', import.meta.url));
  const html = readFileSync(new URL('../apps/openclaw/index.html', import.meta.url), 'utf8');
  assert.equal(appManifest.name, 'OpenClaw');
  assert.equal(appManifest.entry, 'index.html');
  assert.equal(appManifest.launcherActionLabel, 'Enter OpenClaw');
  assert.match(html, /destination', 'openclaw'/);
  assert.match(html, /stephanosLauncherShellUrl/);
});

test('mission console runtime consumes launcher destination hint for openclaw focus', () => {
  const appSource = readFileSync(new URL('../stephanos-ui/src/App.jsx', import.meta.url), 'utf8');
  assert.match(appSource, /params\.get\('destination'\)/);
  assert.match(appSource, /launcherDestination !== 'openclaw'/);
  assert.match(appSource, /setPanelState\('openClawPanel', true\)/);
});
