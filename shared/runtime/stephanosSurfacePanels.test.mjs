import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  readSurfacePanelState,
  writeSurfacePanelState,
} from './stephanosSurfacePanels.mjs';

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

test('surface panel state writes and reads through stephanos session memory layout', () => {
  const storage = createMemoryStorage();
  writeSurfacePanelState('vr-research-lab', 'overview', true, storage);
  writeSurfacePanelState('vr-research-lab', 'techniques', false, storage);
  writeSurfacePanelState('music-lab', 'queue', true, storage);

  assert.deepEqual(readSurfacePanelState('vr-research-lab', storage), {
    overview: true,
    techniques: false,
  });
  assert.deepEqual(readSurfacePanelState('music-lab', storage), { queue: true });
});

test('surface panel shell uses canon rotating chevron button only', () => {
  const source = fs.readFileSync(new URL('./stephanosSurfacePanels.mjs', import.meta.url), 'utf8');
  assert.match(source, /stephanos-canon-rotating-chevron-button/);
  assert.doesNotMatch(source, /stephanos-surface-panel-knob/);
});
