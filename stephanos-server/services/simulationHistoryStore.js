import path from 'node:path';
import { ensureDir, nowIso, readJsonFile, writeJsonAtomic } from './storageUtils.js';

const DATA_DIR = path.resolve(process.cwd(), 'data', 'simulations');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

class SimulationHistoryStore {
  ensureStorage() {
    ensureDir(DATA_DIR);
    const data = readJsonFile(HISTORY_FILE, null);
    if (!data) writeJsonAtomic(HISTORY_FILE, { runs: [] });
  }

  readRuns() {
    this.ensureStorage();
    const parsed = readJsonFile(HISTORY_FILE, { runs: [] });
    return Array.isArray(parsed.runs) ? parsed.runs : [];
  }

  writeRuns(runs = []) {
    this.ensureStorage();
    writeJsonAtomic(HISTORY_FILE, { runs, updated_at: nowIso() });
  }

  getStatus() {
    this.ensureStorage();
    return { storage: HISTORY_FILE, run_count: this.readRuns().length };
  }
}

export const simulationHistoryStore = new SimulationHistoryStore();
