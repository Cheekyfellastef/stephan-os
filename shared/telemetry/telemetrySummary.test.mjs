import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTelemetrySummary } from './telemetrySummary.mjs';

test('telemetry summary defaults to not_started with no events', () => {
  const summary = buildTelemetrySummary({ telemetryEntries: [], telemetryAvailable: true, now: Date.parse('2026-04-28T00:00:00.000Z') });

  assert.equal(summary.systemId, 'telemetry');
  assert.equal(summary.status, 'not_started');
  assert.equal(summary.eventCount, 0);
  assert.match(summary.nextActions[0], /Bind telemetry summary to agent\/task lifecycle/i);
});

test('telemetry summary reports flowing when recent events are present', () => {
  const summary = buildTelemetrySummary({
    telemetryAvailable: true,
    now: Date.parse('2026-04-28T00:10:00.000Z'),
    telemetryEntries: [
      { id: 'evt-1', timestamp: '2026-04-28T00:05:00.000Z', subsystem: 'AGENT', change: 'agent selected', status: 'passed' },
      { id: 'evt-2', timestamp: '2026-04-28T00:08:30.000Z', subsystem: 'CODEX', change: 'verification run', status: 'active' },
    ],
  });

  assert.equal(summary.status, 'flowing');
  assert.equal(summary.recentEventCount, 2);
  assert.match(summary.dashboardSummaryText, /flowing/i);
});
