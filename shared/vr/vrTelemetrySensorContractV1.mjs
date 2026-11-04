export const VR_TELEMETRY_SENSOR_CONTRACT_SCHEMA = 'stephanos.vr-telemetry-sensor-contract.v1';

export const VR_TELEMETRY_CORE_SENSORS = Object.freeze([
  'system.cpu',
  'game.cpu',
  'gpu.utilization',
  'gpu.vram',
  'frame.application-time',
  'frame.delivered-cadence',
  'headset.refresh-rate',
  'compositor.reprojection',
  'compositor.dropped-frames',
  'transport.encode-latency',
  'transport.network-latency',
  'transport.decode-latency',
  'transport.bitrate',
  'transport.jitter',
  'openxr.frame-lifecycle',
  'openxr.projection-presence',
  'openxr.stereo-submission',
  'openxr.swapchain-release',
  'openxr.eye-skew',
  'openxr.pose-display-delta',
  'openxr.pose-fov',
  'openxr.submission-anomaly',
  'operator.visual-fault-marker',
]);

const token = (value, fallback = '') => {
  const out = String(value ?? fallback).trim();
  return /^[A-Za-z0-9._-]{1,160}$/.test(out) ? out : fallback;
};

export function buildVrTelemetrySensorContract({
  gameId,
  provider = 'unknown',
  launchSessionId,
  sourceHead = '',
  tracePath = '',
  markerPath = '',
  layerManifestPath = '',
  targetExecutable = '',
  providerSensors = [],
} = {}) {
  const normalizedGameId = token(gameId);
  const normalizedLaunchSessionId = token(launchSessionId);
  if (!normalizedGameId || !normalizedLaunchSessionId) {
    return Object.freeze({
      schemaVersion: VR_TELEMETRY_SENSOR_CONTRACT_SCHEMA,
      ok: false,
      reason: 'VR_TELEMETRY_SENSOR_IDENTITY_INVALID',
    });
  }

  const normalizedProviderSensors = [...new Set(
    (Array.isArray(providerSensors) ? providerSensors : [])
      .map((item) => token(item))
      .filter(Boolean),
  )].sort();

  return Object.freeze({
    schemaVersion: VR_TELEMETRY_SENSOR_CONTRACT_SCHEMA,
    ok: true,
    gameId: normalizedGameId,
    provider: token(provider, 'unknown'),
    launchSessionId: normalizedLaunchSessionId,
    sourceHead: /^[0-9a-f]{40}$/i.test(String(sourceHead)) ? String(sourceHead).toLowerCase() : '',
    targetExecutable: token(targetExecutable),
    layerManifestPath: String(layerManifestPath ?? ''),
    tracePath: String(tracePath ?? ''),
    markerPath: String(markerPath ?? ''),
    sensors: Object.freeze([...VR_TELEMETRY_CORE_SENSORS, ...normalizedProviderSensors]),
    capabilities: Object.freeze({
      modifiesFrameData: false,
      pixelContentSampling: false,
      pixelContentState: 'UNOBSERVED',
      frameLifecycle: true,
      stereoSubmission: true,
      eyeTiming: true,
      poseTiming: true,
      operatorFaultMarkers: true,
      providerSpecificSensors: normalizedProviderSensors.length > 0,
    }),
  });
}
