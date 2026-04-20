import { buildOperatorGuidanceProjection } from '../../state/operatorGuidanceRendering.js';

function asText(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function boolFromState(value) {
  if (value === true || value === 'yes' || value === 'reachable') return true;
  if (value === false || value === 'no' || value === 'unreachable') return false;
  return null;
}

export function collectActionHints(finalRouteTruth, orchestration = {}) {
  if (!finalRouteTruth) {
    return ['Runtime truth pending. Action hints will appear once route diagnostics are available.'];
  }

  const guidance = buildOperatorGuidanceProjection({
    finalRouteTruth,
    orchestrationTruth: orchestration,
    latestResponseEnvelope: orchestration?.latestResponseEnvelope || null,
  });

  const hints = [];
  const mission = guidance.missionLifecycleSummary;
  const caution = guidance.operatorCautionSummary;
  const requestedProvider = asText(finalRouteTruth?.requestedProvider, '').toLowerCase();
  const selectedProvider = asText(finalRouteTruth?.selectedProvider, '').toLowerCase();
  const executedProvider = asText(finalRouteTruth?.executedProvider, '').toLowerCase();
  const routeReachable = boolFromState(finalRouteTruth?.selectedRouteReachableState ?? finalRouteTruth?.selectedRouteReachable);
  const routeUsable = boolFromState(finalRouteTruth?.routeUsableState ?? finalRouteTruth?.routeUsable);
  const backendReachable = boolFromState(finalRouteTruth?.backendReachableState ?? finalRouteTruth?.backendReachable);
  const routeHealthy = routeReachable === true && routeUsable === true && backendReachable === true;
  const providerRequested = Boolean(requestedProvider && requestedProvider !== 'unknown');
  const providerSelected = Boolean(selectedProvider && selectedProvider !== 'unknown');
  const providerExecutable = Boolean(executedProvider && !['unknown', 'none', 'n/a'].includes(executedProvider));
  const providerExecutionBlocked = routeHealthy && (providerRequested || providerSelected) && !providerExecutable;
  const alignment = orchestration?.canonicalSourceDistAlignment || {};
  const alignmentState = asText(alignment.buildAlignmentState, 'unknown');
  const buildCertaintyUnavailable = ['unknown', 'stale', 'indeterminate'].includes(alignmentState);

  hints.push(`Mission: ${mission.missionPhase} (${mission.lifecycleState}).`);

  if (mission.blocked) {
    hints.push(`Mission blocked: ${asText(mission.blockageReason, 'Blocker reason unavailable.')}`);
  }

  if (guidance.blockedBecause.length > 0) {
    const primaryBlocker = guidance.blockedBecause[0];
    hints.push(`Blocked now: ${primaryBlocker.command} — ${primaryBlocker.message}`);
  }

  hints.push(`Next step: ${guidance.nextStepSummary}`);
  hints.push(`Build assistance: ${guidance.buildAssistanceSummary.state} — ${guidance.buildAssistanceSummary.explanation}`);
  if (routeHealthy) {
    hints.push('Route healthy; backend handshake is reachable from this hosted session.');
  }
  if (providerExecutionBlocked) {
    hints.push('Route healthy; backend execution contract appears stale or incomplete.');
    if (providerRequested) {
      hints.push(`Selected/requested provider (${requestedProvider}) is not executable under the current backend contract.`);
    }
    hints.push('Rebuild/restart Battle Bridge before trusting provider execution from hosted caravan surfaces.');
  } else if (routeReachable === false || routeUsable === false || backendReachable === false) {
    hints.push('Route issue unresolved: verify Home Bridge reachability and selected route usability before provider debugging.');
  }
  if (buildCertaintyUnavailable) {
    hints.push('Build certainty unavailable from hosted surface; backend/runtime alignment is not yet trustworthy.');
  }

  if (caution.inferredIntentCaution) {
    hints.push(caution.inferredIntentCaution);
  }

  if (caution.sparseContinuityCaution) {
    hints.push(caution.sparseContinuityCaution);
  }

  if (caution.routeWarnings.length > 0) {
    hints.push(...caution.routeWarnings.slice(0, 2));
  }

  if (guidance.envelopeProjection) {
    hints.push(`Latest action: ${guidance.envelopeProjection.actionRequested} (allowed=${guidance.envelopeProjection.actionAllowed ? 'yes' : 'no'}, applied=${guidance.envelopeProjection.actionApplied ? 'yes' : 'no'}).`);
  }

  if (alignmentState !== 'aligned') {
    hints.push({
      severity: alignment.blockingSeverity === 'warning' || alignment.blockingSeverity === 'blocking' ? 'high' : 'info',
      subsystem: 'BUILD-TRUTH',
      text: asText(alignment.alignmentReason, 'Build alignment cannot be verified from this surface.'),
    });
    hints.push({
      severity: 'info',
      subsystem: 'BUILD-TRUTH',
      text: asText(alignment.operatorActionText, 'Run stephanos:build and stephanos:verify before trusting hosted runtime behavior.'),
    });
  } else {
    hints.push({
      severity: 'info',
      subsystem: 'BUILD-TRUTH',
      text: 'Runtime artifacts are aligned with build truth.',
    });
  }

  return hints;
}
