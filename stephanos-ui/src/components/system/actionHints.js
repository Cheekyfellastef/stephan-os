import { buildOperatorGuidanceProjection } from '../../state/operatorGuidanceRendering.js';

function asText(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
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

  const alignment = orchestration?.canonicalSourceDistAlignment || {};
  const alignmentState = asText(alignment.buildAlignmentState, 'unknown');
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
