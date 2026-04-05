import crypto from 'node:crypto';

const MEMORY_CLASS = 'durable';
const VALID_SOURCE_TYPES = new Set(['handoff', 'snapshot', 'operator', 'system']);
const VALID_CONFIDENCE = new Set(['low', 'medium', 'high']);

function asString(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function asStructuredValue(value) {
  if (value && typeof value === 'object') {
    return value;
  }
  return asString(value);
}

function sanitizeTags(tags = []) {
  if (!Array.isArray(tags)) return [];
  return tags.map((tag) => asString(tag)).filter(Boolean);
}

export function normalizeMemoryCandidate(candidate = {}) {
  const source = candidate && typeof candidate === 'object' ? candidate : {};
  const sourceType = asString(source.sourceType, 'operator').toLowerCase();
  const memoryConfidence = asString(source.memoryConfidence, 'medium').toLowerCase();

  return {
    key: asString(source.key),
    value: asStructuredValue(source.value),
    sourceType: VALID_SOURCE_TYPES.has(sourceType) ? sourceType : 'operator',
    sourceRef: asString(source.sourceRef),
    memoryReason: asString(source.memoryReason),
    memoryConfidence: VALID_CONFIDENCE.has(memoryConfidence) ? memoryConfidence : 'medium',
    tags: sanitizeTags(source.tags),
    supersedes: asString(source.supersedes),
    memoryClass: MEMORY_CLASS,
  };
}

export function createMemoryId({ key = '', sourceRef = '', createdAt = '' } = {}) {
  const seed = `${key}::${sourceRef}::${createdAt}`;
  return `mem_${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16)}`;
}

export function createDurableMemoryRecord(candidate = {}, clock = () => new Date().toISOString()) {
  const normalized = normalizeMemoryCandidate(candidate);
  const now = asString(clock(), new Date().toISOString());
  const id = createMemoryId({
    key: normalized.key,
    sourceRef: normalized.sourceRef,
    createdAt: now,
  });

  return {
    id,
    memoryClass: MEMORY_CLASS,
    key: normalized.key,
    value: normalized.value,
    sourceType: normalized.sourceType,
    sourceRef: normalized.sourceRef,
    memoryReason: normalized.memoryReason,
    memoryConfidence: normalized.memoryConfidence,
    createdAt: now,
    updatedAt: now,
    ...(normalized.supersedes ? { supersedes: normalized.supersedes } : {}),
    ...(normalized.tags.length > 0 ? { tags: normalized.tags } : {}),
  };
}

export function createDefaultMemoryStore() {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    itemsByKey: {},
  };
}

export function sanitizeDurableMemoryStore(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const itemsByKeySource = source.itemsByKey && typeof source.itemsByKey === 'object' ? source.itemsByKey : {};
  const itemsByKey = Object.fromEntries(
    Object.entries(itemsByKeySource)
      .map(([key, value]) => [asString(key), value && typeof value === 'object' ? value : null])
      .filter(([key, value]) => key && value),
  );

  return {
    schemaVersion: 1,
    updatedAt: asString(source.updatedAt, new Date().toISOString()),
    itemsByKey,
  };
}
