function asText(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function toSummaryList(values = [], { fallback = 'none', limit = 4 } = {}) {
  if (!Array.isArray(values) || values.length === 0) {
    return [fallback];
  }
  const entries = values
    .map((entry) => {
      if (typeof entry === 'string') {
        return asText(entry);
      }
      if (!entry || typeof entry !== 'object') {
        return '';
      }
      return asText(entry.summary || entry.reason || entry.title || entry.action || entry.message);
    })
    .filter(Boolean)
    .slice(0, limit);
  return entries.length > 0 ? entries : [fallback];
}

function createCommandSummary(commandKey, readiness = {}) {
  return {
    command: asText(commandKey, 'unknown-command'),
    reason: asText(readiness.reason, readiness.allowed === true ? 'ready' : 'blocked-by-truth'),
    message: asText(readiness.message, readiness.allowed === true ? 'Action is available now.' : 'Action is blocked by current orchestration truth.'),
    approvalRequired: readiness.approvalRequired === true,
  };
}

function summarizeMissionLifecycle(missionPhase = '', { missionBlocked = false, blockers = [] } = {}) {
  const phase = asText(missionPhase, 'unknown');
  if (phase === 'in-progress') return 'in-progress';
  if (phase === 'completed') return 'completed';
  if (phase === 'failed') return 'failed';
  if (phase === 'rollback-recommended' || phase === 'rolled-back') return 'rollback-recommended';
  if (missionBlocked || blockers.length > 0) return 'blocked';
  if (phase === 'accepted' || phase === 'execution-ready') return 'ready';
  if (phase === 'awaiting-approval' || phase === 'proposed') return 'awaiting-approval';
  return phase;
}

export function buildOperatorGuidanceProjection({
  finalRouteTruth = null,
  orchestrationTruth = {},
  latestResponseEnvelope = null,
} = {}) {
  const selectors = orchestrationTruth?.selectors || {};
  const commandReadiness = selectors?.commandReadiness && typeof selectors.commandReadiness === 'object'
    ? selectors.commandReadiness
    : {};
  const commandEntries = Object.entries(commandReadiness);

  const availableNow = commandEntries
    .filter(([, readiness]) => readiness?.allowed === true)
    .map(([command, readiness]) => createCommandSummary(command, readiness));

  const blockedBecause = commandEntries
    .filter(([, readiness]) => readiness?.allowed !== true)
    .map(([command, readiness]) => createCommandSummary(command, readiness));

  const currentMissionState = selectors?.currentMissionState || {};
  const continuityLoopState = selectors?.continuityLoopState || {};
  const buildAssistanceReadiness = selectors?.buildAssistanceReadiness || {};
  const missionLifecycleState = summarizeMissionLifecycle(currentMissionState?.missionPhase, {
    missionBlocked: selectors?.missionBlocked === true,
    blockers: blockedBecause,
  });

  const approvalRequired = selectors?.approvalReadiness === 'awaiting-approval'
    || buildAssistanceReadiness?.approvalRequired === true
    || blockedBecause.some((entry) => entry.approvalRequired === true);

  const continuitySummary = {
    strength: asText(continuityLoopState?.strength, 'unknown'),
    sparse: continuityLoopState?.sparse === true,
    state: asText(continuityLoopState?.state, 'unknown'),
    caution: continuityLoopState?.sparse === true
      ? 'Sparse continuity: keep guidance bounded and request explicit operator confirmation before lifecycle transitions.'
      : '',
  };

  const inferredIntent = currentMissionState?.intentSource === 'inferred';
  const routeWarnings = [];
  if (finalRouteTruth?.backendReachable === false) {
    routeWarnings.push('Backend route is unreachable from this runtime session.');
  }
  if (finalRouteTruth?.providerExecution?.executableProvider === 'mock') {
    routeWarnings.push('Mock provider is executing; outputs are simulation-only execution truth.');
  }


  const missionResumability = selectors?.missionResumability && typeof selectors.missionResumability === 'object'
    ? selectors.missionResumability
    : {};
  const envelope = latestResponseEnvelope && typeof latestResponseEnvelope === 'object'
    ? {
      actionRequested: asText(latestResponseEnvelope.actionRequested, 'n/a'),
      actionAllowed: latestResponseEnvelope.actionAllowed === true,
      actionApplied: latestResponseEnvelope.actionApplied === true,
      lifecycleState: asText(latestResponseEnvelope.resultingLifecycleState, asText(currentMissionState?.missionPhase, 'unknown')),
      buildAssistanceState: asText(latestResponseEnvelope.resultingBuildAssistanceState, asText(buildAssistanceReadiness?.state, 'unavailable')),
      truthWarnings: toSummaryList(latestResponseEnvelope.truthWarnings, { fallback: 'none', limit: 4 }),
      nextRecommendedAction: asText(latestResponseEnvelope.nextRecommendedAction, asText(selectors?.nextRecommendedAction, 'Await explicit operator guidance.')),
      status: asText(latestResponseEnvelope.status, 'n/a'),
    }
    : null;

  const blockedSummary = blockedBecause.length > 0
    ? blockedBecause.map((entry) => `${entry.command}: ${entry.reason}`)
    : ['none'];

  return {
    schemaVersion: 'operator-guidance-render.v1',
    availableNow,
    blockedBecause,
    blockedSummary,
    nextStepSummary: asText(selectors?.nextRecommendedAction, 'Await explicit operator guidance.'),
    buildAssistanceSummary: {
      state: asText(buildAssistanceReadiness?.state, 'unavailable'),
      explanation: asText(buildAssistanceReadiness?.explanation, 'Build assistance is unavailable until canonical mission truth is established.'),
      approvalRequired,
    },
    approvalSummary: {
      readiness: asText(selectors?.approvalReadiness, 'unknown'),
      requiredNow: approvalRequired,
    },
    codexReadinessSummary: {
      state: asText(selectors?.codexHandoffReadiness, 'unavailable'),
      readyNow: selectors?.codexHandoffReadiness === 'ready',
    },
    codexPipelineSummary: {
      status: asText(currentMissionState?.codexHandoffStatus, 'not-generated'),
      validationStatus: asText(currentMissionState?.validationStatus, 'not-run'),
      lastOperatorAction: asText(currentMissionState?.lastHandoffAction, 'none'),
    },
    continuitySummary,
    missionLifecycleSummary: {
      missionTitle: asText(currentMissionState?.missionTitle, 'not yet established'),
      missionPhase: asText(currentMissionState?.missionPhase, 'unknown'),
      lifecycleState: missionLifecycleState,
      blocked: selectors?.missionBlocked === true,
      blockageReason: asText(selectors?.blockageExplanation, 'none'),
    },
    resumabilitySummary: {
      hasResumableMission: missionResumability?.hasResumableMission === true,
      resumableMissionCount: Number.isFinite(Number(missionResumability?.resumableMissionCount)) ? Number(missionResumability.resumableMissionCount) : 0,
      missionSummary: asText(missionResumability?.missionSummary, 'No resumable mission found.'),
      lastStableState: missionResumability?.lastStableState || null,
      lastExternalAction: asText(missionResumability?.lastExternalAction, 'none'),
      nextRecommendedAction: asText(missionResumability?.nextRecommendedAction, asText(selectors?.nextRecommendedAction, 'Await explicit operator guidance.')),
      warnings: toSummaryList(missionResumability?.warnings, { fallback: 'none', limit: 4 }),
    },
    operatorCautionSummary: {
      inferredIntent,
      inferredIntentCaution: inferredIntent
        ? 'Intent is inferred; confirm explicit objective before lifecycle transitions.'
        : '',
      sparseContinuityCaution: continuitySummary.caution,
      routeWarnings,
    },
    envelopeProjection: envelope,
  };
}
