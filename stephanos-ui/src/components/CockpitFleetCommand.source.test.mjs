import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fleetUrl = new URL('./CockpitFleetCommand.jsx', import.meta.url);
const panelUrl = new URL('./CockpitPanel.jsx', import.meta.url);

test('Cockpit Deluxe renders canonical fleet traffic lights and runtime proof', async () => {
  const [fleet, panel] = await Promise.all([
    readFile(fleetUrl, 'utf8'),
    readFile(panelUrl, 'utf8'),
  ]);

  assert.match(fleet, /FLEET COMMAND · LIVE CANONICAL TRUTH/);
  assert.match(fleet, /Every registered agent, one glance/);
  assert.match(fleet, /data-agent-status/);
  assert.match(fleet, /\/api\/health/);
  assert.match(fleet, /dashboard-feed\?scope=full-history/);
  assert.match(fleet, /stephanos-build\.json/);
  assert.match(fleet, /window\.location\.reload\(\)/);
  assert.match(fleet, /deriveAgentsWorkspaceView/);
  assert.match(panel, /<CockpitFleetCommand/);
  assert.match(panel, /backendHealthFresh: true/);
  assert.match(panel, /Canonical health probe:/);
});

test('Cockpit Deluxe waits for repeated build mismatch before reloading stale DOM', async () => {
  const fleet = await readFile(fleetUrl, 'utf8');
  assert.match(fleet, /count >= 2/);
  assert.match(fleet, /Two matching observations trigger an automatic reload/);
});
