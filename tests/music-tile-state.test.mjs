import test from 'node:test';
import assert from 'node:assert/strict';

function createLocalStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
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

const originalWindow = globalThis.window;

globalThis.window = {
  localStorage: createLocalStorage(),
  StephanosTileDataContract: null,
  console,
};

const musicStateModule = await import('../apps/music-tile/state/musicTileState.js');

test.after(() => {
  globalThis.window = originalWindow;
});

test('music tile load prefers shared backend state and includes load diagnostics metadata', async () => {
  globalThis.window.localStorage = createLocalStorage({
    'stephanos.musicTile.state.v1': JSON.stringify({ version: 1, selection: { era: 'legacy' } }),
  });
  globalThis.window.StephanosTileDataContract = {
    client: {
      async loadDurableState() {
        return {
          source: 'shared-backend',
          state: {
            version: 2,
            selection: {
              era: 'future-wave',
              energyCurve: 'descending',
              emotion: 'focused',
              density: 'minimal',
            },
            memory: { ratings: [] },
          },
          diagnostics: { status: 200 },
        };
      },
    },
  };

  const loaded = await musicStateModule.loadMusicTileState();
  assert.equal(loaded.selection.era, 'future-wave');
  assert.equal(loaded.__tileDataMeta.source, 'shared-backend');
  assert.ok(Array.isArray(loaded.memory.ratings));
});

test('music tile save sanitizes payload and sends durable data to shared backend contract', async () => {
  let capturedPayload = null;
  globalThis.window.StephanosTileDataContract = {
    client: {
      async saveDurableState(payload) {
        capturedPayload = payload;
        return { ok: true, source: 'shared-backend' };
      },
    },
  };

  const payload = musicStateModule.saveMusicTileState({
    selection: {
      era: 'night-drive',
      energyCurve: 'rising',
      emotion: 'hopeful',
      density: 'layered',
    },
    memory: { ratings: [] },
  });

  assert.equal(payload.version, 2);
  assert.equal(payload.selection.era, 'night-drive');
  assert.equal(capturedPayload.appId, 'music-tile');
  assert.equal(capturedPayload.state.selection.era, 'night-drive');
});
