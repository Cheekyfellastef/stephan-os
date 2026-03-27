import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildParitySnapshot, resolveStephanosLaunchEntry } from './buildParity.mjs';

test('resolveStephanosLaunchEntry prioritizes launchEntry over runtimeEntry and entry', () => {
  assert.deepEqual(
    resolveStephanosLaunchEntry({ launchEntry: '/launch', runtimeEntry: '/runtime', entry: '/compat' }),
    { resolvedEntry: '/launch', source: 'launchEntry' },
  );

  assert.deepEqual(
    resolveStephanosLaunchEntry({ runtimeEntry: '/runtime', entry: '/compat' }),
    { resolvedEntry: '/runtime', source: 'runtimeEntry' },
  );

  assert.deepEqual(
    resolveStephanosLaunchEntry({ entry: '/compat' }),
    { resolvedEntry: '/compat', source: 'entry' },
  );
});

test('createBuildParitySnapshot reports drift and restart requirement when reality sync is disabled', () => {
  const parity = createBuildParitySnapshot({
    requestedSourceMarker: 'source-A',
    builtMarker: 'build-A',
    servedMarker: 'build-B',
    buildTimestamp: '2026-03-27T00:00:00.000Z',
    servedBuildTimestamp: '2026-03-27T00:01:00.000Z',
    ignitionRestartSupported: true,
    realitySyncEnabled: false,
  });

  assert.equal(parity.sourceDistParityOk, false);
  assert.equal(parity.localhostMirrorDrift, true);
  assert.equal(parity.ignitionRestartRequired, true);
  assert.equal(parity.confidence, 'drift');
});
