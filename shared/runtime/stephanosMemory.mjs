export const STEPHANOS_DURABLE_MEMORY_STORAGE_KEY = 'stephanos.durable.memory.v1';
export const STEPHANOS_DURABLE_MEMORY_SCHEMA_VERSION = 1;

function createDefaultState() {
  return {
    schemaVersion: STEPHANOS_DURABLE_MEMORY_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    records: {},
  };
}

function isStorageAvailable(storage) {
  return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function';
}

function readStorageState(storage, storageKey) {
  if (!isStorageAvailable(storage)) {
    return createDefaultState();
  }

  try {
    const raw = storage.getItem(storageKey);
    if (!raw) {
      return createDefaultState();
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.records !== 'object') {
      return createDefaultState();
    }
    return {
      schemaVersion: STEPHANOS_DURABLE_MEMORY_SCHEMA_VERSION,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      records: { ...parsed.records },
    };
  } catch {
    return createDefaultState();
  }
}

function writeStorageState(storage, storageKey, state) {
  if (!isStorageAvailable(storage)) {
    return;
  }

  try {
    storage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // no-op: keep runtime usable even when storage is blocked.
  }
}

function normalizeString(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeTagList(tags = []) {
  if (!Array.isArray(tags)) {
    return [];
  }
  return [...new Set(tags.map((tag) => normalizeString(tag)).filter(Boolean))];
}

function normalizeRecordIdentity({ namespace = 'default', id }) {
  const normalizedNamespace = normalizeString(namespace, 'default');
  const normalizedId = normalizeString(id);
  if (!normalizedId) {
    return null;
  }

  return {
    namespace: normalizedNamespace,
    id: normalizedId,
    key: `${normalizedNamespace}::${normalizedId}`,
  };
}

function detectMemorySurfaceMode() {
  const hostname = String(globalThis.location?.hostname || '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'localhost';
  }
  return 'hosted';
}

function createStorageAdapter({
  storage = globalThis.localStorage,
  storageKey = STEPHANOS_DURABLE_MEMORY_STORAGE_KEY,
} = {}) {
  return {
    mode: 'browser-local-storage',
    readState: () => readStorageState(storage, storageKey),
    writeState: (state) => writeStorageState(storage, storageKey, state),
  };
}

export function createStephanosMemory({
  adapter = createStorageAdapter(),
  source = 'runtime',
  surface = detectMemorySurfaceMode(),
} = {}) {
  if (!adapter || typeof adapter.readState !== 'function' || typeof adapter.writeState !== 'function') {
    throw new Error('Stephanos memory requires a valid adapter with readState/writeState.');
  }

  function persistRecords(records) {
    adapter.writeState({
      schemaVersion: STEPHANOS_DURABLE_MEMORY_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      records,
    });
  }

  function listRecords(filters = {}) {
    const state = adapter.readState();
    const allRecords = Object.values(state.records || {});
    return allRecords.filter((record) => {
      if (filters.namespace && record.namespace !== filters.namespace) {
        return false;
      }
      if (filters.type && record.type !== filters.type) {
        return false;
      }
      if (filters.surface && record.surface !== filters.surface) {
        return false;
      }
      if (filters.tag && !(record.tags || []).includes(filters.tag)) {
        return false;
      }
      return true;
    });
  }

  function saveRecord({
    namespace = 'default',
    id,
    type = 'note',
    title = '',
    payload = {},
    tags = [],
    recordSource = source,
    recordSurface = surface,
  } = {}) {
    const identity = normalizeRecordIdentity({ namespace, id });
    if (!identity) {
      throw new Error('Stephanos memory saveRecord requires a non-empty id.');
    }

    const state = adapter.readState();
    const existing = state.records?.[identity.key] || null;
    const now = new Date().toISOString();
    const nextRecord = {
      namespace: identity.namespace,
      id: identity.id,
      type: normalizeString(type, 'note'),
      title: normalizeString(title),
      payload: payload && typeof payload === 'object' ? payload : { value: payload },
      source: normalizeString(recordSource, source),
      surface: normalizeString(recordSurface, surface),
      tags: normalizeTagList(tags),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    const nextRecords = {
      ...(state.records || {}),
      [identity.key]: nextRecord,
    };
    persistRecords(nextRecords);
    return nextRecord;
  }

  function getRecord({ namespace = 'default', id } = {}) {
    const identity = normalizeRecordIdentity({ namespace, id });
    if (!identity) {
      return null;
    }
    const state = adapter.readState();
    return state.records?.[identity.key] || null;
  }

  function updateRecord({ namespace = 'default', id, patch = {} } = {}) {
    const current = getRecord({ namespace, id });
    if (!current) {
      return null;
    }
    return saveRecord({
      namespace,
      id,
      type: patch.type ?? current.type,
      title: patch.title ?? current.title,
      payload: patch.payload ?? current.payload,
      tags: patch.tags ?? current.tags,
      recordSource: patch.source ?? current.source,
      recordSurface: patch.surface ?? current.surface,
    });
  }

  function deleteRecord({ namespace = 'default', id } = {}) {
    const identity = normalizeRecordIdentity({ namespace, id });
    if (!identity) {
      return false;
    }

    const state = adapter.readState();
    if (!state.records?.[identity.key]) {
      return false;
    }

    const nextRecords = { ...(state.records || {}) };
    delete nextRecords[identity.key];
    persistRecords(nextRecords);
    return true;
  }

  return {
    surfaceMode: detectMemorySurfaceMode(),
    adapterMode: adapter.mode || 'custom',
    saveRecord,
    createRecord: saveRecord,
    getRecord,
    listRecords,
    updateRecord,
    deleteRecord,
  };
}

