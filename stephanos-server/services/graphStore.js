import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../utils/logger.js';
import { createError, ERROR_CODES } from './errors.js';

const logger = createLogger('graph-store');
const KG_DIR = path.resolve(process.cwd(), 'data', 'knowledge-graph');
const NODES_FILE = path.join(KG_DIR, 'nodes.json');
const EDGES_FILE = path.join(KG_DIR, 'edges.json');

function writeJsonAtomic(filePath, payload) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

export class GraphStore {
  ensureStorage() {
    if (!fs.existsSync(KG_DIR)) {
      fs.mkdirSync(KG_DIR, { recursive: true });
      logger.info('Created graph data directory', { directory: KG_DIR });
    }

    if (!fs.existsSync(NODES_FILE)) {
      writeJsonAtomic(NODES_FILE, { nodes: [] });
      logger.info('Initialized nodes storage', { file: NODES_FILE });
    }

    if (!fs.existsSync(EDGES_FILE)) {
      writeJsonAtomic(EDGES_FILE, { edges: [] });
      logger.info('Initialized edges storage', { file: EDGES_FILE });
    }
  }

  readCollection(filePath, key) {
    this.ensureStorage();

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const collection = parsed?.[key];
      if (!Array.isArray(collection)) {
        throw new Error(`Invalid graph state: '${key}' is not an array.`);
      }

      return collection;
    } catch (error) {
      logger.error(`Failed to read ${key}`, { filePath, message: error.message });
      throw createError(ERROR_CODES.KG_STORAGE_FAILURE, `Graph storage read failed for ${key}: ${error.message}`, { status: 500 });
    }
  }

  writeCollection(filePath, key, items) {
    this.ensureStorage();

    try {
      writeJsonAtomic(filePath, { [key]: items });
      logger.debug(`Persisted ${key}`, { filePath, count: items.length });
      return { ok: true, filePath, key, count: items.length };
    } catch (error) {
      logger.error(`Failed to persist ${key}`, { filePath, message: error.message });
      throw createError(ERROR_CODES.KG_STORAGE_FAILURE, `Graph storage write failed for ${key}: ${error.message}`, { status: 500 });
    }
  }

  readNodes() {
    return this.readCollection(NODES_FILE, 'nodes');
  }

  writeNodes(nodes) {
    return this.writeCollection(NODES_FILE, 'nodes', nodes);
  }

  readEdges() {
    return this.readCollection(EDGES_FILE, 'edges');
  }

  writeEdges(edges) {
    return this.writeCollection(EDGES_FILE, 'edges', edges);
  }

  getStatus() {
    this.ensureStorage();
    return {
      state: 'live',
      directory: KG_DIR,
      nodes_file: NODES_FILE,
      edges_file: EDGES_FILE,
    };
  }
}

export const graphStore = new GraphStore();
