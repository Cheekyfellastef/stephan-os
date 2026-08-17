import { createHash } from 'node:crypto';

export const STALL_SENTINEL_REVIEW_PIPELINE_SCHEMA = 'stephanos.stall-sentinel.review-pipeline.v1';

export const STALL_SENTINEL_STATE = Object.freeze({
  ACTIVE: 'ACTIVE',
  WATCHING: 'WATCHING',
  STALLED_RECOVERABLE: 'STALLED_RECOVERABLE',
  STALLED_BLOCKED: 'STALLED_BLOCKED',
  CAPTAIN_DECISION: 'CAPTAIN_DECISION',
});

export const STALL_SENTINEL_RULE = Object.freeze({
  NONE: 'NONE',
  GREEN_COORDINATOR_SKIPPED: 'GREEN_COORDINATOR_SKIPPED',
  REVIEW_DISPATCH_NO_RECEIPT: 'REVIEW_DISPATCH_NO_RECEIPT',
  REVIEW_RATE_LIMIT_NO_ARTIFACT: 'REVIEW_RATE_LIMIT_NO_ARTIFACT',
});

export const STALL_SENTINEL_CAPACITY_ROUTE = Object.freeze({
  EXISTING_LANE: 'EXISTING_LANE',
  FORGE_SIDECAR: 'FORGE_SIDECAR',
  FORGE_ACTIVATION: 'FORGE_ACTIVATION',
  PROVIDER_NEUTRAL: 'PROVIDER_NEUTRAL',
  QUOTA_RETRY: 'QUOTA_RETRY',
  CAPTAIN_DECISION: 'CAPTAIN_DECISION',
});

const FULL_SHA = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/i;
const SAFE_BRANCH = /^[a-z0-9](?:[a-z0-9._/-]{0,238}[a-z0-9])?$/i;
const DEFAULT_RECEIPT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_RECEIPT_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_LANES = 50;
const MAX_AUTHORITY_RECEIPT_AGE_MS = 24 * 60 * 60 * 1000;
const SAFE_RECEIPT_ID = /^[a-z0-9][a-z0-9._:@/-]{2,239}$/i;
const SAFE_EVIDENCE_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const FORGE_M2_READY = 'FORGE_SHADOW_M2_READY';
const FORGE_M2_RECEIPT_SCHEMA = 'stephanos.forge-shadow-m2-runtime-receipt.v1';
const FORGE_M3_RUNTIME_RECEIPT_SCHEMA = 'stephanos.forge-shadow-m3-runner-runtime-receipt.v1';
const FORGE_M3_RUNTIME_READY = 'FORGE_SHADOW_M3_RUNNER_RUNTIME_READY';
const REVIEW_RECEIPT_SCHEMA = 'stephanos.independent-review-route-receipt.v1';
const PROVIDER_NEUTRAL_CAPACITY_RECEIPT_SCHEMA = 'stephanos.provider-neutral-review-capacity-receipt.v1';
const PROVIDER_NEUTRAL_REVIEW_OPERATION = 'EXACT_HEAD_INDEPENDENT_REVIEW';
const PROVIDER_NEUTRAL_REVIEW_CLASSES = new Set(['external-qualified', 'independent-exact-head']);

const M2_RECEIPT_KEYS = Object.freeze([
  'schemaVersion', 'receiptId', 'repository', 'sourceHead', 'sourceTree', 'mirrorHead',
  'mirrorTree', 'operation', 'state', 'finalVerdict', 'completedAt', 'proofRefs', 'payloadSha256',
]);
const M3_RECEIPT_KEYS = Object.freeze([
  'schemaVersion', 'receiptId', 'repository', 'sourceHead', 'sourceTree',
  'artifactSetDigest', 'runnerIdentities', 'linuxReviewRunnerConnected',
  'windowsProofRunnerConnected', 'teardownComplete', 'zeroResidualRegistration',
  'zeroResidualCredential', 'zeroResidualWorkspace', 'canCarryRealWork',
  'finalVerdict', 'completedAt', 'proofRefs', 'payloadSha256',
]);
const REVIEW_RECEIPT_KEYS = Object.freeze([
  'schemaVersion', 'receiptId', 'repository', 'prNumber', 'branch', 'sourceHead',
  'baseSha', 'reviewClass', 'conclusion', 'findingsCount', 'artifactDigest',
  'completedAt', 'payloadSha256',
]);
const PROVIDER_NEUTRAL_CAPACITY_RECEIPT_KEYS = Object.freeze([
  'schemaVersion', 'receiptId', 'repository', 'prNumber', 'branch', 'sourceHead',
  'baseSha', 'reviewClass', 'supportedOperations', 'completedAt', 'expiresAt',
  'evidenceRefs', 'payloadSha256',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function timestamp(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function strictPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function denseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) return false;
  return true;
}

function normalizedConclusion(value) {
  return text(value).toLowerCase();
}

function actionKey(
  repository,
  prNumber,
  headSha,
  rule,
  capacityRoute = '',
  exactNextSafeAction = '',
  evidenceIdentity = '',
) {
  return `stall-sentinel-${createHash('sha256')
    .update(`${repository}\n${prNumber}\n${headSha}\n${rule}\n${capacityRoute}\n${exactNextSafeAction}\n${evidenceIdentity}`)
    .digest('hex')
    .slice(0, 24)}`;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function payloadSha256(receipt) {
  const core = Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'payloadSha256'));
  return createHash('sha256').update(canonicalJson(core), 'utf8').digest('hex');
}

function freshCompletedAt(value, nowMs) {
  const completedAtMs = timestamp(value);
  return completedAtMs !== null
    && /(?:Z|[+-]\d{2}:\d{2})$/i.test(text(value))
    && completedAtMs <= nowMs
    && nowMs - completedAtMs <= MAX_AUTHORITY_RECEIPT_AGE_MS;
}

function validReceiptProofRefs(value) {
  return Array.isArray(value)
    && value.length >= 1
    && value.length <= 20
    && new Set(value).size === value.length
    && value.every((ref) => SAFE_EVIDENCE_REF.test(text(ref)) && !text(ref).includes('..'));
}

function validM2Receipt(receipt, { repository, head, tree, nowMs }) {
  return exactKeys(receipt, M2_RECEIPT_KEYS)
    && receipt.schemaVersion === FORGE_M2_RECEIPT_SCHEMA
    && SAFE_RECEIPT_ID.test(text(receipt.receiptId))
    && receipt.repository === repository
    && text(receipt.sourceHead).toLowerCase() === head
    && text(receipt.sourceTree).toLowerCase() === tree
    && text(receipt.mirrorHead).toLowerCase() === head
    && text(receipt.mirrorTree).toLowerCase() === tree
    && receipt.operation === 'INSTALL_FORGE_SHADOW_M2'
    && receipt.state === 'DONE'
    && receipt.finalVerdict === FORGE_M2_READY
    && freshCompletedAt(receipt.completedAt, nowMs)
    && validReceiptProofRefs(receipt.proofRefs)
    && SHA256.test(text(receipt.payloadSha256))
    && text(receipt.payloadSha256).toLowerCase() === payloadSha256(receipt);
}

function validM3Receipt(receipt, { repository, head, tree, nowMs }) {
  const runnerIdentities = Array.isArray(receipt?.runnerIdentities)
    ? receipt.runnerIdentities.map(text)
    : [];
  return exactKeys(receipt, M3_RECEIPT_KEYS)
    && receipt.schemaVersion === FORGE_M3_RUNTIME_RECEIPT_SCHEMA
    && SAFE_RECEIPT_ID.test(text(receipt.receiptId))
    && receipt.repository === repository
    && text(receipt.sourceHead).toLowerCase() === head
    && text(receipt.sourceTree).toLowerCase() === tree
    && DIGEST.test(text(receipt.artifactSetDigest))
    && runnerIdentities.length === 2
    && new Set(runnerIdentities).size === 2
    && runnerIdentities.includes('stephanos-forge-linux-runner-01')
    && runnerIdentities.includes('stephanos-forge-windows-proof-runner-01')
    && receipt.linuxReviewRunnerConnected === true
    && receipt.windowsProofRunnerConnected === true
    && receipt.teardownComplete === true
    && receipt.zeroResidualRegistration === true
    && receipt.zeroResidualCredential === true
    && receipt.zeroResidualWorkspace === true
    && receipt.canCarryRealWork === true
    && receipt.finalVerdict === FORGE_M3_RUNTIME_READY
    && freshCompletedAt(receipt.completedAt, nowMs)
    && validReceiptProofRefs(receipt.proofRefs)
    && SHA256.test(text(receipt.payloadSha256))
    && text(receipt.payloadSha256).toLowerCase() === payloadSha256(receipt);
}

function validReviewReceipt(receipt, lane, repository, nowMs) {
  return exactKeys(receipt, REVIEW_RECEIPT_KEYS)
    && receipt.schemaVersion === REVIEW_RECEIPT_SCHEMA
    && SAFE_RECEIPT_ID.test(text(receipt.receiptId))
    && receipt.repository === repository
    && strictPositiveInteger(receipt.prNumber) === lane.prNumber
    && receipt.branch === lane.branch
    && text(receipt.sourceHead).toLowerCase() === lane.headSha
    && text(receipt.baseSha).toLowerCase() === lane.baseSha
    && receipt.reviewClass === lane.reviewClass
    && receipt.conclusion === 'success'
    && receipt.findingsCount === 0
    && DIGEST.test(text(receipt.artifactDigest))
    && freshCompletedAt(receipt.completedAt, nowMs)
    && SHA256.test(text(receipt.payloadSha256))
    && text(receipt.payloadSha256).toLowerCase() === payloadSha256(receipt);
}

function validProviderNeutralCapacityReceipt(receipt, lane, repository, nowMs) {
  const completedAtMs = timestamp(receipt?.completedAt);
  const expiresAtMs = timestamp(receipt?.expiresAt);
  return exactKeys(receipt, PROVIDER_NEUTRAL_CAPACITY_RECEIPT_KEYS)
    && receipt.schemaVersion === PROVIDER_NEUTRAL_CAPACITY_RECEIPT_SCHEMA
    && SAFE_RECEIPT_ID.test(text(receipt.receiptId))
    && receipt.repository === repository
    && strictPositiveInteger(receipt.prNumber) === lane.prNumber
    && receipt.branch === lane.branch
    && text(receipt.sourceHead).toLowerCase() === lane.headSha
    && text(receipt.baseSha).toLowerCase() === lane.baseSha
    && PROVIDER_NEUTRAL_REVIEW_CLASSES.has(receipt.reviewClass)
    && denseArray(receipt.supportedOperations)
    && receipt.supportedOperations.length === 1
    && receipt.supportedOperations[0] === PROVIDER_NEUTRAL_REVIEW_OPERATION
    && freshCompletedAt(receipt.completedAt, nowMs)
    && completedAtMs !== null
    && expiresAtMs !== null
    && /(?:Z|[+-]\d{2}:\d{2})$/i.test(text(receipt.expiresAt))
    && expiresAtMs > nowMs
    && expiresAtMs - completedAtMs <= MAX_AUTHORITY_RECEIPT_AGE_MS
    && validReceiptProofRefs(receipt.evidenceRefs)
    && SHA256.test(text(receipt.payloadSha256))
    && text(receipt.payloadSha256).toLowerCase() === payloadSha256(receipt);
}

function invalid(reason) {
  return Object.freeze({
    schemaVersion: STALL_SENTINEL_REVIEW_PIPELINE_SCHEMA,
    valid: false,
    reason,
    records: Object.freeze([]),
    summary: Object.freeze({ active: 0, watching: 0, recoverable: 0, blocked: 0, captainDecision: 0 }),
    sourceMutationAllowed: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAllowed: false,
    arbitraryShellAllowed: false,
    finalVerdict: 'STALL_SENTINEL_REVIEW_PIPELINE_INVALID',
  });
}

function normalizeForgeSidecar(value, nowMs) {
  if (value === undefined || value === null) {
    return Object.freeze({
      declared: false,
      sourceReady: false,
      runtimeReady: false,
      activationRequired: false,
      exactHeadReviewReady: false,
      canCarryRealWork: false,
      evidenceRefs: Object.freeze([]),
    });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const allowedKeys = new Set([
    'goalId', 'repository', 'canonicalMainHead', 'canonicalMainTree', 'mirrorHead', 'mirrorTree',
    'sourceReady', 'm2Receipt', 'm3RuntimeReceipt', 'evidenceRefs',
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return null;
  const goalId = text(value.goalId);
  const repository = text(value.repository);
  const canonicalMainHead = text(value.canonicalMainHead).toLowerCase();
  const canonicalMainTree = text(value.canonicalMainTree).toLowerCase();
  const mirrorHead = text(value.mirrorHead).toLowerCase();
  const mirrorTree = text(value.mirrorTree).toLowerCase();
  const evidenceRefs = Array.isArray(value.evidenceRefs)
    ? [...new Set(value.evidenceRefs.map(text).filter(Boolean))]
    : null;
  if (goalId !== '#1671' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
    || !FULL_SHA.test(canonicalMainHead) || !FULL_SHA.test(canonicalMainTree)
    || !FULL_SHA.test(mirrorHead) || !FULL_SHA.test(mirrorTree)
    || !Array.isArray(evidenceRefs) || evidenceRefs.length > 20
    || evidenceRefs.some((ref) => !SAFE_EVIDENCE_REF.test(ref) || ref.includes('..'))) return null;
  const sourceReady = value.sourceReady === true;
  const exactMirrorParity = canonicalMainHead === mirrorHead && canonicalMainTree === mirrorTree;
  const binding = { repository, head: canonicalMainHead, tree: canonicalMainTree, nowMs };
  const m2ReceiptValid = validM2Receipt(value.m2Receipt, binding);
  const m3RuntimeReceiptValid = validM3Receipt(value.m3RuntimeReceipt, binding);
  const m2ReceiptId = m2ReceiptValid ? text(value.m2Receipt.receiptId) : null;
  const m3RuntimeReceiptId = m3RuntimeReceiptValid ? text(value.m3RuntimeReceipt.receiptId) : null;
  const receiptIdentitiesDistinct = Boolean(m2ReceiptId && m3RuntimeReceiptId
    && m2ReceiptId !== m3RuntimeReceiptId);
  const receiptEvidenceRefs = m2ReceiptValid && m3RuntimeReceiptValid
    ? [...new Set([...value.m2Receipt.proofRefs, ...value.m3RuntimeReceipt.proofRefs])].sort()
    : [];
  const evidenceBound = receiptEvidenceRefs.length === evidenceRefs.length
    && receiptEvidenceRefs.every((ref, index) => ref === [...evidenceRefs].sort()[index]);
  const runtimeReady = sourceReady
    && exactMirrorParity
    && m2ReceiptValid
    && m3RuntimeReceiptValid
    && receiptIdentitiesDistinct
    && evidenceRefs.length >= 2
    && evidenceBound;
  return Object.freeze({
    declared: true,
    goalId,
    repository,
    canonicalMainHead,
    canonicalMainTree,
    mirrorHead,
    mirrorTree,
    sourceReady,
    runtimeReady,
    activationRequired: sourceReady && !runtimeReady,
    exactHeadReviewReady: runtimeReady,
    canCarryRealWork: runtimeReady,
    m2ReceiptValid,
    m3RuntimeReceiptValid,
    evidenceBound,
    m2ReceiptId,
    m3RuntimeReceiptId,
    evidenceRefs: Object.freeze(evidenceRefs),
  });
}

export function adjudicateForgeSidecarCapacity(value, options = {}) {
  const nowMs = timestamp(options.nowUtc ?? options.now);
  if (nowMs === null) return null;
  return normalizeForgeSidecar(value, nowMs);
}

function normalizeLane(lane, repository, nowMs) {
  if (!lane || typeof lane !== 'object' || Array.isArray(lane)) return null;
  const prNumber = positiveInteger(lane.prNumber);
  const title = text(lane.title);
  const branch = text(lane.branch);
  const headSha = text(lane.headSha).toLowerCase();
  const baseSha = text(lane.baseSha).toLowerCase();
  const lastMeaningfulActivityMs = timestamp(lane.lastMeaningfulActivityAt);
  if (!prNumber || !title || !SAFE_BRANCH.test(branch) || branch.includes('..')
    || !FULL_SHA.test(headSha) || !FULL_SHA.test(baseSha) || lastMeaningfulActivityMs === null) return null;
  const review = lane.review && typeof lane.review === 'object' && !Array.isArray(lane.review)
    ? lane.review
    : {};
  const dispatchCommentIdSupplied = review.dispatchCommentId !== undefined && review.dispatchCommentId !== null;
  const dispatchAtSupplied = review.dispatchAt !== undefined && review.dispatchAt !== null;
  if (dispatchCommentIdSupplied !== dispatchAtSupplied) return null;
  const dispatchCommentId = dispatchCommentIdSupplied ? strictPositiveInteger(review.dispatchCommentId) : null;
  const dispatchAtMs = dispatchAtSupplied ? timestamp(review.dispatchAt) : null;
  const rateLimitResetAtMs = review.rateLimitResetAt == null ? null : timestamp(review.rateLimitResetAt);
  if ((dispatchCommentIdSupplied && !dispatchCommentId)
    || (dispatchAtSupplied && dispatchAtMs === null)
    || (review.rateLimitResetAt != null && rateLimitResetAtMs === null)) return null;
  const normalized = {
    repository,
    goalId: text(lane.goalId),
    prNumber,
    title,
    prReference: `PR #${prNumber} — ${title}`,
    branch,
    headSha,
    baseSha,
    lastMeaningfulActivityAt: new Date(lastMeaningfulActivityMs).toISOString(),
    lastMeaningfulActivityMs,
    sourceChanging: lane.sourceChanging === true,
    requiredChecksSuccessful: lane.requiredChecksSuccessful === true,
    reviewRequired: lane.reviewRequired !== false,
    coordinatorWorkflowConclusion: normalizedConclusion(review.coordinatorWorkflowConclusion),
    coordinateJobConclusion: normalizedConclusion(review.coordinateJobConclusion),
    dispatchCommentId,
    dispatchAt: dispatchAtMs === null ? null : new Date(dispatchAtMs).toISOString(),
    dispatchAtMs,
    independentReviewStatus: normalizedConclusion(review.independentReviewStatus),
    independentReviewConclusion: normalizedConclusion(review.independentReviewConclusion),
    independentReviewErrorClass: text(review.independentReviewErrorClass).toUpperCase(),
    independentReviewArtifactId: positiveInteger(review.independentReviewArtifactId) || null,
    independentReviewAttempt: strictPositiveInteger(review.independentReviewAttempt),
    rateLimitResetAt: rateLimitResetAtMs === null ? null : new Date(rateLimitResetAtMs).toISOString(),
    rateLimitResetAtMs,
    reviewClass: text(review.reviewClass) || 'independent-exact-head',
    evidenceRefs: Object.freeze([...new Set((Array.isArray(lane.evidenceRefs) ? lane.evidenceRefs : []).map(text).filter(Boolean))]),
  };
  const receiptValid = validReviewReceipt(review.receipt, normalized, repository, nowMs);
  const providerNeutralCapacityReceiptValid = validProviderNeutralCapacityReceipt(
    review.providerNeutralCapacityReceipt,
    normalized,
    repository,
    nowMs,
  );
  return Object.freeze({
    ...normalized,
    receiptValid,
    receiptId: receiptValid ? text(review.receipt.receiptId) : null,
    providerNeutralCapacityReceiptValid,
    providerNeutralCapacityReceiptId: providerNeutralCapacityReceiptValid
      ? text(review.providerNeutralCapacityReceipt.receiptId)
      : null,
  });
}

function classify(lane, nowMs, receiptTimeoutMs, existingRecoveryKeys, forgeSidecar) {
  let rule = STALL_SENTINEL_RULE.NONE;
  let state = STALL_SENTINEL_STATE.ACTIVE;
  let nextOwner = 'existing-lane-owner';
  let exactNextSafeAction = 'CONTINUE_EXISTING_LANE';
  let notBefore = null;
  let operatorNotificationRequired = false;
  let capacityRoute = STALL_SENTINEL_CAPACITY_ROUTE.EXISTING_LANE;

  if (lane.sourceChanging) {
    state = STALL_SENTINEL_STATE.ACTIVE;
    exactNextSafeAction = 'OBSERVE_ACTIVE_HEAD_MOVEMENT';
  } else if (!lane.requiredChecksSuccessful) {
    state = STALL_SENTINEL_STATE.WATCHING;
    exactNextSafeAction = 'WAIT_FOR_REQUIRED_EXACT_HEAD_CHECKS';
  } else if (!lane.reviewRequired) {
    state = STALL_SENTINEL_STATE.ACTIVE;
    exactNextSafeAction = 'ADVANCE_WITHOUT_REVIEW';
  } else if (lane.independentReviewConclusion === 'failure'
    && lane.independentReviewErrorClass === 'API_RATE_LIMIT_EXCEEDED'
    && !lane.independentReviewArtifactId) {
    rule = STALL_SENTINEL_RULE.REVIEW_RATE_LIMIT_NO_ARTIFACT;
    nextOwner = 'provider-neutral-review-controller';
    if (forgeSidecar.exactHeadReviewReady) {
      state = STALL_SENTINEL_STATE.STALLED_RECOVERABLE;
      nextOwner = 'existing-forge-sidecar-controller';
      exactNextSafeAction = 'ROUTE_EXISTING_EXACT_HEAD_TO_PROVEN_FORGE_REVIEW_CAPACITY';
      capacityRoute = STALL_SENTINEL_CAPACITY_ROUTE.FORGE_SIDECAR;
    } else if (lane.providerNeutralCapacityReceiptValid) {
      state = STALL_SENTINEL_STATE.STALLED_RECOVERABLE;
      exactNextSafeAction = 'ROUTE_EXISTING_EXACT_HEAD_TO_PROVIDER_NEUTRAL_REVIEW_FALLBACK';
      capacityRoute = STALL_SENTINEL_CAPACITY_ROUTE.PROVIDER_NEUTRAL;
    } else if (forgeSidecar.activationRequired) {
      state = STALL_SENTINEL_STATE.STALLED_RECOVERABLE;
      nextOwner = 'existing-forge-sidecar-controller';
      exactNextSafeAction = 'ACTIVATE_EXISTING_FORGE_SIDECAR_AND_CONTINUE_NONCONFLICTING_LOCAL_CONSTRUCTION';
      capacityRoute = STALL_SENTINEL_CAPACITY_ROUTE.FORGE_ACTIVATION;
    } else if (lane.independentReviewAttempt === 1 && lane.rateLimitResetAtMs !== null) {
      state = STALL_SENTINEL_STATE.STALLED_RECOVERABLE;
      exactNextSafeAction = 'RERUN_FAILED_REVIEW_JOB_ONCE_AFTER_RATE_LIMIT_RESET';
      notBefore = lane.rateLimitResetAtMs > nowMs ? lane.rateLimitResetAt : null;
      capacityRoute = STALL_SENTINEL_CAPACITY_ROUTE.QUOTA_RETRY;
    } else {
      state = STALL_SENTINEL_STATE.CAPTAIN_DECISION;
      exactNextSafeAction = 'CHOOSE_REVIEW_CAPACITY_OR_WAIT_FOR_QUOTA_RESET';
      operatorNotificationRequired = true;
      capacityRoute = STALL_SENTINEL_CAPACITY_ROUTE.CAPTAIN_DECISION;
    }
  } else if (lane.dispatchCommentId && !lane.receiptId
    && lane.dispatchAtMs !== null && nowMs - lane.dispatchAtMs >= receiptTimeoutMs) {
    rule = STALL_SENTINEL_RULE.REVIEW_DISPATCH_NO_RECEIPT;
    state = STALL_SENTINEL_STATE.STALLED_RECOVERABLE;
    nextOwner = 'exact-head-review-coordinator';
    exactNextSafeAction = 'INSPECT_OR_RETRY_EXISTING_INDEPENDENT_REVIEW_WITHOUT_DUPLICATE_DISPATCH';
  } else if (lane.coordinatorWorkflowConclusion === 'success'
    && lane.coordinateJobConclusion === 'skipped'
    && !lane.dispatchCommentId && !lane.receiptId) {
    rule = STALL_SENTINEL_RULE.GREEN_COORDINATOR_SKIPPED;
    state = STALL_SENTINEL_STATE.STALLED_RECOVERABLE;
    nextOwner = 'exact-head-review-coordinator';
    exactNextSafeAction = 'TRIGGER_RESOURCE_SCOPED_COORDINATION_FOR_EVENT_PR';
  } else if (lane.independentReviewStatus === 'queued' || lane.independentReviewStatus === 'in_progress'
    || (lane.dispatchCommentId && !lane.receiptId)) {
    state = STALL_SENTINEL_STATE.WATCHING;
    exactNextSafeAction = 'WAIT_INSIDE_BOUNDED_REVIEW_RECEIPT_WINDOW';
  } else if (lane.receiptId) {
    exactNextSafeAction = 'ADVANCE_EXISTING_EXACT_HEAD_GATE';
  }

  const recoveryEvidenceIdentity = capacityRoute === STALL_SENTINEL_CAPACITY_ROUTE.FORGE_SIDECAR
    ? `${forgeSidecar.m2ReceiptId}:${forgeSidecar.m3RuntimeReceiptId}`
    : (capacityRoute === STALL_SENTINEL_CAPACITY_ROUTE.FORGE_ACTIVATION
      ? `${forgeSidecar.canonicalMainHead}:${forgeSidecar.canonicalMainTree}`
      : (capacityRoute === STALL_SENTINEL_CAPACITY_ROUTE.PROVIDER_NEUTRAL
        ? lane.providerNeutralCapacityReceiptId
        : (capacityRoute === STALL_SENTINEL_CAPACITY_ROUTE.QUOTA_RETRY
          ? `${lane.independentReviewAttempt}:${lane.rateLimitResetAt}`
          : `${lane.dispatchCommentId ?? ''}:${lane.receiptId ?? ''}`)));
  const recoveryKey = rule === STALL_SENTINEL_RULE.NONE
    ? null
    : actionKey(
      lane.repository,
      lane.prNumber,
      lane.headSha,
      rule,
      capacityRoute,
      exactNextSafeAction,
      recoveryEvidenceIdentity,
    );
  const recoveryAlreadyRecorded = recoveryKey !== null && existingRecoveryKeys.has(recoveryKey);
  if (recoveryAlreadyRecorded && state === STALL_SENTINEL_STATE.STALLED_RECOVERABLE) {
    state = STALL_SENTINEL_STATE.WATCHING;
    exactNextSafeAction = 'OBSERVE_EXISTING_IDEMPOTENT_RECOVERY';
  }

  return Object.freeze({
    stallId: recoveryKey ?? actionKey(
      lane.repository,
      lane.prNumber,
      lane.headSha,
      STALL_SENTINEL_RULE.NONE,
      capacityRoute,
      exactNextSafeAction,
      recoveryEvidenceIdentity,
    ),
    goalId: lane.goalId || null,
    prNumber: lane.prNumber,
    prReference: lane.prReference,
    branch: lane.branch,
    liveHeadSha: lane.headSha,
    reportedTestedSha: null,
    evidenceRefs: lane.evidenceRefs,
    detectedRule: rule,
    lastMeaningfulActivityAt: lane.lastMeaningfulActivityAt,
    currentOwner: 'existing-lane-owner',
    nextOwner,
    exactNextSafeAction,
    capacityRoute,
    notBefore,
    confidence: 'VERIFIED_FACTS_ONLY',
    state,
    recoveryKey,
    recoveryEvidenceIdentity,
    recoveryAlreadyRecorded,
    duplicateRecoveryAllowed: false,
    operatorNotificationRequired,
  });
}

export function projectStallSentinelReviewPipeline(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid('one object input is required');
  const repository = text(input.repository);
  const nowMs = timestamp(input.now);
  const lanes = input.lanes;
  const receiptTimeoutMs = input.receiptTimeoutMs === undefined
    ? DEFAULT_RECEIPT_TIMEOUT_MS
    : Number(input.receiptTimeoutMs);
  const existingRecoveryKeys = new Set(Array.isArray(input.existingRecoveryKeys)
    ? input.existingRecoveryKeys.map(text).filter(Boolean)
    : []);
  const forgeSidecar = normalizeForgeSidecar(input.forgeSidecar, nowMs);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)
    || nowMs === null || !denseArray(lanes) || lanes.length > MAX_LANES
    || !Number.isSafeInteger(receiptTimeoutMs) || receiptTimeoutMs <= 0 || receiptTimeoutMs > MAX_RECEIPT_TIMEOUT_MS
    || forgeSidecar === null
    || (forgeSidecar.declared && forgeSidecar.repository !== repository)) {
    return invalid('valid repository, clock, dense bounded lanes and receipt timeout are required');
  }
  const normalized = lanes.map((lane) => normalizeLane(lane, repository, nowMs));
  if (normalized.some((lane) => lane === null)) return invalid('one or more lane identities are malformed');
  const seenPrs = new Set();
  if (normalized.some((lane) => seenPrs.has(lane.prNumber) || !seenPrs.add(lane.prNumber))) return invalid('duplicate PR lanes are not accepted');

  const records = Object.freeze(normalized
    .map((lane) => classify(lane, nowMs, receiptTimeoutMs, existingRecoveryKeys, forgeSidecar))
    .sort((left, right) => left.prNumber - right.prNumber));
  const count = (state) => records.filter((record) => record.state === state).length;
  const summary = Object.freeze({
    active: count(STALL_SENTINEL_STATE.ACTIVE),
    watching: count(STALL_SENTINEL_STATE.WATCHING),
    recoverable: count(STALL_SENTINEL_STATE.STALLED_RECOVERABLE),
    blocked: count(STALL_SENTINEL_STATE.STALLED_BLOCKED),
    captainDecision: count(STALL_SENTINEL_STATE.CAPTAIN_DECISION),
    forgeRouted: records.filter((record) => record.capacityRoute === STALL_SENTINEL_CAPACITY_ROUTE.FORGE_SIDECAR).length,
    forgeActivationRequired: records.filter((record) => record.capacityRoute === STALL_SENTINEL_CAPACITY_ROUTE.FORGE_ACTIVATION).length,
    oldestMeaningfulInactivityAt: records.map((record) => record.lastMeaningfulActivityAt).sort()[0] ?? null,
  });
  return Object.freeze({
    schemaVersion: STALL_SENTINEL_REVIEW_PIPELINE_SCHEMA,
    valid: true,
    records,
    summary,
    forgeSidecar,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAllowed: false,
    arbitraryShellAllowed: false,
    finalVerdict: summary.captainDecision > 0
      ? 'STALL_SENTINEL_CAPTAIN_DECISION_REQUIRED'
      : (summary.recoverable > 0 ? 'STALL_SENTINEL_AUTONOMOUS_RECOVERY_REQUIRED' : 'STALL_SENTINEL_REVIEW_PIPELINE_OBSERVED'),
  });
}
