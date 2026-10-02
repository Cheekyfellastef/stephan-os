import assert from 'node:assert/strict';
import test from 'node:test';

test('Starfield VR telemetry reporter parses and exports its runtime entrypoints', async () => {
  const module = await import('./report-starfield-vr-telemetry.mjs');
  assert.equal(module.STARFIELD_VR_TELEMETRY_REPORT_SCHEMA, 'stephanos.starfield-vr-telemetry-report.v1');
  assert.equal(module.STARFIELD_VR_TELEMETRY_HISTORY_SCHEMA, 'stephanos.starfield-vr-telemetry-history-index.v1');
  assert.equal(typeof module.reportStarfieldVrTelemetry, 'function');
  assert.equal(typeof module.main, 'function');
});
