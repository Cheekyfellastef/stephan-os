import { memoryService } from './memoryService.js';
import { knowledgeGraphService } from './knowledgeGraphService.js';
import { simulationEngine } from './simulationEngine.js';
import { getToolRegistry } from './toolRegistry.js';
import { listRegisteredAgents } from './agentRegistry.js';
import { proposalService } from './proposalService.js';
import { activityLogService } from './activityLogService.js';
import { roadmapService } from './roadmapService.js';
import { simulationHistoryService } from './simulationHistoryService.js';

const base = [
  { id: 'ai_core', name: 'AI Core', description: 'Primary assistant orchestration and response routing.', state: 'live', version: process.env.APP_VERSION ?? '0.1.0', capabilities: ['command-routing', 'assistant-response', 'debug-telemetry', 'context-packaging'] },
  { id: 'simulation_core', name: 'Simulation Core', description: 'Deterministic simulation execution engine.', state: 'live', capabilities: ['simulation-registry', 'schema-validation', 'preset-execution'] },
  { id: 'simulation_history', name: 'Simulation History', description: 'Persistent run history and deterministic run comparison.', state: 'live', capabilities: ['run-history', 'run-inspection', 'run-comparison'] },
  { id: 'knowledge_graph_core', name: 'Knowledge Graph Core', description: 'Persistent graph nodes/edges with deterministic graph operations.', state: 'live', capabilities: ['node-management', 'edge-management', 'graph-search', 'related-traversal', 'provenance-links'] },
  { id: 'memory_service', name: 'Memory Service', description: 'Conversation and contextual memory storage/retrieval.', state: 'live', capabilities: ['save', 'list', 'search', 'proposal-candidates'] },
  { id: 'proposal_queue', name: 'Proposal Queue', description: 'Explicit review queue for graph-affecting suggestions.', state: 'live', capabilities: ['proposal-staging', 'inspect', 'accept', 'reject', 'audit-trail'] },
  { id: 'activity_log', name: 'Activity Log', description: 'Chronological event log across core system operations.', state: 'live', capabilities: ['event-recording', 'timeline-inspection'] },
  { id: 'roadmap_service', name: 'Roadmap Service', description: 'Project roadmap and build-intention notes storage.', state: 'live', capabilities: ['roadmap-items', 'status-tracking'] },
  { id: 'tool_registry', name: 'Tool Registry', description: 'Central registration and execution point for deterministic tools.', state: 'live', capabilities: ['tool-discovery', 'tool-execution'] },
  { id: 'agent_registry', name: 'Agent Registry', description: 'Known agents and lifecycle metadata.', state: 'live', capabilities: ['agent-discovery'] },
];

export function getSubsystemRegistry() {
  return base.map((entry) => {
    if (entry.id === 'simulation_core') return { ...entry, health: simulationEngine.getStatus() };
    if (entry.id === 'simulation_history') return { ...entry, health: simulationHistoryService.getStatus() };
    if (entry.id === 'knowledge_graph_core') return { ...entry, health: knowledgeGraphService.getStatus() };
    if (entry.id === 'memory_service') return { ...entry, health: memoryService.getStatus() };
    if (entry.id === 'proposal_queue') return { ...entry, health: proposalService.getStatus() };
    if (entry.id === 'activity_log') return { ...entry, health: activityLogService.getStatus() };
    if (entry.id === 'roadmap_service') return { ...entry, health: roadmapService.getStatus() };
    if (entry.id === 'tool_registry') return { ...entry, health: { registered_tools: getToolRegistry().length } };
    if (entry.id === 'agent_registry') return { ...entry, health: { registered_agents: listRegisteredAgents().length } };
    return { ...entry, health: { status: 'nominal' } };
  });
}

export function getSubsystem(id) {
  return getSubsystemRegistry().find((entry) => entry.id === id) ?? null;
}
