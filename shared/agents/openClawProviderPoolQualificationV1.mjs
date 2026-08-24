import { routeMissionControllerCapacity } from './missionControllerCapacityRouterV1.mjs';
import {
  toSharedWorkspaceExecutionReceipt,
  validateExecutionReceipt,
} from './executionReceiptV1.mjs';
import {
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';

export const OPENCLAW_PROVIDER_POOL_QUALIFICATION_SCHEMA = 'stephanos.openclaw-provider-pool-qualification.v1';
export const OPENCLAW_PROVIDER_CAPACITY_SCHEMA = 'stephanos.openclaw-provider-capacity-receipt.v1';
export const OPENCLAW_PROVIDER_POOL_HOST_CONTEXT_SCHEMA = 'stephanos.openclaw-provider-pool-host-context.v1';
export const OPENCLAW_PROVIDER_ROUTE = 'OPENCLAW_LOCAL';
export const OPENCLAW_PROVIDER_ADAPTER = 'openclaw-local';
export const OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION = 'OPENCLAW_TASK_CLASS_PRODUCTION_ELIGIBLE';

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,239}$/;
const WORKSPACE_SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const SAFE_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const MAX_RECEIPT_LIFETIME_MS = 60 * 60 * 1000;
const MAX_QUALIFICATION_LAG_MS = 10 * 60 * 1000;
const MAX_SNAPSHOT_DEPTH = 12;
const MAX_SNAPSHOT_NODES = 4096;
const OPENCLAW_QUALIFICATION_ISSUE = 1725;

const QUALIFICATION_KEYS = Object.freeze([
  'schemaVersion',
  'qualificationId',
  'authorityReceiptId',
  'provider',
  'repository',
  'taskClass',
  'state',
  'providerInstance',
  'providerVersion',
  'sourceHead',
  'realWorkTaskId',
  'realWorkReceiptId',
  'observedAtUtc',
  'expiresAtUtc',
  'codexRequired',
  'proofRefs',
]);

const CAPACITY_KEYS = Object.freeze([
  'schemaVersion',
  'receiptId',
  'provider',
  'repository',
  'workerId',
  'state',
  'supportedOperations',
  'supportedTaskClasses',
  'observedAtUtc',
  'expiresAtUtc',
  'queueDepth',
  'p95StartLatencySeconds',
  'qualificationIds',
  'qualificationAuthorityReceiptId',
  'proofRefs',
]);

const HOST_CONTEXT_KEYS = Object.freeze([
  'schemaVersion',
  'qualificationReceipt',
  'capacityReceipt',
  'realWorkExecutionReceipt',
  'realWorkWorkspaceReceipt',
  'qualificationAuthorityReceipt',
]);

const WORKSPACE_RECEIPT_KEYS = Object.freeze([
  'schemaVersion',
  'kind',
  'receiptId',
  'participantId',
  'timestampUtc',
  'correlationId',
  'relatedIssue',
  'relatedPr',
  'proofRefs',
  'receivedRecordId',
  'disposition',
  'summary',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function timestamp(value) {
  const normalized = text(value);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function inertSnapshot(value, state, depth = 0) {
  state.nodes += 1;
  if (state.nodes > MAX_SNAPSHOT_NODES || depth > MAX_SNAPSHOT_DEPTH) throw new TypeError('snapshot-bounds-exceeded');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('snapshot-number-invalid');
    return value;
  }
  if (!value || typeof value !== 'object') throw new TypeError('snapshot-type-invalid');
  if (state.visiting.has(value)) throw new TypeError('snapshot-cycle');
  if (state.snapshots.has(value)) return state.snapshots.get(value);
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : (prototype !== Object.prototype && prototype !== null)) {
    throw new TypeError('snapshot-prototype-invalid');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) throw new TypeError('snapshot-symbol-key');
  if (array) {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const length = lengthDescriptor?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > 256) throw new TypeError('snapshot-array-length-invalid');
    const expectedKeys = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
    if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) throw new TypeError('snapshot-array-shape-invalid');
  }
  const snapshot = array ? [] : {};
  state.snapshots.set(value, snapshot);
  state.visiting.add(value);
  for (const key of keys) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
      throw new TypeError('snapshot-accessor-or-hidden-field');
    }
    const child = inertSnapshot(descriptor.value, state, depth + 1);
    if (array) snapshot[Number(key)] = child;
    else snapshot[key] = child;
  }
  state.visiting.delete(value);
  return Object.freeze(snapshot);
}

function snapshot(value) {
  try {
    return inertSnapshot(value, { nodes: 0, visiting: new WeakSet(), snapshots: new WeakMap() });
  } catch {
    return null;
  }
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return null;
  const values = value.map(text);
  if (values.some((entry) => !entry) || values.length !== new Set(values).size) return null;
  return values;
}

function boundedWindow(observedAtUtc, expiresAtUtc, nowUtc) {
  const nowMs = timestamp(nowUtc);
  const observedAtMs = timestamp(observedAtUtc);
  const expiresAtMs = timestamp(expiresAtUtc);
  return nowMs !== null
    && observedAtMs !== null
    && expiresAtMs !== null
    && observedAtMs <= nowMs + 60_000
    && expiresAtMs > nowMs
    && expiresAtMs > observedAtMs
    && expiresAtMs - observedAtMs <= MAX_RECEIPT_LIFETIME_MS;
}

function proofRefsValid(value) {
  const refs = uniqueStrings(value);
  return refs !== null && refs.length > 0 && refs.every((ref) => SAFE_REF.test(ref) && !ref.includes('..'));
}

function sameStrings(left, right) {
  const a = uniqueStrings(left);
  const b = uniqueStrings(right);
  if (a === null || b === null || a.length !== b.length) return false;
  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  return aSorted.every((entry, index) => entry === bSorted[index]);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function qualificationSummary(receipt) {
  return `Stephanos qualifies ${receipt.providerInstance} ${receipt.providerVersion} for ${receipt.taskClass} at ${receipt.sourceHead} from OpenClaw execution ${receipt.realWorkReceiptId}.`;
}

function blockedAuthority(reason) {
  return Object.freeze({
    valid: false,
    reason,
    authorityReceiptId: '',
    realWorkReceiptId: '',
    proofRefs: Object.freeze([]),
  });
}

export function validateOpenClawProviderQualification(receipt, expected = {}) {
  const candidate = snapshot(receipt);
  const valid = exactKeys(candidate, QUALIFICATION_KEYS)
    && candidate.schemaVersion === OPENCLAW_PROVIDER_POOL_QUALIFICATION_SCHEMA
    && candidate.provider === 'openclaw-standalone'
    && candidate.repository === expected.repository
    && REPOSITORY.test(text(candidate.repository))
    && candidate.taskClass === expected.taskClass
    && candidate.state === 'PRODUCTION_ELIGIBLE'
    && WORKSPACE_SAFE_ID.test(text(candidate.qualificationId))
    && WORKSPACE_SAFE_ID.test(text(candidate.authorityReceiptId))
    && WORKSPACE_SAFE_ID.test(text(candidate.providerInstance))
    && SAFE_ID.test(text(candidate.providerVersion))
    && FULL_SHA.test(text(candidate.sourceHead))
    && candidate.sourceHead.toLowerCase() === text(expected.sourceHead).toLowerCase()
    && WORKSPACE_SAFE_ID.test(text(candidate.realWorkTaskId))
    && WORKSPACE_SAFE_ID.test(text(candidate.realWorkReceiptId))
    && candidate.codexRequired === false
    && proofRefsValid(candidate.proofRefs)
    && boundedWindow(candidate.observedAtUtc, candidate.expiresAtUtc, expected.nowUtc);
  return Object.freeze({
    valid: Boolean(valid),
    receipt: valid ? candidate : null,
    reason: valid ? 'OPENCLAW_QUALIFICATION_CLAIM_VALID' : 'OPENCLAW_QUALIFICATION_CLAIM_INVALID',
  });
}

export function validateOpenClawQualificationAuthorityChain(qualificationReceipt, trustedHostContext, expected = {}) {
  const qualification = validateOpenClawProviderQualification(qualificationReceipt, expected);
  if (!qualification.valid) return blockedAuthority('OPENCLAW_QUALIFICATION_CLAIM_INVALID');

  const host = snapshot(trustedHostContext);
  if (!exactKeys(host, HOST_CONTEXT_KEYS) || host.schemaVersion !== OPENCLAW_PROVIDER_POOL_HOST_CONTEXT_SCHEMA) {
    return blockedAuthority('OPENCLAW_TRUSTED_HOST_CONTEXT_INVALID');
  }
  if (canonicalJson(host.qualificationReceipt) !== canonicalJson(qualification.receipt)) {
    return blockedAuthority('OPENCLAW_TRUSTED_QUALIFICATION_MISMATCH');
  }

  const execution = host.realWorkExecutionReceipt;
  const executionValidation = validateExecutionReceipt(execution, {
    repository: expected.repository,
    issueNumber: OPENCLAW_QUALIFICATION_ISSUE,
    expectedHead: expected.sourceHead,
    executionId: qualification.receipt.realWorkTaskId,
  });
  if (!executionValidation.valid
    || execution.receiptId !== qualification.receipt.realWorkReceiptId
    || execution.workerType !== 'openclaw'
    || execution.workerId !== qualification.receipt.providerInstance
    || execution.state !== 'completed'
    || execution.phase !== expected.taskClass
    || execution.operatorActionRequired !== false) {
    return blockedAuthority('OPENCLAW_REAL_WORK_EXECUTION_NOT_PROVEN');
  }

  const executionAtMs = timestamp(execution.timestampUtc);
  const qualifiedAtMs = timestamp(qualification.receipt.observedAtUtc);
  if (executionAtMs === null || qualifiedAtMs === null || qualifiedAtMs < executionAtMs || qualifiedAtMs - executionAtMs > MAX_QUALIFICATION_LAG_MS) {
    return blockedAuthority('OPENCLAW_REAL_WORK_QUALIFICATION_TIME_INVALID');
  }

  const canonicalWorkspace = toSharedWorkspaceExecutionReceipt(execution);
  if (!canonicalWorkspace.ok
    || canonicalJson(host.realWorkWorkspaceReceipt) !== canonicalJson(canonicalWorkspace.record)) {
    return blockedAuthority('OPENCLAW_REAL_WORK_WORKSPACE_RECEIPT_INVALID');
  }

  const authority = host.qualificationAuthorityReceipt;
  const authorityValidation = validateSharedWorkspaceRecord(authority, {
    nowMs: timestamp(expected.nowUtc),
    staleAfterMs: MAX_RECEIPT_LIFETIME_MS,
  });
  if (!exactKeys(authority, WORKSPACE_RECEIPT_KEYS)
    || !authorityValidation.valid
    || authorityValidation.stale === true
    || authority.schemaVersion !== SHARED_WORKSPACE_RECORD_SCHEMA_VERSION
    || authority.kind !== SHARED_WORKSPACE_RECORD_KINDS.RECEIPT
    || authority.receiptId !== qualification.receipt.authorityReceiptId
    || authority.participantId !== 'stephanos'
    || authority.timestampUtc !== qualification.receipt.observedAtUtc
    || authority.correlationId !== qualification.receipt.qualificationId
    || authority.relatedIssue !== String(OPENCLAW_QUALIFICATION_ISSUE)
    || authority.relatedPr !== ''
    || authority.receivedRecordId !== execution.receiptId
    || authority.disposition !== OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION
    || authority.summary !== qualificationSummary(qualification.receipt)
    || !sameStrings(authority.proofRefs, qualification.receipt.proofRefs)) {
    return blockedAuthority('OPENCLAW_PRODUCTION_ELIGIBILITY_AUTHORITY_INVALID');
  }

  const proofRefs = Object.freeze([...new Set([
    ...qualification.receipt.proofRefs,
    ...execution.proofRefs,
    ...host.realWorkWorkspaceReceipt.proofRefs,
    ...authority.proofRefs,
  ])]);
  return Object.freeze({
    valid: true,
    reason: 'OPENCLAW_QUALIFICATION_AUTHORITY_CHAIN_VALID',
    authorityReceiptId: authority.receiptId,
    realWorkReceiptId: execution.receiptId,
    proofRefs,
  });
}

export function validateOpenClawProviderCapacity(receipt, expected = {}) {
  const candidate = snapshot(receipt);
  const operations = uniqueStrings(candidate?.supportedOperations);
  const taskClasses = uniqueStrings(candidate?.supportedTaskClasses);
  const qualificationIds = uniqueStrings(candidate?.qualificationIds);
  const valid = exactKeys(candidate, CAPACITY_KEYS)
    && candidate.schemaVersion === OPENCLAW_PROVIDER_CAPACITY_SCHEMA
    && candidate.provider === 'openclaw-standalone'
    && candidate.repository === expected.repository
    && REPOSITORY.test(text(candidate.repository))
    && WORKSPACE_SAFE_ID.test(text(candidate.receiptId))
    && WORKSPACE_SAFE_ID.test(text(candidate.workerId))
    && candidate.workerId === expected.workerId
    && candidate.state === 'READY'
    && operations?.includes('SOURCE_CONSTRUCTION')
    && operations?.includes('FOCUSED_TESTS')
    && taskClasses?.includes(expected.taskClass)
    && qualificationIds?.includes(expected.qualificationId)
    && candidate.qualificationAuthorityReceiptId === expected.authorityReceiptId
    && proofRefsValid(candidate.proofRefs)
    && Number.isSafeInteger(candidate.queueDepth)
    && candidate.queueDepth >= 0
    && candidate.queueDepth <= 1000
    && Number.isFinite(candidate.p95StartLatencySeconds)
    && candidate.p95StartLatencySeconds >= 0
    && candidate.p95StartLatencySeconds <= 24 * 60 * 60
    && boundedWindow(candidate.observedAtUtc, candidate.expiresAtUtc, expected.nowUtc);
  return Object.freeze({
    valid: Boolean(valid),
    receipt: valid ? candidate : null,
    reason: valid ? 'OPENCLAW_CAPACITY_VALID' : 'OPENCLAW_CAPACITY_INVALID',
  });
}

function requestedRoute(input = {}) {
  const value = text(input.task?.preferredProviderRoute || input.mission?.preferredProviderRoute).toUpperCase();
  return value || 'AUTO';
}

export function routeWithQualifiedOpenClawProvider(input = {}, trustedHostContext = {}) {
  const base = routeMissionControllerCapacity(input);
  const preference = requestedRoute(input);
  const sourceHead = text(input.sourceHead || input.mission?.sourceHead);
  const expected = {
    repository: text(input.mission?.repository),
    taskClass: text(base.task?.taskClass),
    sourceHead,
    nowUtc: text(input.nowUtc),
  };

  if (base.finalVerdict === 'MISSION_CONTROLLER_EXISTING_DISPATCH_PRESERVED') {
    return Object.freeze({ ...base, providerPoolPreference: preference, openClawPoolEligible: false });
  }

  // Qualification/capacity evidence is deliberately loaded only from the
  // trusted host context. Caller-shaped mission/task fields cannot self-admit
  // OpenClaw into the provider pool.
  const host = snapshot(trustedHostContext);
  const qualification = validateOpenClawProviderQualification(host?.qualificationReceipt, expected);
  const authority = qualification.valid
    ? validateOpenClawQualificationAuthorityChain(qualification.receipt, host, expected)
    : blockedAuthority('OPENCLAW_QUALIFICATION_CLAIM_INVALID');
  const capacity = authority.valid
    ? validateOpenClawProviderCapacity(host?.capacityReceipt, {
        repository: expected.repository,
        taskClass: expected.taskClass,
        qualificationId: qualification.receipt.qualificationId,
        authorityReceiptId: authority.authorityReceiptId,
        workerId: qualification.receipt.providerInstance,
        nowUtc: expected.nowUtc,
      })
    : Object.freeze({ valid: false, receipt: null, reason: 'OPENCLAW_CAPACITY_NOT_EVALUATED' });

  const openClawPoolEligible = qualification.valid && authority.valid && capacity.valid;
  const explicitOpenClawPreference = preference === OPENCLAW_PROVIDER_ROUTE;
  const baseUnavailable = base.dispatchAllowed !== true;
  const selectOpenClaw = openClawPoolEligible && (explicitOpenClawPreference || baseUnavailable);

  if (!selectOpenClaw) {
    const blockers = [];
    if (explicitOpenClawPreference && !qualification.valid) blockers.push('openclaw-task-class-not-production-qualified');
    if (explicitOpenClawPreference && qualification.valid && !authority.valid) blockers.push('openclaw-qualification-authority-not-proven');
    if (explicitOpenClawPreference && authority.valid && !capacity.valid) blockers.push('openclaw-live-capacity-not-proven');
    return Object.freeze({
      ...base,
      providerPoolPreference: preference,
      openClawPoolEligible,
      openClawQualification: qualification,
      openClawQualificationAuthority: authority,
      openClawCapacity: capacity,
      providerPoolBlockers: Object.freeze(blockers),
    });
  }

  return Object.freeze({
    ...base,
    route: OPENCLAW_PROVIDER_ROUTE,
    adapter: OPENCLAW_PROVIDER_ADAPTER,
    workerId: capacity.receipt.workerId,
    dispatchAllowed: true,
    selectedCapacityReceiptId: capacity.receipt.receiptId,
    selectedQualificationReceiptId: qualification.receipt.qualificationId,
    selectedQualificationAuthorityReceiptId: authority.authorityReceiptId,
    proofRefs: Object.freeze([...new Set([
      ...authority.proofRefs,
      ...capacity.receipt.proofRefs,
    ])]),
    blockers: Object.freeze([]),
    providerPoolPreference: preference,
    openClawPoolEligible: true,
    openClawQualification: qualification,
    openClawQualificationAuthority: authority,
    openClawCapacity: capacity,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    duplicateDispatchAllowed: false,
    finalVerdict: 'MISSION_CONTROLLER_OPENCLAW_POOL_ROUTE_READY',
  });
}
