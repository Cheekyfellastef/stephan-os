import { createHash } from 'node:crypto';
import {
  BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
  MISSION_CONTROLLER_ROUTE,
  validateBuildLaneCapacityReceipt,
} from './missionControllerCapacityRouterV1.mjs';
import { adjudicateForgeSidecarCapacity } from './stallSentinelReviewPipelineV1.mjs';
import { buildMissionScheduler } from '../runtime/missionScheduler.mjs';

const SHA_RE = /^[a-f0-9]{40}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SAFE_ID_RE = /^[a-z0-9][a-z0-9._:@/-]{2,239}$/i;
const REPOSITORY_RE = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const RESOURCE_ID_RE = /^[a-z0-9][a-z0-9._:/-]{0,239}$/;
const PROOF_REF_RE = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const EXPLICIT_TZ_RE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const MAX_PROVIDERS = 16;
const MAX_CANDIDATES = 256;
const MAX_RESOURCES = 10_000;
const MAX_LIST = 128;
const MAX_SLOTS = 32;
const MAX_DURATION_SECONDS = 30 * 24 * 60 * 60;
const MAX_FRESHNESS_SECONDS = 60 * 60;
const MAX_SCHEDULER_GOALS = 1000;
const MAX_SCHEDULER_ARRAY = 10_000;
const MAX_SCHEDULER_PREREQUISITES_PER_GOAL = 1000;
const MAX_SCHEDULER_TOTAL_PREREQUISITES = 10_000;
const MAX_SCHEDULER_SNAPSHOT_DEPTH = 32;
const MAX_SCHEDULER_SNAPSHOT_NODES = 50_000;
const MAX_SCHEDULER_SNAPSHOT_STRING_CODE_UNITS = 4 * 1024 * 1024;

export const FOUNDRY_ACCELERATION_SCHEMA = 'stephanos.foundry-parallel-production-acceleration.v1';
export const FOUNDRY_ACCELERATION_HOST_CONTEXT_SCHEMA = 'stephanos.foundry-acceleration-host-context.v1';
export const FOUNDRY_ACCELERATION_METRICS_RECEIPT_SCHEMA = 'stephanos.foundry-acceleration-metrics-receipt.v1';
export const MISSION_SCHEDULER_SCHEMA = 'stephanos.mission-scheduler.v1';

export const FOUNDRY_ACCELERATION_DECISIONS = Object.freeze({
  BLOCKED: 'FOUNDRY_ACCELERATION_BLOCKED',
  IDLE: 'FOUNDRY_ACCELERATION_IDLE',
  WAITING_FOR_M3: 'FOUNDRY_ACCELERATION_WAITING_FOR_M3',
  WAITING_FOR_CAPACITY: 'FOUNDRY_ACCELERATION_WAITING_FOR_CAPACITY',
  NO_POSITIVE_GAIN: 'FOUNDRY_ACCELERATION_NO_POSITIVE_GAIN',
  READY: 'FOUNDRY_ACCELERATION_READY_MODEL_ONLY',
});

const TRUSTED_KEYS = [
  'schemaVersion', 'repository', 'canonicalMainHead', 'canonicalMainTree', 'nowUtc',
  'taskClass', 'minimumNetSavingsSeconds', 'receiptFreshnessSeconds',
  'schedulerSource', 'providerCapacityEvidence', 'forgeSidecar',
];
const SCHEDULER_SOURCE_KEYS = [
  'correlationId', 'goals', 'proofHeadShas', 'proofReceipts', 'proofRefs',
  'minimumActiveLanes', 'maximumActiveLanes', 'availableExecutorSlots',
];
const EVIDENCE_KEYS = ['providerId', 'buildLaneReceipt', 'metricsReceipt'];
const METRICS_KEYS = [
  'schemaVersion', 'receiptId', 'providerId', 'buildLaneCapacityReceiptId', 'route',
  'repository', 'workerId', 'canonicalMainHead', 'canonicalMainTree', 'taskClass',
  'state', 'supportedOperations', 'supportedTaskClasses', 'observedAtUtc', 'expiresAtUtc',
  'availableSlots', 'queueDepth', 'p95StartLatencySeconds', 'medianExecutionSeconds',
  'reviewIntegrationSeconds', 'successRate', 'reworkRate', 'authorityReceiptIds',
  'proofRefs', 'payloadSha256',
];
const SCHEDULER_DECISION_KEYS = [
  'correlationId', 'decidedAt', 'status', 'failClosed', 'contradictionCodes',
  'selectedIssue', 'selectedIssues', 'selectedLifecycle', 'activeIssue', 'activeIssues',
  'route', 'proofRefs', 'proofHeadShas', 'proofReceipts',
];
const SCHEDULER_DECISION_STATUSES = new Set([
  'ACTIVE_LANE', 'ACTIVE_LANES', 'MERGE_READY', 'CLOSE_READY',
  'LANE_SELECTED', 'APPROVAL_REQUIRED', 'WAITING',
]);

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}
function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function integer(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null; }
function boundedNumber(value, maximum = MAX_DURATION_SECONDS) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum ? value : null;
}
function nonnegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
function ratio(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}
function instant(value) {
  const normalized = text(value);
  if (!normalized || !EXPLICIT_TZ_RE.test(normalized)) return Number.NaN;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function dense(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) return false;
  return true;
}
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function inertSnapshot(value, state, depth = 0) {
  state.nodes += 1;
  if (state.nodes > MAX_SCHEDULER_SNAPSHOT_NODES || depth > MAX_SCHEDULER_SNAPSHOT_DEPTH) {
    throw new TypeError('scheduler source exceeds inert snapshot bounds');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('scheduler source number is not finite');
    return value;
  }
  if (typeof value === 'string') {
    state.stringCodeUnits += value.length;
    if (state.stringCodeUnits > MAX_SCHEDULER_SNAPSHOT_STRING_CODE_UNITS) {
      throw new TypeError('scheduler source strings exceed inert snapshot bounds');
    }
    return value;
  }
  if (!value || typeof value !== 'object') throw new TypeError('scheduler source is not JSON-like');
  if (state.visiting.has(value)) throw new TypeError('scheduler source is cyclic');
  if (state.snapshots.has(value)) return state.snapshots.get(value);
  const prototype = Object.getPrototypeOf(value);
  const array = Array.isArray(value);
  if (array ? prototype !== Array.prototype : (prototype !== Object.prototype && prototype !== null)) {
    throw new TypeError('scheduler source prototype is not inert');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) throw new TypeError('scheduler source contains symbol keys');
  const lengthDescriptor = array ? Object.getOwnPropertyDescriptor(value, 'length') : null;
  const arrayLength = lengthDescriptor && Object.hasOwn(lengthDescriptor, 'value')
    && Number.isSafeInteger(lengthDescriptor.value) && lengthDescriptor.value >= 0
    ? lengthDescriptor.value
    : null;
  if (array && (arrayLength === null || arrayLength > MAX_SCHEDULER_ARRAY)) {
    throw new TypeError('scheduler source array exceeds bounds');
  }
  const expectedArrayKeys = array
    ? new Set(['length', ...Array.from({ length:arrayLength }, (_, index) => String(index))])
    : null;
  if (array && (keys.length !== expectedArrayKeys.size || keys.some((key) => !expectedArrayKeys.has(key)))) {
    throw new TypeError('scheduler source array is sparse or widened');
  }
  const snapshot = array ? [] : Object.create(null);
  state.snapshots.set(value, snapshot);
  state.visiting.add(value);
  for (const key of keys) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
      throw new TypeError('scheduler source contains accessors or hidden fields');
    }
    const entry = inertSnapshot(descriptor.value, state, depth + 1);
    if (array) snapshot[Number(key)] = entry;
    else Object.defineProperty(snapshot, key, {
      value:entry, enumerable:true, configurable:false, writable:false,
    });
  }
  state.visiting.delete(value);
  return Object.freeze(snapshot);
}
function snapshotSchedulerSource(value, blockers) {
  try {
    const snapshot = inertSnapshot(value, {
      nodes:0, stringCodeUnits:0, visiting:new WeakSet(), snapshots:new WeakMap(),
    });
    if (!exactKeys(snapshot, SCHEDULER_SOURCE_KEYS)) {
      blockers.push('scheduler-source-shape-invalid');
      return null;
    }
    if (!dense(snapshot.goals) || snapshot.goals.length > MAX_SCHEDULER_GOALS
      || !dense(snapshot.proofHeadShas) || snapshot.proofHeadShas.length > MAX_SCHEDULER_ARRAY
      || !dense(snapshot.proofReceipts) || snapshot.proofReceipts.length > MAX_SCHEDULER_ARRAY
      || !dense(snapshot.proofRefs) || snapshot.proofRefs.length > MAX_SCHEDULER_ARRAY) {
      blockers.push('scheduler-source-inventory-invalid');
      return null;
    }
    let totalPrerequisites = 0;
    for (const goal of snapshot.goals) {
      if (goal && typeof goal === 'object' && Object.hasOwn(goal, 'prerequisites')) {
        if (!dense(goal.prerequisites)
          || goal.prerequisites.length > MAX_SCHEDULER_PREREQUISITES_PER_GOAL) {
          blockers.push('scheduler-source-prerequisites-invalid');
          return null;
        }
        totalPrerequisites += goal.prerequisites.length;
        if (totalPrerequisites > MAX_SCHEDULER_TOTAL_PREREQUISITES) {
          blockers.push('scheduler-source-prerequisites-invalid');
          return null;
        }
      }
    }
    return snapshot;
  } catch {
    blockers.push('scheduler-source-inspection-failed');
    return null;
  }
}
function snapshotTrustedHostContext(value, blockers) {
  try {
    const snapshot = inertSnapshot(value, {
      nodes:0, stringCodeUnits:0, visiting:new WeakSet(), snapshots:new WeakMap(),
    });
    if (!exactKeys(snapshot, TRUSTED_KEYS)) {
      blockers.push('trusted-host-context-shape-invalid');
      return null;
    }
    return snapshot;
  } catch {
    blockers.push('trusted-host-context-inspection-failed');
    return null;
  }
}
function normalizedStrings(value, maximum = MAX_LIST, pattern = SAFE_ID_RE, allowEmpty = true) {
  if (!dense(value) || value.length > maximum || (!allowEmpty && value.length === 0)) return null;
  const result = value.map(text);
  if (result.some((entry) => !pattern.test(entry)) || new Set(result).size !== result.length) return null;
  return [...result].sort();
}
function normalizedProofRefs(value) {
  const refs = normalizedStrings(value, MAX_LIST, PROOF_REF_RE);
  return refs && refs.every((ref) => !ref.includes('..')) ? refs : null;
}
function sameSet(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function payloadDigest(receipt) {
  const core = { ...receipt };
  delete core.payloadSha256;
  return createHash('sha256').update(canonicalJson(core)).digest('hex');
}
function issueNumber(value) {
  const match = String(value ?? '').trim().match(/^#?([1-9]\d*)$/);
  const issue = match ? Number(match[1]) : Number.NaN;
  return Number.isSafeInteger(issue) && issue > 0 ? issue : null;
}
function authorityProjection() {
  return freeze({ dispatch:false, sourceMutation:false, branchMutation:false, publication:false,
    merge:false, deployment:false, runtimeMutation:false, credentialAccess:false,
    arbitraryCommand:false, recommendationOnly:true });
}
function blockedResult(blockers = ['trusted-host-context-invalid']) {
  return freeze({ schemaVersion:FOUNDRY_ACCELERATION_SCHEMA, valid:false,
    decision:FOUNDRY_ACCELERATION_DECISIONS.BLOCKED, blockers:[...new Set(blockers)],
    assignments:[], heldCandidates:[], providerStatus:[], foundryTelemetry:null,
    totalCriticalPathSecondsSaved:0, authority:authorityProjection() });
}

function validateMetricsReceipt(receipt, evidence, build, host, blockers) {
  if (!exactKeys(receipt, METRICS_KEYS)) {
    blockers.push('metrics-receipt-shape-invalid');
    return null;
  }
  const operations = normalizedStrings(receipt.supportedOperations);
  const classes = normalizedStrings(receipt.supportedTaskClasses);
  const authorities = normalizedStrings(receipt.authorityReceiptIds);
  const proofRefs = normalizedProofRefs(receipt.proofRefs);
  const buildOperations = normalizedStrings(build.supportedOperations);
  const buildClasses = normalizedStrings(build.supportedTaskClasses);
  const buildAuthorities = normalizedStrings(build.authorityReceiptIds);
  const buildProofRefs = normalizedProofRefs(build.proofRefs);
  const availableSlots = integer(receipt.availableSlots);
  const queueDepth = integer(receipt.queueDepth);
  const p95StartLatencySeconds = boundedNumber(receipt.p95StartLatencySeconds);
  const medianExecutionSeconds = integer(receipt.medianExecutionSeconds);
  const reviewIntegrationSeconds = integer(receipt.reviewIntegrationSeconds);
  const successRate = ratio(receipt.successRate);
  const reworkRate = ratio(receipt.reworkRate);
  const observedAtMs = instant(receipt.observedAtUtc);
  const expiresAtMs = instant(receipt.expiresAtUtc);
  const buildObservedAtMs = instant(build.observedAtUtc);
  const buildExpiresAtMs = instant(build.expiresAtUtc);
  const providerId = text(receipt.providerId).toLowerCase();
  const buildReceiptId = text(build.receiptId);
  const metricsReceiptId = text(receipt.receiptId);
  const boundBuildReceiptId = text(receipt.buildLaneCapacityReceiptId);

  if (receipt.schemaVersion !== FOUNDRY_ACCELERATION_METRICS_RECEIPT_SCHEMA) blockers.push('metrics-schema-invalid');
  if (!SAFE_ID_RE.test(providerId) || providerId !== text(evidence.providerId).toLowerCase()) blockers.push('metrics-provider-mismatch');
  if (!SAFE_ID_RE.test(metricsReceiptId)) blockers.push('metrics-receipt-id-invalid');
  if (boundBuildReceiptId !== buildReceiptId) blockers.push('metrics-build-receipt-mismatch');
  if (receipt.route !== build.route) blockers.push('metrics-route-mismatch');
  if (receipt.repository !== host.repository || receipt.repository !== build.repository) blockers.push('metrics-repository-mismatch');
  if (receipt.workerId !== build.workerId) blockers.push('metrics-worker-mismatch');
  if (text(receipt.canonicalMainHead).toLowerCase() !== host.canonicalMainHead) blockers.push('metrics-head-mismatch');
  if (text(receipt.canonicalMainTree).toLowerCase() !== host.canonicalMainTree) blockers.push('metrics-tree-mismatch');
  if (receipt.taskClass !== host.taskClass || !buildClasses?.includes(host.taskClass)) blockers.push('metrics-task-class-mismatch');
  if (receipt.state !== build.state || receipt.state !== 'READY') blockers.push('metrics-state-mismatch');
  if (!operations || !buildOperations || !sameSet(operations, buildOperations)) blockers.push('metrics-operations-mismatch');
  if (!classes || !buildClasses || !sameSet(classes, buildClasses)) blockers.push('metrics-task-classes-mismatch');
  if (!authorities || !buildAuthorities || buildAuthorities.some((id) => !authorities.includes(id))) blockers.push('metrics-authority-binding-invalid');
  if (!proofRefs || !buildProofRefs || buildProofRefs.some((ref) => !proofRefs.includes(ref))) blockers.push('metrics-proof-binding-invalid');
  if (availableSlots === null || availableSlots > MAX_SLOTS) blockers.push('metrics-slots-invalid');
  if (queueDepth === null || queueDepth !== build.queueDepth) blockers.push('metrics-queue-mismatch');
  if (p95StartLatencySeconds === null || p95StartLatencySeconds !== build.p95StartLatencySeconds) blockers.push('metrics-start-latency-mismatch');
  if (medianExecutionSeconds === null || medianExecutionSeconds > MAX_DURATION_SECONDS) blockers.push('metrics-execution-invalid');
  if (reviewIntegrationSeconds === null || reviewIntegrationSeconds > MAX_DURATION_SECONDS) blockers.push('metrics-integration-invalid');
  if (successRate === null) blockers.push('metrics-success-rate-invalid');
  if (reworkRate === null) blockers.push('metrics-rework-rate-invalid');
  if (!Number.isFinite(observedAtMs) || !Number.isFinite(expiresAtMs)
    || observedAtMs < buildObservedAtMs || expiresAtMs > buildExpiresAtMs
    || observedAtMs > host.nowMs + 60_000 || host.nowMs - observedAtMs > host.freshnessSeconds * 1000
    || expiresAtMs <= host.nowMs || expiresAtMs <= observedAtMs) blockers.push('metrics-validity-window-invalid');
  if (!SHA256_RE.test(text(receipt.payloadSha256).toLowerCase())
    || payloadDigest(receipt) !== text(receipt.payloadSha256).toLowerCase()) blockers.push('metrics-payload-digest-invalid');
  if (blockers.length) return null;
  const predictedSeconds = p95StartLatencySeconds + medianExecutionSeconds + reviewIntegrationSeconds
    + (medianExecutionSeconds * reworkRate)
    + (medianExecutionSeconds * (1 - successRate));
  return { providerId, route:build.route, workerId:build.workerId, supportedOperations:operations,
    availableSlots, queueDepth, predictedSeconds, authorityReceiptIds:authorities,
    proofRefs, capacityReceiptId:buildReceiptId, metricsReceiptId,
    observedAtUtc:receipt.observedAtUtc };
}

function normalizeScheduler(projection, host, blockers) {
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
    blockers.push('scheduler-projection-missing');
    return null;
  }
  if (projection.schemaVersion !== MISSION_SCHEDULER_SCHEMA) blockers.push('scheduler-schema-invalid');
  if (projection.readOnly !== true) blockers.push('scheduler-not-read-only');
  if (projection.failClosed !== false || projection.contradictionsTotal !== 0
    || !dense(projection.contradictions) || projection.contradictions.length !== 0) {
    blockers.push('scheduler-contradiction-state-invalid');
  }
  if (!dense(projection.parallelCandidateDetails) || projection.parallelCandidateDetails.length > MAX_CANDIDATES) {
    blockers.push('scheduler-candidates-invalid');
    return null;
  }
  if (!dense(projection.portfolio) || projection.portfolio.length > 1000) {
    blockers.push('scheduler-portfolio-invalid');
    return null;
  }
  if (!dense(projection.activeGoals) || projection.activeGoals.length > MAX_CANDIDATES) blockers.push('scheduler-active-goals-invalid');
  if (!dense(projection.parallelCandidates) || projection.parallelCandidates.length > MAX_CANDIDATES) {
    blockers.push('scheduler-parallel-candidate-refs-invalid');
  }
  const decision = projection.decisionReceipt;
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    blockers.push('scheduler-decision-receipt-invalid');
    return null;
  }
  if (!exactKeys(decision, SCHEDULER_DECISION_KEYS)) blockers.push('scheduler-decision-receipt-shape-invalid');
  const decidedAtMs = instant(decision.decidedAt);
  const decisionStatus = text(decision.status);
  if (decision.failClosed !== false || !SCHEDULER_DECISION_STATUSES.has(decisionStatus)
    || !dense(decision.contradictionCodes) || decision.contradictionCodes.length !== 0
    || !Number.isFinite(decidedAtMs)
    || decidedAtMs > host.nowMs || host.nowMs - decidedAtMs > host.freshnessSeconds * 1000) {
    blockers.push('scheduler-decision-stale-or-invalid');
  }
  if (!dense(decision.proofRefs) || !dense(decision.proofHeadShas) || !dense(decision.proofReceipts)
    || decision.proofRefs.length > MAX_SCHEDULER_ARRAY
    || decision.proofHeadShas.length > MAX_SCHEDULER_ARRAY
    || decision.proofReceipts.length > MAX_SCHEDULER_ARRAY) {
    blockers.push('scheduler-decision-proof-inventory-invalid');
  }
  if (!dense(decision.selectedIssues) || decision.selectedIssues.length > MAX_CANDIDATES
    || !dense(decision.activeIssues) || decision.activeIssues.length > MAX_CANDIDATES) {
    blockers.push('scheduler-decision-issues-invalid');
    return null;
  }

  const portfolioByIssue = new Map();
  for (const item of projection.portfolio) {
    const issue = issueNumber(item?.issue);
    const resourceIds = normalizedStrings(item?.resourceIds, MAX_RESOURCES, RESOURCE_ID_RE);
    const weight = nonnegativeNumber(item?.criticalPathWeight);
    if (!issue || !resourceIds || weight === null || portfolioByIssue.has(issue)) {
      blockers.push('scheduler-portfolio-item-invalid');
      continue;
    }
    portfolioByIssue.set(issue, { issue, route:text(item.route), lifecycle:text(item.lifecycle),
      evidenceFreshness:text(item.evidenceFreshness), resourceIds, criticalPathWeight:weight });
  }

  const activeFromProjection = projection.activeGoals.map(issueNumber);
  const activeFromReceipt = decision.activeIssues.map(issueNumber);
  const activeFromPortfolio = [...portfolioByIssue.values()]
    .filter(({ lifecycle }) => lifecycle === 'ACTIVE').map(({ issue }) => issue).sort((a, b) => a - b);
  if (activeFromProjection.some((issue) => issue === null) || activeFromReceipt.some((issue) => issue === null)
    || !sameSet([...activeFromProjection].sort((a, b) => a - b), [...activeFromReceipt].sort((a, b) => a - b))) {
    blockers.push('scheduler-active-issues-mismatch');
  }
  if (!sameSet([...activeFromReceipt].sort((a, b) => a - b), activeFromPortfolio)) {
    blockers.push('scheduler-active-portfolio-inventory-mismatch');
  }
  const expectedActiveStatus = activeFromReceipt.length === 1 ? 'ACTIVE_LANE'
    : activeFromReceipt.length > 1 ? 'ACTIVE_LANES' : null;
  const selectedDecisionIssue = issueNumber(decision.selectedIssue);
  const selectedDecisionPortfolio = selectedDecisionIssue ? portfolioByIssue.get(selectedDecisionIssue) : null;
  const primaryActivePortfolio = activeFromReceipt[0] ? portfolioByIssue.get(activeFromReceipt[0]) : null;
  if ((expectedActiveStatus && decisionStatus !== expectedActiveStatus)
    || (!expectedActiveStatus && (decisionStatus === 'ACTIVE_LANE' || decisionStatus === 'ACTIVE_LANES'))
    || (expectedActiveStatus && issueNumber(decision.activeIssue) !== activeFromReceipt[0])
    || (expectedActiveStatus && (decision.selectedIssue !== null || decision.selectedLifecycle !== null
      || text(decision.route) !== primaryActivePortfolio?.route))
    || (!expectedActiveStatus && decision.activeIssue !== null)
    || (decisionStatus === 'LANE_SELECTED'
      && (!selectedDecisionIssue
        || decision.selectedIssues.map(issueNumber)[0] !== selectedDecisionIssue
        || selectedDecisionPortfolio?.lifecycle !== 'READY'
        || selectedDecisionPortfolio?.route !== text(decision.route)
        || decision.selectedLifecycle !== 'READY'))
    || (decisionStatus === 'MERGE_READY'
      && (!selectedDecisionIssue || selectedDecisionPortfolio?.lifecycle !== 'MERGE_READY'
        || selectedDecisionPortfolio?.route !== text(decision.route)
        || decision.selectedLifecycle !== 'MERGE_READY'))
    || (decisionStatus === 'CLOSE_READY'
      && (!selectedDecisionIssue || selectedDecisionPortfolio?.lifecycle !== 'CLOSE_READY'
        || selectedDecisionPortfolio?.route !== text(decision.route)
        || decision.selectedLifecycle !== 'CLOSE_READY'))
    || ((decisionStatus === 'WAITING' || decisionStatus === 'APPROVAL_REQUIRED')
      && (decision.selectedIssue !== null
      || decision.selectedIssues.length > 0 || projection.parallelCandidates.length > 0
      || projection.parallelCandidateDetails.length > 0))) {
    blockers.push('scheduler-decision-status-inconsistent');
  }
  const activeResources = new Set();
  for (const issue of activeFromReceipt.filter(Boolean)) {
    const item = portfolioByIssue.get(issue);
    if (!item || item.lifecycle !== 'ACTIVE' || item.evidenceFreshness !== 'FRESH'
      || item.resourceIds.length === 0) {
      blockers.push(`scheduler-active-portfolio-invalid:#${issue}`);
      continue;
    }
    item.resourceIds.forEach((resourceId) => activeResources.add(resourceId));
  }

  const candidates = [];
  const selectedIssues = new Set();
  const selectedResources = new Set();
  for (const detail of projection.parallelCandidateDetails) {
    const issue = issueNumber(detail?.issue);
    const resourceIds = normalizedStrings(detail?.resourceIds, MAX_RESOURCES, RESOURCE_ID_RE, false);
    const item = issue ? portfolioByIssue.get(issue) : null;
    if (!issue || detail?.candidateId !== `#${issue}` || !resourceIds || !item || selectedIssues.has(issue)) {
      blockers.push('scheduler-candidate-detail-invalid');
      continue;
    }
    if (text(detail.route) !== item.route || item.lifecycle !== 'READY' || item.evidenceFreshness !== 'FRESH') {
      blockers.push(`scheduler-candidate-route-or-lifecycle-invalid:#${issue}`);
    }
    if (!sameSet(resourceIds, item.resourceIds)) blockers.push(`scheduler-candidate-resource-mismatch:#${issue}`);
    if (resourceIds.some((resourceId) => activeResources.has(resourceId))) {
      blockers.push(`scheduler-candidate-active-resource-conflict:#${issue}`);
    }
    if (resourceIds.some((resourceId) => selectedResources.has(resourceId))) {
      blockers.push(`scheduler-candidate-parallel-resource-conflict:#${issue}`);
    }
    resourceIds.forEach((resourceId) => selectedResources.add(resourceId));
    selectedIssues.add(issue);
    candidates.push({ candidateId:`#${issue}`, issue, route:item.route, resourceIds,
      criticalPathWeight:item.criticalPathWeight });
  }
  const receiptSelected = decision.selectedIssues.map(issueNumber);
  const detailSelected = candidates.map(({ issue }) => issue);
  if (receiptSelected.some((issue) => issue === null) || !sameSet(receiptSelected, detailSelected)) {
    blockers.push('scheduler-selected-issues-mismatch');
  }
  const parallelRefs = dense(projection.parallelCandidates)
    ? [...projection.parallelCandidates].map(text)
    : [];
  const detailRefs = candidates.map(({ candidateId }) => candidateId);
  if (!sameSet(parallelRefs, detailRefs)) blockers.push('scheduler-parallel-candidate-refs-mismatch');
  if (blockers.length) return null;
  return candidates.filter(({ route }) => route === 'CHATGPT_GITHUB');
}

function forgeProof(forge, foundry, host, blockers) {
  const m2ReceiptId = text(forge?.m2ReceiptId);
  const m3RuntimeReceiptId = text(forge?.m3RuntimeReceiptId);
  if (forge?.repository !== host.repository) blockers.push('forge-repository-mismatch');
  if (text(forge?.canonicalMainHead).toLowerCase() !== host.canonicalMainHead) blockers.push('forge-head-mismatch');
  if (text(forge?.canonicalMainTree).toLowerCase() !== host.canonicalMainTree) blockers.push('forge-tree-mismatch');
  if (text(forge?.mirrorHead).toLowerCase() !== host.canonicalMainHead
    || text(forge?.mirrorTree).toLowerCase() !== host.canonicalMainTree) blockers.push('forge-mirror-mismatch');
  for (const [field, blocker] of [
    ['sourceReady', 'forge-source-not-ready'], ['runtimeReady', 'forge-runtime-not-ready'],
    ['canCarryRealWork', 'forge-cannot-carry-real-work'], ['m2ReceiptValid', 'forge-m2-invalid'],
    ['m3RuntimeReceiptValid', 'forge-m3-runtime-invalid'], ['evidenceBound', 'forge-evidence-unbound'],
  ]) if (forge?.[field] !== true) blockers.push(blocker);
  if (forge?.activationRequired === true) blockers.push('forge-activation-required');
  if (!SAFE_ID_RE.test(m2ReceiptId) || !SAFE_ID_RE.test(m3RuntimeReceiptId)) blockers.push('forge-receipt-identity-invalid');
  if (m2ReceiptId && m2ReceiptId === m3RuntimeReceiptId) blockers.push('forge-receipt-identities-not-distinct');
  for (const receiptId of [m2ReceiptId, m3RuntimeReceiptId]) {
    if (!foundry?.buildAuthorityReceiptIds.includes(receiptId)
      || !foundry?.authorityReceiptIds.includes(receiptId)) blockers.push('foundry-forge-authority-binding-invalid');
  }
  return blockers.length ? null : { m2ReceiptId, m3RuntimeReceiptId };
}

function telemetry(foundry, forge, activePackets) {
  if (!foundry) return freeze({ status:'NOT_OBSERVED', queueDepth:null, availableSlots:null,
    activePackets:0, capacityReceiptId:null, metricsReceiptId:null, m2ReceiptId:null,
    m3RuntimeReceiptId:null, operatorRequired:true });
  const proven = foundry.evidenceValid && Boolean(forge);
  const status = !proven ? 'HELD_UNPROVEN' : foundry.availableSlots > 0 ? 'READY' : 'CAPACITY_EXHAUSTED';
  return freeze({ status, queueDepth:foundry.queueDepth,
    availableSlots:foundry.availableSlots, activePackets, capacityReceiptId:foundry.capacityReceiptId,
    metricsReceiptId:foundry.metricsReceiptId, m2ReceiptId:forge?.m2ReceiptId ?? null,
    m3RuntimeReceiptId:forge?.m3RuntimeReceiptId ?? null,
    operatorRequired:!proven });
}

/**
 * Returns a recommendation only. The first argument is intentionally never
 * observed. The host must inject its current main snapshot, canonical Mission
 * Scheduler source, capacity receipts and Forge sidecar evidence in the second
 * argument. Dispatch must re-read the scheduler/lease projection.
 */
export function planFoundryParallelProductionAcceleration(_request = {}, trustedContext = {}) {
  try {
    const hostBlockers = [];
    const context = snapshotTrustedHostContext(trustedContext, hostBlockers);
    if (!context) return blockedResult(hostBlockers);
    const repository = text(context.repository);
    const canonicalMainHead = text(context.canonicalMainHead).toLowerCase();
    const canonicalMainTree = text(context.canonicalMainTree).toLowerCase();
    const nowMs = instant(context.nowUtc);
    const taskClass = text(context.taskClass);
    const minimumNetSavingsSeconds = integer(context.minimumNetSavingsSeconds);
    const freshnessSeconds = integer(context.receiptFreshnessSeconds);
    if (context.schemaVersion !== FOUNDRY_ACCELERATION_HOST_CONTEXT_SCHEMA) hostBlockers.push('trusted-host-schema-invalid');
    if (!REPOSITORY_RE.test(repository)) hostBlockers.push('trusted-repository-invalid');
    if (!SHA_RE.test(canonicalMainHead)) hostBlockers.push('trusted-main-head-invalid');
    if (!SHA_RE.test(canonicalMainTree)) hostBlockers.push('trusted-main-tree-invalid');
    if (!Number.isFinite(nowMs)) hostBlockers.push('trusted-clock-invalid');
    if (!SAFE_ID_RE.test(taskClass)) hostBlockers.push('trusted-task-class-invalid');
    if (minimumNetSavingsSeconds === null || minimumNetSavingsSeconds > MAX_DURATION_SECONDS) hostBlockers.push('trusted-minimum-savings-invalid');
    if (freshnessSeconds === null || freshnessSeconds < 1 || freshnessSeconds > MAX_FRESHNESS_SECONDS) hostBlockers.push('trusted-freshness-invalid');
    if (!dense(context.providerCapacityEvidence)
      || context.providerCapacityEvidence.length > MAX_PROVIDERS) hostBlockers.push('provider-evidence-inventory-invalid');
    if (hostBlockers.length) return blockedResult(hostBlockers);
    const host = { repository, canonicalMainHead, canonicalMainTree, nowMs,
      nowUtc:new Date(nowMs).toISOString(), taskClass, minimumNetSavingsSeconds, freshnessSeconds };

    const schedulerBlockers = [];
    const schedulerSource = snapshotSchedulerSource(context.schedulerSource, schedulerBlockers);
    if (!schedulerSource) return blockedResult(schedulerBlockers);
    const schedulerProjection = buildMissionScheduler({
      ...schedulerSource,
      now:host.nowUtc,
      freshnessMs:host.freshnessSeconds * 1000,
    });
    const candidates = normalizeScheduler(schedulerProjection, host, schedulerBlockers);
    if (!candidates) return blockedResult(schedulerBlockers);

    const providers = [];
    const providerIds = new Set();
    const routes = new Set();
    const receiptIds = new Set();
    for (const rawEvidence of context.providerCapacityEvidence) {
      const evidence = rawEvidence && typeof rawEvidence === 'object' && !Array.isArray(rawEvidence) ? rawEvidence : {};
      const blockers = [];
      const providerId = text(evidence.providerId).toLowerCase();
      if (!exactKeys(evidence, EVIDENCE_KEYS)) blockers.push('provider-evidence-shape-invalid');
      if (!SAFE_ID_RE.test(providerId)) blockers.push('provider-id-invalid');
      const validation = validateBuildLaneCapacityReceipt(evidence.buildLaneReceipt, {
        repository:host.repository, taskClass:host.taskClass, nowUtc:host.nowUtc,
      });
      if (!validation.valid) blockers.push('canonical-build-capacity-receipt-invalid');
      const build = validation.receipt;
      const capacityReceiptId = text(build?.receiptId);
      if (build && build.route !== validation.route) blockers.push('provider-route-not-canonical');
      const allowedRoute = validation.route === MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB
        || validation.route === MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE;
      if (!allowedRoute) blockers.push('provider-route-not-acceleration-lane');
      const metrics = build ? validateMetricsReceipt(evidence.metricsReceipt, evidence, build, host, blockers) : null;
      if (providerIds.has(providerId)) blockers.push('provider-id-duplicate');
      if (build && routes.has(validation.route)) blockers.push('provider-route-duplicate');
      if (build && receiptIds.has(capacityReceiptId)) blockers.push('capacity-receipt-id-duplicate');
      providerIds.add(providerId);
      if (build) { routes.add(validation.route); receiptIds.add(capacityReceiptId); }
      if (metrics && receiptIds.has(metrics.metricsReceiptId)) blockers.push('metrics-receipt-id-duplicate');
      if (metrics) receiptIds.add(metrics.metricsReceiptId);
      providers.push({ providerId, route:build ? validation.route : null, workerId:build?.workerId ?? null,
        availableSlots:metrics?.availableSlots ?? null, queueDepth:metrics?.queueDepth ?? null,
        predictedSeconds:metrics?.predictedSeconds ?? null, capacityReceiptId:metrics?.capacityReceiptId ?? null,
        metricsReceiptId:metrics?.metricsReceiptId ?? null, authorityReceiptIds:metrics?.authorityReceiptIds ?? [],
        buildAuthorityReceiptIds:normalizedStrings(build?.authorityReceiptIds) ?? [],
        observedAtUtc:metrics?.observedAtUtc ?? null, blockers,
        evidenceValid:blockers.length === 0,
        eligible:blockers.length === 0 && metrics?.availableSlots > 0 });
    }
    const identityFailure = providers.flatMap(({ blockers }) => blockers).filter((blocker) => blocker.endsWith('-duplicate'));
    if (identityFailure.length) return blockedResult(identityFailure);
    const providerFailures = providers.flatMap(({ blockers }) => blockers);
    if (providerFailures.length) return blockedResult(providerFailures);
    const github = providers.find(({ route }) => route === MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB);
    if (!github?.evidenceValid) return blockedResult(['github-baseline-capacity-invalid', ...(github?.blockers ?? [])]);
    const foundry = providers.find(({ route }) => route === MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE);
    let forge = null;
    if (foundry) {
      const forgeBlockers = [];
      const adjudication = adjudicateForgeSidecarCapacity(context.forgeSidecar, { nowUtc:host.nowUtc });
      forge = forgeProof(adjudication, foundry, host, forgeBlockers);
      if (forge && [forge.m2ReceiptId, forge.m3RuntimeReceiptId].some((receiptId) => receiptIds.has(receiptId))) {
        return blockedResult(['forge-receipt-id-duplicate']);
      }
      if (forge) {
        receiptIds.add(forge.m2ReceiptId);
        receiptIds.add(forge.m3RuntimeReceiptId);
      }
      if (!forge) {
        foundry.blockers.push(...forgeBlockers);
        foundry.evidenceValid = false;
        foundry.eligible = false;
      }
    }

    const assignments = [];
    const heldCandidates = [];
    const foundryProven = Boolean(foundry?.evidenceValid && forge);
    let foundrySlots = foundryProven ? foundry.availableSlots : 0;
    let hasQualifyingGain = false;
    for (const candidate of candidates) {
      const netSecondsSaved = foundryProven ? github.predictedSeconds - foundry.predictedSeconds : null;
      const qualifyingGain = netSecondsSaved > 0 && netSecondsSaved >= minimumNetSavingsSeconds;
      if (qualifyingGain) hasQualifyingGain = true;
      if (foundrySlots > 0 && qualifyingGain) {
        foundrySlots -= 1;
        assignments.push({ candidateId:candidate.candidateId, issue:candidate.issue,
          providerId:foundry.providerId, route:foundry.route, workerId:foundry.workerId,
          resourceIds:candidate.resourceIds, criticalPathWeight:candidate.criticalPathWeight,
          baselineProviderId:github.providerId, baselinePredictedSeconds:github.predictedSeconds,
          providerPredictedSeconds:foundry.predictedSeconds, predictedNetSecondsSaved:netSecondsSaved,
          capacityReceiptId:foundry.capacityReceiptId, metricsReceiptId:foundry.metricsReceiptId,
          dispatchAuthority:false });
      } else {
        const reason = !foundryProven ? 'NO_PROVEN_FOUNDRY_CAPACITY'
          : !(netSecondsSaved > 0 && netSecondsSaved >= minimumNetSavingsSeconds)
            ? 'NO_POSITIVE_NET_ACCELERATION_USE_GITHUB'
            : 'NO_AVAILABLE_FOUNDRY_SLOT_USE_GITHUB';
        heldCandidates.push({ candidateId:candidate.candidateId, issue:candidate.issue,
          reason });
      }
    }
    const decision = candidates.length === 0 ? FOUNDRY_ACCELERATION_DECISIONS.IDLE
      : assignments.length ? FOUNDRY_ACCELERATION_DECISIONS.READY
        : !foundryProven ? FOUNDRY_ACCELERATION_DECISIONS.WAITING_FOR_M3
          : foundry.availableSlots === 0 && hasQualifyingGain
            ? FOUNDRY_ACCELERATION_DECISIONS.WAITING_FOR_CAPACITY
            : FOUNDRY_ACCELERATION_DECISIONS.NO_POSITIVE_GAIN;
    return freeze({ schemaVersion:FOUNDRY_ACCELERATION_SCHEMA, valid:true, decision,
      repository, canonicalMainHead, canonicalMainTree, observedAtUtc:host.nowUtc,
      minimumNetSavingsSeconds, baselineProviderId:github.providerId,
      assignments, heldCandidates,
      providerStatus:providers.map((provider) => ({ providerId:provider.providerId, route:provider.route,
        evidenceValid:provider.evidenceValid, eligible:provider.eligible,
        availableSlots:provider.availableSlots, queueDepth:provider.queueDepth,
        predictedSeconds:provider.predictedSeconds, capacityReceiptId:provider.capacityReceiptId,
        metricsReceiptId:provider.metricsReceiptId, observedAtUtc:provider.observedAtUtc,
        blockers:[...new Set(provider.blockers)] })),
      foundryTelemetry:telemetry(foundry, forge, assignments.length),
      totalCriticalPathSecondsSaved:assignments.reduce((sum, assignment) =>
        sum + assignment.predictedNetSecondsSaved, 0),
      authority:authorityProjection() });
  } catch {
    return blockedResult(['trusted-host-context-observation-failed']);
  }
}
