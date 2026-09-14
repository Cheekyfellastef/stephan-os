export const ELASTIC_FIVE_LANE_RECOVERABLE_LEASE_SHADOW_SCHEMA_VERSION =
  'stephanos.elastic-five-lane-recoverable-lease-shadow.v1';

const SHA40 = /^[0-9a-f]{40}$/;
const ZERO_AUTHORITY = Object.freeze({
  leaseAcquisitionAllowed: false,
  leaseRenewalAllowed: false,
  leaseReclamationAllowed: false,
  leaseSeizureAllowed: false,
  dispatchAllowed: false,
  sourceMutationAllowed: false,
  runtimeMutationAllowed: false,
  controllerAuthorityTransferAllowed: false,
  fiveLaneCutoverAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
});

function text(value, limit = 180) {
  const normalized = String(value ?? '').trim();
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function isInspectableRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return false;
  }
  return true;
}

function terminalSafeHold(reasonCodes = ['LEASE_SHADOW_INPUT_INVALID']) {
  return Object.freeze({
    schemaVersion: ELASTIC_FIVE_LANE_RECOVERABLE_LEASE_SHADOW_SCHEMA_VERSION,
    shadowOnly: true,
    state: 'SAFE_HOLD',
    laneCount: 0,
    leases: Object.freeze([]),
    oneWriterPerResourceProven: false,
    crashRecoveryShadowProven: false,
    authority: ZERO_AUTHORITY,
    reasonCodes: Object.freeze([...new Set(reasonCodes)]),
    finalVerdict: 'ELASTIC_FIVE_LANE_RECOVERABLE_LEASE_SHADOW_SAFE_HOLD',
  });
}

function safeHold(leases, reasonCodes) {
  return Object.freeze({
    ...terminalSafeHold(reasonCodes),
    laneCount: leases.length,
    leases: Object.freeze(leases.map((lease) => Object.freeze({
      leaseId: text(lease.leaseId, 140),
      resourceId: text(lease.resourceId, 180),
      action: 'SAFE_HOLD',
      mutationAllowed: false,
    }))),
  });
}

function canonicalTimestamp(value) {
  const raw = text(value, 40);
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString() === raw ? time : null;
}

function validateLeaseShape(lease, sourceHead) {
  if (!isInspectableRecord(lease)) return 'LEASE_RECORD_NOT_CANONICAL_PLAIN_DATA';
  for (const field of ['leaseId', 'ownerId', 'resourceId', 'processIdentity', 'nonce']) {
    if (!text(lease[field], 180)) return `LEASE_${field.toUpperCase()}_MISSING`;
  }
  if (text(lease.sourceHead, 40).toLowerCase() !== sourceHead) return 'LEASE_SOURCE_HEAD_MISMATCH';
  if (lease.signatureVerified !== true) return 'LEASE_SIGNATURE_UNVERIFIED';
  if (lease.issuerAuthorized !== true) return 'LEASE_ISSUER_UNAUTHORIZED';
  const createdAt = canonicalTimestamp(lease.createdAtUtc);
  const heartbeatAt = canonicalTimestamp(lease.heartbeatAtUtc);
  const expiresAt = canonicalTimestamp(lease.expiresAtUtc);
  if (createdAt === null || heartbeatAt === null || expiresAt === null) return 'LEASE_TIMESTAMP_INVALID';
  if (createdAt > heartbeatAt || heartbeatAt >= expiresAt) return 'LEASE_TIMESTAMP_ORDER_INVALID';
  return '';
}

function classifyLease(lease, nowMs) {
  const state = text(lease.state, 40).toUpperCase();
  const expiresAt = canonicalTimestamp(lease.expiresAtUtc);
  if (state === 'ACTIVE') {
    if (expiresAt <= nowMs) return { blocker: 'ACTIVE_LEASE_EXPIRED' };
    return { action: 'RETAIN_ACTIVE_SHADOW', active: true, reclaimable: false };
  }
  if (!['EXPIRED', 'OWNER_DEAD'].includes(state)) return { blocker: 'LEASE_STATE_NOT_ALLOWED' };
  const expiryProven = expiresAt <= nowMs;
  const ownerDeathProven = lease.ownerDeathProven === true;
  if (!expiryProven && !ownerDeathProven) return { blocker: 'LEASE_EXPIRY_OR_OWNER_DEATH_UNPROVEN' };
  if (text(lease.recoveryPolicy, 80) !== 'EXPIRE_OR_PROVEN_DEAD') {
    return { blocker: 'LEASE_RECOVERY_POLICY_NOT_ALLOWED' };
  }
  if (lease.resourceStateRevalidated !== true) return { blocker: 'LEASE_RESOURCE_STATE_NOT_REVALIDATED' };
  if (lease.competingOwnerAbsent !== true) return { blocker: 'LEASE_COMPETING_OWNER_ABSENCE_UNPROVEN' };
  if (!text(lease.recoveryReceiptId, 160)) return { blocker: 'LEASE_RECOVERY_RECEIPT_MISSING' };
  return { action: 'SHADOW_RECLAIMABLE', active: false, reclaimable: true };
}

function project(input) {
  if (!isInspectableRecord(input)) return terminalSafeHold(['LEASE_SHADOW_INPUT_NOT_CANONICAL_PLAIN_DATA']);
  const sourceHead = text(input.sourceHead, 40).toLowerCase();
  const nowMs = canonicalTimestamp(input.observedAtUtc);
  const leases = Array.isArray(input.leases) ? input.leases : [];
  if (!SHA40.test(sourceHead)) return safeHold(leases, ['EXACT_SOURCE_HEAD_UNPROVEN']);
  if (nowMs === null) return safeHold(leases, ['OBSERVATION_TIMESTAMP_INVALID']);
  if (leases.length < 5) return safeHold(leases, ['FIVE_LANE_MINIMUM_NOT_PROVEN']);

  const leaseIds = new Set();
  const nonces = new Set();
  const activeWriterByResource = new Map();
  const projected = [];
  for (const lease of leases) {
    const shapeBlocker = validateLeaseShape(lease, sourceHead);
    if (shapeBlocker) return safeHold(leases, [shapeBlocker]);
    const leaseId = text(lease.leaseId, 140);
    const nonce = text(lease.nonce, 180);
    if (leaseIds.has(leaseId)) return safeHold(leases, ['DUPLICATE_LEASE_ID']);
    if (nonces.has(nonce)) return safeHold(leases, ['LEASE_NONCE_REPLAY']);
    leaseIds.add(leaseId);
    nonces.add(nonce);
    const classification = classifyLease(lease, nowMs);
    if (classification.blocker) return safeHold(leases, [classification.blocker]);
    const resourceId = text(lease.resourceId, 180);
    if (classification.active) {
      if (activeWriterByResource.has(resourceId)) {
        return safeHold(leases, ['MULTIPLE_ACTIVE_WRITERS_FOR_RESOURCE']);
      }
      activeWriterByResource.set(resourceId, Object.freeze({
        ownerId: text(lease.ownerId, 140),
        processIdentity: text(lease.processIdentity, 180),
        leaseId,
      }));
    }
    projected.push(Object.freeze({
      leaseId,
      ownerId: text(lease.ownerId, 140),
      resourceId,
      sourceHead,
      state: text(lease.state, 40).toUpperCase(),
      action: classification.action,
      signatureVerified: true,
      issuerAuthorized: true,
      mutationAllowed: false,
    }));
  }

  const recoveryCount = projected.filter((lease) => lease.action === 'SHADOW_RECLAIMABLE').length;
  return Object.freeze({
    schemaVersion: ELASTIC_FIVE_LANE_RECOVERABLE_LEASE_SHADOW_SCHEMA_VERSION,
    shadowOnly: true,
    state: recoveryCount > 0 ? 'RECOVERY_SHADOW_READY' : 'RUNNING_SHADOW',
    sourceHead,
    observedAtUtc: new Date(nowMs).toISOString(),
    laneCount: projected.length,
    leases: Object.freeze(projected),
    oneWriterPerResourceProven: true,
    crashRecoveryShadowProven: recoveryCount > 0,
    reclaimableLeaseCount: recoveryCount,
    authority: ZERO_AUTHORITY,
    reasonCodes: Object.freeze(recoveryCount > 0
      ? ['CRASH_RECOVERABLE_LEASE_SHADOW_PROVEN', 'LEASE_RECLAMATION_AUTHORITY_REMAINS_SEPARATE']
      : ['FIVE_ACTIVE_RESOURCE_LEASES_SHADOW_PROVEN']),
    finalVerdict: recoveryCount > 0
      ? 'ELASTIC_FIVE_LANE_RECOVERABLE_LEASE_SHADOW_READY_NO_AUTHORITY'
      : 'ELASTIC_FIVE_LANE_ACTIVE_LEASE_SHADOW_PROVEN_NO_AUTHORITY',
  });
}

export function projectElasticFiveLaneRecoverableLeaseShadowV1(input = {}) {
  try {
    return project(input);
  } catch {
    return terminalSafeHold(['LEASE_SHADOW_INPUT_INSPECTION_FAILED']);
  }
}
