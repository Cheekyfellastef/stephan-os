export const BATTLE_BRIDGE_ELASTIC_MAILBOX_MAX_WIDTH = 5;
export const BATTLE_BRIDGE_ELASTIC_MAILBOX_MIN_WIDTH = 1;

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SAFE_RESOURCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,159}$/;
const TERMINAL_STATES = new Set(['COMPLETE', 'MERGED', 'DELIVERED', 'LIVE_PROVEN', 'CANCELLED']);

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clampWidth(value) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < BATTLE_BRIDGE_ELASTIC_MAILBOX_MIN_WIDTH) {
    return BATTLE_BRIDGE_ELASTIC_MAILBOX_MIN_WIDTH;
  }
  return Math.min(BATTLE_BRIDGE_ELASTIC_MAILBOX_MAX_WIDTH, numeric);
}

function safeResources(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    const resource = String(item || '').trim();
    if (!SAFE_RESOURCE_PATTERN.test(resource) || resource.includes('..')) return [];
    if (!result.includes(resource)) result.push(resource);
  }
  return result.slice(0, 32);
}

export function deriveBattleBridgeElasticMailboxWidth(capacity = {}, { now = new Date(), expectedHead = '' } = {}) {
  if (!plainObject(capacity)) return BATTLE_BRIDGE_ELASTIC_MAILBOX_MIN_WIDTH;
  const observedHead = String(capacity.sourceHead || '').toLowerCase();
  const requiredHead = String(expectedHead || '').toLowerCase();
  const observedAtMs = Date.parse(String(capacity.observedAtUtc || ''));
  const expiresAtMs = Date.parse(String(capacity.expiresAtUtc || ''));
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  if (!SHA_PATTERN.test(observedHead) || !SHA_PATTERN.test(requiredHead) || observedHead !== requiredHead) {
    return BATTLE_BRIDGE_ELASTIC_MAILBOX_MIN_WIDTH;
  }
  if (!Number.isFinite(nowMs) || !Number.isFinite(observedAtMs) || !Number.isFinite(expiresAtMs)) {
    return BATTLE_BRIDGE_ELASTIC_MAILBOX_MIN_WIDTH;
  }
  if (observedAtMs > nowMs || expiresAtMs <= nowMs || capacity.ok !== true) {
    return BATTLE_BRIDGE_ELASTIC_MAILBOX_MIN_WIDTH;
  }
  return clampWidth(capacity.provenWidth);
}

function normalizedCandidate(candidate = {}, index = 0) {
  if (!plainObject(candidate)) return null;
  const requestId = String(candidate.requestId || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/.test(requestId)) return null;
  const state = String(candidate.state || 'READY').trim().toUpperCase();
  const resources = safeResources(candidate.resources);
  if (!resources.length) return null;
  return Object.freeze({
    requestId,
    index,
    state,
    resources: Object.freeze(resources),
    approvalRequired: candidate.approvalRequired === true,
    approvalSatisfied: candidate.approvalSatisfied === true,
    providerAvailable: candidate.providerAvailable !== false,
    leaseAvailable: candidate.leaseAvailable !== false,
    priority: Number.isFinite(Number(candidate.priority)) ? Number(candidate.priority) : 0,
  });
}

function conflicts(resources, occupied) {
  return resources.some((resource) => occupied.has(resource));
}

export function planBattleBridgeElasticMailboxDispatch({
  candidates = [],
  capacity = {},
  activeLeases = [],
  consumedRequestIds = [],
  expectedHead = '',
  now = new Date(),
} = {}) {
  const width = deriveBattleBridgeElasticMailboxWidth(capacity, { now, expectedHead });
  const occupied = new Set(safeResources(activeLeases));
  const consumed = new Set(Array.isArray(consumedRequestIds) ? consumedRequestIds.map(String) : []);
  const normalized = (Array.isArray(candidates) ? candidates : [])
    .map(normalizedCandidate)
    .filter(Boolean)
    .sort((a, b) => b.priority - a.priority || a.index - b.index);

  const selected = [];
  const parked = [];
  const deferred = [];
  const seen = new Set();

  for (const candidate of normalized) {
    if (seen.has(candidate.requestId) || consumed.has(candidate.requestId)) {
      parked.push(Object.freeze({ requestId: candidate.requestId, reason: 'DUPLICATE_OR_CONSUMED' }));
      continue;
    }
    seen.add(candidate.requestId);
    if (TERMINAL_STATES.has(candidate.state)) {
      parked.push(Object.freeze({ requestId: candidate.requestId, reason: 'TERMINAL' }));
      continue;
    }
    if (candidate.approvalRequired && !candidate.approvalSatisfied) {
      parked.push(Object.freeze({ requestId: candidate.requestId, reason: 'APPROVAL_GATE' }));
      continue;
    }
    if (!candidate.providerAvailable) {
      parked.push(Object.freeze({ requestId: candidate.requestId, reason: 'PROVIDER_UNAVAILABLE' }));
      continue;
    }
    if (!candidate.leaseAvailable || conflicts(candidate.resources, occupied)) {
      parked.push(Object.freeze({ requestId: candidate.requestId, reason: 'RESOURCE_OR_LEASE_CONFLICT' }));
      continue;
    }
    if (selected.length >= width) {
      deferred.push(Object.freeze({ requestId: candidate.requestId, reason: 'ELASTIC_CAPACITY_FULL' }));
      continue;
    }
    selected.push(Object.freeze({ requestId: candidate.requestId, resources: candidate.resources }));
    for (const resource of candidate.resources) occupied.add(resource);
  }

  return Object.freeze({
    ok: true,
    verdict: selected.length ? 'ELASTIC_MAILBOX_WORK_SELECTED' : 'ELASTIC_MAILBOX_NO_WORK_SELECTED',
    width,
    selected: Object.freeze(selected),
    parked: Object.freeze(parked),
    deferred: Object.freeze(deferred),
    selectedCount: selected.length,
    parkedCount: parked.length,
    deferredCount: deferred.length,
    duplicateMailboxAllowed: false,
    createsScheduler: false,
    createsWorker: false,
    createsQueue: false,
    createsMailbox: false,
    authorityWidened: false,
  });
}
