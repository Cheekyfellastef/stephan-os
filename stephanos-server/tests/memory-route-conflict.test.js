import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import memoryRouter from '../routes/memory.js';
import { durableMemoryService } from '../services/durableMemoryService.js';
import { normalizeError } from '../services/errors.js';

test('normalizeError preserves status/statusCode, code, and details from non-AppError values', () => {
  const rawError = new Error('Conflict from durable memory');
  rawError.statusCode = 409;
  rawError.code = 'DURABLE_MEMORY_CONFLICT';
  rawError.details = { currentUpdatedAt: '2026-04-03T10:00:00.000Z' };

  const appError = normalizeError(rawError);
  assert.equal(appError.status, 409);
  assert.equal(appError.statusCode, 409);
  assert.equal(appError.code, 'DURABLE_MEMORY_CONFLICT');
  assert.deepEqual(appError.details, { currentUpdatedAt: '2026-04-03T10:00:00.000Z' });
});

test('PUT /api/memory/durable returns 409 conflict with durable conflict payload', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/memory', memoryRouter);

  const originalSetStore = durableMemoryService.setStore;
  durableMemoryService.setStore = () => {
    const conflict = new Error('Durable memory write rejected because canonical state changed since client hydration.');
    conflict.status = 409;
    conflict.code = 'DURABLE_MEMORY_CONFLICT';
    conflict.details = {
      ifUnmodifiedSince: '2026-04-03T10:00:00.000Z',
      currentUpdatedAt: '2026-04-03T10:05:00.000Z',
    };
    throw conflict;
  };

  const server = app.listen(0);
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/memory/durable`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 2,
        records: {},
        ifUnmodifiedSince: '2026-04-03T10:00:00.000Z',
      }),
    });

    const payload = await response.json();
    assert.equal(response.status, 409);
    assert.equal(payload.success, false);
    assert.equal(payload.error_code, 'DURABLE_MEMORY_CONFLICT');
    assert.equal(payload.details.currentUpdatedAt, '2026-04-03T10:05:00.000Z');
  } finally {
    durableMemoryService.setStore = originalSetStore;
    await new Promise((resolve) => server.close(resolve));
  }
});
