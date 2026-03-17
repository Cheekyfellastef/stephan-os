import { memoryService } from './memoryService.js';
import { knowledgeGraphService } from './knowledgeGraphService.js';
import { simulationEngine } from './simulationEngine.js';
import { getToolRegistry } from './toolRegistry.js';
import { listRegisteredAgents } from './agentRegistry.js';

const base = [
  {
    id: 'ai_core',
    name: 'AI Core',
    description: 'Primary assistant orchestration and response routing.',
    state: 'live',
    version: process.env.APP_VERSION ?? '0.1.0',
    capabilities: ['command-routing', 'assistant-response', 'debug-telemetry'],
  },
  {
    id: 'simulation_core',
    name: 'Simulation Core',
    description: 'Deterministic simulation execution engine.',
    state: 'live',
    capabilities: ['simulation-registry', 'schema-validation', 'preset-execution'],
  },
  {
    id: 'knowledge_graph_core',
    name: 'Knowledge Graph Core',
    description: 'Persistent graph nodes/edges with deterministic graph operations.',
    state: 'live',
    capabilities: ['node-management', 'edge-management', 'graph-search', 'related-traversal'],
  },
  {
    id: 'memory_service',
    name: 'Memory Service',
    description: 'Conversation and contextual memory storage/retrieval.',
    state: 'live',
    capabilities: ['save', 'list', 'search'],
  },
  {
    id: 'tool_registry',
    name: 'Tool Registry',
    description: 'Central registration and execution point for deterministic tools.',
    state: 'live',
    capabilities: ['tool-discovery', 'tool-execution'],
  },
  {
    id: 'agent_registry',
    name: 'Agent Registry',
    description: 'Known agents and lifecycle metadata.',
    state: 'live',
    capabilities: ['agent-discovery'],
  },
];

export function getSubsystemRegistry() {
  return base.map((entry) => {
    if (entry.id === 'simulation_core') {
      return { ...entry, health: simulationEngine.getStatus() };
    }
    if (entry.id === 'knowledge_graph_core') {
      return { ...entry, health: knowledgeGraphService.getStatus() };
    }
    if (entry.id === 'memory_service') {
      return { ...entry, health: memoryService.getStatus() };
    }
    if (entry.id === 'tool_registry') {
      return { ...entry, health: { registered_tools: getToolRegistry().length } };
    }
    if (entry.id === 'agent_registry') {
      return { ...entry, health: { registered_agents: listRegisteredAgents().length } };
    }

    return { ...entry, health: { status: 'nominal' } };
  });
}

export function getSubsystem(id) {
  return getSubsystemRegistry().find((entry) => entry.id === id) ?? null;
}
