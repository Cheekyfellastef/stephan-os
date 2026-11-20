import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveStarfieldVrCapabilityMap } from './capability-map-model.mjs';

test('capability map stays unknown without canonical playtest evidence', () => {
  const map = deriveStarfieldVrCapabilityMap({});
  assert.equal(map.targetState, 'UNKNOWN');
  assert.equal(map.currentEvidence, false);
  assert.equal(map.capabilities.find((entry) => entry.id === 'telemetry').state, 'UNKNOWN');
});

test('alternate-eye evidence blocks stereo and the north star', () => {
  const map = deriveStarfieldVrCapabilityMap({
    state: 'ready',
    starfieldReferenceLab: {
      latest: {
        current: true,
        route: 'Mutar',
        mode: 'OBSERVE',
        sequenceFaultCount: 4,
        maxAbsDelta: 3,
        rollback: 'RESTORED',
        nextMode: 'OBSERVE',
        provenanceRef: 'workspace:vr/playtest/session-1',
        findings: ['Alternate-eye shimmer appears while turning.'],
      },
    },
    flywheel: { latestProtectReady: false, lessonId: 'lesson-1' },
  });

  assert.equal(map.targetState, 'BLOCKED');
  assert.equal(map.biggestBlocker.id, 'stereo-stability');
  assert.equal(map.capabilities.find((entry) => entry.id === 'stereo-stability').state, 'BLOCKED');
  assert.equal(map.capabilities.find((entry) => entry.id === 'telemetry').state, 'HEALTHY');
  assert.equal(map.route, 'Mutar');
});

test('capability health is evidence-bound rather than optimistic', () => {
  const map = deriveStarfieldVrCapabilityMap({
    state: 'ready',
    starfieldReferenceLab: {
      latest: {
        current: true,
        route: 'Mutar',
        mode: 'OBSERVE',
        sequenceFaultCount: 0,
        rollback: 'RESTORED',
        nextMode: 'OBSERVE',
        findings: [],
      },
    },
  });

  assert.equal(map.capabilities.find((entry) => entry.id === 'stereo-stability').state, 'NEEDS_WORK');
  assert.equal(map.capabilities.find((entry) => entry.id === 'gameplay').state, 'UNKNOWN');
  assert.match(map.evidenceBoundary, /Missing proof stays UNKNOWN/);
});
