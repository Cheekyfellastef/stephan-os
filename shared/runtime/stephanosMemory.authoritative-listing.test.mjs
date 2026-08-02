import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createStephanosMemory,
  createStephanosSharedMemoryAdapter,
} from './stephanosMemory.mjs';

function createStorage(entries = {}) {
  const store = new Map(Object.entries(entries));
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
  };
}

function record(summary, source) {
  return {
    schemaVersion: 2,
    type: 'operator.preference',
    source,
    scope: 'runtime',
    summary,
    payload: { value: summary },
    tags: ['explicit-teaching'],
    importance: 'normal',
    retentionHint: 'default',
    createdAt: '2026-08-02T20:00:00.000Z',
    updatedAt: '2026-08-02T20:00:00.000Z',
    surface: 'hosted',
  };
}

test('durable listings exclude pending local intents from authoritative truth', async () => {
  const storage = createStorage();
  const remoteState = {
    schemaVersion: 2,
    updatedAt: '2026-08-02T20:01:00.000Z',
    records: {
      'continuity::remote': record('Remote confirmed preference', 'remote-device'),
    },
  };
  const methods = [];
  const fetchImpl = async (_url, options = {}) => {
    const method = options.method || 'GET';
    methods.push(method);
    if (method === 'PUT') {
      const error = new Error('simulated backend save failure');
      error.code = 'simulated-save-failure';
      throw error;
    }
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ success: true, data: remoteState });
      },
    };
  };
  const adapter = createStephanosSharedMemoryAdapter({
    fetchImpl,
    storage,
    logger: { info() {} },
  });

  adapter.writeState({
    schemaVersion: 2,
    updatedAt: '2026-08-02T20:00:30.000Z',
    records: {
      'continuity::pending-local': record('Pending local preference', 'local-device'),
    },
  });

  const refreshReceipt = await adapter.refreshAuthority();
  assert.equal(refreshReceipt.authorityConfirmed, true);
  assert.deepEqual(Object.keys(refreshReceipt.state.records), ['continuity::remote']);
  assert.deepEqual(
    Object.keys(adapter.readState().records).sort(),
    ['continuity::pending-local', 'continuity::remote'],
  );

  const memory = createStephanosMemory({ adapter, source: 'test', surface: 'hosted' });
  const listing = await memory.listRecordsDurably({ namespace: 'continuity' });

  assert.equal(listing.authorityConfirmed, true);
  assert.deepEqual(listing.records.map((entry) => entry.id), ['remote']);
  assert.equal(Object.hasOwn(listing.receipt, 'state'), false);
  assert.ok(methods.includes('PUT'));
  assert.ok(methods.filter((method) => method === 'GET').length >= 2);
});
