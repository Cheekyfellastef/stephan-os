import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __resetMusicTileStateTestHooks,
  loadMusicTileState,
  saveMusicTileState,
} from './musicTileState.js';

function createStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

test('music tile skips saves before hydration and saves after hydration', async () => {
  const calls = [];
  const storage = createStorage();

  globalThis.window = {
    localStorage: storage,
    StephanosTileDataContract: {
      client: {
        apiBaseUrl: 'http://localhost:8787',
        loadDurableState: async () => ({
          state: {
            version: 1,
            selection: {
              era: 'afterlife-modern',
              energyCurve: 'rising',
              emotion: 'transcendent',
              density: 'layered',
            },
          },
          source: 'shared-backend',
          diagnostics: null,
        }),
        saveDurableState: async ({ state }) => {
          calls.push(state);
          return { ok: true, source: 'shared-backend' };
        },
      },
    },
  };

  __resetMusicTileStateTestHooks();

  saveMusicTileState({ era: 'pre-hydration-write' });
  assert.equal(calls.length, 0);

  await loadMusicTileState();
  saveMusicTileState({ era: 'post-hydration-write' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].selection.era, 'post-hydration-write');
});
