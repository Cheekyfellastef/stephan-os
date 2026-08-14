import { createHash } from 'node:crypto';

import {
  FOUNDRY_ACCELERATION_DECISIONS,
  planFoundryParallelProductionAcceleration,
} from './foundryParallelProductionAccelerationV1.mjs';
import {
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceStatusRecord,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';

export const FOUNDRY_ACCELERATION_WORKSPACE_SCHEMA =
  'stephanos.foundry-parallel-production-acceleration-shared-workspace.v1';
export const FOUNDRY_ACCELERATION_WORKSPACE_PARTICIPANT =
  'foundry-parallel-production-acceleration';
export const FOUNDRY_ACCELERATION_WORKSPACE_STATUS_ID =
  'foundry-parallel-production-acceleration-current';
export const FOUNDRY_ACCELERATION_WORKSPACE_EVENT_KIND =
  'foundry-parallel-production-acceleration-recommendation';

export const FOUNDRY_ACCELERATION_WORKSPACE_TRUTH = Object.freeze({
  BLOCKED: 'BLOCKED',
  CURRENT_READY: 'CURRENT_READY',
  CURRENT_HELD: 'CURRENT_HELD',
  CURRENT_IDLE: 'CURRENT_IDLE',
});

const MAX_ASSIGNMENTS_SHOWN = 16;
const MAX_HELD_SHOWN = 16;
const MAX_PROVIDERS_SHOWN = 8;
const MAX_BLOCKERS_SHOWN = 12;
const SAFE_CODE = /^[a-z0-9][a-z0-9._:@#/-]{0,239}$/i;
const SAFE_REPOSITORY = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const SHA = /^[a-f0-9]{40}$/;

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeCode(value) {
  const normalized = text(value);
  return normalized && SAFE_CODE.test(normalized) && !normalized.includes('..')
    ? normalized
    : null;
}

function safeCandidateId(value, issue) {
  const normalized = text(value);
  return issue && normalized === `#${issue}` ? normalized : null;
}

function nonnegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function positiveIssue(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function dense(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function blockerCodes(value) {
  if (!dense(value)) return [];
  return [...new Set(value.map(safeCode).filter(Boolean))]
    .sort()
    .slice(0, MAX_BLOCKERS_SHOWN);
}

function compactAssignment(value) {
  const issue = positiveIssue(value?.issue);
  const candidateId = safeCandidateId(value?.candidateId, issue);
  const providerId = safeCode(value?.providerId);
  const route = safeCode(value?.route);
  const workerId = safeCode(value?.workerId);
  const baselineProviderId = safeCode(value?.baselineProviderId);
  const capacityReceiptId = safeCode(value?.capacityReceiptId);
  const metricsReceiptId = safeCode(value?.metricsReceiptId);
  const criticalPathWeight = nonnegativeNumber(value?.criticalPathWeight);
  const baselinePredictedSeconds = nonnegativeNumber(value?.baselinePredictedSeconds);
  const providerPredictedSeconds = nonnegativeNumber(value?.providerPredictedSeconds);
  const predictedNetSecondsSaved = nonnegativeNumber(value?.predictedNetSecondsSaved);
  const resourceCount = dense(value?.resourceIds) ? value.resourceIds.length : null;
  if (!issue || candidateId !== `#${issue}` || !providerId || !route || !workerId
    || !baselineProviderId || !capacityReceiptId || !metricsReceiptId
    || criticalPathWeight === null || baselinePredictedSeconds === null
    || providerPredictedSeconds === null || predictedNetSecondsSaved === null
    || resourceCount === null || value?.dispatchAuthority !== false) return null;
  return freeze({
    candidateId,
    issue,
    providerId,
    route,
    workerId,
    baselineProviderId,
    criticalPathWeight,
    resourceCount,
    baselinePredictedSeconds,
    providerPredictedSeconds,
    predictedNetSecondsSaved,
    capacityReceiptId,
    metricsReceiptId,
    dispatchAllowed: false,
  });
}

function compactHeld(value) {
  const issue = positiveIssue(value?.issue);
  const candidateId = safeCandidateId(value?.candidateId, issue);
  const reason = safeCode(value?.reason);
  if (!issue || candidateId !== `#${issue}` || !reason) return null;
  return freeze({ candidateId, issue, reason });
}

function compactProvider(value) {
  const providerId = safeCode(value?.providerId);
  const route = safeCode(value?.route);
  const availableSlots = nonnegativeNumber(value?.availableSlots);
  const queueDepth = nonnegativeNumber(value?.queueDepth);
  const predictedSeconds = nonnegativeNumber(value?.predictedSeconds);
  const capacityReceiptId = safeCode(value?.capacityReceiptId);
  const metricsReceiptId = safeCode(value?.metricsReceiptId);
  const observedAtUtc = text(value?.observedAtUtc);
  if (!providerId || !route || availableSlots === null || queueDepth === null
    || predictedSeconds === null || !capacityReceiptId || !metricsReceiptId
    || !Number.isFinite(Date.parse(observedAtUtc))) return null;
  return freeze({
    providerId,
    route,
    evidenceValid: value?.evidenceValid === true,
    eligible: value?.eligible === true,
    availableSlots,
    queueDepth,
    predictedSeconds,
    capacityReceiptId,
    metricsReceiptId,
    observedAtUtc,
    blockerCodes: blockerCodes(value?.blockers),
  });
}

function compactFoundryTelemetry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = safeCode(value.status);
  const queueDepth = nonnegativeNumber(value.queueDepth);
  const availableSlots = nonnegativeNumber(value.availableSlots);
  const activePackets = nonnegativeNumber(value.activePackets);
  const capacityReceiptId = safeCode(value.capacityReceiptId);
  const metricsReceiptId = safeCode(value.metricsReceiptId);
  const m2ReceiptId = safeCode(value.m2ReceiptId);
  const m3RuntimeReceiptId = safeCode(value.m3RuntimeReceiptId);
  if (!status || queueDepth === null || availableSlots === null || activePackets === null
    || !capacityReceiptId || !metricsReceiptId || !m2ReceiptId || !m3RuntimeReceiptId) return null;
  return freeze({
    status,
    queueDepth,
    availableSlots,
    activePackets,
    capacityReceiptId,
    metricsReceiptId,
    m2ReceiptId,
    m3RuntimeReceiptId,
    operatorRequired: value.operatorRequired === true,
  });
}

function truthFor(plan) {
  if (plan?.valid !== true) return FOUNDRY_ACCELERATION_WORKSPACE_TRUTH.BLOCKED;
  if (plan.decision === FOUNDRY_ACCELERATION_DECISIONS.READY) {
    return FOUNDRY_ACCELERATION_WORKSPACE_TRUTH.CURRENT_READY;
  }
  if (plan.decision === FOUNDRY_ACCELERATION_DECISIONS.IDLE) {
    return FOUNDRY_ACCELERATION_WORKSPACE_TRUTH.CURRENT_IDLE;
  }
  return FOUNDRY_ACCELERATION_WORKSPACE_TRUTH.CURRENT_HELD;
}

function summaryFor(slice) {
  if (slice.truthState === FOUNDRY_ACCELERATION_WORKSPACE_TRUTH.CURRENT_READY) {
    return `Foundry acceleration recommends ${slice.assignmentTotal} packet(s) and predicts ${slice.totalCriticalPathSecondsSaved} seconds saved; dispatch remains separately gated.`;
  }
  if (slice.truthState === FOUNDRY_ACCELERATION_WORKSPACE_TRUTH.CURRENT_IDLE) {
    return 'Foundry acceleration is current and idle because the canonical scheduler selected no candidate packets.';
  }
  if (slice.truthState === FOUNDRY_ACCELERATION_WORKSPACE_TRUTH.CURRENT_HELD) {
    return `Foundry acceleration is current but held at ${slice.decision}; no dispatch authority is granted.`;
  }
  return 'Foundry acceleration evidence is blocked and cannot be advertised as usable capacity.';
}

function finalVerdictFor(truthState) {
  return `FOUNDRY_ACCELERATION_WORKSPACE_${truthState}`;
}

function eventIdFor(slice) {
  const snapshotDigest = createHash('sha256')
    .update(JSON.stringify(slice))
    .digest('hex')
    .slice(0, 24);
  return `${FOUNDRY_ACCELERATION_WORKSPACE_EVENT_KIND}-${snapshotDigest}`;
}

export function createFoundryAccelerationWorkspaceSlice(trustedHostContext = {}) {
  const plan = planFoundryParallelProductionAcceleration({}, trustedHostContext);
  const rawAssignments = dense(plan?.assignments) ? plan.assignments : [];
  const rawHeld = dense(plan?.heldCandidates) ? plan.heldCandidates : [];
  const rawProviders = dense(plan?.providerStatus) ? plan.providerStatus : [];
  const compactAssignments = rawAssignments.map(compactAssignment).filter(Boolean)
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  const compactHeldCandidates = rawHeld.map(compactHeld).filter(Boolean)
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  const compactProviders = rawProviders.map(compactProvider).filter(Boolean)
    .sort((left, right) => left.route.localeCompare(right.route)
      || left.providerId.localeCompare(right.providerId));
  const structurallyComplete = compactAssignments.length === rawAssignments.length
    && compactHeldCandidates.length === rawHeld.length
    && compactProviders.length === rawProviders.length;
  const planTruth = truthFor(plan);
  const truthState = structurallyComplete
    ? planTruth
    : FOUNDRY_ACCELERATION_WORKSPACE_TRUTH.BLOCKED;
  const timestampUtc = plan?.valid === true && Number.isFinite(Date.parse(plan.observedAtUtc))
    ? new Date(Date.parse(plan.observedAtUtc)).toISOString()
    : new Date(0).toISOString();
  const repository = plan?.valid === true && SAFE_REPOSITORY.test(text(plan.repository))
    ? text(plan.repository)
    : null;
  const canonicalMainHead = plan?.valid === true && SHA.test(text(plan.canonicalMainHead))
    ? text(plan.canonicalMainHead)
    : null;
  const canonicalMainTree = plan?.valid === true && SHA.test(text(plan.canonicalMainTree))
    ? text(plan.canonicalMainTree)
    : null;
  const totalCriticalPathSecondsSaved = nonnegativeNumber(plan?.totalCriticalPathSecondsSaved) ?? 0;
  const recommendationUsable = truthState === FOUNDRY_ACCELERATION_WORKSPACE_TRUTH.CURRENT_READY
    && compactAssignments.length > 0;
  const slice = {
    schemaVersion: FOUNDRY_ACCELERATION_WORKSPACE_SCHEMA,
    kind: 'stephanos.foundry_acceleration.workspace_status',
    participantId: FOUNDRY_ACCELERATION_WORKSPACE_PARTICIPANT,
    timestampUtc,
    truthState,
    planValid: plan?.valid === true && structurallyComplete,
    decision: safeCode(plan?.decision) ?? FOUNDRY_ACCELERATION_DECISIONS.BLOCKED,
    repository,
    canonicalMainHead,
    canonicalMainTree,
    baselineProviderId: safeCode(plan?.baselineProviderId),
    assignmentTotal: rawAssignments.length,
    assignmentsShown: Math.min(compactAssignments.length, MAX_ASSIGNMENTS_SHOWN),
    assignmentsTruncated: compactAssignments.length > MAX_ASSIGNMENTS_SHOWN,
    assignments: compactAssignments.slice(0, MAX_ASSIGNMENTS_SHOWN),
    heldCandidateTotal: rawHeld.length,
    heldCandidatesShown: Math.min(compactHeldCandidates.length, MAX_HELD_SHOWN),
    heldCandidatesTruncated: compactHeldCandidates.length > MAX_HELD_SHOWN,
    heldCandidates: compactHeldCandidates.slice(0, MAX_HELD_SHOWN),
    providerTotal: rawProviders.length,
    providersShown: Math.min(compactProviders.length, MAX_PROVIDERS_SHOWN),
    providersTruncated: compactProviders.length > MAX_PROVIDERS_SHOWN,
    providers: compactProviders.slice(0, MAX_PROVIDERS_SHOWN),
    foundryTelemetry: compactFoundryTelemetry(plan?.foundryTelemetry),
    blockerCodes: blockerCodes(plan?.blockers),
    totalCriticalPathSecondsSaved,
    recommendationUsable,
    dispatchAllowed: false,
    sourceMutationAllowed: false,
    branchMutationAllowed: false,
    publicationAllowed: false,
    mergeAuthority: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    workspaceWriteAllowed: false,
    arbitraryCommandAllowed: false,
  };
  return freeze({
    ...slice,
    summary: summaryFor(slice),
    finalVerdict: finalVerdictFor(truthState),
  });
}

export function createFoundryAccelerationWorkspaceRecords(trustedHostContext = {}) {
  const slice = createFoundryAccelerationWorkspaceSlice(trustedHostContext);
  const common = {
    projectionSchemaVersion: slice.schemaVersion,
    truthState: slice.truthState,
    planValid: slice.planValid,
    decision: slice.decision,
    repository: slice.repository,
    canonicalMainHead: slice.canonicalMainHead,
    canonicalMainTree: slice.canonicalMainTree,
    baselineProviderId: slice.baselineProviderId,
    assignmentTotal: slice.assignmentTotal,
    assignmentsShown: slice.assignmentsShown,
    assignmentsTruncated: slice.assignmentsTruncated,
    assignments: slice.assignments,
    heldCandidateTotal: slice.heldCandidateTotal,
    heldCandidatesShown: slice.heldCandidatesShown,
    heldCandidatesTruncated: slice.heldCandidatesTruncated,
    heldCandidates: slice.heldCandidates,
    providerTotal: slice.providerTotal,
    providersShown: slice.providersShown,
    providersTruncated: slice.providersTruncated,
    providers: slice.providers,
    foundryTelemetry: slice.foundryTelemetry,
    blockerCodes: slice.blockerCodes,
    totalCriticalPathSecondsSaved: slice.totalCriticalPathSecondsSaved,
    recommendationUsable: slice.recommendationUsable,
    dispatchAllowed: false,
    sourceMutationAllowed: false,
    branchMutationAllowed: false,
    publicationAllowed: false,
    mergeAuthority: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    workspaceWriteAllowed: false,
    arbitraryCommandAllowed: false,
    finalVerdict: slice.finalVerdict,
  };
  const statusRecord = freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: FOUNDRY_ACCELERATION_WORKSPACE_STATUS_ID,
      participantId: FOUNDRY_ACCELERATION_WORKSPACE_PARTICIPANT,
      timestampUtc: slice.timestampUtc,
      status: slice.truthState,
      summary: slice.summary,
      proofRefs: [],
    }),
    ...common,
  });
  const eventRecord = freeze({
    ...createSharedWorkspaceEventRecord({
      eventId: eventIdFor(slice),
      participantId: FOUNDRY_ACCELERATION_WORKSPACE_PARTICIPANT,
      timestampUtc: slice.timestampUtc,
      eventKind: FOUNDRY_ACCELERATION_WORKSPACE_EVENT_KIND,
      summary: slice.summary,
    }),
    ...common,
  });
  const nowMs = Date.parse(slice.timestampUtc);
  const statusValidation = validateSharedWorkspaceRecord(statusRecord, { nowMs });
  const eventValidation = validateSharedWorkspaceRecord(eventRecord, { nowMs });
  return freeze({
    slice,
    statusRecord,
    eventRecord,
    validation: {
      valid: statusValidation.valid && eventValidation.valid,
      status: statusValidation,
      event: eventValidation,
    },
  });
}
