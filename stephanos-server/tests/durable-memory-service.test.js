import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DurableMemoryService } from '../services/durableMemoryService.js';

test('durable memory service rejects stale writes when ifUnmodifiedSince does not match canonical updatedAt', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stephanos-durable-memory-'));
  const file = path.join(tempDir, 'durable-memory.json');
  const service = new DurableMemoryService(file);

  const first = service.setStore({
    schemaVersion: 2,
    records: {
      'continuity::baseline': {
        schemaVersion: 2,
        type: 'continuity.note',
        source: 'test',
        scope: 'runtime',
        summary: 'baseline',
        payload: {},
        tags: [],
        importance: 'normal',
        retentionHint: 'default',
        createdAt: '2026-04-03T00:00:00.000Z',
        updatedAt: '2026-04-03T00:00:00.000Z',
        surface: 'shared',
      },
    },
  }, 'test');

  assert.throws(() => {
    service.setStore({
      schemaVersion: 2,
      records: {},
    }, 'stale-client', {
      ifUnmodifiedSince: '2026-04-02T00:00:00.000Z',
    });
  }, (error) => error?.code === 'DURABLE_MEMORY_CONFLICT' && error?.status === 409);

  const stable = service.getStore();
  assert.equal(stable.updatedAt, first.updatedAt);
  assert.equal(stable.records['continuity::baseline'].summary, 'baseline');
});
