export function collectActionHints(finalRouteTruth) {
  if (!finalRouteTruth) {
    return ['Runtime truth pending. Action hints will appear once route diagnostics are available.'];
  }

  const hints = [];
  const routeKind = String(finalRouteTruth.routeKind || '').toLowerCase();
  const executedProvider = String(finalRouteTruth.providerExecution?.executableProvider || '').toLowerCase();

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

  return hints.length > 0
    ? hints
    : ['Route and provider truth look healthy. Continue with normal operation.'];
}
