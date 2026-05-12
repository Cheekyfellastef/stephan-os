import test from 'node:test';
import assert from 'node:assert/strict';
import { getPerfDiagnosticsSnapshot, recordPerfCounter, recordPerfEvent } from './perfDiagnostics.js';

test('perf diagnostics counters and recent events stay bounded', () => {
  delete globalThis.__STEPHANOS_PERF_DIAGNOSTICS__;
  for (let index = 0; index < 200; index += 1) {
    recordPerfCounter('test', `counter_${index}`, 1);
    recordPerfEvent('test', `event_${index}`, 'x'.repeat(300));
  }
  const snapshot = getPerfDiagnosticsSnapshot();
  assert.ok(snapshot);
  assert.ok(Object.keys(snapshot.counters).length <= 120);
  assert.ok(snapshot.recent.length <= 80);
  assert.ok(snapshot.recent[0].detail.length <= 120);
});
