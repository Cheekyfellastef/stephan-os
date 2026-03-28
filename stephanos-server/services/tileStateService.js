import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('tile-state-service');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const TILE_STATE_FILE = path.join(DATA_DIR, 'tile-state.json');

function normalizeString(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function createDefaultStore() {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    items: {},
  };
}

function sanitizeTileStateEntry(appId, value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    appId: normalizeString(appId),
    schemaVersion: Number(source.schemaVersion) || 1,
    state: source.state && typeof source.state === 'object' ? source.state : {},
    source: normalizeString(source.source, 'unknown'),
    updatedAt: normalizeString(source.updatedAt, new Date().toISOString()),
  };
}

export class TileStateService {
  constructor(storageFile = TILE_STATE_FILE) {
    this.storageFile = storageFile;
    this.loaded = false;
    this.store = createDefaultStore();
  }

  ensureStorage() {
    fs.mkdirSync(path.dirname(this.storageFile), { recursive: true });
    if (!fs.existsSync(this.storageFile)) {
      fs.writeFileSync(this.storageFile, JSON.stringify(createDefaultStore(), null, 2), 'utf8');
    }
  }

  load() {
    if (this.loaded) {
      return this.store;
    }

    this.ensureStorage();
    const raw = fs.readFileSync(this.storageFile, 'utf8');

    try {
      const parsed = JSON.parse(raw || '{}');
      const items = parsed?.items && typeof parsed.items === 'object' ? parsed.items : {};
      const normalizedItems = Object.fromEntries(
        Object.entries(items)
          .map(([appId, entry]) => [normalizeString(appId), sanitizeTileStateEntry(appId, entry)])
          .filter(([appId]) => Boolean(appId)),
      );

      this.store = {
        schemaVersion: 1,
        updatedAt: normalizeString(parsed?.updatedAt, new Date().toISOString()),
        items: normalizedItems,
      };
      this.loaded = true;
      logger.info('Loaded shared tile state store', { file: this.storageFile, entries: Object.keys(normalizedItems).length });
      return this.store;
    } catch {
      this.store = createDefaultStore();
      this.persist();
      this.loaded = true;
      return this.store;
    }
  }

  persist() {
    fs.mkdirSync(path.dirname(this.storageFile), { recursive: true });
    this.store.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.storageFile, JSON.stringify(this.store, null, 2), 'utf8');
  }

  list() {
    this.load();
    return Object.values(this.store.items || {});
  }

  get(appId) {
    this.load();
    const normalizedAppId = normalizeString(appId);
    if (!normalizedAppId) {
      return null;
    }

    return this.store.items?.[normalizedAppId] || null;
  }

  set(appId, { schemaVersion = 1, state = {}, source = 'unknown' } = {}) {
    this.load();
    const normalizedAppId = normalizeString(appId);
    if (!normalizedAppId) {
      throw new Error('Tile state appId is required.');
    }

    const nextEntry = sanitizeTileStateEntry(normalizedAppId, {
      schemaVersion,
      state,
      source,
      updatedAt: new Date().toISOString(),
    });

    this.store.items[normalizedAppId] = nextEntry;
    this.persist();
    logger.info('Saved shared tile state', {
      appId: normalizedAppId,
      schemaVersion: nextEntry.schemaVersion,
      source: nextEntry.source,
    });
    return nextEntry;
  }

  delete(appId) {
    this.load();
    const normalizedAppId = normalizeString(appId);
    if (!normalizedAppId) {
      return false;
    }

    if (!this.store.items[normalizedAppId]) {
      return false;
    }

    delete this.store.items[normalizedAppId];
    this.persist();
    logger.info('Deleted shared tile state', { appId: normalizedAppId });
    return true;
  }
}

export const tileStateService = new TileStateService();
