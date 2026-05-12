import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
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

test('App registers in-runtime returnToCommandDeck handler without reload fallback', () => {
  const appSource = fs.readFileSync(path.join(srcRoot, 'App.jsx'), 'utf8');
  assert.equal(appSource.includes('window.returnToCommandDeck = returnToCommandDeck;'), true);
  assert.equal(appSource.includes('clearLauncherSurfaceQuery(window);'), true);
  assert.equal(appSource.includes("setSurfaceMode('mission-control');"), true);
  assert.equal(appSource.includes('location.assign('), false);
  assert.equal(appSource.includes('window.location.assign('), false);
});
