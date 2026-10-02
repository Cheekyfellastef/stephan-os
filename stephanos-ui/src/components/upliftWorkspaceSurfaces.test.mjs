import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const flywheelUrl = new URL('./FlywheelPanel.jsx', import.meta.url);
const flywheelCanvasUrl = new URL('./FlywheelWorkspaceCanvas.jsx', import.meta.url);
const agentsUrl = new URL('./AgentsTile.jsx', import.meta.url);
const agentsCanvasUrl = new URL('./AgentsWorkspaceCanvas.jsx', import.meta.url);
const appUrl = new URL('../App.jsx', import.meta.url);
const stylesUrl = new URL('../styles.css', import.meta.url);
const sharedWorkspaceRouteUrl = new URL('../../../stephanos-server/routes/shared-workspace.js', import.meta.url);

test('Flywheel tile renders the Shared Workspace uplift canvas from full-history feed', async () => {
  const [panel, canvas] = await Promise.all([readFile(flywheelUrl, 'utf8'), readFile(flywheelCanvasUrl, 'utf8')]);
  assert.match(panel, /dashboard-feed\?scope=full-history/);
  assert.match(panel, /deriveFlywheelWorkspaceView/);
  assert.match(panel, /<FlywheelWorkspaceCanvas view=\{upliftView\}/);
  assert.match(canvas, /Flywheel Uplift Workspace/);
  assert.match(canvas, /Agent Uplift Field/);
  assert.match(canvas, /Uplift Heatmap/);
  assert.match(canvas, /Learning Timeline/);
  assert.match(canvas, /Brain Bay/);
  assert.match(canvas, /Missing evidence stays UNKNOWN/);
});

test('Agents tile renders command constellation and receives canonical backend routing context', async () => {
  const [tile, canvas, app] = await Promise.all([readFile(agentsUrl, 'utf8'), readFile(agentsCanvasUrl, 'utf8'), readFile(appUrl, 'utf8')]);
  assert.match(tile, /dashboard-feed\?scope=full-history/);
  assert.match(tile, /deriveAgentsWorkspaceView/);
  assert.match(tile, /<AgentsWorkspaceCanvas/);
  assert.match(app, /bridgeTransportTruth=\{bridgeTransportTruth\}/);
  assert.match(app, /homeBridgeUrl=\{homeBridgeUrl\}/);
  assert.match(app, /runtimeStatusModel=\{runtimeStatusModel\}/);
  assert.match(canvas, /Agents Command Constellation/);
  assert.match(canvas, /Agent Constellation/);
  assert.match(canvas, /Capability Vector/);
  assert.match(canvas, /Evidence fabric/);
});

test('uplift workspace styling provides shared starship visual system without hiding truth states', async () => {
  const styles = await readFile(stylesUrl, 'utf8');
  assert.match(styles, /\.uplift-workspace/);
  assert.match(styles, /\.uplift-truth-orb\.current/);
  assert.match(styles, /\.uplift-heat-cell\.unknown/);
  assert.match(styles, /\.agent-constellation-card/);
  assert.match(styles, /\.agent-capability-vector/);
});


test('Shared Workspace historical scope is an opt-in read-only projection path', async () => {
  const source = await readFile(sharedWorkspaceRouteUrl, 'utf8');
  assert.match(source, /router\.get\('\/dashboard-feed'/);
  assert.match(source, /req\.query\?\.scope/);
  assert.match(source, /requestedScope === 'full-history'/);
  assert.match(source, /recordScope/);
  assert.match(source, /Cache-Control/);
});
