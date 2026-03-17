import path from 'node:path';
import { ensureDir, nowIso, readJsonFile, writeJsonAtomic } from './storageUtils.js';

const DATA_DIR = path.resolve(process.cwd(), 'data', 'proposals');
const PROPOSALS_FILE = path.join(DATA_DIR, 'proposals.json');

class ProposalStore {
  ensureStorage() {
    ensureDir(DATA_DIR);
    const data = readJsonFile(PROPOSALS_FILE, null);
    if (!data) writeJsonAtomic(PROPOSALS_FILE, { proposals: [] });
  }

  readProposals() {
    this.ensureStorage();
    const parsed = readJsonFile(PROPOSALS_FILE, { proposals: [] });
    return Array.isArray(parsed.proposals) ? parsed.proposals : [];
  }

  writeProposals(proposals = []) {
    this.ensureStorage();
    writeJsonAtomic(PROPOSALS_FILE, { proposals, updated_at: nowIso() });
  }

  getStatus() {
    this.ensureStorage();
    return { storage: PROPOSALS_FILE, proposal_count: this.readProposals().length };
  }
}

export const proposalStore = new ProposalStore();
