function asText(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

export function collectActionHints(finalRouteTruth, orchestration = {}) {
  if (!finalRouteTruth) {
    return ['Runtime truth pending. Action hints will appear once route diagnostics are available.'];
  }

  const hints = [];
  const routeKind = String(finalRouteTruth.routeKind || '').toLowerCase();
  const executedProvider = String(finalRouteTruth.providerExecution?.executableProvider || '').toLowerCase();
  const selectors = orchestration?.selectors || {};
  const missionState = selectors?.currentMissionState || {};
  const continuity = selectors?.continuityLoopState || {};
  const buildAssist = selectors?.buildAssistanceReadiness || {};

  if (finalRouteTruth.backendReachable === false) {
    hints.push('Backend is unreachable. Route truth is blocking mission advancement until connectivity is restored.');
  }

  if (asText(missionState.intentSource) === 'inferred') {
    hints.push('Intent is inferred. Confirm explicit objective before accepting, promoting, or starting mission execution.');
  }

  if (asText(continuity.strength) === 'sparse') {
    hints.push('Continuity is sparse. Use bounded statements and request explicit operator confirmation before execution transitions.');
  }

  if (selectors?.missionBlocked === true) {
    hints.push(`Mission blocked: ${asText(selectors?.blockageExplanation, 'Blocker reason unavailable')}`);
  }

  hints.push(`Build assistance: ${asText(buildAssist.state, 'unavailable')} — ${asText(buildAssist.explanation, 'No build assistance explanation available.')}`);
  hints.push(`Next step: ${asText(selectors?.nextRecommendedAction, 'Await mission packet / intent truth.')}`);

  if (routeKind.includes('cloud')) {
    hints.push('Cloud route active. Keep provider configuration and approval gating explicit for mission-critical changes.');
  } else if (routeKind) {
    hints.push('Local route active. Validate local runtime health before marking execution transitions.');
  }

  if (executedProvider === 'mock') {
    hints.push('Mock provider is executing. Outputs are simulation-only and must not be treated as real provider execution truth.');
  }

  return hints;
}
