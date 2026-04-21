import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStephanosLaunchTargetForTest } from './command-deck.js';

test('resolveStephanosLaunchTargetForTest preserves launchEntry -> runtimeEntry -> entry order', () => {
  const explicitLaunch = resolveStephanosLaunchTargetForTest({
    launchEntry: 'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
    runtimeEntry: 'http://127.0.0.1:5173/',
    entry: '/',
  });
  assert.equal(explicitLaunch, 'http://127.0.0.1:4173/apps/stephanos/dist/index.html');

  const runtimeFallback = resolveStephanosLaunchTargetForTest({
    launchEntry: '',
    runtimeEntry: 'http://127.0.0.1:5173/',
    entry: '/',
  });
  assert.equal(runtimeFallback, 'http://127.0.0.1:5173/');

  const compatibilityFallback = resolveStephanosLaunchTargetForTest({
    launchEntry: '',
    runtimeEntry: '',
    entry: '/apps/stephanos/dist/index.html',
  });
  assert.equal(compatibilityFallback, '/apps/stephanos/dist/index.html');
});

test('resolveStephanosLaunchTargetForTest prevents launcher shell URL from overriding runtime URL', () => {
  const resolved = resolveStephanosLaunchTargetForTest({
    launcherEntry: 'http://127.0.0.1:4173/',
    launchEntry: 'http://127.0.0.1:4173/',
    runtimeEntry: 'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
    entry: 'http://127.0.0.1:4173/',
  });
  assert.equal(resolved, 'http://127.0.0.1:4173/apps/stephanos/dist/index.html');
});
