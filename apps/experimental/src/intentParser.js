const DEFAULT_LAYERS = ['frontend', 'backend', 'routing', 'providers', 'persistence', 'ui_ux'];

function detectLayerPriority(intentText) {
  const lower = intentText.toLowerCase();
  return DEFAULT_LAYERS.map((layer) => {
    const normalizedLayer = layer.replace('_', '/');
    return {
      layer,
      priority: lower.includes(layer) || lower.includes(normalizedLayer) ? 'high' : 'normal'
    };
  });
}

export function parseIntent(inputText, previousIntent = null) {
  const raw = String(inputText || '').trim();
  const constraints = [];

  if (/no\s+localhost/i.test(raw)) {
    constraints.push('no_localhost_leakage');
  }

  if (/single\s+source\s+of\s+truth/i.test(raw)) {
    constraints.push('runtime_truth_first');
  }

  if (/no\s+fake\s+ui\s+state/i.test(raw)) {
    constraints.push('no_fake_ui_state');
  }

  const inferredPriorities = [];
  if (/speed|fast|quick/i.test(raw)) inferredPriorities.push('delivery_speed');
  if (/secure|security|risk/i.test(raw)) inferredPriorities.push('risk_reduction');
  if (/scale|scalable|throughput/i.test(raw)) inferredPriorities.push('scalability');

  return {
    id: `intent-${Date.now()}`,
    raw,
    objective: raw || 'Design a top-down simulation-ready system.',
    architectureLayers: detectLayerPriority(raw),
    constraints: [...new Set([...(previousIntent?.constraints || []), ...constraints])],
    priorities: [...new Set([...(previousIntent?.priorities || []), ...inferredPriorities])],
    iteration: (previousIntent?.iteration || 0) + 1,
    createdAt: new Date().toISOString()
  };
}
