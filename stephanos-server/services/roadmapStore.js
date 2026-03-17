import path from 'node:path';
import { ensureDir, nowIso, readJsonFile, writeJsonAtomic } from './storageUtils.js';

const DATA_DIR = path.resolve(process.cwd(), 'data', 'roadmap');
const ROADMAP_FILE = path.join(DATA_DIR, 'roadmap.json');

class RoadmapStore {
  ensureStorage() {
    ensureDir(DATA_DIR);
    const data = readJsonFile(ROADMAP_FILE, null);
    if (!data) writeJsonAtomic(ROADMAP_FILE, { items: [] });
  }

  readItems() {
    this.ensureStorage();
    const parsed = readJsonFile(ROADMAP_FILE, { items: [] });
    return Array.isArray(parsed.items) ? parsed.items : [];
  }

  writeItems(items = []) {
    this.ensureStorage();
    writeJsonAtomic(ROADMAP_FILE, { items, updated_at: nowIso() });
  }

  getStatus() {
    this.ensureStorage();
    return { storage: ROADMAP_FILE, item_count: this.readItems().length };
  }
}

export const roadmapStore = new RoadmapStore();
