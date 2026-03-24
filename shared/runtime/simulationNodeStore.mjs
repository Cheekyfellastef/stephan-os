const DEFAULT_NAMESPACE = 'stephanos.simulationNodes.v1';

export const SIMULATION_NODE_CATEGORIES = Object.freeze({
  ideas: 'ideas',
  missions: 'missions',
  experiments: 'experiments',
});

const ALLOWED_MEDIA_TYPES = new Set(['text', 'image', 'video', 'audio', 'link']);

function normalizeString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function sanitizeMediaRef(value) {
  const input = value && typeof value === 'object' ? value : {};
  const type = normalizeString(input.type).toLowerCase();
  const title = normalizeString(input.title);
  const source = normalizeString(input.source);
  const notes = normalizeString(input.notes);

  if (!ALLOWED_MEDIA_TYPES.has(type) || !title || !source) {
    return null;
  }

  return {
    type,
    title,
    source,
    notes,
  };
}

function sanitizeNodeRecord(value, category) {
  const input = value && typeof value === 'object' ? value : {};
  const id = normalizeString(input.id);
  const title = normalizeString(input.title);
  const summary = normalizeString(input.summary);
  const createdAt = normalizeString(input.createdAt);
  const updatedAt = normalizeString(input.updatedAt);
  const tags = normalizeArray(input.tags).map((tag) => normalizeString(tag)).filter(Boolean);
  const media = normalizeArray(input.media).map(sanitizeMediaRef).filter(Boolean);

  if (!id || !title) {
    return null;
  }

  return {
    id,
    category,
    title,
    summary,
    tags,
    media,
    createdAt,
    updatedAt,
  };
}

function safeParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function createStorageAdapter(storage) {
  const adapter = storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
    ? storage
    : null;

  return {
    read(key) {
      if (!adapter) return null;
      const raw = adapter.getItem(key);
      return raw ? safeParseJson(raw) : null;
    },
    write(key, value) {
      if (!adapter) return;
      adapter.setItem(key, JSON.stringify(value));
    },
  };
}

export function createSimulationNodeStore({
  category = SIMULATION_NODE_CATEGORIES.ideas,
  storage = globalThis?.localStorage,
  namespace = DEFAULT_NAMESPACE,
} = {}) {
  const validCategory = Object.values(SIMULATION_NODE_CATEGORIES).includes(category)
    ? category
    : SIMULATION_NODE_CATEGORIES.ideas;
  const storageKey = `${namespace}.${validCategory}`;
  const adapter = createStorageAdapter(storage);

  function readAll() {
    const payload = adapter.read(storageKey);
    const records = normalizeArray(payload?.records)
      .map((record) => sanitizeNodeRecord(record, validCategory))
      .filter(Boolean)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

    return records;
  }

  function writeAll(records) {
    const sanitized = normalizeArray(records)
      .map((record) => sanitizeNodeRecord(record, validCategory))
      .filter(Boolean);

    adapter.write(storageKey, {
      schemaVersion: 1,
      category: validCategory,
      records: sanitized,
    });

    return sanitized;
  }

  function upsert(record) {
    const now = new Date().toISOString();
    const candidate = sanitizeNodeRecord({
      ...record,
      id: normalizeString(record?.id) || `node_${Date.now()}`,
      createdAt: normalizeString(record?.createdAt) || now,
      updatedAt: now,
    }, validCategory);

    if (!candidate) {
      throw new Error('Invalid simulation node record.');
    }

    const current = readAll();
    const next = [candidate, ...current.filter((entry) => entry.id !== candidate.id)];
    return writeAll(next);
  }

  return {
    category: validCategory,
    readAll,
    writeAll,
    upsert,
  };
}
