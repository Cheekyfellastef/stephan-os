import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const appSource = fs.readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const surfacePaneSource = fs.readFileSync(new URL('./StephanosSurfacePane.jsx', import.meta.url), 'utf8');
const openClawSource = fs.readFileSync(new URL('./OpenClawTile.jsx', import.meta.url), 'utf8');
const collapsiblePanelSource = fs.readFileSync(new URL('./CollapsiblePanel.jsx', import.meta.url), 'utf8');

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
  assert.equal(capabilityRadarSurfaceSegment.includes('togglePanel={() => {}}'), false);
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

test('pane canon keeps move controls and collapse state persistence surfaces intact', () => {
  assert.equal(surfacePaneSource.includes('className="pane-order-controls"'), true);
  assert.equal(surfacePaneSource.includes('onClick={onMoveUp}'), true);
  assert.equal(surfacePaneSource.includes('onClick={onMoveDown}'), true);
  assert.equal(surfacePaneSource.includes('data-pane-collapsed={paneCollapsed ? \'true\' : \'false\'}'), true);
  assert.equal(appSource.includes('togglePanel('), true);
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
