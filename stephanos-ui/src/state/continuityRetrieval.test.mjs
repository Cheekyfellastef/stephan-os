import test from 'node:test';
import assert from 'node:assert/strict';

import { buildContinuitySummary, getContinuityContext } from './continuityRetrieval.js';

test('getContinuityContext keeps retrieval bounded and recent', () => {
  const now = Date.parse('2026-04-04T00:00:00.000Z');
  const context = getContinuityContext({
    now,
    limit: 2,
    telemetryEntries: [
      { id: 'evt-1', subsystem: 'MEMORY', change: 'memory sync established', timestamp: '2026-04-03T23:59:58.000Z' },
      { id: 'evt-2', subsystem: 'PROVIDER', change: 'provider connected', timestamp: '2026-04-03T23:59:57.000Z' },
      { id: 'evt-3', subsystem: 'MEMORY', change: 'heartbeat ok', timestamp: '2026-04-03T23:59:56.000Z' },
    ],
  });

  assert.equal(context.retrievalState, 'bounded');
  assert.equal(context.records.length, 2);
  assert.equal(context.records[0].id, 'evt-1');
  assert.equal(context.records[1].id, 'evt-2');
});

test('getContinuityContext excludes stale records outside time window', () => {
  const now = Date.parse('2026-04-04T00:10:00.000Z');
  const context = getContinuityContext({
    now,
    timeWindowMs: 60_000,
    telemetryEntries: [
      { id: 'evt-1', subsystem: 'MEMORY', change: 'memory sync established', timestamp: '2026-04-04T00:00:00.000Z' },
    ],
  });

  assert.equal(context.records.length, 0);
  assert.equal(context.retrievalState, 'empty');
});

test('getContinuityContext marks fallback source as degraded', () => {
  const now = Date.parse('2026-04-04T00:00:00.000Z');
  const context = getContinuityContext({
    now,
    sharedMemorySource: 'local-mirror-fallback',
    telemetryEntries: [
      { id: 'evt-1', subsystem: 'MEMORY', change: 'memory sync established', timestamp: '2026-04-03T23:59:58.000Z' },
    ],
  });

  assert.equal(context.source, 'fallback');
  assert.equal(context.retrievalState, 'degraded');
});

test('buildContinuitySummary returns human-readable summary', () => {
  const summary = buildContinuitySummary([
    { summary: 'memory sync established' },
    { summary: 'provider connected' },
    { summary: 'tile interaction recorded' },
  ]);

  assert.match(summary, /Recent activity:/);
  assert.match(summary, /memory sync established/);
});
