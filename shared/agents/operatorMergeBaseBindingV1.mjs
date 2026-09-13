import {
  evaluateMainMovementTolerantOperatorAuthorizationV1,
  MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_VERDICT,
} from './mainMovementTolerantOperatorAuthorizationV1.mjs';

export * from './operatorMergeBaseBindingV1.core.mjs';

/**
 * Preserve the canonical single-owner merge-queue invariants at the public
 * base-binding source boundary as well as in the preserved core implementation.
 * This validator is read-only and grants no approval or merge authority.
 */
export function validateSingleOwnerQueuePolicyV1(policy = {}, reviews = []) {
  const required_approving_review_count = Number(policy?.required_approving_review_count);
  const require_last_push_approval = policy?.require_last_push_approval;
  const require_code_owner_review = policy?.require_code_owner_review;
  const mergeGroupChangesRequested = Array.isArray(reviews)
    && reviews.some((review) => String(review?.state ?? '').toUpperCase() === 'CHANGES_REQUESTED');

  const blockers = Object.freeze([
    ...(required_approving_review_count !== 0 ? ['single-owner-required-review-count-must-be-zero'] : []),
    ...(mergeGroupChangesRequested ? ['merge-group-changes-requested'] : []),
    ...(require_last_push_approval !== false ? ['single-owner-last-push-approval-must-be-disabled'] : []),
    ...(require_code_owner_review !== false ? ['single-owner-code-owner-review-must-be-disabled'] : []),
  ]);
  return Object.freeze({ ok: blockers.length === 0, blockers });
}

/**
 * Preserve exact approval-receipt binding while deciding whether prior operator
 * judgment may be carried onto a fresh execution base. This helper grants no
 * merge, deployment, runtime, ruleset or credential authority.
 */
export function evaluateMainMovementTolerantBaseBinding(input = {}) {
  const authorization = input.authorization && typeof input.authorization === 'object'
    ? input.authorization
    : {};
  const observed = input.observed && typeof input.observed === 'object'
    ? input.observed
    : {};
  const authorizationBase = String(authorization.authorizationBase ?? '').trim().toLowerCase();
  const expectedBase = String(input.expectedBase ?? observed.currentBase ?? '').trim().toLowerCase();
  const compatibility = evaluateMainMovementTolerantOperatorAuthorizationV1({ authorization, observed });
  const authorizationReusable = compatibility.authorizationReusable === true;
  const protectedExecutionReady = compatibility.protectedExecutionReady === true
    && compatibility.finalVerdict === MAIN_MOVEMENT_TOLERANT_AUTHORIZATION_VERDICT.READY_FOR_PROTECTED_EXECUTION;

  return Object.freeze({
    authorizationBase,
    executionBase: expectedBase,
    expectedBase,
    authorizationReusable,
    protectedExecutionReady,
    compatibility,
    exactApprovalReceiptStillRequiredForExecutionTuple: true,
    reusableAcrossHeads: false,
    reusableAcrossBases: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    blockers: Object.freeze([
      ...(!authorizationReusable ? ['operator-authorization-not-reusable'] : []),
      ...(!protectedExecutionReady ? ['fresh-execution-evidence-not-ready'] : []),
    ]),
    finalVerdict: protectedExecutionReady
      ? 'MAIN_MOVEMENT_TOLERANT_BASE_BINDING_READY'
      : authorizationReusable
        ? 'MAIN_MOVEMENT_TOLERANT_BASE_BINDING_FRESH_EVIDENCE_REQUIRED'
        : 'MAIN_MOVEMENT_TOLERANT_BASE_BINDING_BLOCKED',
  });
}
