import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getStartupDiagnosticsSnapshot,
  markRootLandingLoaded,
  markStartupSettled,
  recordStartupLaunchTrigger,
  recordStartupRenderStage,
  resetStartupDiagnostics,
} from './startupLaunchDiagnostics.mjs';

test('startup launch diagnostics captures trigger source, URL resolution, and remembered session signals', () => {
  const originalLocation = globalThis.location;
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;

  const localStore = new Map([
    ['stephanos_session_memory', '{"session":{"foo":"bar"}}'],
    ['unrelated', 'ignore-me'],
  ]);
  const sessionStore = new Map([
    ['workspace_restore_state', '{"activeProject":"stephanos"}'],
  ]);

  globalThis.location = { href: 'http://127.0.0.1:4173/' };
  globalThis.localStorage = {
    get length() { return localStore.size; },
    key(index) { return Array.from(localStore.keys())[index] || null; },
    getItem(key) { return localStore.has(key) ? localStore.get(key) : null; },
  };
  globalThis.sessionStorage = {
    get length() { return sessionStore.size; },
    key(index) { return Array.from(sessionStore.keys())[index] || null; },
    getItem(key) { return sessionStore.has(key) ? sessionStore.get(key) : null; },
  };

  try {
    resetStartupDiagnostics();
    markRootLandingLoaded({ href: globalThis.location.href, readyState: 'complete' });
    markStartupSettled();

    const trigger = recordStartupLaunchTrigger({
      sourceModule: 'modules/command-deck/command-deck.js',
      sourceFunction: 'launchProject',
      triggerType: 'event-bus',
      triggerPayload: { origin: 'simulation:start', simulationName: 'stephanos' },
      rawTarget: 'apps/stephanos/dist/index.html',
      resolvedTarget: 'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
    });

    assert.equal(trigger.rootLandingLoaded, true);
    assert.equal(trigger.sourceFunction, 'launchProject');
    assert.equal(trigger.resolvedTarget, 'http://127.0.0.1:4173/apps/stephanos/dist/index.html');
    assert.equal(trigger.rememberedSessionStateDetected, true);
    assert.equal(trigger.rememberedSessionSignals.length, 2);

    const snapshot = getStartupDiagnosticsSnapshot();
    assert.equal(snapshot.launchTriggers.length > 0, true);
    assert.equal(snapshot.launchTriggers[0].sourceModule, 'modules/command-deck/command-deck.js');
  } finally {
    resetStartupDiagnostics();
    globalThis.location = originalLocation;
    globalThis.localStorage = originalLocalStorage;
    globalThis.sessionStorage = originalSessionStorage;
  }
});

test('startup launch diagnostics captures render-stage timeline and fatal stage', () => {
  resetStartupDiagnostics();
  try {
    recordStartupRenderStage({
      stage: 'runtime-store-initialized',
      status: 'ok',
      sourceModule: 'stephanos-ui/src/state/aiStore.js',
      sourceFunction: 'AIStoreProvider.useEffect',
    });
    recordStartupRenderStage({
      stage: 'first-render-after-mount',
      status: 'fatal',
      sourceModule: 'stephanos-ui/src/main.jsx',
      sourceFunction: 'StartupErrorBoundary.componentDidCatch',
      details: { message: 'Cannot read properties of undefined' },
    });

    const snapshot = getStartupDiagnosticsSnapshot();
    assert.equal(snapshot.renderStages.length, 2);
    assert.equal(snapshot.renderStages[0].stage, 'first-render-after-mount');
    assert.equal(snapshot.fatalRenderError?.status, 'fatal');
    assert.equal(snapshot.fatalRenderError?.details?.message, 'Cannot read properties of undefined');
  } finally {
    resetStartupDiagnostics();
  }
});
