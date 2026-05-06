import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const appSource = fs.readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const surfacePaneSource = fs.readFileSync(new URL('./StephanosSurfacePane.jsx', import.meta.url), 'utf8');

test('drag gate remains canonical-handle only in App logic', () => {
  assert.equal(appSource.includes("const PANE_DRAG_HANDLE_SELECTOR = '[data-pane-drag-handle=\"true\"]';"), true);
  assert.equal(appSource.includes('if (!dragHandle) {'), true);
  assert.equal(appSource.includes('return !target.closest(PANE_DRAG_BLOCK_SELECTOR);'), true);
});

test('OpenClaw and Agents tile/pane surfaces remain separate in App pane registry', () => {
  assert.equal(appSource.includes("id: 'openClawPanel'"), true);
  assert.equal(appSource.includes("id: 'agentsPanel'"), true);
  assert.equal(appSource.includes('<OpenClawTile'), true);
  assert.equal(appSource.includes('<AgentsTile'), true);
});

test('OpenClaw execution stays disabled in tile copy', () => {
  const src = fs.readFileSync(new URL('./OpenClawTile.jsx', import.meta.url), 'utf8');
  assert.equal(src.includes('Execution disabled:'), true);
  assert.equal(src.includes('no (disabled)'), true);
});

test('wide panes mount through canonical workspace shell, lane, and gutters', () => {
  [
    'stephanos-workspace-pane-shell',
    'data-workspace-shell={pane.wideSurface ? \'canonical\' : undefined}',
    'stephanos-workspace-canvas',
    'stephanos-workspace-gutter stephanos-workspace-gutter--left',
    'stephanos-workspace-lane',
    'stephanos-workspace-gutter stephanos-workspace-gutter--right',
  ].forEach((token) => assert.equal(surfacePaneSource.includes(token), true, `missing workspace shell token: ${token}`));

  [
    'stephanos-app-workspace-canvas',
    'data-workspace-shell="canonical"',
    'operator-pane-wall stephanos-workspace-lane',
  ].forEach((token) => assert.equal(appSource.includes(token), true, `missing app workspace shell token: ${token}`));
});
