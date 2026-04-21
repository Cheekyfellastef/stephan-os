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

function normalizeTruthText(value, fallback = '') {
  const next = String(value ?? '').trim();
  return next || fallback;
}

function toNullableTruthText(value) {
  const next = normalizeTruthText(value, '');
  return next || null;
}

function normalizeBlockingSeverity(value) {
  const normalized = normalizeTruthText(value, '').toLowerCase();
  if (['none', 'caution', 'warning', 'blocking'].includes(normalized)) {
    return normalized;
  }
  return 'none';
}

export function adjudicateCanonicalBuildTruth({
  runtimeBuild = {},
  servedBuild = {},
} = {}) {
  const runtime = runtimeBuild && typeof runtimeBuild === 'object' ? runtimeBuild : {};
  const served = servedBuild && typeof servedBuild === 'object' ? servedBuild : {};
  const runtimeTruth = {
    gitCommit: toNullableTruthText(runtime.gitCommit),
    runtimeMarker: toNullableTruthText(runtime.runtimeMarker),
    buildTimestamp: toNullableTruthText(runtime.buildTimestamp),
    sourceFingerprint: toNullableTruthText(runtime.sourceFingerprint),
  };
  const servedTruth = {
    gitCommit: toNullableTruthText(served.gitCommit),
    runtimeMarker: toNullableTruthText(served.runtimeMarker),
    buildTimestamp: toNullableTruthText(served.buildTimestamp),
    sourceFingerprint: toNullableTruthText(served.sourceFingerprint),
  };

  const servedTruthAvailable = Boolean(
    servedTruth.gitCommit
    || servedTruth.runtimeMarker
    || servedTruth.buildTimestamp
    || servedTruth.sourceFingerprint,
  );

  if (!servedTruthAvailable) {
    return {
      status: 'indeterminate',
      reason: 'Served published build truth is unavailable from this surface.',
      operatorLabel: 'Build certainty unavailable',
      evidence: {
        served: servedTruth,
        runtime: runtimeTruth,
      },
    };
  }

  const comparableFields = ['gitCommit', 'runtimeMarker', 'buildTimestamp', 'sourceFingerprint']
    .filter((key) => Boolean(servedTruth[key]) && Boolean(runtimeTruth[key]));
  const mismatches = comparableFields
    .filter((key) => servedTruth[key] !== runtimeTruth[key]);

  if (comparableFields.length === 0) {
    return {
      status: 'indeterminate',
      reason: 'Build certainty unavailable because served/runtime build fields do not overlap yet.',
      operatorLabel: 'Build certainty unavailable',
      evidence: {
        served: servedTruth,
        runtime: runtimeTruth,
      },
    };
  }

  if (mismatches.length > 0) {
    return {
      status: 'stale',
      reason: `Runtime build differs from published served build (${mismatches.join(', ')})`,
      operatorLabel: 'This surface is stale',
      evidence: {
        comparableFields,
        mismatches,
        served: servedTruth,
        runtime: runtimeTruth,
      },
    };
  }

  return {
    status: 'match',
    reason: 'Runtime build matches published served build truth.',
    operatorLabel: 'Current build confirmed',
    evidence: {
      comparableFields,
      served: servedTruth,
      runtime: runtimeTruth,
    },
  };
}

export function buildCanonicalSourceDistAlignment({
  sourceFingerprint = '',
  buildRuntimeMarker = '',
  buildCommit = '',
  buildTimestamp = '',
  runtimeTruth = {},
  runtimeContext = {},
} = {}) {
  const source = toNullableTruthText(sourceFingerprint);
  const buildMarker = toNullableTruthText(buildRuntimeMarker);
  const commit = toNullableTruthText(buildCommit);
  const timestamp = toNullableTruthText(buildTimestamp);
  const truth = runtimeTruth && typeof runtimeTruth === 'object' ? runtimeTruth : {};
  const context = runtimeContext && typeof runtimeContext === 'object' ? runtimeContext : {};
  const parityKnown = typeof truth.sourceDistParityOk === 'boolean';
  const parityState = parityKnown ? truth.sourceDistParityOk : null;
  const servedMarker = toNullableTruthText(truth.servedMarker || context.servedMarker);
  const servedBuildTimestamp = toNullableTruthText(truth.servedBuildTimestamp || context.servedBuildTimestamp);
  const servedSourceFingerprint = toNullableTruthText(truth.servedSourceFingerprint || context.servedSourceFingerprint);
  const servedBuildCommit = toNullableTruthText(truth.servedBuildCommit || context.servedBuildCommit);
  const distFingerprint = servedSourceFingerprint || servedMarker;
  const servedTruthAvailable = truth.servedSourceTruthAvailable === true
    || truth.servedDistTruthAvailable === true
    || Boolean(servedMarker || servedBuildTimestamp || servedSourceFingerprint);
  const evidenceMissing = !source || !buildMarker;

  const buildTruthAdjudication = adjudicateCanonicalBuildTruth({
    runtimeBuild: {
      gitCommit: commit,
      runtimeMarker: buildMarker,
      buildTimestamp: timestamp,
      sourceFingerprint: source,
    },
    servedBuild: {
      gitCommit: servedBuildCommit,
      runtimeMarker: servedMarker,
      buildTimestamp: servedBuildTimestamp,
      sourceFingerprint: servedSourceFingerprint,
    },
  });

  let buildAlignmentState = 'unknown';
  let alignmentReason = 'Runtime/source alignment cannot be verified from this surface.';
  let blockingSeverity = 'caution';

  if (evidenceMissing) {
    buildAlignmentState = 'missing-build-truth';
    alignmentReason = 'Runtime is missing local build truth markers; rebuild is required before trusting parity claims.';
    blockingSeverity = 'warning';
  } else if (buildTruthAdjudication.status === 'match' || parityState === true) {
    buildAlignmentState = 'aligned';
    alignmentReason = 'Runtime artifacts are aligned with build truth.';
    blockingSeverity = 'none';
  } else if (buildTruthAdjudication.status === 'stale' || parityState === false) {
    buildAlignmentState = 'stale';
    alignmentReason = 'Hosted/runtime dist appears stale relative to expected build truth.';
    blockingSeverity = 'warning';
  } else if (buildTruthAdjudication.status === 'indeterminate' || !servedTruthAvailable) {
    buildAlignmentState = 'unknown';
    alignmentReason = buildTruthAdjudication.reason || 'Build alignment cannot be verified from this surface because served build truth is unavailable.';
    blockingSeverity = 'caution';
  }

  const explicitSeverity = normalizeBlockingSeverity(truth?.alignmentBlockingSeverity || context?.alignmentBlockingSeverity);
  const effectiveSeverity = explicitSeverity === 'none' ? blockingSeverity : explicitSeverity;
  const operatorActionRequired = buildAlignmentState === 'stale' || buildAlignmentState === 'missing-build-truth' || buildAlignmentState === 'unknown';
  const operatorActionText = buildAlignmentState === 'aligned'
    ? 'No operator action required for build alignment.'
    : 'Run npm run stephanos:build, verify with npm run stephanos:verify, then push updated dist before trusting hosted runtime behavior.';

  return {
    schemaVersion: 'runtime-source-dist-alignment.v1',
    buildAlignmentState,
    sourceFingerprint: source,
    distFingerprint,
    buildRuntimeMarker: buildMarker,
    buildCommit: commit,
    buildTimestamp: timestamp,
    servedBuildTimestamp,
    servedBuildCommit,
    buildTruthStatus: buildTruthAdjudication.status,
    buildTruthReason: buildTruthAdjudication.reason,
    buildTruthOperatorLabel: buildTruthAdjudication.operatorLabel,
    buildTruthEvidence: buildTruthAdjudication.evidence,
    alignmentReason,
    operatorActionRequired,
    operatorActionText,
    blockingSeverity: effectiveSeverity,
    rebuildActionAvailable: false,
  };
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
  operatorIntentCapture = {},
  missionPacket = {},
  proposal = {},
  execution = {},
} = {}) {
  const explicitIntent = intent?.intentDetected === true;
  const capturedIntent = operatorIntentCapture && typeof operatorIntentCapture === 'object'
    ? operatorIntentCapture
    : {};
  const capturedApproved = capturedIntent.approved === true;
  const capturedLabel = asText(capturedIntent.intentLabel || capturedIntent.missionType);
  const inferredIntent = !explicitIntent && asText(intent?.intentType) && asText(intent?.intentType) !== 'unknown';

  return {
    intentTruthVersion: 'runtime-current-intent.v1',
    operatorIntent: {
      label: capturedApproved
        ? asText(capturedLabel, 'unknown')
        : asText(intent?.intentType, 'unknown'),
      source: capturedApproved
        ? 'explicit'
        : explicitIntent
          ? 'explicit'
          : (inferredIntent ? 'inferred' : 'unknown'),
      confidence: capturedApproved
        ? 1
        : (Number.isFinite(Number(intent?.confidence)) ? Number(intent.confidence) : 0),
      reason: capturedApproved
        ? asText(capturedIntent.packetSummary, 'Operator approved canonical intent via Intent Engine.')
        : asText(intent?.reason, explicitIntent ? 'explicit operator request observed' : 'operator intent not yet established'),
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
  operatorIntentCapture = {},
} = {}) {
  const capturedIntent = operatorIntentCapture && typeof operatorIntentCapture === 'object'
    ? operatorIntentCapture
    : {};
  const latestDecision = Array.isArray(missionPacketWorkflow?.decisions) ? missionPacketWorkflow.decisions[0] : null;
  const latestHandoff = Array.isArray(missionPacketWorkflow?.codexHandoffs) ? missionPacketWorkflow.codexHandoffs[0] : null;
  const decision = asText(latestDecision?.decision, 'pending-review');
  const status = asText(latestHandoff?.status) === 'validated'
    ? 'completed'
    : asText(latestHandoff?.status) === 'applied'
      ? 'in-progress'
      : asText(latestHandoff?.status) === 'failed'
        ? 'rollback-recommended'
        : asText(latestHandoff?.status) === 'rolled-back'
          ? 'rolled-back'
          : decision === 'accept'
    ? 'execution-ready'
    : decision === 'reject'
      ? 'failed'
      : decision === 'defer'
        ? 'awaiting-approval'
        : (missionPacketTruth?.active ? 'awaiting-approval' : 'proposed');

  return {
    missionPacketTruthVersion: 'runtime-mission-packet.v1',
    packetKey: buildMissionPacketKey(missionPacketTruth),
    missionTitle: asText(missionPacketTruth?.moveTitle || capturedIntent?.missionTitle, 'not yet established'),
    missionSummary: asText(missionPacketTruth?.rationale || capturedIntent?.packetSummary, 'not yet established'),
    objective: asText(currentIntent?.operatorIntent?.label, 'not yet established'),
    currentPhase: status,
    blockers: asList(missionPacketTruth?.blockers, 5),
    recommendedNextAction: asText(missionPacketTruth?.executionEligible ? 'Prepare execution handoff' : 'Await explicit operator approval', 'not yet established'),
    continuityNotes: asList(missionPacketTruth?.evidence, 5),
    codexExecution: {
      handoffId: asText(latestHandoff?.handoffId),
      status: asText(latestHandoff?.status, 'not-generated'),
      validationStatus: asText(latestHandoff?.validationStatus, 'not-run'),
      lastOperatorAction: asText(latestHandoff?.lastOperatorAction, 'none'),
      summary: asText(latestHandoff?.summary),
      updatedAt: asText(latestHandoff?.updatedAt),
    },
    approvalExecutionStatus: {
      requested: 'proposed',
      proposed: missionPacketTruth?.active === true ? 'yes' : 'no',
      accepted: decision === 'accept' ? 'yes' : 'no',
      executing: missionPacketTruth?.executionEligible === true ? 'possible-after-approval' : 'no',
      completed: asText(latestHandoff?.status) === 'validated' ? 'operator-validated' : 'no-automatic-completion-claim',
      lifecycleStatus: normalizeLifecycle(status, 'proposed'),
    },
  };
}
