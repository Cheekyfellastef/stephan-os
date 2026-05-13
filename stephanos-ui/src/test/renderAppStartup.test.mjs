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

test('App registers in-runtime returnToCommandDeck handler with canonical navigation fallback', () => {
  const appSource = fs.readFileSync(path.join(srcRoot, 'App.jsx'), 'utf8');
  assert.equal(appSource.includes('window.returnToCommandDeck = returnToCommandDeck;'), true);
  assert.equal(appSource.includes('clearLauncherSurfaceQuery(window);'), true);
  assert.equal(appSource.includes('window.parent.returnToCommandDeck();'), true);
  assert.equal(appSource.includes("window.parent?.postMessage?.({ type: 'stephanos:return-to-command-deck', source: 'stephanos-runtime' }, '*');"), true);
  assert.equal(appSource.includes("setSurfaceMode('mission-control');"), true);
  assert.equal(appSource.includes('resolveCommandDeckDestinationPath(window);'), true);
  assert.equal(appSource.includes('window.location.assign(destination);'), true);
  assert.equal(appSource.includes('commandDeckReturn.handler_invoked'), true);
});
