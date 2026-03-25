import { queryStephanosAI } from '../../../shared/ai/stephanosClient.mjs';

function scoreCompleteness(generatedSystem) {
  const requiredRegions = 6;
  const generatedRegions = generatedSystem.uiLayout.regions.length;
  return Math.min(100, Math.round((generatedRegions / requiredRegions) * 100));
}

async function requestSimulationAdvisor({ intent, decomposition, generatedSystem, simulationCoreStatus, fetchImpl = globalThis.fetch }) {
  try {
    const aiResult = await queryStephanosAI({
      provider: 'ollama',
      messages: [
        {
          role: 'system',
          content: 'You are a concise simulation advisor. Return one practical improvement sentence.',
        },
        {
          role: 'user',
          content: `Summarize one improvement for intent "${intent.summary}" with ${decomposition.layers.length} layers and ${generatedSystem.files.length} generated files. Core status: ${simulationCoreStatus}.`,
        },
      ],
      context: {
        tileId: 'experimental-sandbox',
        workspace: 'experimental',
        simulationType: 'system-generation-sandbox',
        scenarioId: intent.id,
      },
      runtimeContext: {
        frontendOrigin: typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '',
      },
      fetchImpl,
    });

    return {
      requestedProvider: 'ollama',
      actualProvider: aiResult?.data?.actual_provider_used || aiResult?.data?.provider || null,
      summary: aiResult?.output_text || '',
      ok: Boolean(aiResult?.success),
      error: null,
    };
  } catch (error) {
    return {
      requestedProvider: 'ollama',
      actualProvider: null,
      summary: '',
      ok: false,
      error: error?.message || 'Unable to reach Stephanos AI route.',
    };
  }
}

export async function runSandboxSimulation({ intent, decomposition, generatedSystem, fetchImpl = globalThis.fetch }) {
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
      localhostLeakageDetected: false,
    },
  };

  // Best-effort simulation-core handshake. Uses relative path to avoid localhost leakage.
  let simulationCoreStatus = 'offline';
  try {
    const response = await fetchImpl('/api/health', { cache: 'no-store' });
    if (response.ok) simulationCoreStatus = 'reachable';
  } catch {
    simulationCoreStatus = 'offline';
  }

  const aiAdvisor = await requestSimulationAdvisor({ intent, decomposition, generatedSystem, simulationCoreStatus, fetchImpl });

  const completeness = scoreCompleteness(generatedSystem);
  const missingComponents = [];
  if (!intent.priorities.length) missingComponents.push('priority-profile');
  if (!generatedSystem.apis.length) missingComponents.push('api-contracts');

  const riskAreas = [];
  if (simulationCoreStatus === 'offline') riskAreas.push('simulation-core-unreachable');
  if (intent.constraints.length === 0) riskAreas.push('constraints-underspecified');

  const suggestedImprovements = [
    'Add explicit performance target and reliability SLO.',
    'Promote one high-priority architecture layer for faster trade-off analysis.',
  ];

  if (aiAdvisor.summary) {
    suggestedImprovements.unshift(aiAdvisor.summary);
  }

  return {
    finishedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - start),
    simulationCoreStatus,
    providerMode,
    routeSimulation,
    aiAdvisor,
    metrics: {
      completeness,
      missingComponents,
      riskAreas,
      suggestedImprovements,
    },
  };
}
