import path from 'node:path';
import { ensureDir, nowIso, readJsonFile, writeJsonAtomic } from './storageUtils.js';

const DATA_DIR = path.resolve(process.cwd(), 'data', 'activity');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');

class ActivityLogStore {
  ensureStorage() {
    ensureDir(DATA_DIR);
    const data = readJsonFile(EVENTS_FILE, null);
    if (!data) writeJsonAtomic(EVENTS_FILE, { events: [] });
  }

  readEvents() {
    this.ensureStorage();
    const parsed = readJsonFile(EVENTS_FILE, { events: [] });
    return Array.isArray(parsed.events) ? parsed.events : [];
  }

  writeEvents(events = []) {
    this.ensureStorage();
    writeJsonAtomic(EVENTS_FILE, { events, updated_at: nowIso() });
  }

  getStatus() {
    this.ensureStorage();
    return { storage: EVENTS_FILE, event_count: this.readEvents().length };
  }
}

export const activityLogStore = new ActivityLogStore();
