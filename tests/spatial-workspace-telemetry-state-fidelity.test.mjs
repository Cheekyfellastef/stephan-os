import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SPATIAL_WORKSPACE_TELEMETRY_FEED_SCHEMA_V1,
  SPATIAL_WORKSPACE_TELEMETRY_SCHEMA_V1,
} from '../shared/vr/spatialWorkspaceTelemetryContractV1.mjs';
import {
  projectSpatialWorkspaceTelemetryForConsumersV1,
  buildSpatialWorkspaceTelemetryLandingLinesV1,
} from '../shared/vr/spatialWorkspaceTelemetryProjectionV1.mjs';

const HEAD = 'a'.repeat(40);
const latest = Object.freeze({
  evidence: Object.freeze({
    schemaVersion: SPATIAL_WORKSPACE_TELEMETRY_SCHEMA_V1,
    runId: 'spatial-state-regression',
    phase: 'end',
    observedAtUtc: '2026-10-21T12:00:00.000Z',
    sourceHead: HEAD,
    rendererSourceHead: HEAD,
    device: 'browser',
    frame: { count: 120, poseFrames: 120, estimatedFps: 72 },
    input: { selectCount: 1, squeezeCount: 0 },
  }),
});
function canonical(state, evidence = latest) {
  return {
    schemaVersion: SPATIAL_WORKSPACE_TELEMETRY_FEED_SCHEMA_V1,
    readOnly: true,
    state,
    latest: evidence,
  };
}
for (const state of ['ready', 'stale', 'waiting', 'unavailable']) {
  test(`Spatial evidence state ${state} survives canonical projection and re-projection`, () => {
    const once = projectSpatialWorkspaceTelemetryForConsumersV1(canonical(state));
    const twice = projectSpatialWorkspaceTelemetryForConsumersV1(once);
    assert.equal(once.state, state);
    assert.equal(twice.state, state);
    assert.equal(once.available, true, 'cached evidence is still present');
    assert.equal(twice.runId, 'spatial-state-regression');
    assert.equal(twice.sourceHead, HEAD);
    assert.equal(twice.operatorAcceptance, false);
    assert.match(buildSpatialWorkspaceTelemetryLandingLinesV1(once)[0], new RegExp(state));
  });
}
test('missing cached evidence is waiting, never ready', () => {
  const projection = projectSpatialWorkspaceTelemetryForConsumersV1(canonical('ready', null));
  assert.equal(projection.available, false);
  assert.equal(projection.state, 'waiting');
});
test('unavailable with no evidence is reported unavailable', () => {
  const projection = projectSpatialWorkspaceTelemetryForConsumersV1(canonical('unavailable', null));
  assert.equal(projection.available, false);
  assert.equal(projection.state, 'unavailable');
});
test('unknown input is never treated as fresh telemetry', () => {
  const projection = projectSpatialWorkspaceTelemetryForConsumersV1({
    schemaVersion: 'untrusted.telemetry', readOnly: true, state: 'ready', latest,
  });
  assert.equal(projection.available, false);
  assert.equal(projection.state, 'waiting');
  assert.equal(projection.operatorAcceptance, false);
});
