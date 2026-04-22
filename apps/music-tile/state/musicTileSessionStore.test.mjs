import test from 'node:test';
import assert from 'node:assert/strict';

import { createMusicTileSessionStore } from './musicTileSessionStore.js';

test('musicTileSessionStore reads default and persists patched playback session', () => {
  let memory = { sessions: [] };
  const store = createMusicTileSessionStore({
    readMemory: () => memory,
    writeMemory: (next) => {
      memory = next;
    },
  });

  const initial = store.read();
  assert.equal(initial.mode, 'single');
  assert.equal(initial.flowState, 'idle');
  assert.equal(initial.errorType, 'none');
  assert.equal(initial.externallyOpened, false);
  assert.equal(initial.resumeAvailable, false);

  const next = store.patch({
    mode: 'flow',
    flowState: 'active',
    currentMediaItemId: 'abc123video0',
    errorType: 'embedBlocked',
    externallyOpened: true,
    resumeAvailable: true,
  });
  assert.equal(next.mode, 'flow');
  assert.equal(next.errorType, 'embedBlocked');
  assert.equal(next.externallyOpened, true);
  assert.equal(next.resumeAvailable, true);
  assert.equal(memory.sessions.length, 1);
  assert.equal(memory.sessions[0].currentMediaItemId, 'abc123video0');
});
