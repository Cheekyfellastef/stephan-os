export const STEPHANOS_DURABLE_MEMORY_STORAGE_KEY = 'stephanos.durable.memory.v2';
export const STEPHANOS_DURABLE_MEMORY_SCHEMA_VERSION = 2;

export const STEPHANOS_MEMORY_RECORD_TYPES = Object.freeze([
  'operator.preference',
  'operator.goal',
  'ai.decision',
  'ai.summary',
  'tile.event',
  'tile.result',
  'workspace.state',
  'route.diagnostic',
  'truth.contradiction',
  'law.violation',
  'simulation.result',
  'continuity.note',
  'note',
]);

const VALID_IMPORTANCE = new Set(['low', 'normal', 'high', 'critical']);

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

function isAllowedRecordType(type = '') {
  const normalized = normalizeString(type);
  return STEPHANOS_MEMORY_RECORD_TYPES.includes(normalized) || /^[a-z]+(?:\.[a-z0-9-]+)+$/i.test(normalized);
}

function normalizeRecordShape(record = {}, { source = 'runtime', surface = 'localhost' } = {}) {
  const now = new Date().toISOString();
  const normalizedType = normalizeString(record.type || 'note', 'note');

  if (!isAllowedRecordType(normalizedType)) {
    throw new Error(`Stephanos memory record type is invalid or ungoverned: ${normalizedType}`);
  }

  const normalizedImportance = normalizeString(record.importance || 'normal', 'normal').toLowerCase();
  if (!VALID_IMPORTANCE.has(normalizedImportance)) {
    throw new Error(`Stephanos memory importance must be one of: ${Array.from(VALID_IMPORTANCE).join(', ')}`);
  }

  const normalizedPayload = record.payload && typeof record.payload === 'object'
    ? record.payload
    : { value: record.payload };

  return {
    schemaVersion: Number(record.schemaVersion) || STEPHANOS_DURABLE_MEMORY_SCHEMA_VERSION,
    type: normalizedType,
    source: normalizeString(record.source, source),
    scope: normalizeString(record.scope, 'runtime'),
    summary: normalizeString(record.summary || record.title),
    payload: normalizedPayload,
    tags: normalizeTagList(record.tags),
    importance: normalizedImportance,
    retentionHint: normalizeString(record.retentionHint || 'default', 'default'),
    createdAt: normalizeString(record.createdAt, now),
    updatedAt: normalizeString(record.updatedAt, now),
    surface: normalizeString(record.surface, surface),
  };
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

    const records = Object.fromEntries(
      Object.entries(parsed.records || {}).map(([key, value]) => {
        const normalized = normalizeRecordShape(value || {});
        return [key, normalized];
      }),
    );

    return {
      schemaVersion: STEPHANOS_DURABLE_MEMORY_SCHEMA_VERSION,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      records,
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
    // no-op: keep runtime usable when storage is blocked.
  }
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
    const allRecords = Object.entries(state.records || {}).map(([key, record]) => {
      const [namespace = 'default', id = ''] = String(key).split('::');
      return {
        namespace,
        id,
        ...record,
        title: record.summary,
        recordSource: record.source,
        recordSurface: record.surface,
      };
    });

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
    schemaVersion = STEPHANOS_DURABLE_MEMORY_SCHEMA_VERSION,
    type = 'note',
    source: recordSource = source,
    scope = 'runtime',
    summary = '',
    title = '',
    payload = {},
    tags = [],
    importance = 'normal',
    retentionHint = 'default',
    recordSurface = surface,
    createdAt,
    updatedAt,
  } = {}) {
    const identity = normalizeRecordIdentity({ namespace, id });
    if (!identity) {
      throw new Error('Stephanos memory saveRecord requires a non-empty id.');
    }

    const state = adapter.readState();
    const existing = state.records?.[identity.key] || null;
    const now = new Date().toISOString();
    const normalizedRecord = normalizeRecordShape({
      schemaVersion,
      type,
      source: recordSource,
      scope,
      summary: summary || title,
      payload,
      tags,
      importance,
      retentionHint,
      surface: recordSurface,
      createdAt: existing?.createdAt || createdAt || now,
      updatedAt: updatedAt || now,
    }, { source, surface });

    const nextRecords = {
      ...(state.records || {}),
      [identity.key]: normalizedRecord,
    };
    persistRecords(nextRecords);

    return {
      namespace: identity.namespace,
      id: identity.id,
      ...normalizedRecord,
      title: normalizedRecord.summary,
      recordSource: normalizedRecord.source,
      recordSurface: normalizedRecord.surface,
    };
  }

  function getRecord({ namespace = 'default', id } = {}) {
    const identity = normalizeRecordIdentity({ namespace, id });
    if (!identity) {
      return null;
    }

    const state = adapter.readState();
    const record = state.records?.[identity.key] || null;
    if (!record) {
      return null;
    }

    return {
      namespace: identity.namespace,
      id: identity.id,
      ...record,
      title: record.summary,
      recordSource: record.source,
      recordSurface: record.surface,
    };
  }

  function updateRecord({ namespace = 'default', id, patch = {} } = {}) {
    const current = getRecord({ namespace, id });
    if (!current) {
      return null;
    }

    return saveRecord({
      namespace,
      id,
      schemaVersion: patch.schemaVersion ?? current.schemaVersion,
      type: patch.type ?? current.type,
      source: patch.source ?? current.source,
      scope: patch.scope ?? current.scope,
      summary: patch.summary ?? patch.title ?? current.summary,
      payload: patch.payload ?? current.payload,
      tags: patch.tags ?? current.tags,
      importance: patch.importance ?? current.importance,
      retentionHint: patch.retentionHint ?? current.retentionHint,
      recordSurface: patch.surface ?? patch.recordSurface ?? current.surface,
      createdAt: current.createdAt,
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

function createMemoryRecordId(prefix = 'record') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createStephanosMemoryGateway(memory, { namespace = 'continuity', source = 'runtime-gateway' } = {}) {
  if (!memory || typeof memory.saveRecord !== 'function') {
    throw new Error('Stephanos memory gateway requires a Stephanos memory instance.');
  }

  function persistTypedRecord({
    id,
    type,
    summary,
    payload = {},
    tags = [],
    scope = 'runtime',
    importance = 'normal',
    retentionHint = 'default',
  } = {}) {
    return memory.saveRecord({
      namespace,
      id: normalizeString(id, createMemoryRecordId(type || 'record')),
      type,
      source,
      scope,
      summary,
      payload,
      tags,
      importance,
      retentionHint,
    });
  }

  function persistEventRecord(eventEnvelope = {}) {
    const eventName = normalizeString(eventEnvelope.name, 'event.unknown');
    const eventData = eventEnvelope.data && typeof eventEnvelope.data === 'object' ? eventEnvelope.data : {};
    const type = eventName.startsWith('tile.') ? 'tile.event'
      : eventName.startsWith('truth.') ? 'truth.contradiction'
        : eventName.startsWith('law.') ? 'law.violation'
          : eventName.startsWith('workspace.') ? 'workspace.state'
            : eventName.startsWith('ai.') ? 'ai.summary'
              : 'continuity.note';

    return persistTypedRecord({
      id: normalizeString(eventData.id, createMemoryRecordId(eventName.replace(/\W+/g, '-'))),
      type,
      summary: normalizeString(eventData.summary || eventData.message || eventName, eventName),
      payload: {
        eventName,
        ...eventData,
      },
      scope: normalizeString(eventData.scope, 'runtime'),
      tags: normalizeTagList([eventName, ...(Array.isArray(eventData.tags) ? eventData.tags : [])]),
      importance: normalizeString(eventData.importance, 'normal').toLowerCase(),
    });
  }

  return {
    persistTypedRecord,
    persistEventRecord,
  };
}
