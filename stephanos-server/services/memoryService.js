import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../utils/logger.js';
import { createError, ERROR_CODES } from './errors.js';
import { activityLogService } from './activityLogService.js';

const logger = createLogger('memory-service');
const DATA_DIR = path.resolve(process.cwd(), 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');

class MemoryService {
  constructor() {
    this.memory = [];
    this.loaded = false;
  }

  ensureStorage() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(MEMORY_FILE)) {
      fs.writeFileSync(MEMORY_FILE, JSON.stringify({ items: [] }, null, 2), 'utf8');
    }
  }

  load() {
    if (this.loaded) return;

    this.ensureStorage();
    const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    this.memory = Array.isArray(parsed.items) ? parsed.items : [];
    this.loaded = true;
  }

  persist() {
    this.ensureStorage();
    fs.writeFileSync(MEMORY_FILE, JSON.stringify({ items: this.memory }, null, 2), 'utf8');
  }

  listMemory() {
    this.load();
    return [...this.memory];
  }

  getById(id) {
    this.load();
    const item = this.memory.find((entry) => entry.id === id);
    if (!item) throw createError(ERROR_CODES.MEMORY_NOT_FOUND, `Memory item '${id}' was not found.`, { status: 404 });
    return item;
  }

  saveMemory(item) {
    this.load();
    const now = new Date().toISOString();
    const nextId = `mem_${Date.now()}`;
    const entry = {
      id: item.id ?? nextId,
      text: item.text,
      tags: Array.isArray(item.tags) ? item.tags : (String(item.tags ?? '').split(',').map((v) => v.trim()).filter(Boolean)),
      created_at: item.created_at ?? now,
      updated_at: now,
    };

    this.memory.push(entry);
    this.persist();
    logger.info('Saved memory entry', { id: entry.id });
    activityLogService.record({ type: 'memory_item_saved', subsystem: 'memory_service', summary: `Saved memory ${entry.id}.`, payload: { id: entry.id, tags: entry.tags } });
    return entry;
  }

  findMemory(query = '') {
    this.load();
    const normalized = query.toLowerCase().trim();
    if (!normalized) return [];

    return this.memory.filter((entry) => entry.text.toLowerCase().includes(normalized));
  }

  getRelevantMemory(query = '') {
    return this.findMemory(query).slice(-5);
  }

  getStatus() {
    this.load();
    return {
      storage: MEMORY_FILE,
      loaded: this.loaded,
      items: this.memory.length,
    };
  }
}

export const memoryService = new MemoryService();
