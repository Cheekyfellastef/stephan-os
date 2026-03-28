import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('durable-memory-service');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const DURABLE_MEMORY_FILE = path.join(DATA_DIR, 'durable-memory.json');
const SCHEMA_VERSION = 2;

function normalizeString(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function createDefaultStore() {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    records: {},
  };
}

function sanitizeRecord(record = {}) {
  const source = record && typeof record === 'object' ? record : {};
  return {
    schemaVersion: Number(source.schemaVersion) || SCHEMA_VERSION,
    type: normalizeString(source.type, 'note'),
    source: normalizeString(source.source, 'runtime'),
    scope: normalizeString(source.scope, 'runtime'),
    summary: normalizeString(source.summary || source.title),
    payload: source.payload && typeof source.payload === 'object' ? source.payload : {},
    tags: Array.isArray(source.tags)
      ? source.tags.map((tag) => normalizeString(tag)).filter(Boolean)
      : [],
    importance: normalizeString(source.importance, 'normal'),
    retentionHint: normalizeString(source.retentionHint, 'default'),
    createdAt: normalizeString(source.createdAt, new Date().toISOString()),
    updatedAt: normalizeString(source.updatedAt, new Date().toISOString()),
    surface: normalizeString(source.surface, 'unknown'),
  };
}

function sanitizeStore(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const recordsSource = source.records && typeof source.records === 'object' ? source.records : {};
  const records = Object.fromEntries(
    Object.entries(recordsSource).map(([key, value]) => [normalizeString(key), sanitizeRecord(value)]).filter(([key]) => key),
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: normalizeString(source.updatedAt, new Date().toISOString()),
    records,
  };
}

export class DurableMemoryService {
  constructor(storageFile = DURABLE_MEMORY_FILE) {
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

    try {
      const raw = fs.readFileSync(this.storageFile, 'utf8');
      this.store = sanitizeStore(JSON.parse(raw || '{}'));
      this.loaded = true;
      logger.info('Loaded durable memory store', {
        file: this.storageFile,
        records: Object.keys(this.store.records || {}).length,
      });
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

  getStore() {
    this.load();
    return sanitizeStore(this.store);
  }

  setStore(payload = {}, source = 'runtime') {
    this.load();
    this.store = sanitizeStore({
      ...payload,
      updatedAt: new Date().toISOString(),
    });
    this.persist();
    logger.info('Saved durable memory store', {
      source: normalizeString(source, 'runtime'),
      records: Object.keys(this.store.records || {}).length,
    });
    return this.getStore();
  }
}

export const durableMemoryService = new DurableMemoryService();
