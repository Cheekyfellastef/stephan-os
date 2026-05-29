import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const thisFilePath = fileURLToPath(import.meta.url);
const thisDirPath = path.dirname(thisFilePath);

const appSource = fs.readFileSync(path.join(thisDirPath, '../App.jsx'), 'utf8');
const surfacePaneSource = fs.readFileSync(path.join(thisDirPath, './StephanosSurfacePane.jsx'), 'utf8');
const openClawSource = fs.readFileSync(path.join(thisDirPath, './OpenClawTile.jsx'), 'utf8');
const collapsiblePanelSource = fs.readFileSync(path.join(thisDirPath, './CollapsiblePanel.jsx'), 'utf8');
const aiStoreSource = fs.readFileSync(path.join(thisDirPath, '../state/aiStore.js'), 'utf8');
const stylesSource = fs.readFileSync(path.join(thisDirPath, '../styles.css'), 'utf8');

function collectSourceFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(absolutePath));
      continue;
    }
    if (/\.(jsx|js|mjs)$/.test(entry.name) && !entry.name.endsWith('.test.mjs')) {
      files.push(absolutePath);
    }
  }
  return files;
}

test('drag gate remains canonical-handle only in App logic', () => {
  assert.equal(appSource.includes("const PANE_DRAG_HANDLE_SELECTOR = '[data-pane-drag-handle=\"true\"]';"), true);
  assert.equal(appSource.includes('if (!dragHandle) {'), true);
  assert.equal(appSource.includes('return !target.closest(PANE_DRAG_BLOCK_SELECTOR);'), true);
});

test('OpenClaw landing tile layout and Stephanos pane layout stay distinct in App surfaces', () => {
  assert.equal(appSource.includes("id: 'openClawPanel'"), true);
  assert.equal(appSource.includes("id: 'agentsPanel'"), true);
  assert.equal(appSource.includes('<OpenClawTile'), true);
  assert.equal(appSource.includes('<AgentsTile'), true);

  assert.equal(appSource.includes('openclaw-landing-stage'), true);
  assert.equal(appSource.includes('data-workspace-shell="openclaw-landing"'), true);
  const openClawSurfaceSegment = appSource.split('if (openClawSurfaceMode) {')[1]?.split('if (skillForgeSurfaceMode) {')[0] || '';
  assert.equal(openClawSurfaceSegment.includes('className="workspace-canvas"'), false);
});


test('Capability Radar surface uses canonical collapse wiring and persisted uiLayout state path', () => {
  const capabilityRadarSurfaceSegment = appSource.split('if (capabilityRadarSurfaceMode) {')[1]?.split('if (openClawSurfaceMode) {')[0] || '';
  assert.equal(capabilityRadarSurfaceSegment.includes('uiLayout={safeUiLayout}'), true);
  assert.equal(capabilityRadarSurfaceSegment.includes('togglePanel={togglePanel}'), true);
  assert.equal(capabilityRadarSurfaceSegment.includes('capabilityRadarPanel: true'), false);
  assert.equal(aiStoreSource.includes('capabilityRadarPanel: true'), true);
});

test('Cockpit surface uses canonical togglePanel wiring (no force-open override)', () => {
  const cockpitSurfaceSegment = appSource.split('if (cockpitSurfaceMode) {')[1]?.split('if (agentsSurfaceMode) {')[0] || '';
  assert.equal(cockpitSurfaceSegment.includes('<CockpitPanel standalone'), true);
  assert.equal(cockpitSurfaceSegment.includes('forceOpen'), false);
});

test('OpenClaw execution stays disabled in tile copy', () => {
  assert.equal(openClawSource.includes('Execution disabled:'), true);
  assert.equal(openClawSource.includes('no (disabled)'), true);
});

test('OpenClaw Stephanos pane layout uses canonical collapse path and does not implement local one-off collapse', () => {
  assert.equal(openClawSource.includes('<CollapsiblePanel'), true);
  assert.equal(openClawSource.includes('panelId="openClawPanel"'), true);
  assert.equal(openClawSource.includes('isOpen={uiLayout.openClawPanel !== false}'), true);
  assert.equal(openClawSource.includes("onToggle={() => togglePanel('openClawPanel')}"), true);
  assert.equal(openClawSource.includes('PaneCollapseDial'), false);
  assert.equal(openClawSource.includes('aria-expanded='), false);
  assert.equal(openClawSource.includes('keepMountedWhenClosed={true}'), false);
});

test('canonical collapse control reduces footprint and avoids dead empty panel area', () => {
  assert.equal(collapsiblePanelSource.includes('className="stephanos-canon-rotating-chevron-button panel-collapse-button"'), true);
  assert.equal(collapsiblePanelSource.includes('<PaneCollapseDial isOpen={isOpen} />'), true);
  assert.equal(collapsiblePanelSource.includes('hidden={!isOpen}'), true);
  assert.equal(collapsiblePanelSource.includes('aria-hidden={!isOpen}'), true);
  assert.equal(collapsiblePanelSource.includes('const shouldRenderBody = isOpen || keepMountedWhenClosed;'), true);
  assert.equal(collapsiblePanelSource.includes('{shouldRenderBody ? children : null}'), true);
});


test('Agents tile uses canonical uiLayout + togglePanel collapse wiring only', () => {
  const agentsSource = fs.readFileSync(path.join(thisDirPath, './AgentsTile.jsx'), 'utf8');
  assert.equal(agentsSource.includes('resolvedIsOpen = uiLayout.agentsPanel !== false'), true);
  assert.equal(agentsSource.includes("resolvedToggle = () => togglePanel('agentsPanel')"), true);
  assert.equal(agentsSource.includes('hasCanonicalToggle'), false);
  assert.equal(agentsSource.includes('onToggle = () => {}'), false);
  assert.equal(agentsSource.includes('isOpen = true'), false);
});



test('Hosted Idea Staging pane uses canonical collapse wiring and human-readable pane title', () => {
  const hostedIdeaSource = fs.readFileSync(path.join(thisDirPath, './HostedIdeaStagingPanel.jsx'), 'utf8');
  assert.equal(hostedIdeaSource.includes('panelId="hostedIdeaStagingPanel"'), true);
  assert.equal(hostedIdeaSource.includes('title="Hosted Idea Staging"'), true);
  assert.equal(hostedIdeaSource.includes('isOpen={uiLayout.hostedIdeaStagingPanel !== false}'), true);
  assert.equal(hostedIdeaSource.includes("onToggle={() => togglePanel('hostedIdeaStagingPanel')"), true);
  assert.equal(aiStoreSource.includes('hostedIdeaStagingPanel: true'), true);
  assert.equal(appSource.includes("id: 'hostedIdeaStagingPanel'"), true);
  assert.equal(appSource.includes("title: 'Hosted Idea Staging'"), true);
});

test('Mission Console defaults wall-of-text detail panes to compact/collapsed in DEFAULT_UI_LAYOUT', () => {
  assert.equal(aiStoreSource.includes('missionConsoleOperatorReliefPanel: false'), true);
  assert.equal(aiStoreSource.includes('missionConsoleSecondaryDiagnosticsPanel: false'), true);
  assert.equal(aiStoreSource.includes('missionConsoleConnectedTileContextsPanel: false'), true);
});

test('App diagnostics expose explicit agent mission console live mount keys', () => {
  [
    'actualPanelId: \'missionConsolePanel\'',
    'forcePanelOpen: false',
    'isOpenFromUiLayout: safeUiLayout.missionConsolePanel !== false',
    'renderedOpenState: safeUiLayout.missionConsolePanel !== false',
    'togglePanelKey: \'missionConsolePanel\'',
    'visibleChevronLayer',
    'visibleContentLayer',
  ].forEach((token) => assert.equal(appSource.includes(token), true, `missing diagnostics key in App: ${token}`));
});

test('pane canon keeps move controls and collapse state persistence surfaces intact', () => {
  assert.equal(surfacePaneSource.includes('className="pane-order-controls"'), true);
  assert.equal(surfacePaneSource.includes('pane-order-controls-shell'), true);
  assert.equal(surfacePaneSource.includes('data-testid={`pane-${pane.id}-move-up`}'), true);
  assert.equal(surfacePaneSource.includes('data-testid={`pane-${pane.id}-move-down`}'), true);
  assert.equal(surfacePaneSource.includes('ownerPanelId = pane.layoutKey || pane.id'), true);
  assert.equal(surfacePaneSource.includes('onClick={onMoveUp}'), true);
  assert.equal(surfacePaneSource.includes('onClick={onMoveDown}'), true);
  assert.equal(surfacePaneSource.includes('data-pane-collapsed={paneCollapsed ? \'true\' : \'false\'}'), true);
  assert.equal(collapsiblePanelSource.includes('const matchesOwnerPanel = paneMoveControlsContext?.ownerPanelId === panelId;'), true);
  assert.equal(collapsiblePanelSource.includes('const claimResult = matchesOwnerPanel'), true);
  assert.equal(appSource.includes('togglePanel('), true);
});

test('Arrange Mode toggle uses compact toolbar placement instead of full pane surface section', () => {
  assert.equal(appSource.includes('className="arrange-mode-toolbar"'), true);
  assert.equal(appSource.includes('data-testid="arrange-mode-toolbar"'), true);
  assert.equal(appSource.includes('className="provider-dock" aria-label="Layout controls"'), false);
});

test('UI reality diagnostics track move-control and collapse coverage truth', () => {
  [
    'moveControlTrace',
    'totalMoveControlsCreated',
    'totalMoveControlsConsumed',
    'totalMoveControlsRendered',
    'totalMoveControlsVisible',
    'panesMissingMoveControls',
    'paneCollapseCoverage',
    'panesMissingCollapseControls',
  ].forEach((token) => assert.equal(appSource.includes(token), true, `missing App reality diagnostics token: ${token}`));
});

test('every CollapsiblePanel panelId is registered in DEFAULT_UI_LAYOUT', () => {
  const defaultLayoutMatch = aiStoreSource.match(/const DEFAULT_UI_LAYOUT = \{([\s\S]*?)\n\};/);
  assert.ok(defaultLayoutMatch, 'DEFAULT_UI_LAYOUT block must exist in aiStore');
  const defaultLayoutKeys = new Set(
    Array.from(defaultLayoutMatch[1].matchAll(/\n\s*([A-Za-z0-9_]+):/g)).map((match) => match[1]),
  );
  const componentRoot = thisDirPath;
  const sourceFiles = collectSourceFiles(componentRoot);
  const missingPanelIds = [];
  for (const filePath of sourceFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    const collapsibleUseRegex = /<CollapsiblePanel[\s\S]*?panelId="([^"]+)"/g;
    for (const match of source.matchAll(collapsibleUseRegex)) {
      const panelId = match[1];
      if (!defaultLayoutKeys.has(panelId)) {
        missingPanelIds.push({ panelId, filePath: path.relative(componentRoot, filePath) });
      }
    }
  }
  assert.deepEqual(missingPanelIds, [], `unregistered CollapsiblePanel panelIds found: ${JSON.stringify(missingPanelIds)}`);
});

test('wide panes mount through canonical workspace shell, lane, and gutters', () => {
  [
    'stephanos-workspace-pane-shell',
    'data-workspace-shell={pane.wideSurface ? \'canonical\' : undefined}',
  ].forEach((token) => assert.equal(surfacePaneSource.includes(token), true, `missing workspace shell token: ${token}`));

  [
    'stephanos-workspace-canvas',
    'stephanos-workspace-gutter stephanos-workspace-gutter--left',
    'stephanos-workspace-lane',
    'stephanos-workspace-gutter stephanos-workspace-gutter--right',
  ].forEach((legacyNestedToken) => assert.equal(surfacePaneSource.includes(legacyNestedToken), false, `legacy nested workspace token remains in pane shell: ${legacyNestedToken}`));

  [
    'stephanos-app-workspace-canvas',
    'data-workspace-shell="canonical"',
    'operator-pane-wall stephanos-workspace-lane',
  ].forEach((token) => assert.equal(appSource.includes(token), true, `missing app workspace shell token: ${token}`));
});

test('Mission Console compact feed CSS removes excessive feed row dead space', () => {
  assert.equal(stylesSource.includes('.compact-feed-row'), true);
  assert.equal(stylesSource.includes('min-height: 0;'), true);
  assert.equal(stylesSource.includes('padding: 0.36rem 0.48rem;'), true);
  assert.equal(stylesSource.includes('grid-template-columns: minmax(4.8rem, auto) auto minmax(0, 1fr);'), true);
  assert.equal(stylesSource.includes('.compact-feed-row--empty'), true);
  assert.equal(stylesSource.includes('max-height: 14rem;'), true);
});
