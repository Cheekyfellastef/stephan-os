import test from 'node:test';
import assert from 'node:assert/strict';
import { createTileMemoryBridge } from './tileMemoryBridge.js';

test('tile memory bridge preserves related idea provenance through adjudication', () => {
  let savedPayload = null;
  const bridge = createTileMemoryBridge({
    tileId: 'ideas',
    stephanosMemory: {
      saveRecord(payload) {
        savedPayload = payload;
        return payload;
      },
    },
  });

  const result = bridge.submitMemoryCandidate({
    key: 'idea.insight.1',
    value: 'A promoted insight',
    reason: 'Operator promoted this because it affects runtime planning.',
    sourceRef: 'idea:1',
    relatedIdeaIds: ['idea_2'],
    confidence: 'high',
    tags: ['ideas'],
  });

  assert.equal(result.promoted, true);
  assert.deepEqual(result.candidate.relatedIdeaIds, ['idea_2']);
  assert.equal(savedPayload.payload.relatedIdeaIds[0], 'idea_2');
});
