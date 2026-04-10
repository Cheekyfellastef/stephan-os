const BUILTIN_TOOLS = Object.freeze([
  { toolId: 'code-reader', toolType: 'read-code', mutationRisk: 'none', requiresApproval: false, notes: 'Read source truth files.' },
  { toolId: 'state-inspector', toolType: 'inspect-state', mutationRisk: 'none', requiresApproval: false, notes: 'Inspect runtime/session truth state.' },
  { toolId: 'patch-generator', toolType: 'generate-patch', mutationRisk: 'high', requiresApproval: true, notes: 'Prepare bounded patch plan.' },
  { toolId: 'build-verifier', toolType: 'verify-build', mutationRisk: 'low', requiresApproval: true, notes: 'Run deterministic verify checks.' },
  { toolId: 'test-runner', toolType: 'run-tests', mutationRisk: 'low', requiresApproval: true, notes: 'Run targeted test suites.' },
  { toolId: 'roadmap-updater', toolType: 'update-roadmap', mutationRisk: 'high', requiresApproval: true, notes: 'Promote accepted mission to roadmap truth.' },
  { toolId: 'activity-updater', toolType: 'update-activity', mutationRisk: 'medium', requiresApproval: true, notes: 'Append mission lifecycle activity.' },
  { toolId: 'codex-handoff-prep', toolType: 'prepare-codex-handoff', mutationRisk: 'none', requiresApproval: true, notes: 'Generate bounded handoff packet.' },
  { toolId: 'transport-inspector', toolType: 'inspect-transport', mutationRisk: 'none', requiresApproval: false, notes: 'Inspect transport/path health.' },
  { toolId: 'provider-inspector', toolType: 'inspect-provider', mutationRisk: 'none', requiresApproval: false, notes: 'Inspect provider state and capabilities.' },
  { toolId: 'memory-inspector', toolType: 'inspect-memory', mutationRisk: 'none', requiresApproval: false, notes: 'Inspect memory candidate state.' },
  { toolId: 'graph-inspector', toolType: 'inspect-graph', mutationRisk: 'none', requiresApproval: false, notes: 'Inspect graph readiness and links.' },
]);

export function listToolExecutions() {
  return BUILTIN_TOOLS.map((tool) => ({ ...tool }));
}

export function resolveToolByType(toolType = '') {
  const normalized = String(toolType || '').trim().toLowerCase();
  return BUILTIN_TOOLS.find((tool) => tool.toolType === normalized) || null;
}
