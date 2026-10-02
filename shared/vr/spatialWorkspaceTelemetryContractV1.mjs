export const SPATIAL_WORKSPACE_TELEMETRY_SCHEMA_V1 = 'stephanos.spatial-workspace-telemetry.v1';
export const SPATIAL_WORKSPACE_TELEMETRY_FEED_SCHEMA_V1 = 'stephanos.spatial-workspace-telemetry-feed.v1';
export const SPATIAL_WORKSPACE_TELEMETRY_ROUTE = '/api/shared-workspace/spatial-telemetry';
export const SPATIAL_WORKSPACE_TELEMETRY_FEED_ROUTE = '/api/shared-workspace/spatial-telemetry-feed';
export const SPATIAL_WORKSPACE_TELEMETRY_PHASES = Object.freeze(['start', 'sample', 'end', 'error']);

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

function text(value, fallback = '') {
  const out = value === null || value === undefined ? '' : String(value).trim();
  return out || fallback;
}

function number(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(min, Math.min(max, parsed));
}

function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Math.floor(number(value, min, max));
}

function iso(value) {
  const raw = text(value);
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function boundedErrors(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.slice(0, 8).map((item) => text(item).slice(0, 240)).filter(Boolean));
}

export function sanitizeSpatialWorkspaceTelemetryV1(input = {}) {
  const runId = text(input.runId).toLowerCase();
  const phase = text(input.phase).toLowerCase();
  const observedAtUtc = iso(input.observedAtUtc);
  if (input.schemaVersion !== SPATIAL_WORKSPACE_TELEMETRY_SCHEMA_V1) throw new Error('SPATIAL_TELEMETRY_SCHEMA_INVALID');
  if (!SAFE_ID.test(runId)) throw new Error('SPATIAL_TELEMETRY_RUN_ID_INVALID');
  if (!SPATIAL_WORKSPACE_TELEMETRY_PHASES.includes(phase)) throw new Error('SPATIAL_TELEMETRY_PHASE_INVALID');
  if (!observedAtUtc) throw new Error('SPATIAL_TELEMETRY_TIME_INVALID');

  const frame = input.frame && typeof input.frame === 'object' ? input.frame : {};
  const xrInput = input.input && typeof input.input === 'object' ? input.input : {};
  const webxr = input.webxr && typeof input.webxr === 'object' ? input.webxr : {};

  return Object.freeze({
    schemaVersion: SPATIAL_WORKSPACE_TELEMETRY_SCHEMA_V1,
    runId,
    phase,
    sequence: integer(input.sequence, 0, 1000000),
    observedAtUtc,
    sourceHead: /^[0-9a-f]{40}$/i.test(text(input.sourceHead)) ? text(input.sourceHead).toLowerCase() : '',
    rendererSourceHead: /^[0-9a-f]{40}$/i.test(text(input.rendererSourceHead)) ? text(input.rendererSourceHead).toLowerCase() : '',
    device: text(input.device, 'browser').slice(0, 80),
    route: text(input.route, 'Stephanos Spatial Workspace / WebXR').slice(0, 120),
    room: text(input.room, 'holodeck-starting-chamber').slice(0, 80),
    durationMs: integer(input.durationMs, 0, 24 * 60 * 60 * 1000),
    frame: Object.freeze({
      count: integer(frame.count, 0, 100000000),
      poseFrames: integer(frame.poseFrames, 0, 100000000),
      missingPoseFrames: integer(frame.missingPoseFrames, 0, 100000000),
      trackingLossCount: integer(frame.trackingLossCount, 0, 1000000),
      averageFrameMs: number(frame.averageFrameMs, 0, 1000),
      maxFrameMs: number(frame.maxFrameMs, 0, 10000),
      estimatedFps: number(frame.estimatedFps, 0, 1000),
      maxViewCount: integer(frame.maxViewCount, 0, 16),
    }),
    input: Object.freeze({
      sourceCountMax: integer(xrInput.sourceCountMax, 0, 32),
      handTrackedSourceCountMax: integer(xrInput.handTrackedSourceCountMax, 0, 32),
      inputSourceChangeCount: integer(xrInput.inputSourceChangeCount, 0, 1000000),
      selectCount: integer(xrInput.selectCount, 0, 1000000),
      squeezeCount: integer(xrInput.squeezeCount, 0, 1000000),
    }),
    webxr: Object.freeze({
      immersiveSupported: webxr.immersiveSupported === true,
      referenceSpace: text(webxr.referenceSpace, 'unknown').slice(0, 40),
    }),
    errors: boundedErrors(input.errors),
  });
}

export function spatialTelemetryHasRuntimeProof(packet = {}) {
  return packet.phase === 'end'
    && packet.webxr?.immersiveSupported === true
    && Number(packet.frame?.count) >= 30
    && Number(packet.frame?.poseFrames) >= 10;
}

export function spatialTelemetryHasPhysicalInteractionProof(packet = {}) {
  return spatialTelemetryHasRuntimeProof(packet)
    && (Number(packet.input?.selectCount) > 0 || Number(packet.input?.squeezeCount) > 0);
}

export function spatialTelemetryNeedsLearning(packet = {}) {
  return Number(packet.frame?.trackingLossCount) > 0
    || Number(packet.frame?.maxFrameMs) >= 50
    || Number(packet.errors?.length) > 0;
}
