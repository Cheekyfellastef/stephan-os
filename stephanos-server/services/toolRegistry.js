import { memoryService } from './memoryService.js';
import { listRegisteredAgents } from './agentRegistry.js';

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
