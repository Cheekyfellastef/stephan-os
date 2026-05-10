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

test('CollapsiblePanel collapse toggle is marked as non-draggable and controls its panel body', async () => {
  const { renderCollapsiblePanel } = await importBundledModule(
    path.join(srcRoot, 'test/renderCollapsiblePanelEntry.jsx'),
    {},
    'collapsible-panel-toggle-a11y',
  );

  const rendered = renderCollapsiblePanel({ isOpen: true });
  assert.match(rendered, /class="panel-header-row" data-pane-drag-handle="true"/);
  assert.match(rendered, /class="panel-collapse-toggle" data-pane-drag-handle="true"/);
  assert.match(rendered, /class="stephanos-canon-rotating-chevron-button panel-collapse-button"/);
  assert.match(rendered, /data-no-drag="true"/);
  assert.match(rendered, /aria-controls="testPanel-body"/);
  assert.match(rendered, /class="pane-collapse-dial chevron-dial"/);
  assert.match(rendered, /class="chevron open"/);
});

test('CollapsiblePanel emits missing panelId and missing onToggle diagnostics in Vite-style dev mode', async () => {
  const originalWarn = console.warn;
  const originalImportMetaEnv = globalThis.__STEPHANOS_IMPORT_META_ENV__;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  globalThis.__STEPHANOS_IMPORT_META_ENV__ = { DEV: true };

  try {
    const { renderCollapsiblePanel } = await importBundledModule(
      path.join(srcRoot, 'test/renderCollapsiblePanelEntry.jsx'),
      {},
      'collapsible-panel-vite-dev-diagnostics',
      {
        'process.env.NODE_ENV': '"production"',
      },
    );

    renderCollapsiblePanel({ panelId: '   ', onToggle: null });

    const warningMessages = warnings.map(([message]) => String(message));
    assert.ok(
      warningMessages.some((message) => message.includes('Missing panelId for collapse target.')),
      'expected missing panelId diagnostic in Vite dev mode',
    );
    assert.ok(
      warningMessages.some((message) => message.includes('Chevron rendered without a valid onToggle handler.')),
      'expected missing onToggle diagnostic in Vite dev mode',
    );
  } finally {
    globalThis.__STEPHANOS_IMPORT_META_ENV__ = originalImportMetaEnv;
    console.warn = originalWarn;
  }
});

test('CollapsiblePanel emits diagnostics in Node/test mode when NODE_ENV is not production', async () => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);

  try {
    const { renderCollapsiblePanel } = await importBundledModule(
      path.join(srcRoot, 'test/renderCollapsiblePanelEntry.jsx'),
      {},
      'collapsible-panel-node-dev-diagnostics',
      {
        'process.env.NODE_ENV': '"test"',
      },
    );

    renderCollapsiblePanel({ panelId: '', onToggle: null });

    const warningMessages = warnings.map(([message]) => String(message));
    assert.ok(warningMessages.some((message) => message.includes('Missing panelId for collapse target.')));
    assert.ok(
      warningMessages.some((message) => message.includes('Chevron rendered without a valid onToggle handler.')),
    );
  } finally {
    console.warn = originalWarn;
  }
});

test('CollapsiblePanel diagnostics stay disabled in production mode', async () => {
  const originalWarn = console.warn;
  const originalImportMetaEnv = globalThis.__STEPHANOS_IMPORT_META_ENV__;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  globalThis.__STEPHANOS_IMPORT_META_ENV__ = { DEV: false };

  try {
    const { renderCollapsiblePanel } = await importBundledModule(
      path.join(srcRoot, 'test/renderCollapsiblePanelEntry.jsx'),
      {},
      'collapsible-panel-production-diagnostics-off',
      {
        'process.env.NODE_ENV': '"production"',
      },
    );

    renderCollapsiblePanel({ panelId: '', onToggle: null });
    assert.equal(warnings.length, 0);
  } finally {
    globalThis.__STEPHANOS_IMPORT_META_ENV__ = originalImportMetaEnv;
    console.warn = originalWarn;
  }
});
