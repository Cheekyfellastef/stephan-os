import test from 'node:test';
import assert from 'node:assert/strict';

import { createMusicTileFlowController } from './musicTileFlowController.js';
import { createMusicTilePlaybackController } from './musicTilePlaybackController.js';
import { createMusicTileSessionStore } from '../state/musicTileSessionStore.js';

function item(id) {
  return { id, title: id };
}

test('playback controller starts flow and advances queue while patching session', () => {
  let memory = { sessions: [], mediaItems: { a: item('a'), b: item('b') } };
  const flowController = createMusicTileFlowController();
  flowController.rebuild([item('a'), item('b')]);

  const sessionStore = createMusicTileSessionStore({
    readMemory: () => memory,
    writeMemory: (next) => {
      memory = next;
    },
  });

  const controller = createMusicTilePlaybackController({
    flowController,
    sessionStore,
    getMediaItemById: (id) => memory.mediaItems[id] || null,
  });

  const first = controller.startOrResumeFlow([item('a'), item('b')]);
  assert.equal(first.id, 'a');
  assert.equal(sessionStore.read().mode, 'flow');

  const next = controller.nextInFlow([item('a'), item('b')]);
  assert.equal(next.id, 'b');
  assert.equal(sessionStore.read().currentMediaItemId, 'b');

  controller.onExternalOpen();
  assert.equal(sessionStore.read().flowState, 'externally-opened');
  assert.equal(sessionStore.read().resumeAvailable, true);

  controller.onPlaybackError('embedBlocked');
  assert.equal(sessionStore.read().errorType, 'embedBlocked');

  controller.clearCurrentSelection();
  assert.equal(sessionStore.read().currentMediaItemId, '');
  assert.equal(sessionStore.read().flowState, 'idle');
});
