import { createError, ERROR_CODES } from './errors.js';
import { memoryService } from './memoryService.js';
import { proposalService } from './proposalService.js';

class MemoryProposalService {
  generateFromMemory(memoryItem) {
    const text = memoryItem.text;
    return proposalService.create({
      type: 'create_graph_node',
      sourceSubsystem: 'memory_service',
      summary: `Create graph node from memory: ${text.slice(0, 48)}`,
      payload: { label: text.slice(0, 64), type: 'memory_insight', description: text, tags: memoryItem.tags ?? [] },
      relatedMemoryIds: [memoryItem.id],
    });
  }

  proposeById(memoryId) {
    const item = memoryService.getById(memoryId);
    if (!item) throw createError(ERROR_CODES.MEMORY_NOT_FOUND, `Memory item '${memoryId}' was not found.`, { status: 404 });
    return this.generateFromMemory(item);
  }

  proposeRecent() {
    const items = memoryService.listMemory();
    if (!items.length) throw createError(ERROR_CODES.MEMORY_NOT_FOUND, 'No memory items available for proposal generation.', { status: 404 });
    const latest = items[items.length - 1];
    return this.generateFromMemory(latest);
  }
}

export const memoryProposalService = new MemoryProposalService();
