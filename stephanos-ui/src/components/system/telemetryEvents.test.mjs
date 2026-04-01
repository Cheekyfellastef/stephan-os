import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTelemetryHistory, extractTelemetryEvents, TELEMETRY_MAX_HISTORY } from './telemetryEvents.js';

test('extractTelemetryEvents emits BACKEND transition event for reachable to unreachable', () => {
  const events = extractTelemetryEvents(
    { backendReachable: true },
    { backendReachable: false },
    '2026-04-01T00:00:00.000Z',
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].subsystem, 'BACKEND');
  assert.match(events[0].change, /reachable → unreachable/);
});

test('extractTelemetryEvents emits ROUTE transition event', () => {
  const events = extractTelemetryEvents(
    { routeKind: 'local-desktop' },
    { routeKind: 'dist' },
    '2026-04-01T00:00:00.000Z',
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].subsystem, 'ROUTE');
  assert.match(events[0].change, /local-desktop → dist/);
});

test('extractTelemetryEvents emits PROVIDER executable transition event', () => {
  const events = extractTelemetryEvents(
    { providerExecution: { executableProvider: 'ollama' } },
    { providerExecution: { executableProvider: 'mock' } },
    '2026-04-01T00:00:00.000Z',
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].subsystem, 'PROVIDER');
  assert.match(events[0].change, /executable ollama → mock/);
});

test('appendTelemetryHistory keeps only newest bounded history events', () => {
  let history = [];
  for (let index = 0; index < 55; index += 1) {
    const nextEvent = {
      id: `event-${index}`,
      timestamp: `2026-04-01T00:00:${String(index).padStart(2, '0')}.000Z`,
      subsystem: 'SYSTEM',
      change: `Change ${index}`,
      reason: null,
      impact: null,
    };
    history = appendTelemetryHistory(history, [nextEvent], TELEMETRY_MAX_HISTORY);
  }

  assert.equal(history.length, 50);
  assert.equal(history[0].id, 'event-54');
  assert.equal(history[49].id, 'event-5');
});
