import { memoryService } from '../memoryService.js';
import { knowledgeGraphService } from '../knowledgeGraphService.js';
import { listRegisteredAgents } from '../agentRegistry.js';

export const systemHealthSnapshotSimulation = {
  id: 'system-health-snapshot',
  name: 'System Health Snapshot',
  description: 'Returns a simulation-style status report for Stephanos subsystems.',
  category: 'diagnostics',
  state: 'live',
  input_schema: {
    includeDetails: 'optional boolean (default true)',
  },
  output_schema: {
    backend: 'online | offline',
    memory: 'status object',
    knowledgeGraph: 'status object',
    toolCount: 'number',
    agentCount: 'number',
    appVersion: 'string',
    timestamp: 'ISO datetime',
  },
  validateInput(input = {}) {
    const includeDetails = input.includeDetails ?? true;
    if (typeof includeDetails !== 'boolean') {
      throw new Error("'includeDetails' must be a boolean.");
    }

    return { includeDetails };
  },
  execute(input, context = {}) {
    const validated = this.validateInput(input);
    const memoryStatus = memoryService.getStatus();
    const graphStatus = knowledgeGraphService.getStatus();

    return {
      backend: 'online',
      memory: validated.includeDetails ? memoryStatus : { items: memoryStatus.items },
      knowledgeGraph: validated.includeDetails ? graphStatus : { loaded: graphStatus.loaded },
      toolCount: context.toolCount ?? 0,
      agentCount: listRegisteredAgents().length,
      appVersion: context.appVersion ?? process.env.APP_VERSION ?? '0.1.0',
      timestamp: new Date().toISOString(),
    };
  },
};
