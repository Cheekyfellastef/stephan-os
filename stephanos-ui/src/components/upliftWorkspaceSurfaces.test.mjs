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
const flywheelLauncherUrl = new URL('../../../apps/flywheel/index.html', import.meta.url);

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
  assert.match(app, /bridgeTransportTruth=\{runtimeStatusModel\?\.runtimeContext\?\.bridgeTransportTruth \|\| null\}/);
  assert.match(app, /homeBridgeUrl=\{runtimeStatusModel\?\.runtimeContext\?\.homeNodeBridge\?\.backendUrl \|\| ''\}/);
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


test('landing-page Flywheel tile opens the dedicated Flywheel surface', async () => {
  const [app, launcher] = await Promise.all([readFile(appUrl, 'utf8'), readFile(flywheelLauncherUrl, 'utf8')]);
  assert.match(app, /const flywheelSurfaceMode = surfaceMode === 'flywheel'/);
  assert.match(app, /if \(flywheelSurfaceMode\)/);
  assert.match(app, /FLYWHEEL SURFACE/);
  assert.match(launcher, /searchParams\.set\('surface', 'flywheel'\)/);
  assert.match(launcher, /stephanosLauncherShellUrl/);
});


test('dedicated Agents landing surface opens the canonical workspace while normal pane remains collapsible', async () => {
  const [app, tile, styles] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(agentsUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);
  const dedicatedStart = app.indexOf('if (agentsSurfaceMode)');
  const dedicatedEnd = app.indexOf('if (flywheelSurfaceMode)', dedicatedStart);
  const dedicatedBlock = app.slice(dedicatedStart, dedicatedEnd);
  const normalPaneStart = app.indexOf("id: 'agentsPanel'");
  const normalPaneEnd = app.indexOf("id: 'promptBuilderPanel'", normalPaneStart);
  const normalPaneBlock = app.slice(normalPaneStart, normalPaneEnd);
  assert.match(dedicatedBlock, /<AgentsTile[\s\S]*forcePanelOpen/);
  assert.equal((dedicatedBlock.match(/forcePanelOpen/g) || []).length, 1);
  assert.doesNotMatch(normalPaneBlock, /forcePanelOpen/);
  assert.match(tile, /const resolvedIsOpen = forcePanelOpen \|\| uiLayout\.agentsPanel !== false/);
  assert.match(tile, /agents-tile--workspace-surface/);
  assert.match(styles, /\.agents-tile--workspace-surface > \.panel-header-row[\s\S]*display:\s*none/);
});
