import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ensureSharedWorkspaceLayout } from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  sanitizeSpatialWorkspaceTelemetryV1,
  SPATIAL_WORKSPACE_TELEMETRY_SCHEMA_V1,
  spatialTelemetryHasPhysicalInteractionProof,
  spatialTelemetryHasRuntimeProof,
} from '../shared/vr/spatialWorkspaceTelemetryContractV1.mjs';
import {
  publishSpatialWorkspaceTelemetry,
  readSpatialWorkspaceTelemetryFeed,
} from '../stephanos-server/services/spatialWorkspaceTelemetryService.js';
import { readVrCapabilityFeed } from '../stephanos-server/services/vrCapabilityFeedService.js';

const REPO_ROOT = process.cwd();
const NOW = Date.parse('2026-09-28T18:30:00+01:00');
const OBSERVED = new Date(NOW).toISOString();

function telemetryPacket(overrides = {}) {
  return {
    schemaVersion: SPATIAL_WORKSPACE_TELEMETRY_SCHEMA_V1,
    runId: 'quest-proof-001',
    phase: 'end',
    sequence: 3,
    observedAtUtc: OBSERVED,
    sourceHead: 'a'.repeat(40),
    device: 'Quest/browser',
    route: 'Stephanos Spatial Workspace / WebXR',
    room: 'holodeck-starting-chamber',
    durationMs: 120000,
    frame: {
      count: 7200,
      poseFrames: 7188,
      missingPoseFrames: 12,
      trackingLossCount: 1,
      averageFrameMs: 13.9,
      maxFrameMs: 58.4,
      estimatedFps: 71.9,
      maxViewCount: 2,
    },
    input: {
      sourceCountMax: 2,
      handTrackedSourceCountMax: 0,
      inputSourceChangeCount: 1,
      selectCount: 4,
      squeezeCount: 2,
    },
    webxr: {
      immersiveSupported: true,
      referenceSpace: 'local-floor',
    },
    errors: [],
    ...overrides,
  };
}

test('Spatial telemetry sanitizes bounded aggregate evidence without raw pose data', () => {
  const packet = sanitizeSpatialWorkspaceTelemetryV1(telemetryPacket());
  assert.equal(packet.runId, 'quest-proof-001');
  assert.equal(packet.frame.poseFrames, 7188);
  assert.equal(packet.frame.maxViewCount, 2);
  assert.equal(packet.input.selectCount, 4);
  assert.equal(Object.hasOwn(packet.frame, 'position'), false);
  assert.equal(Object.hasOwn(packet.frame, 'orientation'), false);
  assert.equal(spatialTelemetryHasRuntimeProof(packet), true);
  assert.equal(spatialTelemetryHasPhysicalInteractionProof(packet), true);
});

test('Spatial telemetry publishes to Shared Workspace, Flywheel, VR Lab feed, and Atlas proofs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-spatial-telemetry-'));
  try {
    const layout = await ensureSharedWorkspaceLayout({ root, repoRoot: REPO_ROOT });
    assert.equal(layout.ok, true);
    const env = { STEPHANOS_SHARED_AGENT_WORKSPACE: root };

    const result = await publishSpatialWorkspaceTelemetry({
      env,
      repoRoot: REPO_ROOT,
      nowMs: NOW,
      payload: telemetryPacket(),
    });
    assert.equal(result.ok, true);
    assert.match(result.eventId, /^spatial-vr-quest-proof-001-end-/);
    assert.ok(result.proofRefs.includes('proofs/vr-capability/spatial-bridge/implementation'));
    assert.ok(result.proofRefs.includes('proofs/vr-capability/spatial-bridge/runtimeProof'));
    assert.ok(result.proofRefs.includes('proofs/vr-capability/embodied-exploration/runtimeProof'));
    assert.ok(result.proofRefs.includes('proofs/vr-capability/physical-interaction/runtimeProof'));
    assert.equal(result.proofRefs.some((ref) => ref.endsWith('/operatorAcceptance')), false);

    const feed = await readSpatialWorkspaceTelemetryFeed({
      env,
      repoRoot: REPO_ROOT,
      nowMs: NOW + 1000,
    });
    assert.equal(feed.state, 'ready');
    assert.equal(feed.latest.evidence.runId, 'quest-proof-001');
    assert.equal(feed.latest.evidence.device, 'Quest/browser');
    assert.equal(feed.latest.evidence.frame.trackingLossCount, 1);
    assert.equal(feed.latest.evidence.input.selectCount, 4);
    assert.equal(feed.latest.learningCandidate, true);

    const atlas = await readVrCapabilityFeed({
      env,
      repoRoot: REPO_ROOT,
      nowMs: NOW + 1000,
    });
    const byId = new Map(atlas.ledger.capabilities.map((entry) => [entry.id, entry]));
    assert.equal(byId.get('spatial-bridge').stages.implementation.status, 'proven');
    assert.equal(byId.get('spatial-bridge').stages.runtimeProof.status, 'proven');
    assert.equal(byId.get('spatial-bridge').stages.operatorAcceptance.status, 'pending');
    assert.equal(byId.get('embodied-exploration').stages.runtimeProof.status, 'proven');
    assert.equal(byId.get('physical-interaction').stages.runtimeProof.status, 'proven');

    const lessons = await readdir(join(root, 'lessons'));
    assert.ok(lessons.some((name) => name.startsWith('vr-spatial-quest-proof-001-quality')));
    const lessonName = lessons.find((name) => name.startsWith('vr-spatial-quest-proof-001-quality'));
    const lesson = JSON.parse(await readFile(join(root, 'lessons', lessonName), 'utf8'));
    assert.equal(lesson.participantId, 'spatial-workspace');
    assert.equal(lesson.engineeringRecord.privacyAndSensitivity, 'INTERNAL_BOUNDED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Spatial runtime proof remains withheld when immersive pose evidence is insufficient', () => {
  const packet = sanitizeSpatialWorkspaceTelemetryV1(telemetryPacket({
    frame: {
      count: 10,
      poseFrames: 2,
      missingPoseFrames: 8,
      trackingLossCount: 1,
      averageFrameMs: 20,
      maxFrameMs: 60,
      estimatedFps: 50,
      maxViewCount: 2,
    },
    input: {
      sourceCountMax: 1,
      handTrackedSourceCountMax: 0,
      inputSourceChangeCount: 0,
      selectCount: 1,
      squeezeCount: 0,
    },
  }));
  assert.equal(spatialTelemetryHasRuntimeProof(packet), false);
  assert.equal(spatialTelemetryHasPhysicalInteractionProof(packet), false);
});


test('Spatial telemetry wiring stays connected across Quest, backend, VR Lab, and Atlas', async () => {
  const [questEntry, recorder, contract, routes, labHtml, labFeed, atlasClient, appManifest] = await Promise.all([
    readFile(join(REPO_ROOT, 'apps/spatial-bridge/quest-entry.html'), 'utf8'),
    readFile(join(REPO_ROOT, 'apps/spatial-bridge/spatial-telemetry-client.mjs'), 'utf8'),
    readFile(join(REPO_ROOT, 'shared/vr/spatialWorkspaceTelemetryContractV1.mjs'), 'utf8'),
    readFile(join(REPO_ROOT, 'stephanos-server/routes/shared-workspace.js'), 'utf8'),
    readFile(join(REPO_ROOT, 'apps/vr-research-lab/index.html'), 'utf8'),
    readFile(join(REPO_ROOT, 'apps/vr-research-lab/spatial-workspace-telemetry-feed.js'), 'utf8'),
    readFile(join(REPO_ROOT, 'apps/vr-capability-atlas/atlas-live-capability-feed.mjs'), 'utf8'),
    readFile(join(REPO_ROOT, 'apps/spatial-bridge/app.json'), 'utf8'),
  ]);
  assert.match(questEntry, /spatial-telemetry-client\.mjs/);
  assert.match(questEntry, /telemetry-status/);
  assert.match(questEntry, /recordFrame/);
  assert.match(recorder, /SPATIAL_WORKSPACE_TELEMETRY_ROUTE/);
  assert.match(contract, /\/api\/shared-workspace\/spatial-telemetry/);
  assert.match(contract, /\/api\/shared-workspace\/spatial-telemetry-feed/);
  assert.match(recorder, /inputsourceschange/);
  assert.match(recorder, /selectCount/);
  assert.match(recorder, /squeezeCount/);
  assert.match(routes, /\/spatial-telemetry/);
  assert.match(routes, /\/spatial-telemetry-feed/);
  assert.match(labHtml, /spatial-workspace-telemetry-feed\.js/);
  assert.match(labFeed, /SPATIAL_WORKSPACE_TELEMETRY_FEED_ROUTE/);
  assert.match(atlasClient, /\/api\/shared-workspace\/vr-capability-feed/);
  const manifest = JSON.parse(appManifest);
  assert.ok(manifest.capabilities.includes('shared-workspace-vr-telemetry-v1'));
  assert.ok(manifest.capabilities.includes('vr-lab-live-telemetry-feed'));
  assert.ok(manifest.capabilities.includes('vr-atlas-capability-proof-publisher'));
});
