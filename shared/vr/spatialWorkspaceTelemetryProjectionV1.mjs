import {
  SPATIAL_WORKSPACE_TELEMETRY_FEED_SCHEMA_V1,
  SPATIAL_WORKSPACE_TELEMETRY_SCHEMA_V1,
} from './spatialWorkspaceTelemetryContractV1.mjs';

export const SPATIAL_WORKSPACE_TELEMETRY_CONSUMER_SCHEMA_V1 =
  'stephanos.spatial-workspace-telemetry-consumer.v1';

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const output = String(value).trim();
  return output || fallback;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shortHead(value) {
  const head = text(value);
  return head.length >= 8 ? head.slice(0, 8) : (head || 'unknown');
}

function alreadyProjected(value = {}) {
  return value?.schemaVersion === SPATIAL_WORKSPACE_TELEMETRY_CONSUMER_SCHEMA_V1
    && value?.readOnly === true;
}

export function projectSpatialWorkspaceTelemetryForConsumersV1(feed = {}) {
  if (alreadyProjected(feed)) return feed;
  const validFeed = feed?.schemaVersion === SPATIAL_WORKSPACE_TELEMETRY_FEED_SCHEMA_V1
    && feed?.readOnly === true;
  const evidence = validFeed && feed?.latest?.evidence?.schemaVersion === SPATIAL_WORKSPACE_TELEMETRY_SCHEMA_V1
    ? feed.latest.evidence
    : null;
  const feedState = text(feed?.state, evidence ? 'ready' : 'waiting').toLowerCase();
  const state = evidence
    ? (feedState === 'stale' ? 'stale' : 'ready')
    : (feedState === 'unavailable' ? 'unavailable' : 'waiting');
  const fps = number(evidence?.frame?.estimatedFps);

  return Object.freeze({
    schemaVersion: SPATIAL_WORKSPACE_TELEMETRY_CONSUMER_SCHEMA_V1,
    readOnly: true,
    sourceSchemaVersion: validFeed ? feed.schemaVersion : '',
    state,
    available: Boolean(evidence),
    runId: text(evidence?.runId),
    phase: text(evidence?.phase, 'unknown'),
    observedAtUtc: text(evidence?.observedAtUtc),
    sourceHead: text(evidence?.sourceHead),
    rendererSourceHead: text(evidence?.rendererSourceHead),
    device: text(evidence?.device, 'Spatial Workspace'),
    room: text(evidence?.room, 'holodeck-starting-chamber'),
    frame: Object.freeze({
      count: number(evidence?.frame?.count),
      poseFrames: number(evidence?.frame?.poseFrames),
      missingPoseFrames: number(evidence?.frame?.missingPoseFrames),
      trackingLossCount: number(evidence?.frame?.trackingLossCount),
      estimatedFps: fps,
      maxFrameMs: number(evidence?.frame?.maxFrameMs),
    }),
    input: Object.freeze({
      sourceCountMax: number(evidence?.input?.sourceCountMax),
      handTrackedSourceCountMax: number(evidence?.input?.handTrackedSourceCountMax),
      selectCount: number(evidence?.input?.selectCount),
      squeezeCount: number(evidence?.input?.squeezeCount),
    }),
    errorCount: number(evidence?.errorCount),
    learningCandidate: feed?.latest?.learningCandidate === true,
    operatorAcceptance: false,
    summary: evidence
      ? `${text(evidence.device, 'Spatial Workspace')} · ${text(evidence.phase, 'sample').toUpperCase()} · ${number(evidence.frame?.count)} frames · ${fps > 0 ? `${fps.toFixed(1)} fps` : 'fps pending'}`
      : state === 'unavailable'
        ? 'Spatial telemetry unavailable'
        : 'Spatial telemetry waiting for an immersive run',
  });
}

export function buildSpatialWorkspaceTelemetryLandingLinesV1(feedOrProjection = {}) {
  const projection = projectSpatialWorkspaceTelemetryForConsumersV1(feedOrProjection);
  if (!projection.available) {
    return Object.freeze([
      projection.summary,
      projection.state === 'unavailable'
        ? 'Shared Workspace telemetry route unavailable'
        : 'No provenance-bound immersive telemetry received yet',
    ]);
  }
  const actionCount = projection.input.selectCount + projection.input.squeezeCount;
  return Object.freeze([
    `Spatial telemetry ${projection.state} · ${projection.device}`,
    `${projection.frame.count} frames · ${projection.frame.estimatedFps > 0 ? `${projection.frame.estimatedFps.toFixed(1)} fps` : 'fps pending'} · pose ${projection.frame.poseFrames}`,
    `tracking losses ${projection.frame.trackingLossCount} · interactions ${actionCount} · run ${projection.runId || 'unknown'} · head ${shortHead(projection.sourceHead)}`,
  ]);
}
