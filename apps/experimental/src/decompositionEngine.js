const LAYER_BLUEPRINTS = {
  frontend: ['ui-shell', 'state-model', 'interaction-handlers'],
  backend: ['service-gateway', 'domain-services', 'validation-layer'],
  routing: ['route-truth-model', 'transition-policy'],
  providers: ['provider-adapter', 'provider-selection-policy'],
  persistence: ['repository', 'event-log', 'snapshot-store'],
  ui_ux: ['command-deck-layout', 'diagnostics-panels', 'responsive-grid']
};

export function decomposeIntent(intentModel, refinement = {}) {
  const layers = intentModel.architectureLayers.map(({ layer, priority }) => {
    const refinementHint = refinement[layer];
    return {
      layer,
      priority,
      responsibilities: LAYER_BLUEPRINTS[layer] || [],
      refinementHint: refinementHint || ''
    };
  });

  return {
    intentId: intentModel.id,
    iteration: intentModel.iteration,
    layers,
    crossCutting: {
      runtimeTruth: 'single-source-of-truth',
      uiState: 'runtime-derived-only',
      routeSafety: 'no-localhost-leakage'
    }
  };
}
