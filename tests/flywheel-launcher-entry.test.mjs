import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('apps index includes launcher-discoverable flywheel app', () => {
  const appIndex = readJson(new URL('../apps/index.json', import.meta.url));
  assert.equal(appIndex.includes('flywheel'), true);
});

test('Flywheel landing tile opens the existing canonical Flywheel pane', () => {
  const appManifest = readJson(new URL('../apps/flywheel/app.json', import.meta.url));
  const html = readFileSync(new URL('../apps/flywheel/index.html', import.meta.url), 'utf8');
  const flywheelPanel = readFileSync(new URL('../stephanos-ui/src/components/FlywheelPanel.jsx', import.meta.url), 'utf8');

  assert.equal(appManifest.name, 'Flywheel');
  assert.equal(appManifest.entry, 'index.html');
  assert.equal(appManifest.role, 'FLYWHEEL_LANDING_TILE');
  assert.match(html, /\.\.\/stephanos\/dist\/index\.html/);
  assert.match(html, /\[data-panel-id="flywheelPanel"\]/);
  assert.match(html, /panel-collapse-button/);
  assert.match(html, /does not create a second dashboard/);
  assert.match(flywheelPanel, /panelId="flywheelPanel"/);
});
