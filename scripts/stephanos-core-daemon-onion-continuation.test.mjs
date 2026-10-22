import test from 'node:test';
import assert from 'node:assert/strict';
import { projectOnionContinuationV1 } from '../shared/agents/onionContinuationDoctrineV1.mjs';
import { projectStephanosCoreOnionContinuationV1 } from '../shared/agents/stephanosCoreOnionContinuationV1.mjs';

test('core daemon restores onion continuation from Shared Workspace state after restart', () => {
  const persisted = projectOnionContinuationV1({
    originalOutcomeId: 'automatic-building',
    blocker: 'LAYER_763',
    blockerDepth: 763,
    safeRepairAvailable: true,
  });

  const restored = projectStephanosCoreOnionContinuationV1({ persisted });
  assert.equal(restored.restoredFromPersistedState, true);
  assert.equal(restored.originalOutcomeId, 'automatic-building');
  assert.equal(restored.blocker, 'LAYER_763');
  assert.equal(restored.blockerDepth, 763);
  assert.equal(restored.nextBlockerDepth, 764);
  assert.equal(restored.shouldContinue, true);
  assert.equal(restored.authorityExpanded, false);
});

test('new blocker continues the same parent outcome at the next depth', () => {
  const persisted = projectOnionContinuationV1({
    originalOutcomeId: 'automatic-building',
    blocker: 'LAYER_763',
    blockerDepth: 763,
    safeRepairAvailable: true,
  });

  const continued = projectStephanosCoreOnionContinuationV1({
    persisted,
    current: {
      originalOutcomeId: 'automatic-building',
      blocker: 'LAYER_764',
      safeRepairAvailable: true,
    },
  });

  assert.equal(continued.blockerChanged, true);
  assert.equal(continued.blockerDepth, 764);
  assert.equal(continued.nextBlockerDepth, 765);
  assert.equal(continued.shouldContinue, true);
  assert.equal(continued.sourceMutationAuthorityGranted, false);
  assert.equal(continued.mergeAuthorityGranted, false);
});

test('schema-mismatched persisted data is not trusted as continuation state', () => {
  const restored = projectStephanosCoreOnionContinuationV1({
    persisted: {
      schemaVersion: 'stephanos.onion-continuation.bad',
      originalOutcomeId: 'forged',
      blocker: 'forged',
      blockerDepth: 999,
    },
  });
  assert.equal(restored.restoredFromPersistedState, false);
  assert.equal(restored.originalOutcomeId, '');
  assert.equal(restored.blocker, '');
  assert.equal(restored.blockerDepth, 0);
});
