import {
  planContinuousCapacityRefillV1,
  validateProviderNeutralTaskEnvelope,
} from './providerNeutralExecutionCompatibilityV1.mjs';

export const OPERATOR_REVIEW_PARKING_SCHEMA_VERSION = 'stephanos.operator-review-parking.v1';
export const OPERATOR_REVIEW_PARKING_STATE = Object.freeze({
  PARKED: 'OPERATOR_REVIEW_READY_PARKED',
  CURRENT: 'OPERATOR_REVIEW_READY_PARKED_CURRENT',
  REPROVE_REQUIRED: 'OPERATOR_REVIEW_REPROVE_REQUIRED',
  TERMINAL_MERGED: 'OPERATOR_REVIEW_TERMINAL_MERGED',
  TERMINAL_CLOSED: 'OPERATOR_REVIEW_TERMINAL_CLOSED',
  SAFE_HOLD: 'OPERATOR_REVIEW_PARKING_SAFE_HOLD',
});
export const OPERATOR_REVIEW_AUTHORITY_CLASSES = Object.freeze([
  'READY_TRANSITION',
  'PROTECTED_MERGE',
  'DEPLOYMENT',
  'RUNTIME_MUTATION',
  'OPERATOR_JUDGMENT',
]);

const SHA40 = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:#-]{0,159}$/i;
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$/;
const FORBIDDEN_TEXT = /(?:token|secret|password|private[ _-]?key|\.env|session)/i;
const PACKET_KEYS = new Set([
  'schemaVersion', 'parkingId', 'missionId', 'goalId', 'correlationId', 'repository',
  'issueNumber', 'goalTitle', 'prNumber', 'prTitle', 'branch', 'exactHead', 'exactTree',
  'exactBase', 'changedPaths', 'requiredAuthorityClass', 'checksProofRefs', 'reviewProofRefs',
  'proofRefs', 'parkedAtUtc', 'leaseIds', 'leaseDisposition', 'constructionCapacityReleased',
  'builderCapacityConsumed', 'nextOperatorAction', 'authority', 'state',
]);
const CURRENT_KEYS = new Set([
  'repository', 'prNumber', 'branch', 'exactHead', 'exactTree', 'exactBase', 'changedPaths',
  'state', 'checksCurrent', 'reviewCurrent', 'unresolvedThreads', 'observedAtUtc',
]);
const AUTHORITY_KEYS = new Set([
  'dispatchAllowed', 'sourceMutationAllowed', 'mergeAllowed', 'deploymentAllowed',
  'runtimeMutationAllowed', 'credentialAccessAllowed', 'spendingAllowed',
]);
const ZERO_AUTHORITY = Object.freeze({
  dispatchAllowed: false,
  sourceMutationAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
  credentialAccessAllowed: false,
  spendingAllowed: false,
});

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(value) {
  return [...new Set(list(value).map((item) => text(item)).filter(Boolean))];
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function positiveInteger(value) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : 0;
}

function exactSha(value) {
  const normalized = text(value).toLowerCase();
  return SHA40.test(normalized) ? normalized : '';
}

function safeId(value) {
  const normalized = text(value);
  return SAFE_ID.test(normalized) && !FORBIDDEN_TEXT.test(normalized);
}

function safeTitle(value) {
  const normalized = text(value);
  return normalized.length >= 1 && normalized.length <= 240
    && !/[\u0000-\u001f]/.test(normalized);
}

function safeBranch(value) {
  const normalized = text(value).replace(/\\/g, '/');
  return SAFE_BRANCH.test(normalized) && !normalized.includes('..') && !FORBIDDEN_TEXT.test(normalized);
}

function safePath(value) {
  const normalized = text(value).replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.startsWith('//') || /^[a-z]:\//i.test(normalized)) return false;
  if (normalized.split('/').some((part) => part === '..' || part === '.git')) return false;
  return !FORBIDDEN_TEXT.test(normalized) && normalized.length <= 260;
}

function safeProofRef(value) {
  const normalized = text(value).replace(/\\/g, '/');
  return safePath(normalized) && normalized.length <= 260;
}

function explicitTime(value) {
  const normalized = text(value);
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) && Number.isFinite(Date.parse(normalized));
}

function authorityIsZero(authority) {
  return hasExactKeys(authority, AUTHORITY_KEYS)
    && [...AUTHORITY_KEYS].every((key) => authority[key] === false);
}

function sameStringSet(left, right) {
  const a = [...new Set(uniqueStrings(left))].sort();
  const b = [...new Set(uniqueStrings(right))].sort();
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function intersects(left, right) {
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
}

function parkingBlock(reason, additions = {}) {
  return freeze({
    schemaVersion: OPERATOR_REVIEW_PARKING_SCHEMA_VERSION,
    state: OPERATOR_REVIEW_PARKING_STATE.SAFE_HOLD,
    blockers: [reason, ...list(additions.blockers)].filter(Boolean),
    builderCapacityConsumed: false,
    authority: ZERO_AUTHORITY,
    ...additions,
  });
}

export function createOperatorReviewParkingPacketV1(input = {}) {
  return freeze({
    schemaVersion: OPERATOR_REVIEW_PARKING_SCHEMA_VERSION,
    parkingId: text(input.parkingId),
    missionId: text(input.missionId),
    goalId: text(input.goalId),
    correlationId: text(input.correlationId),
    repository: text(input.repository),
    issueNumber: positiveInteger(input.issueNumber),
    goalTitle: text(input.goalTitle),
    prNumber: positiveInteger(input.prNumber),
    prTitle: text(input.prTitle),
    branch: text(input.branch).replace(/\\/g, '/'),
    exactHead: exactSha(input.exactHead),
    exactTree: exactSha(input.exactTree),
    exactBase: exactSha(input.exactBase),
    changedPaths: uniqueStrings(input.changedPaths).map((item) => item.replace(/\\/g, '/')).sort(),
    requiredAuthorityClass: text(input.requiredAuthorityClass).toUpperCase(),
    checksProofRefs: uniqueStrings(input.checksProofRefs).map((item) => item.replace(/\\/g, '/')).sort(),
    reviewProofRefs: uniqueStrings(input.reviewProofRefs).map((item) => item.replace(/\\/g, '/')).sort(),
    proofRefs: uniqueStrings(input.proofRefs).map((item) => item.replace(/\\/g, '/')).sort(),
    parkedAtUtc: text(input.parkedAtUtc),
    leaseIds: uniqueStrings(input.leaseIds).sort(),
    leaseDisposition: text(input.leaseDisposition, 'RELEASED').toUpperCase(),
    constructionCapacityReleased: input.constructionCapacityReleased !== false,
    builderCapacityConsumed: false,
    nextOperatorAction: text(input.nextOperatorAction),
    authority: ZERO_AUTHORITY,
    state: OPERATOR_REVIEW_PARKING_STATE.PARKED,
  });
}

export function validateOperatorReviewParkingPacketV1(packet) {
  const errors = [];
  if (!isPlainObject(packet)) {
    return freeze({ valid: false, errors: ['parking-packet-not-object'], finalVerdict: 'OPERATOR_REVIEW_PARKING_PACKET_BLOCKED' });
  }
  if (!hasExactKeys(packet, PACKET_KEYS)) errors.push('parking-packet-fields-invalid');
  if (packet.schemaVersion !== OPERATOR_REVIEW_PARKING_SCHEMA_VERSION) errors.push('schema-version-invalid');
  for (const [field, value] of [['parkingId', packet.parkingId], ['missionId', packet.missionId], ['goalId', packet.goalId], ['correlationId', packet.correlationId]]) {
    if (!safeId(value)) errors.push(`${field}-invalid`);
  }
  if (!SAFE_REPOSITORY.test(text(packet.repository)) || FORBIDDEN_TEXT.test(text(packet.repository))) errors.push('repository-invalid');
  if (!positiveInteger(packet.issueNumber)) errors.push('issue-number-invalid');
  if (!safeTitle(packet.goalTitle)) errors.push('goal-title-invalid');
  if (!positiveInteger(packet.prNumber)) errors.push('pr-number-invalid');
  if (!safeTitle(packet.prTitle)) errors.push('pr-title-invalid');
  if (!safeBranch(packet.branch)) errors.push('branch-invalid');
  for (const field of ['exactHead', 'exactTree', 'exactBase']) if (!exactSha(packet[field])) errors.push(`${field}-invalid`);
  if (!Array.isArray(packet.changedPaths) || packet.changedPaths.length === 0 || packet.changedPaths.some((item) => !safePath(item))) errors.push('changed-paths-invalid');
  if (packet.changedPaths.length !== new Set(packet.changedPaths).size) errors.push('changed-paths-duplicate-or-noncanonical');
  if (!OPERATOR_REVIEW_AUTHORITY_CLASSES.includes(packet.requiredAuthorityClass)) errors.push('required-authority-class-invalid');
  for (const [field, refs] of [['checks-proof-refs', packet.checksProofRefs], ['review-proof-refs', packet.reviewProofRefs], ['proof-refs', packet.proofRefs]]) {
    if (!Array.isArray(refs) || refs.length === 0 || refs.some((item) => !safeProofRef(item))) errors.push(`${field}-invalid`);
  }
  if (!explicitTime(packet.parkedAtUtc)) errors.push('parked-at-invalid');
  if (!Array.isArray(packet.leaseIds) || packet.leaseIds.length === 0 || packet.leaseIds.some((item) => !safeId(item))) errors.push('lease-ids-invalid');
  if (packet.leaseDisposition !== 'RELEASED') errors.push('lease-not-released');
  if (packet.constructionCapacityReleased !== true) errors.push('construction-capacity-not-released');
  if (packet.builderCapacityConsumed !== false) errors.push('parked-goal-consumes-builder-capacity');
  if (!safeTitle(packet.nextOperatorAction)) errors.push('next-operator-action-invalid');
  if (!authorityIsZero(packet.authority)) errors.push('parking-authority-not-zero');
  if (packet.state !== OPERATOR_REVIEW_PARKING_STATE.PARKED) errors.push('parking-state-invalid');
  return freeze({
    valid: errors.length === 0,
    errors,
    finalVerdict: errors.length === 0 ? 'OPERATOR_REVIEW_PARKING_PACKET_PASS' : 'OPERATOR_REVIEW_PARKING_PACKET_BLOCKED',
  });
}

function validateCurrentIdentity(current = {}) {
  const errors = [];
  if (!hasExactKeys(current, CURRENT_KEYS)) errors.push('current-identity-fields-invalid');
  if (!SAFE_REPOSITORY.test(text(current.repository)) || FORBIDDEN_TEXT.test(text(current.repository))) errors.push('current-repository-invalid');
  if (!positiveInteger(current.prNumber)) errors.push('current-pr-number-invalid');
  if (!safeBranch(current.branch)) errors.push('current-branch-invalid');
  for (const field of ['exactHead', 'exactTree', 'exactBase']) if (!exactSha(current[field])) errors.push(`current-${field}-invalid`);
  if (!Array.isArray(current.changedPaths) || current.changedPaths.length === 0 || current.changedPaths.some((item) => !safePath(item))) errors.push('current-changed-paths-invalid');
  if (!['OPEN', 'MERGED', 'CLOSED'].includes(text(current.state).toUpperCase())) errors.push('current-state-invalid');
  if (typeof current.checksCurrent !== 'boolean') errors.push('current-checks-state-invalid');
  if (typeof current.reviewCurrent !== 'boolean') errors.push('current-review-state-invalid');
  if (!Number.isSafeInteger(Number(current.unresolvedThreads)) || Number(current.unresolvedThreads) < 0) errors.push('current-unresolved-threads-invalid');
  if (!explicitTime(current.observedAtUtc)) errors.push('current-observed-at-invalid');
  return freeze({ valid: errors.length === 0, errors });
}

export function evaluateParkedGoalIdentityV1(packet, current = {}) {
  const packetValidation = validateOperatorReviewParkingPacketV1(packet);
  const currentValidation = validateCurrentIdentity(current);
  if (!packetValidation.valid || !currentValidation.valid) {
    return parkingBlock('PARKED_GOAL_CURRENT_IDENTITY_INVALID', {
      blockers: [...packetValidation.errors, ...currentValidation.errors],
      parkingId: text(packet?.parkingId) || null,
      prNumber: positiveInteger(packet?.prNumber) || null,
      currentState: null,
    });
  }
  const state = text(current.state).toUpperCase();
  if (state === 'MERGED') {
    return freeze({
      schemaVersion: OPERATOR_REVIEW_PARKING_SCHEMA_VERSION,
      state: OPERATOR_REVIEW_PARKING_STATE.TERMINAL_MERGED,
      parkingId: packet.parkingId,
      prNumber: packet.prNumber,
      reasons: [],
      builderCapacityConsumed: false,
      operatorNeeded: false,
      authority: ZERO_AUTHORITY,
    });
  }
  if (state === 'CLOSED') {
    return freeze({
      schemaVersion: OPERATOR_REVIEW_PARKING_SCHEMA_VERSION,
      state: OPERATOR_REVIEW_PARKING_STATE.TERMINAL_CLOSED,
      parkingId: packet.parkingId,
      prNumber: packet.prNumber,
      reasons: [],
      builderCapacityConsumed: false,
      operatorNeeded: false,
      authority: ZERO_AUTHORITY,
    });
  }

  const reasons = [];
  if (current.repository !== packet.repository) reasons.push('PARKED_REPOSITORY_DRIFTED');
  if (Number(current.prNumber) !== packet.prNumber) reasons.push('PARKED_PR_DRIFTED');
  if (current.branch !== packet.branch) reasons.push('PARKED_BRANCH_DRIFTED');
  if (current.exactHead.toLowerCase() !== packet.exactHead) reasons.push('PARKED_HEAD_DRIFTED');
  if (current.exactTree.toLowerCase() !== packet.exactTree) reasons.push('PARKED_TREE_DRIFTED');
  if (current.exactBase.toLowerCase() !== packet.exactBase) reasons.push('PARKED_BASE_DRIFTED');
  if (!sameStringSet(current.changedPaths, packet.changedPaths)) reasons.push('PARKED_CHANGED_ESTATE_DRIFTED');
  if (current.checksCurrent !== true) reasons.push('PARKED_CHECKS_REPROVE_REQUIRED');
  if (current.reviewCurrent !== true) reasons.push('PARKED_REVIEW_REPROVE_REQUIRED');
  if (Number(current.unresolvedThreads) !== 0) reasons.push('PARKED_REVIEW_THREADS_REPROVE_REQUIRED');

  return freeze({
    schemaVersion: OPERATOR_REVIEW_PARKING_SCHEMA_VERSION,
    state: reasons.length ? OPERATOR_REVIEW_PARKING_STATE.REPROVE_REQUIRED : OPERATOR_REVIEW_PARKING_STATE.CURRENT,
    parkingId: packet.parkingId,
    prNumber: packet.prNumber,
    reasons,
    builderCapacityConsumed: false,
    operatorNeeded: reasons.length === 0,
    authority: ZERO_AUTHORITY,
  });
}

export function planOperatorReviewParkAndRefillV1(input = {}) {
  const packet = input.parkingPacket;
  const validation = validateOperatorReviewParkingPacketV1(packet);
  if (!validation.valid) {
    return parkingBlock('OPERATOR_REVIEW_PARKING_PACKET_INVALID', {
      blockers: validation.errors,
      parkingPacket: packet ?? null,
      refillPlan: null,
    });
  }

  const parkingHolds = [];
  const candidates = list(input.schedulerDecision?.selectedTasks);
  const refillCandidates = [];
  for (const task of candidates) {
    const taskValidation = validateProviderNeutralTaskEnvelope(task);
    if (!taskValidation.valid) {
      refillCandidates.push(task);
      continue;
    }
    if (task.goalId === packet.goalId || task.missionId === packet.missionId) {
      parkingHolds.push(freeze({ taskId: task.taskId, reason: 'PARKED_FOR_OPERATOR_REVIEW' }));
      continue;
    }
    if (task.repository === packet.repository && intersects(task.allowedPaths, packet.changedPaths)) {
      parkingHolds.push(freeze({ taskId: task.taskId, reason: 'PARKED_REVIEW_RESOURCE_CONFLICT' }));
      continue;
    }
    refillCandidates.push(task);
  }

  const releaseEvent = freeze({
    trigger: 'LANE_CAPACITY_RELEASED',
    eventId: text(input.releaseEventId, `park-${packet.parkingId}`.slice(0, 160)),
    correlationId: packet.correlationId,
    releasedSlots: 1,
  });
  const refill = planContinuousCapacityRefillV1({
    releaseEvent,
    schedulerDecision: {
      ...(isPlainObject(input.schedulerDecision) ? input.schedulerDecision : {}),
      selectedTasks: refillCandidates,
    },
    activeLeaseIds: input.activeLeaseIds,
    seenEventKeys: input.seenEventKeys,
  });
  const refillPlan = freeze({
    ...refill,
    heldTasks: [...parkingHolds, ...list(refill.heldTasks)],
  });
  const refillCount = list(refillPlan.refillRequests).length;
  return freeze({
    schemaVersion: OPERATOR_REVIEW_PARKING_SCHEMA_VERSION,
    state: OPERATOR_REVIEW_PARKING_STATE.PARKED,
    parkingPacket: packet,
    releaseEvent,
    refillPlan,
    parkedGoalConsumesConstructionCapacity: false,
    releasedConstructionSlots: 1,
    refillCount,
    operatorNeeded: true,
    nextAction: refillCount > 0
      ? 'Keep the parked goal waiting for operator review while the released construction slot advances the next resource-disjoint eligible goal.'
      : 'Keep the parked goal waiting for operator review and remain truthfully idle until another resource-disjoint eligible goal is available.',
    authority: ZERO_AUTHORITY,
    finalVerdict: refillCount > 0 ? 'OPERATOR_REVIEW_PARKED_AND_CAPACITY_REFILLED' : 'OPERATOR_REVIEW_PARKED_NO_ELIGIBLE_REFILL',
  });
}

export function buildOperatorReviewReadyBatchV1(entries = []) {
  const ready = [];
  const reproving = [];
  const terminal = [];
  const seenParkingIds = new Set();
  const seenPrHeads = new Set();
  const conflicts = [];

  for (const entry of list(entries)) {
    const packet = entry?.packet;
    const validation = validateOperatorReviewParkingPacketV1(packet);
    if (!validation.valid) {
      conflicts.push(freeze({ parkingId: text(packet?.parkingId), reason: 'PARKING_PACKET_INVALID', errors: validation.errors }));
      continue;
    }
    const prHeadKey = `${packet.repository}:${packet.prNumber}:${packet.exactHead}`;
    if (seenParkingIds.has(packet.parkingId) || seenPrHeads.has(prHeadKey)) {
      conflicts.push(freeze({ parkingId: packet.parkingId, reason: 'DUPLICATE_PARKED_DECISION_IDENTITY', errors: [] }));
      continue;
    }
    seenParkingIds.add(packet.parkingId);
    seenPrHeads.add(prHeadKey);
    const evaluation = evaluateParkedGoalIdentityV1(packet, entry?.current ?? {});
    if (evaluation.state === OPERATOR_REVIEW_PARKING_STATE.CURRENT) {
      ready.push(freeze({
        parkingId: packet.parkingId,
        issueNumber: packet.issueNumber,
        goalTitle: packet.goalTitle,
        prNumber: packet.prNumber,
        prTitle: packet.prTitle,
        exactHead: packet.exactHead,
        requiredAuthorityClass: packet.requiredAuthorityClass,
        parkedAtUtc: packet.parkedAtUtc,
        nextOperatorAction: packet.nextOperatorAction,
      }));
    } else if (evaluation.state === OPERATOR_REVIEW_PARKING_STATE.REPROVE_REQUIRED) {
      reproving.push(freeze({
        parkingId: packet.parkingId,
        issueNumber: packet.issueNumber,
        goalTitle: packet.goalTitle,
        prNumber: packet.prNumber,
        prTitle: packet.prTitle,
        exactHead: packet.exactHead,
        reasons: evaluation.reasons,
      }));
    } else if ([OPERATOR_REVIEW_PARKING_STATE.TERMINAL_MERGED, OPERATOR_REVIEW_PARKING_STATE.TERMINAL_CLOSED].includes(evaluation.state)) {
      terminal.push(freeze({ parkingId: packet.parkingId, prNumber: packet.prNumber, state: evaluation.state }));
    } else {
      conflicts.push(freeze({ parkingId: packet.parkingId, reason: 'PARKED_IDENTITY_SAFE_HOLD', errors: evaluation.blockers ?? [] }));
    }
  }

  const readySorted = ready.sort((a, b) => Date.parse(a.parkedAtUtc) - Date.parse(b.parkedAtUtc) || a.prNumber - b.prNumber);
  const reprovingSorted = reproving.sort((a, b) => a.prNumber - b.prNumber);
  if (conflicts.length) {
    return freeze({
      schemaVersion: OPERATOR_REVIEW_PARKING_SCHEMA_VERSION,
      state: OPERATOR_REVIEW_PARKING_STATE.SAFE_HOLD,
      ready: readySorted,
      reproving: reprovingSorted,
      terminal,
      conflicts,
      readyCount: readySorted.length,
      reproveCount: reprovingSorted.length,
      parkedBuilderCapacityConsumed: 0,
      operatorNeeded: readySorted.length > 0,
      authority: ZERO_AUTHORITY,
      finalVerdict: 'OPERATOR_REVIEW_READY_BATCH_SAFE_HOLD',
    });
  }
  return freeze({
    schemaVersion: OPERATOR_REVIEW_PARKING_SCHEMA_VERSION,
    state: readySorted.length ? OPERATOR_REVIEW_PARKING_STATE.CURRENT : OPERATOR_REVIEW_PARKING_STATE.PARKED,
    ready: readySorted,
    reproving: reprovingSorted,
    terminal,
    conflicts: [],
    readyCount: readySorted.length,
    reproveCount: reprovingSorted.length,
    parkedBuilderCapacityConsumed: 0,
    operatorNeeded: readySorted.length > 0,
    authority: ZERO_AUTHORITY,
    finalVerdict: readySorted.length ? 'OPERATOR_REVIEW_READY_BATCH_AVAILABLE' : 'OPERATOR_REVIEW_READY_BATCH_EMPTY',
  });
}
