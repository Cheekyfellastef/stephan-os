import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importBundledModule, srcRoot } from './renderHarness.mjs';

test('App startup render path mounts with AIStoreProvider after runtimeStatusModel initialization', async () => {
  const { renderApp } = await importBundledModule(
    path.join(srcRoot, 'test/renderAppEntry.jsx'),
    {},
    'render-app-startup',
  );

  assert.doesNotThrow(() => renderApp());
  const rendered = renderApp();

  assert.match(rendered, /app-shell-root/);
  assert.match(rendered, /AI Provider Controls/);
});
