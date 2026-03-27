import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createBuildParitySnapshot,
  evaluateToggleRegistryParity,
  SYSTEM_PANEL_TOGGLE_DEFINITIONS,
} from '../shared/runtime/buildParity.mjs';

test('build parity snapshot aligns launcher, tile, and served truth when runtime marker and timestamp match', () => {
  const snapshot = createBuildParitySnapshot({
    launcher: {
      version: '0.1',
      runtimeMarker: 'marker-abc',
      buildTimestamp: '2026-03-27T10:00:00.000Z',
      runtimeMode: 'launcher-root',
    },
    tile: {
      version: '0.1',
      runtimeMarker: 'marker-abc',
      buildTimestamp: '2026-03-27T10:00:00.000Z',
      gitCommit: 'abc123',
    },
    served: {
      runtimeMarker: 'marker-abc',
      buildTimestamp: '2026-03-27T10:00:00.000Z',
      source: 'source-truth',
    },
  });

  assert.equal(snapshot.parityOk, true);
  assert.equal(snapshot.markerParity, true);
  assert.equal(snapshot.timestampParity, true);
  assert.equal(snapshot.gitCommit, 'abc123');
  assert.equal(snapshot.artifactOrigin, 'source-truth');
});

test('toggle registry parity detects missing toggles and unexpected toggles', () => {
  const expectedIds = SYSTEM_PANEL_TOGGLE_DEFINITIONS.map((entry) => entry.id);
  const parity = evaluateToggleRegistryParity([...expectedIds.slice(0, -1), 'rogue-toggle']);

  assert.equal(parity.parityOk, false);
  assert.deepEqual(parity.missing, [expectedIds.at(-1)]);
  assert.deepEqual(parity.unexpected, ['rogue-toggle']);
});
