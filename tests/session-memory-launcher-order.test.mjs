import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  STEPHANOS_SESSION_MEMORY_STORAGE_KEY,
  STEPHANOS_UI_LAYOUT_STORAGE_KEY,
  clearPersistedStephanosSessionMemory,
  persistStephanosSessionMemory,
  readPersistedStephanosSessionMemory,
} from '../shared/runtime/stephanosSessionMemory.mjs';
import {
  LAUNCHER_TILE_ORDER_LAYOUT_KEY,
  persistLauncherTileOrder,
  readLauncherTileOrder,
} from '../shared/runtime/launcherTileLayout.mjs';

const defaultIds = ['a', 'b', 'control-tower'];
const aiStoreSource = readFileSync(new URL('../stephanos-ui/src/state/aiStore.js', import.meta.url), 'utf8');
const uiDefaults = aiStoreSource.match(/^const DEFAULT_UI_LAYOUT = \{[\s\S]*?^\};/m)?.[0];
const uiNormalizer = aiStoreSource.match(/^function normalizeUiLayout\(value = \{\}\) \{[\s\S]*?^\}/m)?.[0];
assert.ok(uiDefaults && uiNormalizer, 'load the real runtime pane normalizer');

function runtimeUiLayout(value = {}) {
  return JSON.parse(runInNewContext(
    `${uiDefaults}\n${uiNormalizer}\nJSON.stringify(normalizeUiLayout(value));`,
    { value },
  ));
}

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function persistLayout(uiLayout, storage) {
  return persistStephanosSessionMemory({ session: { ui: { uiLayout } } }, storage);
}

test('runtime pane writes preserve the latest launcher order across successive launcher changes', () => {
  const storage = memoryStorage();
  const firstOrder = ['control-tower', 'a', 'b'];
  const secondOrder = ['b', 'control-tower', 'a'];
  assert.equal(persistLauncherTileOrder(firstOrder, defaultIds, storage).saved, true);

  // aiStore retains this normalized snapshot while the launcher changes later.
  const runtimeSnapshot = runtimeUiLayout(readPersistedStephanosSessionMemory(storage).session.ui.uiLayout);
  assert.equal(Object.hasOwn(runtimeSnapshot, LAUNCHER_TILE_ORDER_LAYOUT_KEY), false);
  persistLayout({ ...runtimeSnapshot, memoryPanel: false }, storage);
  assert.deepEqual(readLauncherTileOrder(defaultIds, storage), firstOrder);

  assert.equal(persistLauncherTileOrder(secondOrder, defaultIds, storage).saved, true);
  const currentPanes = { ...runtimeSnapshot, memoryPanel: true, statusPanel: false, debugConsole: true };
  const result = persistLayout(currentPanes, storage);
  assert.deepEqual(readLauncherTileOrder(defaultIds, storage), secondOrder);
  assert.deepEqual(result.session.ui.uiLayout[LAUNCHER_TILE_ORDER_LAYOUT_KEY], secondOrder);
  for (const [key, value] of Object.entries(currentPanes)) {
    assert.equal(result.session.ui.uiLayout[key], value, `runtime retains ownership of ${key}`);
  }
  assert.deepEqual(
    JSON.parse(storage.getItem(STEPHANOS_UI_LAYOUT_STORAGE_KEY)),
    result.session.ui.uiLayout,
    'legacy mirror reflects the same current order and pane choices',
  );
});

test('explicit launcher replacement, default reset and empty order override stored order', () => {
  const storage = memoryStorage();
  persistLauncherTileOrder(['control-tower', 'a', 'b'], defaultIds, storage);
  const replacement = ['b', 'a', 'control-tower'];
  persistLayout({ [LAUNCHER_TILE_ORDER_LAYOUT_KEY]: replacement }, storage);
  assert.deepEqual(readLauncherTileOrder(defaultIds, storage), replacement);

  assert.equal(persistLauncherTileOrder([], defaultIds, storage).saved, true);
  assert.deepEqual(readLauncherTileOrder(defaultIds, storage), defaultIds);
  persistLayout(runtimeUiLayout(), storage);
  assert.deepEqual(readLauncherTileOrder(defaultIds, storage), defaultIds);

  persistLayout({ [LAUNCHER_TILE_ORDER_LAYOUT_KEY]: [] }, storage);
  persistLayout(runtimeUiLayout(), storage);
  assert.deepEqual(readPersistedStephanosSessionMemory(storage).session.ui.uiLayout[LAUNCHER_TILE_ORDER_LAYOUT_KEY], []);
});

test('explicit removal and canonical clear do not resurrect an earlier launcher order', () => {
  const storage = memoryStorage();
  const staleRuntimeLayout = runtimeUiLayout();
  for (const clearedValue of [null, undefined]) {
    persistLauncherTileOrder(['control-tower', 'a', 'b'], defaultIds, storage);
    persistLayout({ [LAUNCHER_TILE_ORDER_LAYOUT_KEY]: clearedValue }, storage);
    persistLayout(staleRuntimeLayout, storage);
    assert.deepEqual(readLauncherTileOrder(defaultIds, storage), defaultIds);
    assert.equal(Object.hasOwn(readPersistedStephanosSessionMemory(storage).session.ui.uiLayout, LAUNCHER_TILE_ORDER_LAYOUT_KEY), false);
  }

  persistLauncherTileOrder(['b', 'control-tower', 'a'], defaultIds, storage);
  clearPersistedStephanosSessionMemory(storage);
  assert.equal(storage.getItem(STEPHANOS_SESSION_MEMORY_STORAGE_KEY), null);
  assert.equal(storage.getItem(STEPHANOS_UI_LAYOUT_STORAGE_KEY), null);
  persistLayout(staleRuntimeLayout, storage);
  assert.deepEqual(readLauncherTileOrder(defaultIds, storage), defaultIds);
  assert.equal(Object.hasOwn(readPersistedStephanosSessionMemory(storage).session.ui.uiLayout, LAUNCHER_TILE_ORDER_LAYOUT_KEY), false);
});

test('missing or corrupt canonical storage does not restore order from a stale legacy mirror', () => {
  const legacyOrder = JSON.stringify({ [LAUNCHER_TILE_ORDER_LAYOUT_KEY]: ['control-tower', 'a', 'b'] });
  for (const canonical of [null, '{invalid json', 'null', '[]', JSON.stringify({ session: { ui: { uiLayout: { [LAUNCHER_TILE_ORDER_LAYOUT_KEY]: 'invalid' } } } })]) {
    const storage = memoryStorage({ [STEPHANOS_UI_LAYOUT_STORAGE_KEY]: legacyOrder });
    if (canonical !== null) storage.setItem(STEPHANOS_SESSION_MEMORY_STORAGE_KEY, canonical);
    const result = persistLayout({ commandDeck: true, memoryPanel: false }, storage);
    assert.equal(Object.hasOwn(result.session.ui.uiLayout, LAUNCHER_TILE_ORDER_LAYOUT_KEY), false);
    assert.equal(result.session.ui.uiLayout.memoryPanel, false);
    assert.deepEqual(readLauncherTileOrder(defaultIds, storage), defaultIds);
  }
});

test('unavailable storage remains safe for an unrelated pane write', () => {
  for (const storage of [null, {
    getItem() { throw new Error('storage unavailable'); },
    setItem() { throw new Error('storage unavailable'); },
  }]) {
    const result = persistLayout({ commandDeck: true, memoryPanel: false }, storage);
    assert.equal(result.session.ui.uiLayout.memoryPanel, false);
    assert.equal(Object.hasOwn(result.session.ui.uiLayout, LAUNCHER_TILE_ORDER_LAYOUT_KEY), false);
  }
});
