import {
  createProviderNeutralTaskEnvelope,
} from './providerNeutralExecutionCompatibilityV1.mjs';
import {
  planProviderIndependentBuilderIgnitionV1,
} from './zeroOpenAiBuilderFailoverV1.mjs';

const SHA40 = /^[0-9a-f]{40}$/i;
const SAFE_BRANCH = /^[a-z0-9][a-z0-9._/-]{0,180}$/i;
const SAFE_ROUTE = /^[A-Za-z0-9][A-Za-z0-9._:#/-]{0,180}$/;
const CANONICAL_REPOSITORY = 'Cheekyfellastef/stephan-os';
const STALE_STATE = 'STALE_BASE_REVALIDATION_REQUIRED';
const OPERATION = 'preservation-converge';
const TEST_ID = 'preservation-converge-same-branch-v1';

export const STANDING_BUILDER_CONTINUITY_PRESERVATION_CONVERGENCE_SCHEMA =
  'stephanos.standing-builder-continuity-preservation-convergence.v1';
export const STANDING_BUILDER_CONTINUITY_STALE_STATE = STALE_STATE;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sha(value) {
  const normalized = text(value).toLowerCase();
  return SHA40.test(normalized) ? normalized : '';
}

function positiveInt(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

function safeBranch(value) {
  const normalized = text(value).replace(/\\/g, '/');
  return SAFE_BRANCH.test(normalized) && !normalized.includes('..') ? normalized : '';
}

function exactRouteId(value) {
  const normalized = text(value);
  return SAFE_ROUTE.test(normalized) ? normalized : '';
}

function baseResult(overrides = {}) {
  return freeze({
    schemaVersion: STANDING_BUILDER_CONTINUITY_PRESERVATION_CONVERGENCE_SCHEMA,
    finalVerdict: 'PRESERVATION_CONVERGENCE_BLOCKED',
    blocker: '',
    convergenceRequired: false,
    selectedRoute: null,
    taskEnvelope: null,
    convergenceContract: null,
    attempts: [],
    exactHeadVerificationRequested: false,
    mergeTrainState: 'STALE_BASE_REVALIDATION_REQUIRED',
    sourceMutationAllowed: false,
    directMainWriteAllowed: false,
    rebaseAllowed: false,
    resetAllowed: false,
    forcePushAllowed: false,
    protectedMergeAllowed: false,
    runtimeMutationAllowed: false,
    ...overrides,
  });
}

function validateIdentity(input = {}) {
  const blockers = [];
  const repository = text(input.repository);
  const prNumber = positiveInt(input.prNumber);
  const branch = safeBranch(input.branch);
  const previousHead = sha(input.previousHead);
  const observedBase = sha(input.observedBase);
  const currentMain = sha(input.currentMain);
  if (repository !== CANONICAL_REPOSITORY) blockers.push('convergence-repository-invalid');
  if (!prNumber) blockers.push('convergence-pr-invalid');
  if (!branch || branch === 'main') blockers.push('convergence-branch-invalid');
  if (!previousHead) blockers.push('convergence-head-invalid');
  if (!observedBase) blockers.push('convergence-observed-base-invalid');
  if (!currentMain) blockers.push('convergence-current-main-invalid');
  if (previousHead && currentMain && previousHead === currentMain) blockers.push('convergence-head-is-main');
  if (observedBase && currentMain && observedBase === currentMain) blockers.push('convergence-base-not-stale');
  return freeze({
    valid: blockers.length === 0,
    blockers,
    repository,
    prNumber,
    branch,
    previousHead,
    observedBase,
    currentMain,
  });
}

function buildTask(identity, input = {}) {
  return createProviderNeutralTaskEnvelope({
    missionId: text(input.missionId) || `continuity-pr-${identity.prNumber}`,
    goalId: text(input.goalId) || 'goal-1557',
    taskId: text(input.taskId) || `preservation-convergence-pr-${identity.prNumber}`,
    taskClass: 'preservation-convergence',
    correlationId: text(input.correlationId) || `pr-${identity.prNumber}-${identity.previousHead.slice(0, 12)}`,
    repository: identity.repository,
    branch: identity.branch,
    exactBase: identity.currentMain,
    expectedStartingHeadIfMutable: identity.previousHead,
    allowedPaths: [],
    allowedOperations: [OPERATION],
    allowedCommandsOrTestIds: [TEST_ID],
    forbiddenOperations: ['direct-main-write', 'force-push', 'destructive-git'],
    timeoutAndRetryBudget: {
      timeoutMs: Number(input.timeoutMs) || 300_000,
      maxAttempts: 1,
    },
    resourceLeaseIds: [text(input.resourceLeaseId) || `pr-${identity.prNumber}-source-lease`],
    requiredTests: [TEST_ID],
    requiredArtifacts: [],
    requiredEvidence: [text(input.currentMainProofRef) || `proofs/pr-${identity.prNumber}-current-main`],
    completionContract: 'Advance the existing branch only by an ordinary non-force two-parent preservation merge whose parents include the exact previous branch head and exact current protected main, then request fresh exact-head proof. Never rebase, reset, force-push, direct-write main, replace the branch, or create another PR.',
    operatorApprovalState: {
      requiresOperatorApprovalBeforeDispatch: false,
      dispatchApprovalPresent: false,
      requiresExactHeadApproval: true,
      requiresOperatorApprovalBeforeMerge: true,
      mergeApprovalPresent: false,
    },
    portableCheckpointRef: text(input.portableCheckpointRef) || `proofs/pr-${identity.prNumber}-preservation-convergence`,
    createdAtUtc: text(input.createdAtUtc) || '1970-01-01T00:00:00.000Z',
    expiresAtUtc: text(input.expiresAtUtc) || '2100-01-01T00:00:00.000Z',
    sourceAdapter: text(input.preferredSourceAdapter) || 'github-first',
  });
}

function routePlan(taskEnvelope, input, providerRoutes) {
  return planProviderIndependentBuilderIgnitionV1({
    ignitionId: `preservation-convergence-pr-${input.prNumber}`,
    correlationId: `head-${sha(input.previousHead).slice(0, 12)}`,
    requestedSlots: 1,
    requiredCapability: 'sourceImplementation',
    openAiBlackout: input.openAiBlackout === true,
    seenIgnitionKeys: [],
    activeLeaseIds: [],
    schedulerDecision: { selectedTasks: [taskEnvelope] },
    providerRoutes,
  });
}

export function planStandingBuilderContinuityPreservationConvergenceV1(input = {}) {
  if (text(input.laneState) !== STALE_STATE) {
    return baseResult({
      finalVerdict: 'PRESERVATION_CONVERGENCE_NOT_REQUIRED',
      blocker: 'LANE_NOT_STALE_BASE_REVALIDATION_REQUIRED',
      mergeTrainState: text(input.laneState) || 'UNKNOWN',
    });
  }
  if (input.existingOwnerConfirmed !== true || input.exactPrIdentityConfirmed !== true) {
    return baseResult({ blocker: 'EXISTING_OWNER_OR_PR_IDENTITY_UNPROVEN' });
  }
  if (input.branchReplacementRequested === true || input.authorityExpansionRequested === true) {
    return baseResult({ blocker: 'PRESERVATION_SCOPE_WIDENING_FORBIDDEN' });
  }

  const identity = validateIdentity(input);
  if (!identity.valid) return baseResult({ blocker: identity.blockers[0] || 'PRESERVATION_IDENTITY_INVALID' });

  const taskEnvelope = buildTask(identity, input);
  const providerRoutes = Array.isArray(input.providerRoutes) ? input.providerRoutes : [];
  const plan = routePlan(taskEnvelope, input, providerRoutes);
  const request = plan.ignitionRequests?.[0];
  if (!request?.selectedRoute?.routeId) {
    const held = plan.heldTasks?.[0]?.reason;
    return baseResult({
      blocker: held || plan.blocker || 'NO_QUALIFIED_PRESERVATION_CONVERGENCE_ROUTE',
      convergenceRequired: true,
      taskEnvelope,
    });
  }

  return baseResult({
    finalVerdict: 'PRESERVATION_CONVERGENCE_ROUTE_READY',
    convergenceRequired: true,
    blocker: '',
    selectedRoute: request.selectedRoute,
    taskEnvelope,
    convergenceContract: {
      repository: identity.repository,
      prNumber: identity.prNumber,
      branch: identity.branch,
      previousHead: identity.previousHead,
      currentMain: identity.currentMain,
      requiredParentOrder: [identity.previousHead, identity.currentMain],
      sameBranchRequired: true,
      ordinaryTwoParentMergeRequired: true,
      freshExactHeadProofRequired: true,
      freshExactHeadReviewRequired: true,
      forcePushAllowed: false,
      rebaseAllowed: false,
      resetAllowed: false,
      directMainWriteAllowed: false,
      replacementBranchAllowed: false,
      replacementPrAllowed: false,
    },
    mergeTrainState: STALE_STATE,
  });
}

function terminalConvergenceReceiptValid(receipt, contract, routeId) {
  return Boolean(
    receipt
    && receipt.ok === true
    && exactRouteId(receipt.routeId) === routeId
    && text(receipt.repository) === contract.repository
    && Number(receipt.prNumber) === contract.prNumber
    && safeBranch(receipt.branch) === contract.branch
    && sha(receipt.previousHead) === contract.previousHead
    && sha(receipt.currentMain) === contract.currentMain
    && sha(receipt.newHead)
    && sha(receipt.newHead) !== contract.previousHead
    && receipt.sameBranch === true
    && receipt.ordinaryTwoParentMerge === true
    && receipt.previousHeadIsParent === true
    && receipt.currentMainIsParent === true
    && receipt.forcePushUsed === false
    && receipt.rebaseUsed === false
    && receipt.resetUsed === false
    && receipt.directMainWriteUsed === false
  );
}

export async function runStandingBuilderContinuityPreservationConvergenceV1(input = {}, adapters = {}) {
  const failedRouteIds = new Set();
  const attempts = [];
  const originalRoutes = Array.isArray(input.providerRoutes) ? input.providerRoutes : [];
  const maxRoutes = Math.max(1, originalRoutes.length);

  for (let routeOrdinal = 0; routeOrdinal < maxRoutes; routeOrdinal += 1) {
    const providerRoutes = originalRoutes.filter((route) => !failedRouteIds.has(text(route?.routeId)));
    const plan = planStandingBuilderContinuityPreservationConvergenceV1({ ...input, providerRoutes });
    if (plan.finalVerdict !== 'PRESERVATION_CONVERGENCE_ROUTE_READY') {
      return baseResult({
        ...plan,
        attempts,
        blocker: attempts.length > 0 ? 'ALL_QUALIFIED_PRESERVATION_ROUTES_BLOCKED' : plan.blocker,
      });
    }

    const route = plan.selectedRoute;
    const adapter = adapters?.[route.adapterId];
    if (typeof adapter !== 'function') {
      attempts.push(freeze({ routeId: route.routeId, adapterId: route.adapterId, outcome: 'ADAPTER_UNAVAILABLE' }));
      failedRouteIds.add(route.routeId);
      continue;
    }

    let receipt;
    try {
      receipt = await adapter(freeze({
        taskEnvelope: plan.taskEnvelope,
        convergenceContract: plan.convergenceContract,
        selectedRoute: route,
      }));
    } catch (error) {
      receipt = { ok: false, blocker: text(error?.message) || 'ADAPTER_THROW' };
    }

    if (!terminalConvergenceReceiptValid(receipt, plan.convergenceContract, route.routeId)) {
      attempts.push(freeze({
        routeId: route.routeId,
        adapterId: route.adapterId,
        outcome: 'CONVERGENCE_RECEIPT_REJECTED',
        blocker: text(receipt?.blocker) || 'INVALID_TERMINAL_CONVERGENCE_RECEIPT',
      }));
      failedRouteIds.add(route.routeId);
      continue;
    }

    const verify = adapters?.requestFreshExactHeadVerification;
    if (typeof verify !== 'function') {
      attempts.push(freeze({ routeId: route.routeId, adapterId: route.adapterId, outcome: 'CONVERGED_VERIFICATION_ADAPTER_UNAVAILABLE', newHead: sha(receipt.newHead) }));
      return baseResult({
        convergenceRequired: true,
        selectedRoute: route,
        taskEnvelope: plan.taskEnvelope,
        convergenceContract: plan.convergenceContract,
        attempts,
        blocker: 'FRESH_EXACT_HEAD_VERIFICATION_ADAPTER_UNAVAILABLE',
        mergeTrainState: 'CHECKS_RUNNING',
      });
    }

    const verification = await verify(freeze({
      repository: plan.convergenceContract.repository,
      prNumber: plan.convergenceContract.prNumber,
      branch: plan.convergenceContract.branch,
      previousHead: plan.convergenceContract.previousHead,
      newHead: sha(receipt.newHead),
      currentMain: plan.convergenceContract.currentMain,
      invalidatePriorHeadBoundEvidence: true,
      requireFreshCi: true,
      requireFreshIndependentReview: true,
    }));

    attempts.push(freeze({ routeId: route.routeId, adapterId: route.adapterId, outcome: 'CONVERGED', newHead: sha(receipt.newHead) }));
    if (verification?.accepted !== true || sha(verification?.head) !== sha(receipt.newHead)) {
      return baseResult({
        convergenceRequired: true,
        selectedRoute: route,
        taskEnvelope: plan.taskEnvelope,
        convergenceContract: plan.convergenceContract,
        attempts,
        blocker: 'FRESH_EXACT_HEAD_VERIFICATION_REQUEST_REJECTED',
        mergeTrainState: 'CHECKS_RUNNING',
      });
    }

    return baseResult({
      finalVerdict: 'PRESERVATION_CONVERGENCE_COMPLETED_FRESH_PROOF_REQUESTED',
      blocker: '',
      convergenceRequired: false,
      selectedRoute: route,
      taskEnvelope: plan.taskEnvelope,
      convergenceContract: plan.convergenceContract,
      attempts,
      exactHeadVerificationRequested: true,
      newHead: sha(receipt.newHead),
      mergeTrainState: 'CHECKS_RUNNING',
      sourceMutationAllowed: true,
    });
  }

  return baseResult({
    convergenceRequired: true,
    attempts,
    blocker: 'ALL_QUALIFIED_PRESERVATION_ROUTES_BLOCKED',
  });
}
