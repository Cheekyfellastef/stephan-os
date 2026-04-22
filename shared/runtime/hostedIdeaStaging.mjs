const MAX_STAGED_ITEMS = 120;

export const HOSTED_STAGED_ITEM_TYPES = Object.freeze([
  'idea',
  'mission',
  'roadmap-item',
  'memory-candidate',
  'handoff',
  'retrieval-candidate',
]);

export const HOSTED_STAGED_ITEM_STATUSES = Object.freeze([
  'staged',
  'reviewed',
  'approved',
  'rejected',
  'promoted',
  'expired',
]);

export const HOSTED_PROMOTION_TARGETS = Object.freeze([
  'durable-memory',
  'roadmap',
  'mission-lineage',
  'graph-link',
  'retrieval-index',
  'handoff-archive',
]);

function asTrimmedString(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function asTimestamp(value, fallback) {
  const normalized = asTrimmedString(value);
  const parsed = Date.parse(normalized);
  if (!normalized || Number.isNaN(parsed)) {
    return fallback;
  }
  return new Date(parsed).toISOString();
}

function asConfidence(value, fallback = 0.5) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(1, Math.max(0, next));
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => asTrimmedString(entry)).filter(Boolean))].slice(0, 24);
}

function createHostedStagedItemId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `stg_${globalThis.crypto.randomUUID()}`;
  }
  return `stg_${Date.now()}_${Math.round(Math.random() * 100000)}`;
}

export function normalizeHostedStagedItem(item = {}, { now = new Date().toISOString() } = {}) {
  const source = item && typeof item === 'object' ? item : {};
  const createdAt = asTimestamp(source.createdAt, now);
  const updatedAt = asTimestamp(source.updatedAt, createdAt);
  const type = HOSTED_STAGED_ITEM_TYPES.includes(source.type)
    ? source.type
    : 'idea';
  const status = HOSTED_STAGED_ITEM_STATUSES.includes(source.status)
    ? source.status
    : 'staged';
  const promotionTarget = HOSTED_PROMOTION_TARGETS.includes(source.promotionTarget)
    ? source.promotionTarget
    : 'durable-memory';

  return {
    id: asTrimmedString(source.id, createHostedStagedItemId()),
    type,
    title: asTrimmedString(source.title, `${type} candidate`),
    summary: asTrimmedString(source.summary),
    content: asTrimmedString(source.content || source.body),
    sourceSurface: asTrimmedString(source.sourceSurface, 'mission-console'),
    sourceProvider: asTrimmedString(source.sourceProvider, 'unknown'),
    sourceAuthorityLevel: asTrimmedString(source.sourceAuthorityLevel, 'hosted-observer'),
    createdAt,
    updatedAt,
    status,
    promotionTarget,
    confidence: asConfidence(source.confidence, 0.5),
    tags: normalizeTags(source.tags),
    linkedMissionId: asTrimmedString(source.linkedMissionId),
    linkedPacketId: asTrimmedString(source.linkedPacketId),
    promotionState: asTrimmedString(source.promotionState, status === 'promoted' ? 'completed' : 'pending'),
    promotionReason: asTrimmedString(source.promotionReason),
    sourceMode: asTrimmedString(source.sourceMode, 'hosted-cognition'),
    canonicalEligibility: source.canonicalEligibility === true,
    exportPayload: asTrimmedString(source.exportPayload),
  };
}

export function createDefaultHostedIdeaStagingQueue() {
  return {
    schemaVersion: 1,
    items: [],
    lastUpdatedAt: '',
  };
}

export function normalizeHostedIdeaStagingQueue(value = {}, { now = new Date().toISOString() } = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const items = Array.isArray(source.items)
    ? source.items.map((entry) => normalizeHostedStagedItem(entry, { now })).slice(-MAX_STAGED_ITEMS)
    : [];
  return {
    schemaVersion: 1,
    items,
    lastUpdatedAt: asTimestamp(source.lastUpdatedAt, items.at(-1)?.updatedAt || ''),
  };
}

export function applyHostedIdeaStagingAction(queue, action = {}, { now = new Date().toISOString(), localAuthorityAvailable = false } = {}) {
  const normalizedQueue = normalizeHostedIdeaStagingQueue(queue, { now });
  const type = asTrimmedString(action.type).toLowerCase();
  const targetId = asTrimmedString(action.id);
  const stamp = asTimestamp(now, new Date().toISOString());

  if (type === 'clear') {
    return {
      queue: createDefaultHostedIdeaStagingQueue(),
      item: null,
    };
  }

  if (type === 'add') {
    const nextItem = normalizeHostedStagedItem({
      ...(action.item || {}),
      status: 'staged',
      canonicalEligibility: false,
      promotionState: 'pending',
      promotionReason: asTrimmedString(action.item?.promotionReason),
      createdAt: stamp,
      updatedAt: stamp,
    }, { now: stamp });
    return {
      queue: {
        ...normalizedQueue,
        items: [...normalizedQueue.items, nextItem].slice(-MAX_STAGED_ITEMS),
        lastUpdatedAt: stamp,
      },
      item: nextItem,
    };
  }

  const nextItems = normalizedQueue.items.map((entry) => {
    if (entry.id !== targetId) return entry;

    if (type === 'update') {
      return normalizeHostedStagedItem({
        ...entry,
        ...(action.patch || {}),
        updatedAt: stamp,
      }, { now: stamp });
    }

    if (type === 'review') {
      return { ...entry, status: 'reviewed', updatedAt: stamp };
    }

    if (type === 'approve') {
      return { ...entry, status: 'approved', promotionState: 'queued', updatedAt: stamp };
    }

    if (type === 'reject') {
      return {
        ...entry,
        status: 'rejected',
        promotionState: 'rejected',
        promotionReason: asTrimmedString(action.reason, 'Rejected by operator.'),
        updatedAt: stamp,
      };
    }

    if (type === 'promote') {
      if (!localAuthorityAvailable) {
        return {
          ...entry,
          promotionState: 'deferred',
          promotionReason: asTrimmedString(action.reason, 'Promotion deferred until trusted persistence is available.'),
          updatedAt: stamp,
        };
      }

      return {
        ...entry,
        status: 'promoted',
        promotionState: 'completed',
        promotionReason: asTrimmedString(action.reason, 'Promoted through trusted persistence path.'),
        canonicalEligibility: true,
        updatedAt: stamp,
      };
    }

    if (type === 'expire') {
      return {
        ...entry,
        status: 'expired',
        promotionState: 'expired',
        promotionReason: asTrimmedString(action.reason, 'Expired from staging queue.'),
        updatedAt: stamp,
      };
    }

    return entry;
  });

  const resolvedItem = targetId
    ? nextItems.find((entry) => entry.id === targetId) || null
    : null;

  return {
    queue: {
      ...normalizedQueue,
      items: nextItems,
      lastUpdatedAt: stamp,
    },
    item: resolvedItem,
  };
}

export function buildHostedStagingHandoffPayload(item = {}) {
  const normalized = normalizeHostedStagedItem(item);
  return [
    `Hosted staged item: ${normalized.title}`,
    `Type: ${normalized.type}`,
    `Status: ${normalized.status}`,
    `Promotion target: ${normalized.promotionTarget}`,
    `Promotion state: ${normalized.promotionState}`,
    `Source provider: ${normalized.sourceProvider}`,
    `Summary: ${normalized.summary || 'n/a'}`,
    normalized.content ? `Content: ${normalized.content}` : '',
  ].filter(Boolean).join('\n');
}
