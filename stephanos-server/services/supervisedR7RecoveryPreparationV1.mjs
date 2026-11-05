import { createHash } from 'node:crypto';
import { types } from 'node:util';

// Preparation for #2961's supervised recovery, not a second lease authority.
// No writes, cancellation, witness signing, process changes or lease release.
export const SUPERVISED_R7_PREPARATION_SCHEMA = 'stephanos.supervised-r7-recovery-preparation.v1';
export const SUPERVISED_R7_APPROVAL_PURPOSE = 'RETIRE_EXACT_R7_ATTEMPT_FOR_SUPERVISED_BUILD';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const MISSION = 'critical-2962-elastic-goal';
const LEASE = `${MISSION}-r7-lease`;
const BRANCH = 'openclaw/elastic-goal-2962';
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:-]{7,119}$/;
const MAX_AGE_MS = 10 * 60 * 1000;
const fail = code => { throw new Error(code); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const noAuthority = Object.freeze({
  historicalExecutionOutcome: 'UNKNOWN', historicalTerminalReceiptReconstructed: false,
  hostileWriterExclusionProven: false, witnessCommissioned: false,
  leaseReleaseAuthority: false, sourceMutationAuthority: false,
  cancellationAuthority: false, automaticDeploymentAllowed: false,
});

// Inspect descriptors before reading data. Reject executable/non-JSON inputs;
// JSON.stringify alone could execute an accessor or attacker-provided toJSON.
function copyData(value, seen = new Set(), depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 4096 || depth > 12) fail('SUPERVISED_R7_INPUT_BUDGET');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > 16384) fail('SUPERVISED_R7_INPUT_BUDGET');
    return value;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value !== 'object' || types.isProxy(value) || seen.has(value)) {
    fail('SUPERVISED_R7_INPUT_NOT_DATA');
  }
  const array = Array.isArray(value);
  const proto = Object.getPrototypeOf(value);
  if (!array && proto !== Object.prototype && proto !== null) fail('SUPERVISED_R7_INPUT_NOT_DATA');
  const keys = Reflect.ownKeys(value);
  if (keys.length > 512) fail('SUPERVISED_R7_INPUT_BUDGET');
  const result = array ? [] : Object.create(null);
  seen.add(value);
  for (const key of keys) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype', 'toJSON'].includes(key)
        || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
        || (array && !/^(0|[1-9]\d*)$/.test(key))) fail('SUPERVISED_R7_INPUT_NOT_DATA');
    result[key] = copyData(descriptor.value, seen, depth + 1, budget);
  }
  if (array && (result.length !== value.length || Object.keys(result).length !== value.length)) {
    fail('SUPERVISED_R7_INPUT_NOT_DATA');
  }
  seen.delete(value);
  return Object.freeze(result);
}
function stamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
}
function fresh(observedAtUtc, expiresAtUtc, now) {
  const observed = stamp(observedAtUtc), expiry = stamp(expiresAtUtc);
  return Number.isFinite(observed) && Number.isFinite(expiry)
    && observed <= now && now < expiry && expiry > observed
    && expiry - observed <= MAX_AGE_MS && now - observed < MAX_AGE_MS;
}
function clock(now) {
  const value = now();
  if (!Number.isSafeInteger(value)) fail('SUPERVISED_R7_CLOCK_INVALID');
  return value;
}
function requestData(input) {
  const request = copyData(input);
  const fields = ['requestId', 'commandId', 'sourceRevision', 'originalLeaseDigest'];
  if (!request || Array.isArray(request) || Object.keys(request).length !== fields.length
      || fields.some(key => !Object.hasOwn(request, key))
      || !ID.test(request.requestId) || !ID.test(request.commandId)
      || !SHA.test(request.sourceRevision) || !HASH.test(request.originalLeaseDigest)) {
    fail('SUPERVISED_R7_REQUEST_INVALID');
  }
  return request;
}
export function supervisedR7SnapshotTarget(snapshot, request) {
  const { mission, leaseRead } = snapshot;
  const lease = leaseRead?.record;
  if (snapshot.sourceRevision !== request.sourceRevision
      || mission?.missionId !== MISSION || mission.revision !== 7
      || mission.repository !== REPOSITORY || mission.currentPhase !== 'REPAIR_REQUIRED'
      || mission.cancelled === true || mission.storeMetadata?.originalSourceAttemptFence
      || mission.dispatch?.status !== 'complete'
      || leaseRead?.ok !== true || leaseRead.validation?.valid !== true
      || leaseRead.validation.active !== false || leaseRead.validation.stale !== true
      || lease?.leaseId !== LEASE || lease.laneId !== MISSION || lease.ownerId !== 'mission-worker'
      || lease.repository !== REPOSITORY || lease.issueNumber !== 2962 || lease.prNumber !== 2987
      || lease.branch !== BRANCH || mission.git?.branch !== BRANCH
      || mission.pullRequest?.number !== lease.prNumber
      || !SHA.test(lease.headSha) || lease.headSha !== mission.pullRequest?.headSha
      || typeof mission.git?.worktreePath !== 'string' || !mission.git.worktreePath.trim()
      || digest(lease) !== request.originalLeaseDigest) fail('SUPERVISED_R7_TARGET_MISMATCH');
  return Object.freeze({
    repository: REPOSITORY, missionId: MISSION, revision: 7, leaseId: LEASE,
    originalLeaseDigest: request.originalLeaseDigest, issueNumber: 2962, prNumber: 2987,
    branch: BRANCH, headSha: lease.headSha, worktreePath: mission.git.worktreePath,
    sourceRevision: request.sourceRevision,
  });
}
function maintenanceEvidence(snapshot, target, now) {
  const evidence = snapshot.maintenance;
  if (!evidence || evidence.schemaVersion !== 'stephanos.supervised-r7-maintenance-observation.v1'
      || digest(evidence.target) !== digest(target)
      || !fresh(evidence.observedAtUtc, evidence.expiresAtUtc, now)
      || snapshot.queuesIdle !== true
      || evidence.preservationVerified !== true || !HASH.test(evidence.preservationDigest)
      || !HASH.test(evidence.maintenanceDigest)
      || evidence.originalExecutionStopped !== true
      || evidence.staleQueueResumePrevented !== true
      || evidence.stalePublicationPrevented !== true
      || evidence.conflictingWriterObserved !== false
      || evidence.unexplainedMutationObserved !== false) fail('SUPERVISED_R7_MAINTENANCE_UNPROVEN');
  return evidence;
}

// readSnapshot is a server-side canonical reader, NEVER a public request field.
// Copy snapshots before awaits: a provider cannot silently mutate an earlier read.
export async function prepareSupervisedR7RecoveryV1(input, { readSnapshot, now = Date.now } = {}) {
  const request = requestData(input);
  if (typeof readSnapshot !== 'function') fail('SUPERVISED_R7_CANONICAL_READER_NOT_INSTALLED');
  const first = copyData(await readSnapshot());
  const firstTarget = supervisedR7SnapshotTarget(first, request);
  const firstEvidence = maintenanceEvidence(first, firstTarget, clock(now));
  const second = copyData(await readSnapshot());
  const target = supervisedR7SnapshotTarget(second, request);
  const evidence = maintenanceEvidence(second, target, clock(now));
  if (digest(target) !== digest(firstTarget) || digest(evidence) !== digest(firstEvidence)) {
    fail('SUPERVISED_R7_SNAPSHOT_CHANGED');
  }
  const preparedAtUtc = new Date(clock(now)).toISOString();
  if (!fresh(evidence.observedAtUtc, evidence.expiresAtUtc, Date.parse(preparedAtUtc))) {
    fail('SUPERVISED_R7_MAINTENANCE_EXPIRED');
  }
  const packet = Object.freeze({
    schemaVersion: SUPERVISED_R7_PREPARATION_SCHEMA, purpose: SUPERVISED_R7_APPROVAL_PURPOSE,
    requestId: request.requestId, commandId: request.commandId, target,
    maintenanceEvidence: evidence, preparedAtUtc, expiresAtUtc: evidence.expiresAtUtc,
    recoveryDisposition: 'OPERATOR_SUPERVISED_RETIREMENT_PROPOSED',
    assurance: 'COOPERATIVE_WORKER_MAINTENANCE_ONLY',
    firstBuildAcceptance: 'EXISTING_WORKER_PICKUP_DIFF_TESTS_COMMIT',
    unattendedRefillsRequiredBeforeFirstBuild: false,
    ...noAuthority,
  });
  return Object.freeze({ packet, packetDigest: digest(packet) });
}

function validatePreparedPacket(data, now) {
  const packet = data?.packet;
  const target = packet?.target;
  const targetFields = ['repository', 'missionId', 'revision', 'leaseId', 'originalLeaseDigest',
    'issueNumber', 'prNumber', 'branch', 'headSha', 'worktreePath', 'sourceRevision'];
  if (!packet || packet.schemaVersion !== SUPERVISED_R7_PREPARATION_SCHEMA
      || packet.purpose !== SUPERVISED_R7_APPROVAL_PURPOSE
      || data.packetDigest !== digest(packet)
      || !ID.test(packet.requestId) || !ID.test(packet.commandId)
      || !target || Object.keys(target).length !== targetFields.length
      || targetFields.some(key => !Object.hasOwn(target, key))
      || target.repository !== REPOSITORY || target.missionId !== MISSION
      || target.revision !== 7 || target.leaseId !== LEASE
      || target.issueNumber !== 2962 || target.prNumber !== 2987 || target.branch !== BRANCH
      || !HASH.test(target.originalLeaseDigest) || !SHA.test(target.headSha)
      || !SHA.test(target.sourceRevision) || typeof target.worktreePath !== 'string'
      || !target.worktreePath.trim()
      || packet.recoveryDisposition !== 'OPERATOR_SUPERVISED_RETIREMENT_PROPOSED'
      || packet.assurance !== 'COOPERATIVE_WORKER_MAINTENANCE_ONLY'
      || packet.firstBuildAcceptance !== 'EXISTING_WORKER_PICKUP_DIFF_TESTS_COMMIT'
      || packet.unattendedRefillsRequiredBeforeFirstBuild !== false
      || Object.entries(noAuthority).some(([key, value]) => packet[key] !== value)
      || !fresh(packet.preparedAtUtc, packet.expiresAtUtc, now)
      || packet.expiresAtUtc !== packet.maintenanceEvidence?.expiresAtUtc) {
    fail('SUPERVISED_R7_PACKET_INVALID');
  }
  maintenanceEvidence({ maintenance: packet.maintenanceEvidence, queuesIdle: true }, target, now);
  return packet;
}

// Check an existing control-plane authenticator's verdict, not caller booleans.
// This intentionally does not consume approval or release a lease. The later
// executor must recheck under existing mission/lease locks, durably audit the
// cancellation, and perform canonical whole-record CAS before claiming release.
export async function inspectSupervisedR7ApprovalV1(prepared, {
  authenticateOperatorApproval, now = Date.now,
} = {}) {
  const data = copyData(prepared);
  const packet = validatePreparedPacket(data, clock(now));
  if (typeof authenticateOperatorApproval !== 'function') fail('SUPERVISED_R7_APPROVAL_ADAPTER_NOT_INSTALLED');
  const expected = Object.freeze({
    purpose: packet.purpose, packetDigest: data.packetDigest,
    requestId: packet.requestId, commandId: packet.commandId,
    sourceRevision: packet.target.sourceRevision, originalLeaseDigest: packet.target.originalLeaseDigest,
  });
  const approval = copyData(await authenticateOperatorApproval(expected));
  const currentTime = clock(now);
  if (!approval || approval.authenticated !== true || approval.consumed !== false
      || approval.lowerAssuranceExplicitlyAccepted !== true
      || Object.entries(expected).some(([key, value]) => approval[key] !== value)
      || !HASH.test(approval.approvalEvidenceDigest)
      || !fresh(approval.approvedAtUtc, approval.expiresAtUtc, currentTime)
      || stamp(approval.expiresAtUtc) > stamp(packet.expiresAtUtc)
      || stamp(approval.approvedAtUtc) < stamp(packet.preparedAtUtc)
      || !fresh(packet.preparedAtUtc, packet.expiresAtUtc, currentTime)) {
    fail('SUPERVISED_R7_APPROVAL_UNPROVEN');
  }
  return Object.freeze({
    status: 'AUTHENTICATED_APPROVAL_REQUIRES_LOCKED_EXECUTION',
    packetDigest: data.packetDigest, approvalEvidenceDigest: approval.approvalEvidenceDigest,
    approvalExpiresAtUtc: approval.expiresAtUtc,
    approvalConsumed: false, canonicalAuditCommitted: false, leaseReleased: false,
    ...noAuthority,
  });
}
