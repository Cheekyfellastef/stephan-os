import {
  PROVIDER_NEUTRAL_REVIEWER_CLASSES,
  PROVIDER_NEUTRAL_REVIEW_RISK_TIERS,
} from './providerNeutralReviewV1.mjs';

export const ELASTIC_INDEPENDENT_REVIEW_CAPACITY_SCHEMA = 'stephanos.elastic-independent-review-capacity.v1';
export const MINIMUM_REVIEW_SLOTS = 2;
export const MAXIMUM_REVIEW_SLOTS = 12;
export const CRITICAL_RECOVERY_PRIORITY = 'CRITICAL_RECOVERY';

const EXACT_HEAD = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,100}$/i;
const SAFE_REPOSITORY = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const SAFE_BRANCH = /^[a-z0-9][a-z0-9._/-]{0,180}$/i;
const SAFE_PROVIDER = /^[a-z0-9][a-z0-9._-]{0,100}$/i;
const SAFE_PRIORITY = new Set(['CRITICAL_RECOVERY', 'PROGRAMME_CRITICAL', 'STANDARD']);
const ACTIVE_PROVIDER_STATES = new Set(['available', 'busy']);
const SPECIALIST_REVIEWER_CLASSES = new Set(['remote-codex', 'battle-bridge-codex', 'external-qualified']);

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

function denseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function timestamp(value) {
  const candidate = text(value);
  if (!candidate) return null;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedRisk(value) {
  const candidate = text(value)?.toLowerCase();
  return PROVIDER_NEUTRAL_REVIEW_RISK_TIERS.includes(candidate) ? candidate : null;
}

function normalizedPriority(value) {
  const candidate = text(value)?.toUpperCase() ?? 'STANDARD';
  return SAFE_PRIORITY.has(candidate) ? candidate : null;
}

function normalizeRequest(candidate = {}) {
  const requestId = text(candidate.requestId);
  const repository = text(candidate.repository);
  const branch = text(candidate.branch);
  const sourceHead = text(candidate.sourceHead)?.toLowerCase() ?? null;
  const baseSha = text(candidate.baseSha)?.toLowerCase() ?? null;
  const priorityClass = normalizedPriority(candidate.priorityClass);
  const riskTier = normalizedRisk(candidate.riskTier);
  const queuedAtMs = timestamp(candidate.queuedAtUtc);
  const implementerProvider = text(candidate.implementerProvider)?.toLowerCase() ?? null;
  const implementerSessionId = text(candidate.implementerSessionId)?.toLowerCase() ?? null;
  return freeze({
    requestId,
    repository,
    prNumber:positiveInteger(candidate.prNumber),
    branch,
    sourceHead,
    baseSha,
    priorityClass,
    riskTier,
    queuedAtUtc:text(candidate.queuedAtUtc),
    queuedAtMs,
    implementerProvider,
    implementerSessionId,
    invalid:!requestId
      || !SAFE_ID.test(requestId)
      || !repository
      || !SAFE_REPOSITORY.test(repository)
      || !positiveInteger(candidate.prNumber)
      || !branch
      || !SAFE_BRANCH.test(branch)
      || branch.includes('..')
      || !sourceHead
      || !EXACT_HEAD.test(sourceHead)
      || !baseSha
      || !EXACT_HEAD.test(baseSha)
      || !priorityClass
      || !riskTier
      || queuedAtMs === null
      || !implementerProvider
      || !SAFE_PROVIDER.test(implementerProvider)
      || !implementerSessionId
      || !SAFE_ID.test(implementerSessionId),
  });
}

function normalizeReviewer(candidate = {}) {
  const reviewerId = text(candidate.reviewerId)?.toLowerCase() ?? null;
  const provider = text(candidate.provider)?.toLowerCase() ?? null;
  const sessionId = text(candidate.sessionId)?.toLowerCase() ?? null;
  const reviewerClass = text(candidate.reviewerClass)?.toLowerCase() ?? null;
  const state = text(candidate.state)?.toLowerCase() ?? null;
  const slots = integer(candidate.availableSlots);
  const riskTiers = denseArray(candidate.qualifiedRiskTiers)
    ? [...new Set(candidate.qualifiedRiskTiers.map(normalizedRisk).filter(Boolean))].sort()
    : null;
  return freeze({
    reviewerId,
    provider,
    sessionId,
    reviewerClass,
    state,
    availableSlots:slots,
    qualifiedRiskTiers:riskTiers,
    supportsIndependentReview:candidate.supportsIndependentReview === true,
    invalid:!reviewerId
      || !SAFE_ID.test(reviewerId)
      || !provider
      || !SAFE_PROVIDER.test(provider)
      || !sessionId
      || !SAFE_ID.test(sessionId)
      || !PROVIDER_NEUTRAL_REVIEWER_CLASSES.includes(reviewerClass)
      || !ACTIVE_PROVIDER_STATES.has(state)
      || slots === null
      || riskTiers === null
      || riskTiers.length === 0
      || candidate.supportsIndependentReview !== true,
  });
}

function requestIdentity(request) {
  return `${request.repository}#${request.prNumber}@${request.sourceHead}`.toLowerCase();
}

function requestBinding(request) {
  return `${request.branch}\u0000${request.baseSha}\u0000${request.riskTier}`.toLowerCase();
}

function reviewerCanTake(request, reviewer) {
  if (reviewer.invalid || reviewer.availableSlots <= 0) return false;
  if (!reviewer.qualifiedRiskTiers.includes(request.riskTier)) return false;
  if (
    reviewer.provider === request.implementerProvider
    && reviewer.sessionId === request.implementerSessionId
  ) return false;
  if (request.riskTier === 'high' && !SPECIALIST_REVIEWER_CLASSES.has(reviewer.reviewerClass)) return false;
  return true;
}

function priorityRank(priorityClass) {
  return ({ CRITICAL_RECOVERY:0, PROGRAMME_CRITICAL:1, STANDARD:2 })[priorityClass] ?? 3;
}

export function deriveElasticIndependentReviewWidth(input = {}) {
  const hasMinimumSlots = Object.hasOwn(input, 'minimumSlots');
  const hasMaximumSlots = Object.hasOwn(input, 'maximumSlots');
  const minimum = hasMinimumSlots ? integer(input.minimumSlots) : MINIMUM_REVIEW_SLOTS;
  const maximum = hasMaximumSlots ? integer(input.maximumSlots) : MAXIMUM_REVIEW_SLOTS;
  const active = integer(input.activeReviewCount);
  const ready = integer(input.readyReviewCount);
  const available = integer(input.availableReviewerSlots);
  const criticalReady = integer(input.criticalRecoveryReadyCount ?? 0);

  const invalid = minimum === null
    || maximum === null
    || minimum < MINIMUM_REVIEW_SLOTS
    || maximum < minimum
    || maximum > MAXIMUM_REVIEW_SLOTS
    || active === null
    || ready === null
    || available === null
    || criticalReady === null
    || criticalReady > ready;

  if (invalid) return freeze({
    schemaVersion:ELASTIC_INDEPENDENT_REVIEW_CAPACITY_SCHEMA,
    status:'SAFE_HOLD_INVALID_CAPACITY',
    minimumSlots:minimum,
    maximumSlots:maximum,
    activeReviewCount:active,
    readyReviewCount:ready,
    criticalRecoveryReadyCount:criticalReady,
    availableReviewerSlots:available,
    desiredWidth:0,
    remainingAdmissionSlots:0,
    scaleAction:'SAFE_HOLD',
    reasonCodes:['INVALID_REVIEW_CAPACITY_EVIDENCE'],
    dispatchAuthority:false,
    mergeAuthority:false,
    runtimeMutationAuthority:false,
  });

  const demandedWidth = active + ready;
  const healthyBaseline = available >= minimum;
  const desiredWidth = Math.min(maximum, available, Math.max(minimum, demandedWidth));
  const remainingAdmissionSlots = Math.max(0, desiredWidth - active);
  const reasonCodes = [
    ...(!healthyBaseline ? ['BASELINE_REVIEW_CAPACITY_SHORTFALL'] : []),
    ...(criticalReady > 0 && remainingAdmissionSlots === 0 ? ['CRITICAL_RECOVERY_REVIEW_QUEUED'] : []),
    ...(demandedWidth > maximum ? ['POLICY_MAXIMUM_REACHED'] : []),
    ...(ready > remainingAdmissionSlots ? ['ELIGIBLE_REVIEWS_REMAIN_QUEUED'] : []),
  ];

  return freeze({
    schemaVersion:ELASTIC_INDEPENDENT_REVIEW_CAPACITY_SCHEMA,
    status:healthyBaseline ? 'RUNNING' : 'DEGRADED_CAPACITY',
    minimumSlots:minimum,
    maximumSlots:maximum,
    activeReviewCount:active,
    readyReviewCount:ready,
    criticalRecoveryReadyCount:criticalReady,
    availableReviewerSlots:available,
    desiredWidth,
    remainingAdmissionSlots,
    scaleAction:!healthyBaseline
      ? 'SAFE_HOLD'
      : desiredWidth > active
        ? 'SCALE_OUT'
        : desiredWidth < active
          ? 'SCALE_IN'
          : 'HOLD',
    reasonCodes,
    dispatchAuthority:false,
    mergeAuthority:false,
    runtimeMutationAuthority:false,
  });
}

export function planElasticIndependentReviewAssignments(requests = [], reviewers = [], options = {}) {
  if (!denseArray(requests) || !denseArray(reviewers)) return freeze({
    schemaVersion:ELASTIC_INDEPENDENT_REVIEW_CAPACITY_SCHEMA,
    status:'SAFE_HOLD_INVALID_INVENTORY',
    assignments:[],
    held:[],
    reasonCodes:['INVALID_REVIEW_INVENTORY'],
    dispatchAuthority:false,
    mergeAuthority:false,
    runtimeMutationAuthority:false,
  });

  const maxAssignments = integer(options.maxAssignments);
  const activeReviewIdentities = denseArray(options.activeReviewIdentities ?? [])
    ? new Set((options.activeReviewIdentities ?? []).map((value) => text(value)?.toLowerCase()).filter(Boolean))
    : null;
  if (maxAssignments === null || maxAssignments > MAXIMUM_REVIEW_SLOTS || activeReviewIdentities === null) {
    return freeze({
      schemaVersion:ELASTIC_INDEPENDENT_REVIEW_CAPACITY_SCHEMA,
      status:'SAFE_HOLD_INVALID_POLICY',
      assignments:[],
      held:[],
      reasonCodes:['INVALID_REVIEW_SELECTION_POLICY'],
      dispatchAuthority:false,
      mergeAuthority:false,
      runtimeMutationAuthority:false,
    });
  }

  const normalizedRequests = requests.map(normalizeRequest);
  const normalizedReviewers = reviewers.map(normalizeReviewer);
  const requestIdCounts = new Map();
  for (const request of normalizedRequests) {
    if (request.requestId) requestIdCounts.set(request.requestId, (requestIdCounts.get(request.requestId) ?? 0) + 1);
  }
  const duplicateIds = new Set([...requestIdCounts].filter(([, count]) => count > 1).map(([id]) => id));
  if (duplicateIds.size) return freeze({
    schemaVersion:ELASTIC_INDEPENDENT_REVIEW_CAPACITY_SCHEMA,
    status:'SAFE_HOLD_DUPLICATE_REQUEST',
    assignments:[],
    held:normalizedRequests.map((request) => ({
      requestId:request.requestId,
      reasonCode:duplicateIds.has(request.requestId) ? 'DUPLICATE_REQUEST_ID' : 'INVALID_REQUEST_INVENTORY',
    })),
    reasonCodes:['DUPLICATE_REQUEST_ID'],
    dispatchAuthority:false,
    mergeAuthority:false,
    runtimeMutationAuthority:false,
  });

  const bindingsByExactHead = new Map();
  for (const request of normalizedRequests) {
    if (request.invalid) continue;
    const identity = requestIdentity(request);
    if (!bindingsByExactHead.has(identity)) bindingsByExactHead.set(identity, new Set());
    bindingsByExactHead.get(identity).add(requestBinding(request));
  }
  const conflictingExactHeadIdentities = new Set(
    [...bindingsByExactHead]
      .filter(([, bindings]) => bindings.size > 1)
      .map(([identity]) => identity),
  );

  const reviewerSlots = new Map();
  for (const reviewer of normalizedReviewers) {
    if (!reviewer.invalid) reviewerSlots.set(reviewer.reviewerId, reviewer.availableSlots);
  }

  const orderedRequests = normalizedRequests
    .map((request, index) => ({ request, index }))
    .sort((left, right) => priorityRank(left.request.priorityClass) - priorityRank(right.request.priorityClass)
      || (left.request.queuedAtMs ?? Number.MAX_SAFE_INTEGER) - (right.request.queuedAtMs ?? Number.MAX_SAFE_INTEGER)
      || left.index - right.index);

  const assignments = [];
  const held = [];
  const selectedReviewIdentities = new Set();
  for (const { request } of orderedRequests) {
    if (request.invalid) {
      held.push({ requestId:request.requestId, reasonCode:'INVALID_REVIEW_REQUEST' });
      continue;
    }
    const exactHeadIdentity = requestIdentity(request);
    if (conflictingExactHeadIdentities.has(exactHeadIdentity)) {
      held.push({ requestId:request.requestId, reasonCode:'CONFLICTING_EXACT_HEAD_REVIEW_REQUEST' });
      continue;
    }
    if (activeReviewIdentities.has(exactHeadIdentity)) {
      held.push({ requestId:request.requestId, reasonCode:'EXACT_HEAD_REVIEW_ALREADY_ACTIVE' });
      continue;
    }
    if (selectedReviewIdentities.has(exactHeadIdentity)) {
      held.push({ requestId:request.requestId, reasonCode:'DUPLICATE_EXACT_HEAD_REVIEW_REQUEST' });
      continue;
    }
    selectedReviewIdentities.add(exactHeadIdentity);
    if (assignments.length >= maxAssignments) {
      held.push({ requestId:request.requestId, reasonCode:'PARALLEL_REVIEW_CAPACITY_FULL' });
      continue;
    }

    const qualified = normalizedReviewers.filter((reviewer) => {
      const remaining = reviewerSlots.get(reviewer.reviewerId) ?? 0;
      return remaining > 0 && reviewerCanTake(request, reviewer);
    });

    if (qualified.length === 0) {
      const hasRiskQualified = normalizedReviewers.some((reviewer) => !reviewer.invalid
        && reviewer.availableSlots > 0
        && reviewer.qualifiedRiskTiers.includes(request.riskTier)
        && (request.riskTier !== 'high' || SPECIALIST_REVIEWER_CLASSES.has(reviewer.reviewerClass)));
      held.push({
        requestId:request.requestId,
        reasonCode:hasRiskQualified ? 'NO_INDEPENDENT_REVIEWER_AVAILABLE' : 'NO_QUALIFIED_RISK_REVIEWER_AVAILABLE',
      });
      continue;
    }

    qualified.sort((left, right) => {
      const leftSlots = reviewerSlots.get(left.reviewerId) ?? 0;
      const rightSlots = reviewerSlots.get(right.reviewerId) ?? 0;
      return rightSlots - leftSlots || left.reviewerId.localeCompare(right.reviewerId);
    });
    const reviewer = qualified[0];
    reviewerSlots.set(reviewer.reviewerId, (reviewerSlots.get(reviewer.reviewerId) ?? 0) - 1);
    assignments.push(freeze({
      requestId:request.requestId,
      reviewIdentity:exactHeadIdentity,
      priorityClass:request.priorityClass,
      riskTier:request.riskTier,
      reviewerId:reviewer.reviewerId,
      reviewerClass:reviewer.reviewerClass,
      provider:reviewer.provider,
      sessionId:reviewer.sessionId,
      sourceHead:request.sourceHead,
      baseSha:request.baseSha,
      dispatchRequired:true,
      dispatchAuthority:false,
    }));
  }

  const reasonCodes = [...new Set(held.map(({ reasonCode }) => reasonCode))];
  return freeze({
    schemaVersion:ELASTIC_INDEPENDENT_REVIEW_CAPACITY_SCHEMA,
    status:assignments.length
      ? 'ASSIGNMENT_PLAN_READY'
      : reasonCodes.includes('CONFLICTING_EXACT_HEAD_REVIEW_REQUEST')
        ? 'SAFE_HOLD_CONFLICTING_EXACT_HEAD_REQUEST'
        : 'NO_ASSIGNMENT_READY',
    assignments,
    held,
    reasonCodes,
    criticalRecoveryAssignments:assignments.filter(({ priorityClass }) => priorityClass === CRITICAL_RECOVERY_PRIORITY).length,
    dispatchAuthority:false,
    mergeAuthority:false,
    approvalAuthority:false,
    deploymentAuthority:false,
    runtimeMutationAuthority:false,
    providerQualificationAuthority:false,
  });
}
