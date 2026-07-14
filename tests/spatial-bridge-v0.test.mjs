import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const appIndexPath = new URL('../apps/index.json', import.meta.url);
const manifestPath = new URL('../apps/spatial-bridge/app.json', import.meta.url);
const projectionPath = new URL('../apps/spatial-bridge/bridge-state.v0.json', import.meta.url);
const htmlPath = new URL('../apps/spatial-bridge/index.html', import.meta.url);

test('spatial bridge is launcher discoverable and explicitly read-only', () => {
  const appIndex = readJson(appIndexPath);
  const manifest = readJson(manifestPath);

  assert.equal(appIndex.includes('spatial-bridge'), true);
  assert.equal(manifest.name, 'Stephanos Spatial Bridge');
  assert.equal(manifest.entry, 'index.html');
  assert.equal(manifest.authority, 'read-only');
  assert.equal(manifest.implementationStage, 'v0-flat-prototype');
  assert.equal(manifest.aiAddressable, false);
  assert.deepEqual(manifest.eventsPublished, []);
});

test('spatial projection carries no execution authority and records wireless transport modes', () => {
  const projection = readJson(projectionPath);

  assert.equal(projection.version, 'stephanos.spatial-projection.v0.mock');
  assert.equal(projection.source, 'mock-projection');
  assert.equal(projection.readOnly, true);
  assert.equal(projection.authority, 'none');
  assert.equal(projection.modes.home.label, 'HOME · AIR LINK');
  assert.equal(projection.modes.home.transport, 'Meta Quest Air Link');
  assert.equal(projection.modes.caravan.label, 'CARAVAN · REMOTE STARLINK');
  assert.equal(projection.modes.degraded.label, 'REMOTE DEGRADED · READ ONLY');
  assert.match(projection.constraints.join('\n'), /No approvals/);
  assert.match(projection.constraints.join('\n'), /No execution/);
});

test('flat bridge prototype exposes simulation controls without mutation routes', () => {
  const html = readFileSync(htmlPath, 'utf8');

  assert.match(html, /Captain Bridge V0/);
  assert.match(html, /Read only · No execution authority/);
  assert.match(html, /data-mode="home" data-simulation-only/);
  assert.match(html, /data-mode="caravan" data-simulation-only/);
  assert.match(html, /data-mode="degraded" data-simulation-only/);
  assert.match(html, /bridge-state\.v0\.json/);
  assert.match(html, /projection\.readOnly !== true/);
  assert.match(html, /projection\.authority !== 'none'/);
  assert.doesNotMatch(html, /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
  assert.doesNotMatch(html, /queryStephanosAI|requestStephanosBackend|openclaw|powershell/i);
});
