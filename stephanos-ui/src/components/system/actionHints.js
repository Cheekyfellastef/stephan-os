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
  const canonicalIntent = orchestration?.currentIntent || {};
  const canonicalMemory = orchestration?.memoryContext || {};
  const missionPacket = orchestration?.missionPacket || {};

  if (finalRouteTruth.backendReachable === false) {
    hints.push('Backend is unreachable. Run a health check before sending commands.');
  }

  if (finalRouteTruth.fallbackActive === true) {
    hints.push('Fallback route is active. Verify preferred route diagnostics before promoting this session.');
  }

  if (routeKind.includes('cloud')) {
    hints.push('Cloud route active. Confirm provider key/config readiness for this workspace.');
  } else if (routeKind) {
    hints.push('Local route active. Keep local host/runtime health in sync with launcher truth.');
  }

  if (executedProvider === 'mock') {
    hints.push('Mock provider is executing. Results are simulation-only and not live model output.');
  }

  if (asText(canonicalMemory?.activeMissionContinuity?.continuityLoopState) === 'live') {
    hints.push('Continuity loop is live. Treat this request as continuation unless operator states a mission reset.');
  }

  if (asText(canonicalIntent?.operatorIntent?.source) === 'inferred') {
    hints.push('Current intent is inferred. Confirm operator objective before accepting or promoting mission packets.');
  }

  if (asText(missionPacket?.currentPhase) === 'awaiting-approval') {
    hints.push(`Mission packet awaiting approval. Recommended next step: ${asText(missionPacket?.recommendedNextAction, 'Await explicit operator decision.')}`);
  }

  if (canonicalMemory?.sparseData === true) {
    hints.push('Continuity memory is sparse. Prefer bounded/explicit wording and avoid overclaiming mission continuity.');
  }

  return hints.length > 0
    ? hints
    : ['Route and provider truth look healthy. Continue with normal operation.'];
}
