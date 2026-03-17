import { memoryService } from './memoryService.js';
import { listRegisteredAgents } from './agentRegistry.js';
import { knowledgeGraphService } from './knowledgeGraphService.js';
import { simulationEngine } from './simulationEngine.js';
import { listSimulations } from './simulationRegistry.js';
import { getPresetStatus, listPresets } from './simulationPresets.js';

const tools = [
  {
    name: 'getSystemStatus',
    description: 'Returns operational status for core Stephanos services.',
    category: 'system',
    state: 'live',
    async execute(_args, context) {
      return {
        output_text: 'Stephanos systems nominal.',
        data: {
          frontend_status: 'online',
          backend_status: 'online',
          ai_service: context.aiAvailable ? 'available' : 'unavailable',
          memory_service: memoryService.getStatus(),
          knowledge_graph_service: knowledgeGraphService.getStatus(),
          simulation_engine: simulationEngine.getStatus(),
          simulation_presets: getPresetStatus(),
          registered_tools: tools.length,
          registered_agents: listRegisteredAgents().length,
          app_version: process.env.APP_VERSION ?? '0.1.0',
        },
      };
    },
  },
  {
    name: 'listAvailableTools',
    description: 'Lists all registered tools and their callability/state.',
    category: 'system',
    state: 'live',
    async execute() {
      const toolList = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        category: tool.category,
        state: tool.state,
        callable_now: tool.state === 'live' || tool.state === 'mock',
      }));

      return {
        output_text: `Registered tools: ${toolList.length}`,
        data: { tools: toolList },
      };
    },
  },
  {
    name: 'listAvailableAgents',
    description: 'Lists all registered agents and lifecycle state.',
    category: 'agents',
    state: 'live',
    async execute() {
      const agents = listRegisteredAgents();
      return {
        output_text: `Registered agents: ${agents.length}`,
        data: { agents },
      };
    },
  },
  {
    name: 'listMemory',
    description: 'Lists persisted memory entries.',
    category: 'memory',
    state: 'live',
    async execute() {
      const items = memoryService.listMemory();
      return {
        output_text: `Memory items: ${items.length}`,
        data: { items },
      };
    },
  },
  {
    name: 'saveMemory',
    description: 'Persists a memory entry from user input text.',
    category: 'memory',
    state: 'live',
    async execute(args) {
      const text = (args?.text ?? '').trim();
      if (!text) {
        throw new Error('Memory save requires text. Usage: /memory save <text>');
      }

      const saved = memoryService.saveMemory({ text });
      return {
        output_text: `Saved memory ${saved.id}.`,
        data: { item: saved },
      };
    },
  },
  {
    name: 'findMemory',
    description: 'Finds memory entries by substring match.',
    category: 'memory',
    state: 'live',
    async execute(args) {
      const query = (args?.query ?? '').trim();
      if (!query) {
        throw new Error('Memory find requires query. Usage: /memory find <query>');
      }

      const matches = memoryService.findMemory(query);
      return {
        output_text: matches.length
          ? `Found ${matches.length} memory item(s).`
          : 'No memory matches found.',
        data: { query, matches },
      };
    },
  },
  {
    name: 'kgGetStatus',
    description: 'Returns knowledge graph subsystem status.',
    category: 'knowledge_graph',
    state: 'live',
    async execute() {
      return {
        output_text: 'Knowledge graph core is available.',
        data: { status: knowledgeGraphService.getStatus() },
      };
    },
  },
  {
    name: 'kgListNodes',
    description: 'Lists all knowledge graph nodes.',
    category: 'knowledge_graph',
    state: 'live',
    async execute() {
      const nodes = knowledgeGraphService.listNodes();
      return {
        output_text: `Knowledge graph nodes: ${nodes.length}`,
        data: { nodes },
      };
    },
  },
  {
    name: 'kgListEdges',
    description: 'Lists all knowledge graph edges.',
    category: 'knowledge_graph',
    state: 'live',
    async execute() {
      const edges = knowledgeGraphService.listEdges();
      return {
        output_text: `Knowledge graph edges: ${edges.length}`,
        data: { edges },
      };
    },
  },
  {
    name: 'kgCreateNode',
    description: 'Creates a knowledge graph node.',
    category: 'knowledge_graph',
    state: 'live',
    async execute(args) {
      const node = knowledgeGraphService.createNode(args);
      return {
        output_text: `Created node ${node.id}.`,
        data: { node },
      };
    },
  },
  {
    name: 'kgCreateEdge',
    description: 'Creates a knowledge graph edge.',
    category: 'knowledge_graph',
    state: 'live',
    async execute(args) {
      const edge = knowledgeGraphService.createEdge(args);
      return {
        output_text: `Created edge ${edge.id}.`,
        data: { edge },
      };
    },
  },
  {
    name: 'kgSearch',
    description: 'Searches graph nodes and edges by text.',
    category: 'knowledge_graph',
    state: 'live',
    async execute(args) {
      const query = (args?.query ?? '').trim();
      const results = knowledgeGraphService.searchGraph(query);
      return {
        output_text: `Search found ${results.node_matches.length} node(s) and ${results.edge_matches.length} edge(s).`,
        data: results,
      };
    },
  },
  {
    name: 'kgFindRelated',
    description: 'Finds nodes related to a given node ID.',
    category: 'knowledge_graph',
    state: 'live',
    async execute(args) {
      const nodeId = (args?.nodeId ?? '').trim();
      if (!nodeId) {
        throw new Error('Usage: /kg related <nodeId>');
      }

      const result = knowledgeGraphService.findRelatedNodes(nodeId);
      return {
        output_text: `Found ${result.related.length} related node(s) for ${nodeId}.`,
        data: result,
      };
    },
  },
  {
    name: 'kgGetStats',
    description: 'Returns aggregate statistics for the knowledge graph.',
    category: 'knowledge_graph',
    state: 'live',
    async execute() {
      const stats = knowledgeGraphService.getGraphStats();
      return {
        output_text: `Graph stats: ${stats.totals.nodes} node(s), ${stats.totals.edges} edge(s).`,
        data: { stats },
      };
    },
  },
  {
    name: 'simList',
    description: 'Lists all registered simulations.',
    category: 'simulation',
    state: 'live',
    async execute() {
      const simulations = listSimulations();
      return {
        output_text: `Registered simulations: ${simulations.length}`,
        data: { simulations },
      };
    },
  },
  {
    name: 'simRun',
    description: 'Runs a simulation by ID with validated input.',
    category: 'simulation',
    state: 'live',
    async execute(args = {}) {
      const simulationId = (args.simulationId ?? '').trim();
      if (!simulationId) {
        throw new Error('Simulation run requires simulationId. Usage: /simulate run <simulationId>');
      }

      const normalizedInput = Object.entries(args.input ?? {}).reduce((acc, [key, value]) => {
        if (value !== null && value !== undefined && value !== '') {
          acc[key] = value;
        }
        return acc;
      }, {});

      const run = simulationEngine.runSimulation(simulationId, normalizedInput, {
        appVersion: process.env.APP_VERSION ?? '0.1.0',
        toolCount: tools.length,
      });

      return {
        output_text: `Simulation '${simulationId}' completed successfully.`,
        data: {
          simulationId,
          simulationName: run.simulation.name,
          category: run.simulation.category,
          input: run.validatedInput,
          result: run.result,
          execution_ms: run.timingMs,
        },
      };
    },
  },
  {
    name: 'simGetStatus',
    description: 'Returns simulation subsystem and preset status.',
    category: 'simulation',
    state: 'live',
    async execute() {
      return {
        output_text: 'Simulation Core status available.',
        data: {
          engine: simulationEngine.getStatus(),
          presets: getPresetStatus(),
          available_presets: listPresets().map((preset) => ({
            name: preset.name,
            simulationId: preset.simulationId,
            updated_at: preset.updated_at,
          })),
        },
      };
    },
  },
];

export function getToolRegistry() {
  return [...tools];
}

export function getTool(name) {
  return tools.find((tool) => tool.name === name);
}

export async function executeTool(name, args, context = {}) {
  const tool = getTool(name);
  if (!tool) {
    throw new Error(`Unknown tool '${name}'.`);
  }

  if (tool.state === 'disabled' || tool.state === 'planned') {
    throw new Error(`Tool '${name}' is not callable in state '${tool.state}'.`);
  }

  const result = await tool.execute(args, context);
  return { tool, result };
}
