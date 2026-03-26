import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearActiveTileContextHint,
  getActiveTileContextHint,
  getAllTileContextSnapshots,
  getTileContextSnapshot,
  publishTileContextSnapshot,
  registerTileContextProvider,
  setActiveTileContextHint,
  unregisterTileContextProvider,
} from './tileContextRegistry.mjs';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test('tileContextRegistry registers providers and persists snapshots', () => {
  const storage = createStorage();

  registerTileContextProvider('wealthapp', () => ({
    tileId: 'wealthapp',
    tileTitle: 'Wealth App',
    tileType: 'simulation',
    summary: 'Retirement assumptions loaded.',
    structuredData: { retirementAge: 60 },
  }));

  const snapshot = getTileContextSnapshot('wealthapp', { storage });
  assert.equal(snapshot?.tileId, 'wealthapp');
  assert.equal(snapshot?.structuredData?.retirementAge, 60);

  const persisted = publishTileContextSnapshot('wealth-simulation-scenarios', {
    tileTitle: 'Wealth Scenarios',
    tileType: 'simulation',
    summary: 'Base case',
    structuredData: { selectedScenario: 'base-case' },
  }, { storage });

  assert.equal(persisted.tileId, 'wealth-simulation-scenarios');
  const all = getAllTileContextSnapshots({ storage });
  assert.equal(all.length >= 2, true);

  unregisterTileContextProvider('wealthapp');
});

test('tileContextRegistry stores active tile hints', () => {
  const storage = createStorage();
  setActiveTileContextHint({ tileId: 'wealthapp', tileTitle: 'Wealth App' }, { storage });

  const hint = getActiveTileContextHint({ storage });
  assert.equal(hint?.tileId, 'wealthapp');

  clearActiveTileContextHint({ storage });
  assert.equal(getActiveTileContextHint({ storage }), null);
});
