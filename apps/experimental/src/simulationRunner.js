function scoreCompleteness(generatedSystem) {
  const requiredRegions = 6;
  const generatedRegions = generatedSystem.uiLayout.regions.length;
  return Math.min(100, Math.round((generatedRegions / requiredRegions) * 100));
}

export async function runSandboxSimulation({ intent, decomposition, generatedSystem }) {
  const start = performance.now();

  const providerMode = decomposition.layers.some((layer) => layer.layer === 'providers')
    ? 'mock-provider-enabled'
    : 'provider-agnostic';

  const routeSimulation = {
    finalRouteTruth: {
      routeKind: 'workspace',
      source: 'experimental-sandbox',
      routeUsable: true,
      fallbackRouteActive: false,
      localhostLeakageDetected: false
    }
  };

  // Best-effort simulation-core handshake. Uses relative path to avoid localhost leakage.
  let simulationCoreStatus = 'offline';
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (response.ok) simulationCoreStatus = 'reachable';
  } catch {
    simulationCoreStatus = 'offline';
  }

  const completeness = scoreCompleteness(generatedSystem);
  const missingComponents = [];
  if (!intent.priorities.length) missingComponents.push('priority-profile');
  if (!generatedSystem.apis.length) missingComponents.push('api-contracts');

  const riskAreas = [];
  if (simulationCoreStatus === 'offline') riskAreas.push('simulation-core-unreachable');
  if (intent.constraints.length === 0) riskAreas.push('constraints-underspecified');

  return {
    finishedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - start),
    simulationCoreStatus,
    providerMode,
    routeSimulation,
    metrics: {
      completeness,
      missingComponents,
      riskAreas,
      suggestedImprovements: [
        'Add explicit performance target and reliability SLO.',
        'Promote one high-priority architecture layer for faster trade-off analysis.'
      ]
    }
  };
}
