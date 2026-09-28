import {
  createSharedWorkspaceEventRecord,
  writeAtomicJson,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  readSharedWorkspaceRecordDirectory,
} from '../../shared/agents/shared-workspace-dashboard-feed.mjs';
import {
  validateExistingSharedWorkspaceRuntimeConfig,
} from '../../shared/agents/sharedWorkspaceRuntimeConfig.mjs';
import {
  promoteSharedWorkspaceLearningCandidatesV1,
} from '../../shared/agents/flywheelLearningFabricV1.mjs';
import {
  publishVrCapabilityEvidence,
} from '../../shared/agents/vrCapabilityEvidencePublisherV1.mjs';
import {
  SPATIAL_WORKSPACE_TELEMETRY_FEED_SCHEMA_V1,
  SPATIAL_WORKSPACE_TELEMETRY_SCHEMA_V1,
  sanitizeSpatialWorkspaceTelemetryV1,
  spatialTelemetryHasPhysicalInteractionProof,
  spatialTelemetryHasRuntimeProof,
  spatialTelemetryNeedsLearning,
} from '../../shared/vr/spatialWorkspaceTelemetryContractV1.mjs';

export const SPATIAL_WORKSPACE_EVENT_KIND_V1 = 'spatial-vr-telemetry';
export const DEFAULT_SPATIAL_TELEMETRY_STALE_AFTER_MS = 60 * 60 * 1000;

function text(value, fallback = '') {
  const out = value === null || value === undefined ? '' : String(value).trim();
  return out || fallback;
}

function compactEvidence(packet = {}) {
  return Object.freeze({
    schemaVersion: SPATIAL_WORKSPACE_TELEMETRY_SCHEMA_V1,
    runId: packet.runId,
    phase: packet.phase,
    sequence: packet.sequence,
    observedAtUtc: packet.observedAtUtc,
    sourceHead: packet.sourceHead,
    device: packet.device,
    route: packet.route,
    room: packet.room,
    durationMs: packet.durationMs,
    frame: packet.frame,
    input: packet.input,
    webxr: packet.webxr,
    errorCount: Array.isArray(packet.errors) ? packet.errors.length : 0,
  });
}

function learningCandidate(packet) {
  if (!spatialTelemetryNeedsLearning(packet)) return null;
  const lessonId = `vr-spatial-${packet.runId}-quality`;
  const trackingLossCount = Number(packet.frame?.trackingLossCount) || 0;
  const maxFrameMs = Number(packet.frame?.maxFrameMs) || 0;
  const errorCount = Array.isArray(packet.errors) ? packet.errors.length : 0;
  return Object.freeze({
    lessonId,
    recordKey: lessonId,
    recordClass: 'ENGINEERING_INCIDENT',
    problemClass: 'spatial-workspace-runtime-quality',
    componentAndOwnerRefs: Object.freeze([
      'apps/spatial-bridge/holodeck-baseline-v0.mjs',
      'apps/spatial-bridge/holodeck-room-v1.mjs',
      'apps/spatial-bridge/spatial-telemetry-client.mjs',
    ]),
    symptom: `Spatial Workspace run recorded ${trackingLossCount} tracking losses, max frame time ${maxFrameMs.toFixed(2)} ms, and ${errorCount} bounded runtime errors.`,
    rootCause: null,
    repairOrMethod: null,
    prerequisites: Object.freeze([
      'Preserve exact-head Battle Bridge runtime proof.',
      'Use real WebXR headset evidence rather than desktop-only simulation.',
    ]),
    forbiddenShortcuts: Object.freeze([
      'Do not infer physical headset quality from the flat preview.',
      'Do not promote operator acceptance automatically from telemetry.',
    ]),
    failureModes: Object.freeze([
      'Viewer pose unavailable during an immersive frame',
      'Frame pacing spike above the bounded quality threshold',
      'Bounded WebXR runtime error',
    ]),
    counterexamples: Object.freeze([
      'A room can render on a desktop preview while immersive tracking remains unproven.',
    ]),
    testAndProofRefs: Object.freeze(['proofs/vr-capability/spatial-bridge/runtimeProof']),
    runtimeEvidenceRefs: Object.freeze(['proofs/vr-capability/spatial-bridge/runtimeProof']),
    confidenceBasis: 'Direct bounded WebXR runtime telemetry from the Spatial Workspace starting chamber.',
    freshness: 'CURRENT',
    applicableDomains: Object.freeze(['vr/spatial-workspace', 'webxr/runtime', 'quest/vr']),
    privacyAndSensitivity: 'INTERNAL_BOUNDED',
    status: 'CURRENT',
  });
}

async function publishCapabilityProofs(root, packet, options = {}) {
  if (!spatialTelemetryHasRuntimeProof(packet)) return Object.freeze([]);
  const common = {
    root,
    repoRoot: options.repoRoot,
    timestampUtc: packet.observedAtUtc,
    participantId: 'spatial-workspace',
    relatedIssue: '#1597',
    sourceHead: packet.sourceHead,
  };
  const items = [
    ['spatial-bridge', 'implementation', 'Spatial Workspace implementation executed in an immersive WebXR run.'],
    ['spatial-bridge', 'runtimeProof', 'Spatial Workspace produced bounded immersive WebXR frames with viewer-pose evidence.'],
    ['embodied-exploration', 'implementation', 'Spatial Workspace embodiment path executed with viewer-pose tracking.'],
    ['embodied-exploration', 'runtimeProof', 'Viewer-pose telemetry was observed in the immersive Spatial Workspace runtime.'],
  ];
  if (spatialTelemetryHasPhysicalInteractionProof(packet)) {
    items.push(
      ['physical-interaction', 'implementation', 'Spatial Workspace input event plumbing executed in the immersive runtime.'],
      ['physical-interaction', 'runtimeProof', 'Select or squeeze input was observed during the immersive Spatial Workspace run.'],
    );
  }

  const published = [];
  for (const [capabilityId, stage, note] of items) {
    const proofId = `spatial-${packet.runId}-${capabilityId}-${stage.toLowerCase()}`;
    const result = await publishVrCapabilityEvidence(root, {
      capabilityId,
      stage,
      proofId,
      timestampUtc: common.timestampUtc,
      participantId: common.participantId,
      relatedIssue: common.relatedIssue,
      passed: true,
      summary: note,
      note: packet.sourceHead ? `${note} Exact source head ${packet.sourceHead}.` : note,
      refs: [`spatial-run-${packet.runId}`],
    }, { repoRoot: options.repoRoot, nowMs: options.nowMs });
    if (!result.ok) throw new Error(`SPATIAL_CAPABILITY_PROOF_FAILED:${capabilityId}:${stage}:${result.reason}`);
    published.push(result.record.proofRefs[0]);
  }
  return Object.freeze(published);
}

export async function publishSpatialWorkspaceTelemetry({
  env = process.env,
  repoRoot = process.cwd(),
  nowMs = Date.now(),
  payload = {},
} = {}) {
  const packet = sanitizeSpatialWorkspaceTelemetryV1(payload);
  const runtime = await validateExistingSharedWorkspaceRuntimeConfig({ env, repoRoot });
  if (!runtime.ok) {
    return Object.freeze({
      ok: false,
      reason: runtime.reason || 'SHARED_WORKSPACE_UNAVAILABLE',
      eventId: '',
      proofRefs: Object.freeze([]),
      flywheel: null,
    });
  }

  const eventId = `spatial-vr-${packet.runId}-${packet.phase}-${packet.sequence}`;
  const candidate = learningCandidate(packet);
  const event = {
    ...createSharedWorkspaceEventRecord({
      eventId,
      participantId: 'spatial-workspace',
      timestampUtc: packet.observedAtUtc,
      eventKind: SPATIAL_WORKSPACE_EVENT_KIND_V1,
      summary: `Spatial Workspace ${packet.phase} evidence: ${packet.frame.count} frames, ${packet.frame.trackingLossCount} tracking losses, ${packet.input.selectCount + packet.input.squeezeCount} interaction events.`,
      ...(candidate ? { learningCandidate: candidate } : {}),
    }),
    spatialEvidence: compactEvidence(packet),
  };

  const eventWrite = await writeAtomicJson(
    runtime.root,
    ['events', `${eventId}.json`],
    event,
    { repoRoot, nowMs, staleAfterMs: 24 * 60 * 60 * 1000 },
  );
  if (!eventWrite.ok) {
    return Object.freeze({
      ok: false,
      reason: eventWrite.reason,
      eventId,
      proofRefs: Object.freeze([]),
      flywheel: null,
    });
  }

  const proofRefs = await publishCapabilityProofs(runtime.root, packet, { repoRoot, nowMs });
  const flywheel = candidate
    ? await promoteSharedWorkspaceLearningCandidatesV1({ root: runtime.root, env, repoRoot, nowMs, maxPromotions: 4 })
    : null;

  return Object.freeze({
    ok: true,
    reason: 'SPATIAL_WORKSPACE_TELEMETRY_PUBLISHED',
    eventId,
    proofRefs,
    flywheel,
    workspace: Object.freeze({
      live: true,
      safeWorkspaceRoot: runtime.safeDisplayPath || 'SHARED_WORKSPACE',
    }),
  });
}

function timestampMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function readSpatialWorkspaceTelemetryFeed({
  env = process.env,
  repoRoot = process.cwd(),
  nowMs = Date.now(),
  staleAfterMs = DEFAULT_SPATIAL_TELEMETRY_STALE_AFTER_MS,
  limit = 40,
} = {}) {
  const runtime = await validateExistingSharedWorkspaceRuntimeConfig({ env, repoRoot });
  if (!runtime.ok) {
    return Object.freeze({
      schemaVersion: SPATIAL_WORKSPACE_TELEMETRY_FEED_SCHEMA_V1,
      readOnly: true,
      state: 'unavailable',
      reason: runtime.reason || 'SHARED_WORKSPACE_UNAVAILABLE',
      latest: null,
      history: Object.freeze([]),
      workspace: Object.freeze({ live: false, safeWorkspaceRoot: runtime.safeDisplayPath || 'UNKNOWN' }),
    });
  }

  const result = await readSharedWorkspaceRecordDirectory(runtime.root, 'events', { repoRoot, nowMs, staleAfterMs: 24 * 60 * 60 * 1000 });
  const history = result.records
    .filter((record) => record?.eventKind === SPATIAL_WORKSPACE_EVENT_KIND_V1 && record?.spatialEvidence?.schemaVersion === SPATIAL_WORKSPACE_TELEMETRY_SCHEMA_V1)
    .sort((left, right) => timestampMs(right.timestampUtc) - timestampMs(left.timestampUtc))
    .slice(0, Math.max(1, Math.min(200, Number(limit) || 40)))
    .map((record) => Object.freeze({
      eventId: record.eventId,
      timestampUtc: record.timestampUtc,
      summary: record.summary,
      evidence: Object.freeze({ ...record.spatialEvidence }),
      learningCandidate: Boolean(record.learningCandidate),
    }));
  const latest = history[0] || null;
  const ageMs = latest ? Math.max(0, nowMs - timestampMs(latest.timestampUtc)) : null;
  const state = !latest ? 'ready' : ageMs <= staleAfterMs ? 'ready' : 'stale';

  return Object.freeze({
    schemaVersion: SPATIAL_WORKSPACE_TELEMETRY_FEED_SCHEMA_V1,
    readOnly: true,
    state,
    reason: !latest ? 'NO_SPATIAL_TELEMETRY_YET' : state === 'ready' ? 'SPATIAL_TELEMETRY_READY' : 'SPATIAL_TELEMETRY_STALE',
    latest,
    history: Object.freeze(history),
    workspace: Object.freeze({ live: true, safeWorkspaceRoot: runtime.safeDisplayPath || 'SHARED_WORKSPACE' }),
    errors: Object.freeze(result.errors || []),
  });
}
