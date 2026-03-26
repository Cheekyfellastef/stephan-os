import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleStephanosContext } from './assembleStephanosContext.mjs';
import { publishTileContextSnapshot, setActiveTileContextHint } from '../runtime/tileContextRegistry.mjs';

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

test('assembleStephanosContext prioritizes active tile then relevant snapshots', () => {
  const storage = createStorage();

  publishTileContextSnapshot('wealthapp', {
    tileTitle: 'Wealth App',
    tileType: 'simulation',
    summary: 'ISA bridge assumptions configured.',
    structuredData: { retirementAge: 60 },
  }, { storage });

  publishTileContextSnapshot('wealth-simulation-scenarios', {
    tileTitle: 'Wealth Simulation Scenarios',
    tileType: 'simulation',
    summary: 'Energy shock scenario configured.',
    structuredData: { selectedScenario: 'energy-shock' },
  }, { storage });

  setActiveTileContextHint({ tileId: 'wealthapp', tileTitle: 'Wealth App' }, { storage });

  const assembled = assembleStephanosContext({
    userPrompt: 'How does my ISA bridge strategy work?',
    runtimeContext: { frontendOrigin: 'http://localhost:5173' },
    storage,
  });

  assert.equal(assembled.activeTileContext?.tileId, 'wealthapp');
  assert.equal(assembled.diagnostics.usedTileContextInjection, true);
  assert.equal(assembled.diagnostics.includedTileIds.includes('wealthapp'), true);
});
