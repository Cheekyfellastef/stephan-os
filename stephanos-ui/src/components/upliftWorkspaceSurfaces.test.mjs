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

test('Flywheel tile always renders the seed observatory while live evidence remains truth-gated', async () => {
  const [panel, canvas] = await Promise.all([readFile(flywheelUrl, 'utf8'), readFile(flywheelCanvasUrl, 'utf8')]);
  assert.match(panel, /dashboard-feed\?scope=full-history/);
  assert.match(panel, /deriveFlywheelWorkspaceView/);
  assert.match(panel, /<FlywheelWorkspaceCanvas/);
  assert.match(panel, /The observatory remains visible/);
  assert.doesNotMatch(panel, /No live Flywheel data is being claimed/);
  assert.equal(panel.indexOf('<FlywheelWorkspaceCanvas'), panel.lastIndexOf('<FlywheelWorkspaceCanvas'));
  assert.match(panel, /<FlywheelWorkspaceCanvas[\s\S]*\{view\.valid \? \(/);
  assert.match(canvas, /Flywheel Uplift Workspace/);
  assert.match(canvas, /Agent Uplift Field/);
  assert.match(canvas, /Uplift Heatmap/);
  assert.match(canvas, /Learning Timeline/);
  assert.match(canvas, /Brain Bay/);
  assert.match(canvas, /Starfield VR Outcome Ownership Seed/);
  assert.match(canvas, /CONTRACT READY · LIVE UNPROVEN/);
  assert.match(canvas, /Mission contract/);
  assert.match(canvas, /Live growth evidence/);
  assert.match(canvas, /PRESERVED ROUTES/);
  assert.match(canvas, /OPERATING LOOP/);
  assert.match(canvas, /CURRENT GROWTH GAPS/);
  assert.match(canvas, /Missing evidence stays UNKNOWN/);
  assert.match(canvas, /recent \/.* total/);
  assert.match(canvas, /source evidence/);
  assert.match(panel, /Source evidence/);
  assert.match(panel, /freshness window/);
});

test('Agents tile renders command constellation and receives canonical backend routing context', async () => {
  const [tile, canvas, app] = await Promise.all([readFile(agentsUrl, 'utf8'), readFile(agentsCanvasUrl, 'utf8'), readFile(appUrl, 'utf8')]);
  assert.match(tile, /dashboard-feed\?scope=full-history/);
  assert.match(tile, /deriveAgentsWorkspaceView/);
  assert.match(tile, /<AgentsWorkspaceCanvas/);
  assert.match(tile, /workspaceSelectedAgentId/);
  assert.match(tile, /handleWorkspaceSelectAgent/);
  assert.match(tile, /setWorkspaceSelectedAgentId\(nextAgentId\)/);
  assert.match(tile, /visibleAgents\.some\(\(entry\) => entry\.agentId === nextAgentId\)\) onSelectAgent\?\.\(nextAgentId\)/);
  assert.match(tile, /selectedAgentId=\{workspaceSelectedAgentId \|\| selectedAgentId\}/);
  assert.match(app, /bridgeTransportTruth=\{runtimeStatusModel\?\.runtimeContext\?\.bridgeTransportTruth \|\| null\}/);
  assert.match(app, /homeBridgeUrl=\{runtimeStatusModel\?\.runtimeContext\?\.homeNodeBridge\?\.backendUrl \|\| ''\}/);
  assert.match(app, /runtimeStatusModel=\{runtimeStatusModel\}/);
  assert.match(canvas, /Agents Intelligence Observatory/);
  assert.match(canvas, /Agent Constellation/);
  assert.match(canvas, /Capability Vector/);
  assert.match(canvas, /Evidence fabric/);
  assert.match(canvas, /FLYWHEEL UPLIFT QUEUE/);
  assert.match(canvas, /AGENT PASSPORT/);
  assert.match(canvas, /FLYWHEEL DIAGNOSIS/);
  assert.match(canvas, /GROWTH FRONTIER/);
  assert.match(canvas, /CURRENT GAPS · WHY UPLIFT\?/);
  assert.match(canvas, /RESOLVED HISTORY · STILL REMEMBERED/);
  assert.match(canvas, /EVIDENCE TIMELINE/);
});

test('uplift workspace styling provides shared starship visual system without hiding truth states', async () => {
  const styles = await readFile(stylesUrl, 'utf8');
  assert.match(styles, /\.uplift-workspace/);
  assert.match(styles, /\.uplift-truth-orb\.current/);
  assert.match(styles, /\.uplift-heat-cell\.unknown/);
  assert.match(styles, /\.agent-constellation-card/);
  assert.match(styles, /\.agent-capability-vector/);
  assert.match(styles, /\.agent-uplift-queue-card/);
  assert.match(styles, /\.agent-passport-grid/);
  assert.match(styles, /\.agent-gap-columns/);
  assert.match(styles, /\.agent-growth-frontier/);
  assert.match(styles, /\.outcome-seed-observatory/);
  assert.match(styles, /\.outcome-seed-growth-grid/);
  assert.match(styles, /\.outcome-seed-loop/);
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
