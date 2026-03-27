import test from 'node:test';
import assert from 'node:assert/strict';

import { createTruthSnapshot } from '../shared/runtime/truthEngine.mjs';

test('truth engine snapshot includes required sections and fields', () => {
  const snapshot = createTruthSnapshot({
    launcher: {
      mode: 'launcher-root',
      shellStatus: 'healthy',
      tileRegistryCount: 4,
      tileDomCount: 4,
      launcherCriticalModuleFailureCount: 0,
      buildProofPresent: true,
      projectsDiscoveredCount: 4,
    },
    sourceBuildServed: {
      buildMarker: 'marker-a',
      buildTimestamp: '2026-03-27T00:00:00.000Z',
      servedSourceTruthAvailable: true,
      servedDistTruthAvailable: true,
      sourceDistParityOk: true,
    },
    runtime: {
      runtimeDiagnosticsEnabled: true,
      launcherRuntimeFingerprintVisible: true,
      truthPanelVisible: false,
      backendReachable: true,
      finalRoute: 'launcher-root',
      routeKind: 'launcher',
    },
  });

  assert.equal(typeof snapshot.capturedAt, 'string');
  assert.equal(snapshot.launcher.mode, 'launcher-root');
  assert.equal(snapshot.launcher.tileRegistryCount, 4);
  assert.equal(snapshot.sourceBuildServed.buildMarker, 'marker-a');
  assert.equal(snapshot.runtime.runtimeDiagnosticsEnabled, true);
  assert.ok(Array.isArray(snapshot.contradictions));
});

test('truth engine contradiction collection reports critical mismatch cases', () => {
  const snapshot = createTruthSnapshot({
    launcher: {
      shellStatus: 'healthy',
      projectsDiscoveredCount: 2,
      tileDomCount: 0,
      launcherCriticalModuleFailureCount: 1,
      buildProofPresent: false,
    },
    sourceBuildServed: {
      sourceDistParityOk: false,
      buildMarker: 'build-a',
      servedMarker: 'served-b',
    },
    runtime: {
      runtimeDiagnosticsEnabled: false,
      runtimeErrorActive: true,
    },
  });

  const contradictionIds = snapshot.contradictions.map((entry) => entry.id);
  assert.match(snapshot.status, /critical|degraded/);
  assert.ok(contradictionIds.includes('tiles-discovered-but-not-rendered'));
  assert.ok(contradictionIds.includes('critical-module-failure-while-healthy'));
  assert.ok(contradictionIds.includes('build-proof-missing'));
  assert.ok(contradictionIds.includes('source-dist-parity-mismatch'));
  assert.ok(contradictionIds.includes('runtime-errors-hidden'));
});
