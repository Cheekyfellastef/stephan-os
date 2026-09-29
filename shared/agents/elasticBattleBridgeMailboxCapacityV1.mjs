const DEFAULT_WIDTH = 1;
const HARD_MAX_WIDTH = 5;
const SAFE_LANE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/;
const SAFE_RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/;

function boundedInteger(value, fallback = DEFAULT_WIDTH) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 1 ? numeric : fallback;
}

function normalizedString(value) {
  return String(value ?? '').trim();
}

function validTimestamp(value) {
  const ms = Date.parse(normalizedString(value));
  return Number.isFinite(ms) ? ms : null;
}

function normalizedResources(value) {
  if (!Array.isArray(value)) return null;
  const resources = [...new Set(value.map(normalizedString).filter((item) => SAFE_RESOURCE_ID.test(item)))];
  return resources.length === value.length ? resources : null;
}

export function deriveElasticBattleBridgeMailboxWidth({
  capacityEvidence = null,
  now = new Date(),
  staleAfterMs = 5 * 60 * 1000,
  hardMaxWidth = HARD_MAX_WIDTH,
} = {}) {
  const safeHardMax = Math.max(1, Math.min(HARD_MAX_WIDTH, boundedInteger(hardMaxWidth, HARD_MAX_WIDTH)));
  if (!capacityEvidence || typeof capacityEvidence !== 'object' || Array.isArray(capacityEvidence)) {
    return Object.freeze({ width: DEFAULT_WIDTH, proven: false, blocker: 'MAILBOX_ELASTIC_CAPACITY_UNPROVEN' });
  }

  const observedAtMs = validTimestamp(capacityEvidence.observedAtUtc);
  const nowMs = now instanceof Date ? now.getTime() : validTimestamp(now);
  if (!Number.isFinite(nowMs) || observedAtMs === null || observedAtMs > nowMs || nowMs - observedAtMs > staleAfterMs) {
    return Object.freeze({ width: DEFAULT_WIDTH, proven: false, blocker: 'MAILBOX_ELASTIC_CAPACITY_STALE' });
  }
  if (capacityEvidence.ok !== true || capacityEvidence.exactSourceBound !== true) {
    return Object.freeze({ width: DEFAULT_WIDTH, proven: false, blocker: 'MAILBOX_ELASTIC_CAPACITY_UNPROVEN' });
  }

  const provenWidth = boundedInteger(capacityEvidence.provenWidth, DEFAULT_WIDTH);
  return Object.freeze({
    width: Math.max(1, Math.min(provenWidth, safeHardMax)),
    proven: true,
    blocker: '',
  });
}

function laneIdentity(entry = {}) {
  const laneId = normalizedString(entry.laneId || entry.requestId);
  return SAFE_LANE_ID.test(laneId) ? laneId : '';
}

function laneResources(entry = {}) {
  return normalizedResources(entry.resources);
}

function conflicts(resources, occupied) {
  return resources.some((resource) => occupied.has(resource));
}

export function planElasticBattleBridgeMailboxDispatch({
  candidates = [],
  capacityEvidence = null,
  now = new Date(),
  staleAfterMs,
  hardMaxWidth = HARD_MAX_WIDTH,
  consumedRequestIds = new Set(),
} = {}) {
  const capacity = deriveElasticBattleBridgeMailboxWidth({ capacityEvidence, now, staleAfterMs, hardMaxWidth });
  const selected = [];
  const parked = [];
  const deferred = [];
  const occupied = new Set();
  const seen = new Set(consumedRequestIds instanceof Set ? [...consumedRequestIds].map(normalizedString) : []);

  for (const entry of Array.isArray(candidates) ? candidates : []) {
    const requestId = normalizedString(entry?.requestId);
    const laneId = laneIdentity(entry);
    const resources = laneResources(entry);

    if (!requestId || !laneId || resources === null) {
      deferred.push(Object.freeze({ requestId, laneId, reason: 'MAILBOX_ELASTIC_CANDIDATE_INVALID' }));
      continue;
    }
    if (seen.has(requestId)) {
      deferred.push(Object.freeze({ requestId, laneId, reason: 'MAILBOX_ELASTIC_DUPLICATE_REQUEST' }));
      continue;
    }
    seen.add(requestId);

    if (entry.approvalGated === true) {
      parked.push(Object.freeze({ requestId, laneId, reason: 'MAILBOX_ELASTIC_APPROVAL_GATE' }));
      continue;
    }
    if (entry.blocked === true || entry.providerAvailable === false) {
      parked.push(Object.freeze({ requestId, laneId, reason: entry.providerAvailable === false ? 'MAILBOX_ELASTIC_PROVIDER_UNAVAILABLE' : 'MAILBOX_ELASTIC_BLOCKED' }));
      continue;
    }
    if (conflicts(resources, occupied)) {
      deferred.push(Object.freeze({ requestId, laneId, reason: 'MAILBOX_ELASTIC_RESOURCE_CONFLICT' }));
      continue;
    }
    if (selected.length >= capacity.width) {
      deferred.push(Object.freeze({ requestId, laneId, reason: 'MAILBOX_ELASTIC_CAPACITY_FULL' }));
      continue;
    }

    for (const resource of resources) occupied.add(resource);
    selected.push(Object.freeze({ requestId, laneId, resources: Object.freeze([...resources]) }));
  }

  return Object.freeze({
    width: capacity.width,
    capacityProven: capacity.proven,
    capacityBlocker: capacity.blocker,
    selected: Object.freeze(selected),
    parked: Object.freeze(parked),
    deferred: Object.freeze(deferred),
    selectedCount: selected.length,
    parkedCount: parked.length,
    deferredCount: deferred.length,
    workConserving: true,
    duplicateMailboxAllowed: false,
    runtimeMutationAuthority: false,
    sourceMutationAuthority: false,
    approvalAuthority: false,
    protectedMergeAuthority: false,
  });
}

export const ELASTIC_BATTLE_BRIDGE_MAILBOX_HARD_MAX_WIDTH = HARD_MAX_WIDTH;
