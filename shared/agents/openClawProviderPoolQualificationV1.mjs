import { routeMissionControllerCapacity } from './missionControllerCapacityRouterV1.mjs';

export const OPENCLAW_PROVIDER_POOL_QUALIFICATION_SCHEMA = 'stephanos.openclaw-provider-pool-qualification.v1';
export const OPENCLAW_PROVIDER_CAPACITY_SCHEMA = 'stephanos.openclaw-provider-capacity-receipt.v1';
export const OPENCLAW_PROVIDER_ROUTE = 'OPENCLAW_LOCAL';
export const OPENCLAW_PROVIDER_ADAPTER = 'openclaw-local';

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FULL_SHA = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,239}$/;
const SAFE_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const MAX_RECEIPT_LIFETIME_MS = 60 * 60 * 1000;

const QUALIFICATION_KEYS = Object.freeze([
  'schemaVersion',
  'qualificationId',
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
  'proofRefs',
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

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Object.getOwnPropertySymbols(value).length === 0
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
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

export function validateOpenClawProviderQualification(receipt, expected = {}) {
  const valid = exactKeys(receipt, QUALIFICATION_KEYS)
    && receipt.schemaVersion === OPENCLAW_PROVIDER_POOL_QUALIFICATION_SCHEMA
    && receipt.provider === 'openclaw-standalone'
    && receipt.repository === expected.repository
    && REPOSITORY.test(text(receipt.repository))
    && receipt.taskClass === expected.taskClass
    && receipt.state === 'PRODUCTION_ELIGIBLE'
    && SAFE_ID.test(text(receipt.qualificationId))
    && SAFE_ID.test(text(receipt.providerInstance))
    && SAFE_ID.test(text(receipt.providerVersion))
    && FULL_SHA.test(text(receipt.sourceHead))
    && receipt.sourceHead.toLowerCase() === text(expected.sourceHead).toLowerCase()
    && SAFE_ID.test(text(receipt.realWorkTaskId))
    && SAFE_ID.test(text(receipt.realWorkReceiptId))
    && receipt.codexRequired === false
    && proofRefsValid(receipt.proofRefs)
    && boundedWindow(receipt.observedAtUtc, receipt.expiresAtUtc, expected.nowUtc);
  return Object.freeze({
    valid: Boolean(valid),
    receipt: valid ? receipt : null,
    reason: valid ? 'OPENCLAW_QUALIFICATION_VALID' : 'OPENCLAW_QUALIFICATION_INVALID',
  });
}

export function validateOpenClawProviderCapacity(receipt, expected = {}) {
  const operations = uniqueStrings(receipt?.supportedOperations);
  const taskClasses = uniqueStrings(receipt?.supportedTaskClasses);
  const qualificationIds = uniqueStrings(receipt?.qualificationIds);
  const valid = exactKeys(receipt, CAPACITY_KEYS)
    && receipt.schemaVersion === OPENCLAW_PROVIDER_CAPACITY_SCHEMA
    && receipt.provider === 'openclaw-standalone'
    && receipt.repository === expected.repository
    && REPOSITORY.test(text(receipt.repository))
    && SAFE_ID.test(text(receipt.receiptId))
    && SAFE_ID.test(text(receipt.workerId))
    && receipt.state === 'READY'
    && operations?.includes('SOURCE_CONSTRUCTION')
    && operations?.includes('FOCUSED_TESTS')
    && taskClasses?.includes(expected.taskClass)
    && qualificationIds?.includes(expected.qualificationId)
    && proofRefsValid(receipt.proofRefs)
    && Number.isSafeInteger(receipt.queueDepth)
    && receipt.queueDepth >= 0
    && receipt.queueDepth <= 1000
    && Number.isFinite(receipt.p95StartLatencySeconds)
    && receipt.p95StartLatencySeconds >= 0
    && receipt.p95StartLatencySeconds <= 24 * 60 * 60
    && boundedWindow(receipt.observedAtUtc, receipt.expiresAtUtc, expected.nowUtc);
  return Object.freeze({
    valid: Boolean(valid),
    receipt: valid ? receipt : null,
    reason: valid ? 'OPENCLAW_CAPACITY_VALID' : 'OPENCLAW_CAPACITY_INVALID',
  });
}

function requestedRoute(input = {}) {
  const value = text(input.task?.preferredProviderRoute || input.mission?.preferredProviderRoute).toUpperCase();
  return value || 'AUTO';
}

export function routeWithQualifiedOpenClawProvider(input = {}) {
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

  const qualification = validateOpenClawProviderQualification(input.openClawQualificationReceipt, expected);
  const capacity = qualification.valid
    ? validateOpenClawProviderCapacity(input.openClawCapacityReceipt, {
        repository: expected.repository,
        taskClass: expected.taskClass,
        qualificationId: qualification.receipt.qualificationId,
        nowUtc: expected.nowUtc,
      })
    : Object.freeze({ valid: false, receipt: null, reason: 'OPENCLAW_CAPACITY_NOT_EVALUATED' });

  const openClawPoolEligible = qualification.valid && capacity.valid;
  const explicitOpenClawPreference = preference === OPENCLAW_PROVIDER_ROUTE;
  const baseUnavailable = base.dispatchAllowed !== true;
  const selectOpenClaw = openClawPoolEligible && (explicitOpenClawPreference || baseUnavailable);

  if (!selectOpenClaw) {
    const blockers = [];
    if (explicitOpenClawPreference && !qualification.valid) blockers.push('openclaw-task-class-not-production-qualified');
    if (explicitOpenClawPreference && qualification.valid && !capacity.valid) blockers.push('openclaw-live-capacity-not-proven');
    return Object.freeze({
      ...base,
      providerPoolPreference: preference,
      openClawPoolEligible,
      openClawQualification: qualification,
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
    proofRefs: Object.freeze([...new Set([...qualification.receipt.proofRefs, ...capacity.receipt.proofRefs])]),
    blockers: Object.freeze([]),
    providerPoolPreference: preference,
    openClawPoolEligible: true,
    openClawQualification: qualification,
    openClawCapacity: capacity,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    duplicateDispatchAllowed: false,
    finalVerdict: 'MISSION_CONTROLLER_OPENCLAW_POOL_ROUTE_READY',
  });
}
