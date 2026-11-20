import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VR_TELEMETRY_CORE_SENSORS,
  VR_TELEMETRY_SENSOR_CONTRACT_SCHEMA,
  buildVrTelemetrySensorContract,
} from './vrTelemetrySensorContractV1.mjs';

test('builds a game-neutral VR sensor contract with provider extensions', () => {
  const result = buildVrTelemetrySensorContract({
    gameId: 'starfield',
    provider: 'mutar-openxr',
    launchSessionId: 'abc123',
    sourceHead: 'a'.repeat(40),
    targetExecutable: 'Starfield.exe',
    layerManifestPath: 'C:\\telemetry\\layer.json',
    tracePath: 'C:\\telemetry\\abc123.jsonl',
    markerPath: 'C:\\telemetry\\abc123.markers.jsonl',
    providerSensors: ['mutar.aer-parity', 'mutar.history-reset', 'mutar.aer-parity'],
  });

  assert.equal(result.schemaVersion, VR_TELEMETRY_SENSOR_CONTRACT_SCHEMA);
  assert.equal(result.ok, true);
  assert.equal(result.gameId, 'starfield');
  assert.equal(result.capabilities.modifiesFrameData, false);
  assert.equal(result.capabilities.pixelContentSampling, false);
  assert.equal(result.capabilities.eyeTiming, true);
  assert.equal(result.capabilities.poseTiming, true);
  assert.ok(result.sensors.includes('openxr.stereo-submission'));
  assert.ok(result.sensors.includes('operator.visual-fault-marker'));
  assert.equal(result.sensors.filter((item) => item === 'mutar.aer-parity').length, 1);
  assert.ok(VR_TELEMETRY_CORE_SENSORS.length >= 20);
});

test('rejects unsafe session identity instead of widening environment injection', () => {
  const result = buildVrTelemetrySensorContract({
    gameId: 'starfield',
    launchSessionId: 'bad session id',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'VR_TELEMETRY_SENSOR_IDENTITY_INVALID');
});
