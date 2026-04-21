import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const componentsDir = path.dirname(new URL(import.meta.url).pathname);

async function readComponent(name) {
  return fs.readFile(path.join(componentsDir, name), 'utf8');
}

test('IntentEnginePanel uses canonical pane form contract classes', async () => {
  const source = await readComponent('IntentEnginePanel.jsx');
  assert.match(source, /paneFormLayout/);
  assert.match(source, /paneFieldGroup/);
  assert.match(source, /paneInput paneControl/);
  assert.match(source, /paneTextarea paneControl/);
  assert.match(source, /paneSelect paneControl/);
});

test('MissionDashboardPanel editor uses canonical pane form contract classes', async () => {
  const source = await readComponent('MissionDashboardPanel.jsx');
  assert.match(source, /paneFormLayout/);
  assert.match(source, /paneFieldGroup/);
  assert.match(source, /paneTextarea paneControl/);
  assert.match(source, /paneSelect paneControl/);
});
