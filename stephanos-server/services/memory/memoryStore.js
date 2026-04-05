import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefaultMemoryStore, sanitizeDurableMemoryStore } from './memorySchema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DURABLE_MEMORY_STORAGE_PATH = path.resolve(__dirname, '../../data/memory/durable-memory.json');

function sortObjectKeys(input = {}) {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)));
}

export class DurableMemoryStore {
  constructor(storageFile = DURABLE_MEMORY_STORAGE_PATH) {
    this.storageFile = storageFile;
  }

  ensureStorage() {
    fs.mkdirSync(path.dirname(this.storageFile), { recursive: true });
    if (!fs.existsSync(this.storageFile)) {
      fs.writeFileSync(this.storageFile, JSON.stringify(createDefaultMemoryStore(), null, 2), 'utf8');
    }
  }

  readStore() {
    this.ensureStorage();
    try {
      const raw = fs.readFileSync(this.storageFile, 'utf8');
      return sanitizeDurableMemoryStore(JSON.parse(raw || '{}'));
    } catch {
      const fallback = createDefaultMemoryStore();
      this.writeStore(fallback);
      return fallback;
    }
  }

  writeStore(store = {}) {
    this.ensureStorage();
    const normalized = sanitizeDurableMemoryStore(store);
    const deterministic = {
      schemaVersion: normalized.schemaVersion,
      updatedAt: new Date().toISOString(),
      itemsByKey: sortObjectKeys(normalized.itemsByKey),
    };
    fs.writeFileSync(this.storageFile, `${JSON.stringify(deterministic, null, 2)}\n`, 'utf8');
    return deterministic;
  }

  upsert(record = {}) {
    const store = this.readStore();
    const key = String(record.key || '').trim();
    if (!key) {
      throw new Error('Durable memory upsert requires record.key');
    }

    const existing = store.itemsByKey[key];
    const merged = {
      ...(existing || {}),
      ...record,
      key,
      createdAt: existing?.createdAt || record.createdAt,
      updatedAt: new Date().toISOString(),
      ...(existing?.id ? { id: existing.id } : {}),
    };

    const next = {
      ...store,
      itemsByKey: {
        ...store.itemsByKey,
        [key]: merged,
      },
    };

    return this.writeStore(next).itemsByKey[key];
  }

  list() {
    const store = this.readStore();
    return Object.values(store.itemsByKey);
  }
}

export const durableMemoryStore = new DurableMemoryStore();
