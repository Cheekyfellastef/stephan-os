const DEFAULT_AGENTS = Object.freeze([
  {
    agentId: 'intent-engine',
    displayName: 'Intent Engine',
    description: 'Parses operator requests into structured intent packets and orchestrates handoffs.',
    kind: 'orchestrator',
    capabilities: ['intent-parse', 'task-structuring', 'agent-handoff'],
    dependencies: ['runtime-truth'],
    allowedSurfaces: ['mission-control', 'cockpit', 'agents'],
    allowedSessionKinds: ['local-dev', 'hosted-web', 'local-network'],
    defaultMode: 'assisted',
    autonomyLevel: 'assisted',
    visibility: 'primary',
    enabledByDefault: true,
  },
  {
    agentId: 'research-agent',
    displayName: 'Research Agent',
    description: 'Handles freshness-gated information retrieval and provider coordination.',
    kind: 'specialist',
    capabilities: ['fresh-world-research', 'source-collection', 'provider-routing'],
    dependencies: ['intent-engine', 'provider-routing'],
    allowedSurfaces: ['mission-control', 'agents'],
    allowedSessionKinds: ['local-dev', 'hosted-web', 'local-network'],
    defaultMode: 'manual',
    autonomyLevel: 'manual',
    visibility: 'primary',
    enabledByDefault: true,
  },
  {
    agentId: 'memory-agent',
    displayName: 'Memory Agent',
    description: 'Evaluates memory candidates and continuity relevance with visible acceptance reasons.',
    kind: 'specialist',
    capabilities: ['memory-candidate-adjudication', 'continuity-summary', 'memory-reasoning'],
    dependencies: ['intent-engine', 'shared-memory'],
    allowedSurfaces: ['mission-control', 'cockpit', 'agents'],
    allowedSessionKinds: ['local-dev', 'hosted-web', 'local-network'],
    defaultMode: 'assisted',
    autonomyLevel: 'assisted',
    visibility: 'primary',
    enabledByDefault: true,
  },
  {
    agentId: 'execution-agent',
    displayName: 'Execution Agent',
    description: 'Performs constrained system actions with explicit operator-policy gates.',
    kind: 'executor',
    capabilities: ['tool-execution', 'workflow-run', 'simulation-trigger'],
    dependencies: ['intent-engine', 'operator-policy'],
    allowedSurfaces: ['mission-control', 'agents'],
    allowedSessionKinds: ['local-dev', 'local-network'],
    defaultMode: 'manual',
    autonomyLevel: 'manual',
    visibility: 'primary',
    enabledByDefault: true,
  },
  {
    agentId: 'ideas-agent',
    displayName: 'Ideas Agent',
    description: 'Normalizes idea stream events into structured artifacts for continuity pipelines.',
    kind: 'specialist',
    capabilities: ['idea-normalization', 'artifact-linking', 'memory-pipeline-submit'],
    dependencies: ['intent-engine', 'memory-agent'],
    allowedSurfaces: ['mission-control', 'agents'],
    allowedSessionKinds: ['local-dev', 'hosted-web', 'local-network'],
    defaultMode: 'assisted',
    autonomyLevel: 'assisted',
    visibility: 'secondary',
    enabledByDefault: true,
  },
]);

function normalizeList(value = []) {
  return Array.isArray(value) ? value : [];
}

export function listCanonicalAgents() {
  return DEFAULT_AGENTS.map((entry) => ({ ...entry }));
}

export function getCanonicalAgent(agentId = '') {
  return listCanonicalAgents().find((entry) => entry.agentId === agentId) || null;
}

export function buildAgentRegistry({ overrides = [] } = {}) {
  const overrideMap = new Map(
    normalizeList(overrides)
      .filter((entry) => entry && typeof entry === 'object' && entry.agentId)
      .map((entry) => [entry.agentId, entry]),
  );

  return listCanonicalAgents().map((entry) => ({
    ...entry,
    ...(overrideMap.get(entry.agentId) || {}),
  }));
}
