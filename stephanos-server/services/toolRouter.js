const mockAgents = [
  { id: 'assistant', description: 'Default strategic assistant route' },
  { id: 'research', description: 'Future deep research workflow' },
  { id: 'simulation', description: 'Future simulation planning and execution' },
];

const mockTools = [
  { id: 'getSystemStatus', domain: 'diagnostics', implemented: true },
  { id: 'listAvailableAgents', domain: 'agents', implemented: true },
  { id: 'listAvailableTools', domain: 'diagnostics', implemented: true },
  { id: 'queryKnowledgeGraph', domain: 'knowledge_graph', implemented: false },
  { id: 'runSimulation', domain: 'simulation', implemented: false },
  { id: 'vrLabAnalyze', domain: 'vr_lab', implemented: false },
];

export async function runTool(toolName) {
  switch (toolName) {
    case 'getSystemStatus':
      return {
        ok: true,
        status: 'Stephanos AI Core online',
        modules: {
          memory: 'stub',
          tools: 'stub',
          knowledge_graph: 'planned',
          simulation: 'planned',
          voice_realtime: 'planned',
          vr_lab: 'planned',
        },
      };
    case 'listAvailableAgents':
      return { ok: true, agents: mockAgents };
    case 'listAvailableTools':
      return { ok: true, tools: mockTools };
    default:
      return {
        ok: false,
        message: `Tool '${toolName}' is not implemented yet.`,
      };
  }
}

export async function listAvailableTools() {
  return mockTools;
}

export async function listAvailableAgents() {
  return mockAgents;
}
