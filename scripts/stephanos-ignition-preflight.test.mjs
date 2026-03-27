import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateBuildPreflight,
  probeExistingLocalServer,
} from './stephanos-ignition-preflight.mjs';

const expectedMetadata = {
  appName: 'Stephanos UI',
  version: '0.1.0',
  sourceIdentifier: 'stephanos-ui/src',
  sourceFingerprint: 'abc123',
  buildTarget: 'apps/stephanos/dist',
  buildTargetIdentifier: 'apps/stephanos/dist',
  runtimeId: 'live-vite-shell',
  runtimeMarker: 'marker-123',
  sourceTruth: 'sourceFingerprint',
};

test('preflight marks missing build when dist index or metadata is absent', () => {
  const decision = evaluateBuildPreflight({
    expectedMetadata,
    distIndexExists: false,
    distMetadata: null,
    embeddedMetadata: null,
  });

  assert.equal(decision.state, 'build-missing');
  assert.equal(decision.action, 'rebuild');
});

test('preflight marks stale build when metadata differs from source fingerprint', () => {
  const decision = evaluateBuildPreflight({
    expectedMetadata,
    distIndexExists: true,
    distMetadata: { ...expectedMetadata, sourceFingerprint: 'stale' },
    embeddedMetadata: expectedMetadata,
  });

  assert.equal(decision.state, 'build-stale');
  assert.equal(decision.action, 'rebuild');
});

test('preflight marks current build when dist metadata matches expected parity', () => {
  const decision = evaluateBuildPreflight({
    expectedMetadata,
    distIndexExists: true,
    distMetadata: expectedMetadata,
    embeddedMetadata: expectedMetadata,
  });

  assert.equal(decision.state, 'build-current');
  assert.equal(decision.action, 'skip-build');
});

test('preflight marks unverifiable build when metadata cannot be read', () => {
  const decision = evaluateBuildPreflight({
    expectedMetadata,
    distIndexExists: true,
    distMetadata: expectedMetadata,
    embeddedMetadata: expectedMetadata,
    distMetadataReadable: false,
  });

  assert.equal(decision.state, 'build-unverifiable');
  assert.equal(decision.action, 'rebuild');
});

test('existing server probe rejects reuse when runtime marker mismatches expected marker', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    if (String(url).includes('/__stephanos/health')) {
      return {
        ok: true,
        json: async () => ({
          service: 'stephanos-dist-server',
          runtimeMarker: 'stale-marker',
        }),
      };
    }

    if (String(url).includes('/__stephanos/source-truth')) {
      return {
        ok: true,
        json: async () => ({
          launcherCriticalSourceTruth: [],
        }),
      };
    }

    return {
      ok: true,
      text: async () => '<html><head><meta name="stephanos-build-runtime-marker" content="stale-marker"></head></html>',
    };
  };

  const result = await probeExistingLocalServer({
    expectedRuntimeMarker: 'marker-123',
  });

  assert.equal(result.reusable, false);
});
