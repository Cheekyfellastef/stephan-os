import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdeasPersistence, sanitizeIdeasState } from './ideas-persistence.js';

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

test('saveState falls back to legacy local storage when shared backend save fails', async () => {
  const localStorage = createMemoryStorage();
  const persistence = createIdeasPersistence({
    localStorage,
    StephanosTileDataContract: {
      client: {
        saveDurableState: async () => ({
          ok: false,
          source: 'local-mirror-fallback',
          diagnostics: { error: 'request-failed' },
        }),
      },
    },
  });

  const result = await persistence.saveState({
    state: {
      records: [{
        id: 'idea_1',
        title: 'Fallback test',
        summary: 'should persist locally',
        tags: ['ideas'],
        media: [],
        createdAt: '2026-04-06T00:00:00.000Z',
        updatedAt: '2026-04-06T00:00:00.000Z',
      }],
    },
    hydrationCompleted: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'legacy-local-fallback');

  const raw = localStorage.getItem('stephanos.simulationNodes.v1.ideas');
  assert.ok(raw);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].title, 'Fallback test');
});

test('saveState reports failure when backend save fails and local fallback is unavailable', async () => {
  const persistence = createIdeasPersistence({
    StephanosTileDataContract: {
      client: {
        saveDurableState: async () => ({
          ok: false,
          source: 'local-mirror-fallback',
          diagnostics: { error: 'request-failed' },
        }),
      },
    },
  });

  const result = await persistence.saveState({
    state: {
      records: [{
        id: 'idea_2',
        title: 'No storage',
        summary: '',
        tags: [],
        media: [],
        createdAt: '2026-04-06T00:00:00.000Z',
        updatedAt: '2026-04-06T00:00:00.000Z',
      }],
    },
    hydrationCompleted: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.source, 'save-failed');
});

test('sanitizeIdeasState migrates legacy media into structured knowledge evidence', () => {
  const sanitized = sanitizeIdeasState({
    records: [{
      id: 'idea_legacy_1',
      title: 'Legacy idea',
      summary: 'Legacy structure',
      tags: ['ideas'],
      media: [{
        type: 'link',
        title: 'Doc',
        source: 'repo://doc',
        notes: 'legacy',
      }],
      createdAt: '2026-04-06T00:00:00.000Z',
      updatedAt: '2026-04-06T00:00:00.000Z',
    }],
  });

  assert.equal(sanitized.records.length, 1);
  assert.equal(sanitized.records[0].knowledge.nodeType, 'idea-node');
  assert.equal(sanitized.records[0].knowledge.evidence.length, 1);
  assert.equal(sanitized.records[0].media.length, 1);
});
