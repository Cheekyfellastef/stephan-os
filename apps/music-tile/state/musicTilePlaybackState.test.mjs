import test from 'node:test';
import assert from 'node:assert/strict';

import { markMediaItemSeen } from './musicTileState.js';

test('markMediaItemSeen sets media item seen and appends seenItemIds once', () => {
  const next = markMediaItemSeen({
    mediaItems: {
      abc123video0: { id: 'abc123video0', seen: false },
    },
    seenItemIds: [],
  }, 'abc123video0');

  assert.equal(next.mediaItems.abc123video0.seen, true);
  assert.deepEqual(next.seenItemIds, ['abc123video0']);

  const second = markMediaItemSeen(next, 'abc123video0');
  assert.deepEqual(second.seenItemIds, ['abc123video0']);
});
