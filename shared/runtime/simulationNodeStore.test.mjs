import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulationNodeStore, SIMULATION_NODE_CATEGORIES } from './simulationNodeStore.mjs';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test('simulationNodeStore persists and reads sanitized idea records', () => {
  const storage = createStorage();
  const store = createSimulationNodeStore({
    category: SIMULATION_NODE_CATEGORIES.ideas,
    storage,
  });

  store.upsert({
    title: 'Test idea',
    summary: 'Idea summary',
    tags: ['a', ' ', 'b'],
    media: [
      { type: 'image', title: 'Inspiration image', source: 'https://example.com/img.png' },
      { type: 'invalid', title: 'bad', source: 'x' },
    ],
  });

  const all = store.readAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].title, 'Test idea');
  assert.deepEqual(all[0].tags, ['a', 'b']);
  assert.equal(all[0].media.length, 1);
  assert.equal(all[0].media[0].type, 'image');
});
