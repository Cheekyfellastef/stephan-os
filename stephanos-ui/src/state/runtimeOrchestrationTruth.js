import { buildMissionPacketKey } from './missionPacketWorkflow.js';

const MEMORY_LIMITS = Object.freeze({
  continuity: 4,
  proposals: 4,
  elevatedMemory: 4,
  frictionThemes: 4,
});

const MISSION_LIFECYCLE = Object.freeze([
  'not-executing',
  'proposed',
  'awaiting-approval',
  'accepted',
  'execution-ready',
  'in-progress',
  'completed',
  'failed',
  'rollback-recommended',
  'rolled-back',
]);

function asText(value, fallback = '') {
  const next = String(value ?? '').trim();
  return next || fallback;
}

function asList(value, limit = 5) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? asText(entry) : asText(entry?.summary || entry?.title || entry?.moveTitle || entry?.moveId)))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeLifecycle(value, fallback = 'proposed') {
  const normalized = asText(value, fallback).toLowerCase();
  return MISSION_LIFECYCLE.includes(normalized) ? normalized : fallback;
}

function resolveExecutionState(lastExecutionMetadata = {}) {
  if (lastExecutionMetadata?.provider_answered === false) return 'failed';
  if (lastExecutionMetadata?.actual_provider_used) return 'completed';
  return 'not-executing';
}

export function buildCanonicalMemoryContext({
  continuitySnapshot = {},
  missionPacketWorkflow = {},
  memoryElevation = {},
  surfaceAwareness = {},
  surfaceFrictionPatterns = [],
} = {}) {
  const continuityEvents = Array.isArray(continuitySnapshot?.recentContinuityEvents)
    ? continuitySnapshot.recentContinuityEvents
    : [];
  const recentAccepted = asList(missionPacketWorkflow?.activity, MEMORY_LIMITS.proposals)
    .filter((line) => /accept|promoted|completed/i.test(line));
  const recentProposed = asList(missionPacketWorkflow?.proposalQueue, MEMORY_LIMITS.proposals);
  const influencers = Array.isArray(memoryElevation?.top_memory_influencers)
    ? memoryElevation.top_memory_influencers
    : [];

  const elevatedMemory = influencers
    .slice(0, MEMORY_LIMITS.elevatedMemory)
    .map((item) => `${asText(item.memoryClass, 'unknown-class')}: ${asText(item.summary, 'unknown')}`)
    .filter(Boolean);

  const frictionThemes = asList(
    Array.isArray(surfaceFrictionPatterns) && surfaceFrictionPatterns.length > 0
      ? surfaceFrictionPatterns.map((pattern) => `${asText(pattern.frictionType, 'unknown')} (${asText(pattern.patternStrength, 'unknown')})`)
      : surfaceAwareness?.frictionPatterns,
    MEMORY_LIMITS.frictionThemes,
  );

  return {
    memoryTruthVersion: 'runtime-memory-context.v1',
    activeMissionContinuity: {
      continuityLoopState: asText(continuitySnapshot?.continuityLoopState, 'unknown'),
      aiContinuityMode: asText(continuitySnapshot?.aiContinuityMode, 'unknown'),
      recentEvents: continuityEvents
        .slice(0, MEMORY_LIMITS.continuity)
        .map((event) => asText(event?.summary, 'event summary unavailable')),
      lastEventAt: asText(continuitySnapshot?.lastContinuityEventAt, 'not-yet-established'),
    },
    recentAcceptedWork: recentAccepted.length > 0 ? recentAccepted : ['none'],
    recentProposedWork: recentProposed.length > 0 ? recentProposed : ['none'],
    elevatedMemory: elevatedMemory.length > 0 ? elevatedMemory : ['unknown / not yet established'],
    currentSurfaceRelevance: {
      deviceClass: asText(surfaceAwareness?.surfaceIdentity?.deviceClass, 'unknown'),
      selectedProfileId: asText(surfaceAwareness?.effectiveSurfaceExperience?.selectedProfileId, 'unknown'),
      resolvedInputMode: asText(surfaceAwareness?.effectiveSurfaceExperience?.resolvedInputMode, 'unknown'),
      routingBiasHint: asText(surfaceAwareness?.effectiveSurfaceExperience?.resolvedRoutingBiasHint, 'none'),
    },
    recentFrictionThemes: frictionThemes.length > 0 ? frictionThemes : ['none / not yet observed'],
    sparseData: continuityEvents.length === 0 && elevatedMemory.length === 0,
  };
}

export function buildCanonicalCurrentIntent({
  intent = {},
  missionPacket = {},
  proposal = {},
  execution = {},
} = {}) {
  const explicitIntent = intent?.intentDetected === true;
  const inferredIntent = !explicitIntent && asText(intent?.intentType) && asText(intent?.intentType) !== 'unknown';

  return {
    intentTruthVersion: 'runtime-current-intent.v1',
    operatorIntent: {
      label: asText(intent?.intentType, 'unknown'),
      source: explicitIntent ? 'explicit' : (inferredIntent ? 'inferred' : 'unknown'),
      confidence: Number.isFinite(Number(intent?.confidence)) ? Number(intent.confidence) : 0,
      reason: asText(intent?.reason, explicitIntent ? 'explicit operator request observed' : 'operator intent not yet established'),
    },
    missionPacketState: {
      status: normalizeLifecycle(missionPacket?.status, missionPacket?.active ? 'awaiting-approval' : 'proposed'),
      approvalRequired: missionPacket?.approvalRequired !== false,
      executionEligible: missionPacket?.executionEligible === true,
      title: asText(missionPacket?.title || missionPacket?.moveTitle, 'not yet established'),
    },
    proposalState: {
      status: normalizeLifecycle(proposal?.status, proposal?.active ? 'proposed' : 'proposed'),
      proposalActive: proposal?.active === true,
      moveId: asText(proposal?.moveId, 'none'),
      truthWarnings: asList(proposal?.warnings, 4),
    },
    executionState: {
      status: normalizeLifecycle(execution?.status, resolveExecutionState(execution?.lastExecutionMetadata || execution)),
      actualProvider: asText(execution?.actualProvider || execution?.lastExecutionMetadata?.actual_provider_used, 'none'),
      note: asText(execution?.note, 'execution status bounded to observed runtime metadata'),
    },
  };
}

export function buildCanonicalMissionPacket({
  missionPacketTruth = {},
  missionPacketWorkflow = {},
  currentIntent = {},
} = {}) {
  const latestDecision = Array.isArray(missionPacketWorkflow?.decisions) ? missionPacketWorkflow.decisions[0] : null;
  const decision = asText(latestDecision?.decision, 'pending-review');
  const status = decision === 'accept'
    ? 'execution-ready'
    : decision === 'reject'
      ? 'failed'
      : decision === 'defer'
        ? 'awaiting-approval'
        : (missionPacketTruth?.active ? 'awaiting-approval' : 'proposed');

  return {
    missionPacketTruthVersion: 'runtime-mission-packet.v1',
    packetKey: buildMissionPacketKey(missionPacketTruth),
    missionTitle: asText(missionPacketTruth?.moveTitle, 'not yet established'),
    missionSummary: asText(missionPacketTruth?.rationale, 'not yet established'),
    objective: asText(currentIntent?.operatorIntent?.label, 'not yet established'),
    currentPhase: status,
    blockers: asList(missionPacketTruth?.blockers, 5),
    recommendedNextAction: asText(missionPacketTruth?.executionEligible ? 'Prepare execution handoff' : 'Await explicit operator approval', 'not yet established'),
    continuityNotes: asList(missionPacketTruth?.evidence, 5),
    approvalExecutionStatus: {
      requested: 'proposed',
      proposed: missionPacketTruth?.active === true ? 'yes' : 'no',
      accepted: decision === 'accept' ? 'yes' : 'no',
      executing: missionPacketTruth?.executionEligible === true ? 'possible-after-approval' : 'no',
      completed: 'no-automatic-completion-claim',
      lifecycleStatus: normalizeLifecycle(status, 'proposed'),
    },
  };
}
