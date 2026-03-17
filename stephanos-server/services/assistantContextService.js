import { getSubsystemRegistry } from './subsystemRegistry.js';
import { proposalService } from './proposalService.js';
import { knowledgeGraphService } from './knowledgeGraphService.js';
import { memoryService } from './memoryService.js';
import { simulationHistoryService } from './simulationHistoryService.js';
import { activityLogService } from './activityLogService.js';
import { roadmapService } from './roadmapService.js';

class AssistantContextService {
  buildContextBundle(options = {}) {
    const defaults = {
      include_subsystems: true,
      include_proposals: true,
      include_graph: true,
      include_memory: true,
      include_simulations: true,
      include_activity: true,
      include_roadmap: true,
      limit: 5,
    };
    const cfg = { ...defaults, ...options };

    return {
      subsystems: cfg.include_subsystems ? getSubsystemRegistry().map((s) => ({ id: s.id, state: s.state })) : undefined,
      proposal_summary: cfg.include_proposals ? proposalService.stats() : undefined,
      pending_proposals: cfg.include_proposals ? proposalService.list().filter((p) => p.status === 'pending').slice(0, cfg.limit) : undefined,
      graph_summary: cfg.include_graph ? knowledgeGraphService.getGraphStats() : undefined,
      recent_memory: cfg.include_memory ? memoryService.listMemory().slice(-cfg.limit) : undefined,
      recent_simulation_runs: cfg.include_simulations ? simulationHistoryService.list().slice(0, cfg.limit) : undefined,
      recent_activity: cfg.include_activity ? activityLogService.recent(cfg.limit) : undefined,
      roadmap_summary: cfg.include_roadmap ? roadmapService.getSummary() : undefined,
    };
  }
}

export const assistantContextService = new AssistantContextService();
