import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importBundledModule, srcRoot } from '../test/renderHarness.mjs';

test('CollapsiblePanel unmounts children while closed by default', async () => {
  const { renderCollapsiblePanel } = await importBundledModule(
    path.join(srcRoot, 'test/renderCollapsiblePanelEntry.jsx'),
    {},
    'collapsible-panel-closed',
  );

  const rendered = renderCollapsiblePanel({ isOpen: false });
  assert.doesNotMatch(rendered, /expensive child content/);
});

test('CollapsiblePanel can keep children mounted while closed when explicitly requested', async () => {
  const { renderCollapsiblePanel } = await importBundledModule(
    path.join(srcRoot, 'test/renderCollapsiblePanelEntry.jsx'),
    {},
    'collapsible-panel-keep-mounted',
  );

  const rendered = renderCollapsiblePanel({ isOpen: false, keepMountedWhenClosed: true });
  assert.match(rendered, /expensive child content/);
});
