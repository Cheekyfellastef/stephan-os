import test from 'node:test';
import assert from 'node:assert/strict';

import { createTruthSnapshot } from '../shared/runtime/truthEngine.mjs';

test('truth snapshot reports localhost mirror drift contradiction when restart is required', () => {
  const snapshot = createTruthSnapshot({
    launcher: {
      buildProofPresent: true,
      projectsDiscoveredCount: 1,
      tileDomCount: 1,
    },
    sourceBuildServed: {
      sourceDistParityOk: false,
    },
    runtime: {
      localhostMirrorDrift: true,
      ignitionRestartRequired: true,
      ignitionRestartSupported: true,
    },
    realitySync: {
      enabled: false,
      displayedMarker: 'old',
      latestMarker: 'new',
      isStale: true,
      lastRestartResult: 'none',
    },
  });

  const contradictionIds = snapshot.contradictions.map((entry) => entry.id);
  assert.ok(contradictionIds.includes('localhost-mirror-drift-restart-required'));
  assert.ok(contradictionIds.includes('source-dist-parity-mismatch'));
});
