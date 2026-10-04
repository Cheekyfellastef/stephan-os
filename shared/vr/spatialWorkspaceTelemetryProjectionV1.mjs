import {
  SPATIAL_WORKSPACE_TELEMETRY_FEED_SCHEMA_V1,
  SPATIAL_WORKSPACE_TELEMETRY_SCHEMA_V1,
} from './spatialWorkspaceTelemetryContractV1.mjs';

export const SPATIAL_WORKSPACE_TELEMETRY_CONSUMER_SCHEMA_V1 =
  'stephanos.spatial-workspace-telemetry-consumer.v1';

const SHA40 = /^[0-9a-f]{40}$/i;
const SAFE_STATES = new Set(['ready', 'stale', 'waiting', 'unavailable']);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const output = String(value).trim();
  return output || fallback;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function head(value) {
  const candidate = text(value).toLowerCase();
  return SHA40.test(candidate) ? candidate : '';
}

function shortHead(value) {
  const valueHead = head(value);
  return valueHead ? valueHead.slice(0, 8) : 'unknown';
}

function state(value, fallback = 'waiting') {
  const candidate = text(value, fallback).toLowerCase();
  return SAFE_STATES.has(candidate) ? candidate : fallback;
}

function sourceRecord(input = {}) {
  const canonicalFeed = input?.schemaVersion === SPATIAL_WORKSPACE_TELEMETRY_FEED_SCHEMA_V1
    && input?.readOnly === true;
  const canonicalEvidence = canonicalFeed
    && input?.latest?.evidence?.schemaVersion === SPATIAL_WORKSPACE_TELEMETRY_SCHEMA_V1
    ? input.latest.evidence
    : null;
  if (canonicalEvidence) {
    return {
      kind: 'canonical-feed',
      evidence: canonicalEvidence,
      feedState: state(input.state, 'ready'),
      learningCandidate: input?.latest?.learningCandidate === true,
      sourceSchemaVersion: input.schemaVersion,
    };
  }

  const boundedProjection = input?.schemaVersion === SPATIAL_WORKSPACE_TELEMETRY_CONSUMER_SCHEMA_V1
    && input?.readOnly === true;
  if (boundedProjection && input?.available === true) {
    return {
      kind: 'consumer-projection',
      evidence: input,
      feedState: state(input.state, 'ready'),
      learningCandidate: input?.learningCandidate === true,
      sourceSchemaVersion: text(input.sourceSchemaVersion),
    };
  }

  return {
    kind: canonicalFeed ? 'canonical-feed-empty' : 'invalid-or-empty',
    evidence: null,
    feedState: state(input?.state, canonicalFeed ? 'waiting' : 'unavailable'),
    learningCandidate: false,
    sourceSchemaVersion: canonicalFeed ? input.schemaVersion : '',
  };
}

export function projectSpatialWorkspaceTelemetryForConsumersV1(input = {}) {
  const source = sourceRecord(input);
  const evidence = source.evidence;
  const projectedState = evidence
    ? (source.feedState === 'stale' ? 'stale' : 'ready')
    : (source.feedState === 'unavailable' ? 'unavailable' : 'waiting');
  const fps = number(evidence?.frame?.estimatedFps);

  return Object.freeze({
    schemaVersion: SPATIAL_WORKSPACE_TELEMETRY_CONSUMER_SCHEMA_V1,
    readOnly: true,
    sourceSchemaVersion: source.sourceSchemaVersion,
    sourceKind: source.kind,
    state: projectedState,
    available: Boolean(evidence),
    runId: text(evidence?.runId).slice(0, 81),
    phase: text(evidence?.phase, 'unknown').slice(0, 24),
    observedAtUtc: text(evidence?.observedAtUtc).slice(0, 40),
    sourceHead: head(evidence?.sourceHead),
    rendererSourceHead: head(evidence?.rendererSourceHead),
    device: text(evidence?.device, 'Spatial Workspace').slice(0, 80),
    room: text(evidence?.room, 'holodeck-starting-chamber').slice(0, 80),
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
    learningCandidate: source.learningCandidate,
    operatorAcceptance: false,
    summary: evidence
      ? `${text(evidence.device, 'Spatial Workspace').slice(0, 80)} · ${text(evidence.phase, 'sample').slice(0, 24).toUpperCase()} · ${number(evidence.frame?.count)} frames · ${fps > 0 ? `${fps.toFixed(1)} fps` : 'fps pending'}`
      : projectedState === 'unavailable'
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
