import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadPaneOrder,
  reconcilePaneOrder,
  savePaneOrder,
  STEPHANOS_TILE_PANE_ORDER_STORAGE_KEY,
} from './paneOrderPersistence.js';

function createMemoryStorage(seed = {}) {
  const state = { ...seed };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(state, key) ? state[key] : null;
    },
    setItem(key, value) {
      state[key] = String(value);
    },
    removeItem(key) {
      delete state[key];
    },
    snapshot() {
      return { ...state };
    },
  };
}

test('reconcilePaneOrder keeps known saved panes, drops unknown, and appends newly added default panes', () => {
  const saved = ['missionDashboardPanel', 'unknownPanel', 'statusPanel'];
  const defaults = ['aiConsole', 'statusPanel', 'missionDashboardPanel', 'agentsPanel'];
  assert.deepEqual(reconcilePaneOrder(saved, defaults), [
    'missionDashboardPanel',
    'statusPanel',
    'aiConsole',
    'agentsPanel',
  ]);
});

test('loadPaneOrder falls back to default order when saved data is invalid', () => {
  const storage = createMemoryStorage({ [STEPHANOS_TILE_PANE_ORDER_STORAGE_KEY]: '{bad-json' });
  const defaults = ['aiConsole', 'statusPanel'];
  assert.deepEqual(loadPaneOrder(STEPHANOS_TILE_PANE_ORDER_STORAGE_KEY, defaults, storage), defaults);
});

test('savePaneOrder and loadPaneOrder round-trip pane order', () => {
  const storage = createMemoryStorage();
  const paneOrder = ['statusPanel', 'aiConsole'];
  assert.equal(savePaneOrder(STEPHANOS_TILE_PANE_ORDER_STORAGE_KEY, paneOrder, storage), true);
  assert.deepEqual(loadPaneOrder(STEPHANOS_TILE_PANE_ORDER_STORAGE_KEY, ['aiConsole', 'statusPanel'], storage), paneOrder);
});

test('loadPaneOrder uses defaults when storage is unavailable', () => {
  const defaults = ['aiConsole', 'statusPanel', 'agentsPanel'];
  assert.deepEqual(loadPaneOrder(STEPHANOS_TILE_PANE_ORDER_STORAGE_KEY, defaults, null), defaults);
});
