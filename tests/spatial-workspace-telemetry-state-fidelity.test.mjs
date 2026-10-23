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

test('invalid canonical feed state fails closed with cached evidence', () => {
  const result = projectSpatialWorkspaceTelemetryForConsumersV1(canonical('rogue-state'));
  assert.equal(result.state, 'waiting');
  assert.equal(result.available, true);
  assert.equal(result.runId, 'spatial-state-regression');
  assert.equal(result.operatorAcceptance, false);
});

test('invalid consumer projection state fails closed on reprojection', () => {
  const valid = projectSpatialWorkspaceTelemetryForConsumersV1(canonical('ready'));
  const once = projectSpatialWorkspaceTelemetryForConsumersV1({ ...valid, state: 'rogue-state' });
  const twice = projectSpatialWorkspaceTelemetryForConsumersV1(once);
  assert.equal(once.state, 'waiting');
  assert.equal(twice.state, 'waiting');
  assert.equal(twice.available, true);
  assert.equal(twice.runId, 'spatial-state-regression');
  assert.equal(twice.operatorAcceptance, false);
});

for (const property of ['runId', 'phase', 'observedAtUtc', 'sourceHead']) {
  test(`canonical READY requires provenance ${property}`, () => {
    const malformed = { ...latest.evidence, [property]: '' };
    const result = projectSpatialWorkspaceTelemetryForConsumersV1(canonical('ready', { evidence: malformed }));
    assert.equal(result.state, 'waiting');
    assert.equal(result.available, false);
    assert.equal(result.operatorAcceptance, false);
  });
  test(`consumer READY re-projection requires provenance ${property}`, () => {
    const valid = projectSpatialWorkspaceTelemetryForConsumersV1(canonical('ready'));
    const result = projectSpatialWorkspaceTelemetryForConsumersV1({ ...valid, [property]: '' });
    assert.equal(result.state, 'waiting');
    assert.equal(result.available, false);
    assert.equal(result.operatorAcceptance, false);
  });
}

for (const [label, rendererHead] of [
  ['different-commit', 'b'.repeat(40)],
  ['invalid-identity', 'not-a-commit'],
]) {
  test(`Spatial canonical READY fails closed on ${label} renderer/source drift`, () => {
    const evidence = { ...latest.evidence, rendererSourceHead: rendererHead };
    const result = projectSpatialWorkspaceTelemetryForConsumersV1(canonical('ready', { evidence }));
    assert.equal(result.available, false);
    assert.equal(result.state, 'waiting');
    assert.equal(result.operatorAcceptance, false);
  });
  test(`Spatial consumer READY reprojection fails closed on ${label} renderer/source drift`, () => {
    const valid = projectSpatialWorkspaceTelemetryForConsumersV1(canonical('ready'));
    const result = projectSpatialWorkspaceTelemetryForConsumersV1({
      ...valid, rendererSourceHead: rendererHead,
    });
    assert.equal(result.available, false);
    assert.equal(result.state, 'waiting');
    assert.equal(result.operatorAcceptance, false);
  });
}
test('matching uppercase renderer identity preserves valid cached telemetry', () => {
  const evidence = { ...latest.evidence, rendererSourceHead: HEAD.toUpperCase() };
  const result = projectSpatialWorkspaceTelemetryForConsumersV1(canonical('ready', { evidence }));
  assert.equal(result.available, true);
  assert.equal(result.state, 'ready');
  assert.equal(result.sourceHead, HEAD);
});
