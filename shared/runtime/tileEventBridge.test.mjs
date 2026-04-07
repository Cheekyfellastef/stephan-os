import test from 'node:test';
import assert from 'node:assert/strict';
import { createTileEventBridge } from './tileEventBridge.js';

test('tile event bridge does not throw when storage setItem fails during artifact journaling', () => {
  const bridge = createTileEventBridge({
    tileId: 'ideas',
    storage: {
      getItem: () => '[]',
      setItem: () => {
        throw new Error('storage blocked');
      },
    },
    executionLoop: {
      publishTileEvent: () => {},
    },
  });

  const result = bridge.emitEvent({
    type: 'idea.created',
    payload: { ideaId: 'ideas_001' },
    sourceRef: 'idea:ideas_001',
  });

  assert.equal(result.ok, true);
  assert.equal(result.artifact.type, 'idea.created');
});
