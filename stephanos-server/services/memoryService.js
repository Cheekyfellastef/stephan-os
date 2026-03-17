import { createLogger } from '../utils/logger.js';

const logger = createLogger('memory-service');

class MemoryService {
  constructor() {
    /** @type {{ id: string, content: string, createdAt: string, tags?: string[] }[]} */
    this.memory = [];
  }

  getRelevantMemory(query) {
    if (!query) return [];

    const normalized = query.toLowerCase();
    const hits = this.memory
      .filter((item) => item.content.toLowerCase().includes(normalized))
      .slice(-5);

    logger.debug('Resolved memory hits', { query, count: hits.length });
    return hits;
  }

  saveMemory(item) {
    const entry = {
      id: item.id ?? `mem_${Date.now()}`,
      content: item.content,
      createdAt: item.createdAt ?? new Date().toISOString(),
      tags: item.tags ?? [],
    };

    this.memory.push(entry);
    logger.info('Saved memory entry', { id: entry.id });
    return entry;
  }

  listMemory() {
    return [...this.memory];
  }
}

export const memoryService = new MemoryService();
