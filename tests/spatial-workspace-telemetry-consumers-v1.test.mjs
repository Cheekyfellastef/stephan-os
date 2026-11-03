import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  SPATIAL_WORKSPACE_TELEMETRY_FEED_SCHEMA_V1,
  SPATIAL_WORKSPACE_TELEMETRY_SCHEMA_V1,
} from '../shared/vr/spatialWorkspaceTelemetryContractV1.mjs';
import {
  SPATIAL_WORKSPACE_TELEMETRY_CONSUMER_SCHEMA_V1,
  buildSpatialWorkspaceTelemetryLandingLinesV1,
  projectSpatialWorkspaceTelemetryForConsumersV1,
} from '../shared/vr/spatialWorkspaceTelemetryProjectionV1.mjs';
import {
  createVrResearchAgentWorkspaceRecords,
  planVrResearchAgentCycle,
} from '../shared/agents/vrResearchAgentV1.mjs';

const NOW = Date.parse('2026-10-01T10:00:00.000Z');
const HEAD = 'a'.repeat(40);

function feed() {
  return {
    schemaVersion: SPATIAL_WORKSPACE_TELEMETRY_FEED_SCHEMA_V1,
    readOnly: true,
    state: 'ready',
    latest: {
      eventId: 'spatial-vr-quest-consumer-proof-end-3',
      learningCandidate: true,
      evidence: {
        schemaVersion: SPATIAL_WORKSPACE_TELEMETRY_SCHEMA_V1,
        runId: 'quest-consumer-proof',
        phase: 'end',
        sequence: 3,
        observedAtUtc: '2026-10-01T09:59:00.000Z',
        sourceHead: HEAD,
        rendererSourceHead: HEAD,
        device: 'Quest/browser',
        room: 'holodeck-starting-chamber',
        frame: {
          count: 4320,
          poseFrames: 4318,
          missingPoseFrames: 2,
          trackingLossCount: 1,
          estimatedFps: 71.9,
          maxFrameMs: 29.1,
        },
        input: {
          sourceCountMax: 2,
          handTrackedSourceCountMax: 0,
          selectCount: 3,
          squeezeCount: 1,
        },
        errorCount: 0,
      },
    },
  };
}

function workspaceProjection() {
  return {
    updatedAt: '2026-10-01T09:58:00.000Z',
    currentTarget: 'Starfield VR',
    programmeStage: 'research-intelligence-buildout',
    researchQueue: [],
    discoveryCandidates: [],
    capabilityGraphCandidates: [],
    runtimeEvidenceRequests: [],
  };
}

test('one read-only Spatial telemetry projection preserves provenance without operator acceptance', () => {
  const projection = projectSpatialWorkspaceTelemetryForConsumersV1(feed());
  assert.equal(projection.schemaVersion, SPATIAL_WORKSPACE_TELEMETRY_CONSUMER_SCHEMA_V1);
  assert.equal(projection.readOnly, true);
  assert.equal(projection.state, 'ready');
  assert.equal(projection.runId, 'quest-consumer-proof');
  assert.equal(projection.sourceHead, HEAD);
  assert.equal(projection.rendererSourceHead, HEAD);
  assert.equal(projection.frame.count, 4320);
  assert.equal(projection.frame.poseFrames, 4318);
  assert.equal(projection.input.selectCount, 3);
  assert.equal(projection.learningCandidate, true);
  assert.equal(projection.operatorAcceptance, false);

  const lines = buildSpatialWorkspaceTelemetryLandingLinesV1(projection);
  assert.match(lines[0], /Spatial telemetry ready/);
  assert.match(lines[1], /4320 frames/);
  assert.match(lines[2], /run quest-consumer-proof/);
  assert.match(lines[2], /head aaaaaaaa/);
});

test('previously projected telemetry is revalidated and cannot smuggle operator acceptance', () => {
  const canonical = projectSpatialWorkspaceTelemetryForConsumersV1(feed());
  const forgedProjection = {
    ...canonical,
    operatorAcceptance: true,
    sourceHead: HEAD.toUpperCase(),
    frame: { ...canonical.frame, count: -99 },
  };

  const rebuilt = projectSpatialWorkspaceTelemetryForConsumersV1(forgedProjection);
  assert.notEqual(rebuilt, forgedProjection);
  assert.equal(rebuilt.schemaVersion, SPATIAL_WORKSPACE_TELEMETRY_CONSUMER_SCHEMA_V1);
  assert.equal(rebuilt.readOnly, true);
  assert.equal(rebuilt.runId, 'quest-consumer-proof');
  assert.equal(rebuilt.sourceHead, HEAD);
  assert.equal(rebuilt.frame.count, 0);
  assert.equal(rebuilt.operatorAcceptance, false);

  const cycle = planVrResearchAgentCycle({
    nowMs: NOW,
    workspaceProjection: {
      ...workspaceProjection(),
      spatialTelemetry: forgedProjection,
    },
    sourceRegistry: { schema_version: '1.6', sources: [] },
    availableSurfaces: { openClaw: false, battleBridge: true },
  });
  assert.equal(cycle.readModel.spatialTelemetry.operatorAcceptance, false);

  const records = createVrResearchAgentWorkspaceRecords({
    cycle,
    timestampUtc: '2026-10-01T10:00:00.000Z',
    correlationId: 'forged-spatial-projection-test',
    validationOptions: { nowMs: NOW },
  });
  assert.equal(JSON.parse(records.status.body).spatialTelemetryOperatorAcceptance, false);
});

test('VR Research Agent consumes the canonical Spatial telemetry projection read-only', () => {
  const cycle = planVrResearchAgentCycle({
    nowMs: NOW,
    workspaceProjection: workspaceProjection(),
    sourceRegistry: { schema_version: '1.6', sources: [] },
    spatialTelemetryFeed: feed(),
    availableSurfaces: { openClaw: false, battleBridge: true },
  });

  assert.equal(cycle.readModel.spatialTelemetry.runId, 'quest-consumer-proof');
  assert.equal(cycle.readModel.spatialTelemetry.sourceHead, HEAD);
  assert.equal(cycle.readModel.spatialTelemetry.operatorAcceptance, false);

  const records = createVrResearchAgentWorkspaceRecords({
    cycle,
    timestampUtc: '2026-10-01T10:00:00.000Z',
    correlationId: 'spatial-consumer-test',
    validationOptions: { nowMs: NOW },
  });
  const body = JSON.parse(records.status.body);
  assert.equal(body.spatialTelemetryState, 'ready');
  assert.equal(body.spatialTelemetryRunId, 'quest-consumer-proof');
  assert.equal(body.spatialTelemetrySourceHead, HEAD);
  assert.equal(body.spatialTelemetryOperatorAcceptance, false);
});

test('Spatial Bridge and VR Research landing tiles consume the Shared Workspace telemetry feed', async () => {
  const source = await readFile(new URL('../modules/command-deck/command-deck.js', import.meta.url), 'utf8');
  assert.match(source, /SPATIAL_WORKSPACE_TELEMETRY_FEED_ROUTE/);
  assert.match(source, /requestStephanosBackend/);
  assert.match(source, /SPATIAL_TELEMETRY_TILE_IDS = new Set\(\['spatial-bridge', 'vr-research-lab'\]\)/);
  assert.match(source, /buildSpatialWorkspaceTelemetryLandingLinesV1/);
  assert.match(source, /spatialTelemetryLandingProjection/);
  assert.match(source, /spatialTelemetryLifecycleGeneration/);
  assert.match(source, /generation !== spatialTelemetryLifecycleGeneration/);
  assert.match(source, /spatialTelemetryActive = false/);
  assert.match(source, /spatialTelemetryRefreshInFlight === request/);
});
