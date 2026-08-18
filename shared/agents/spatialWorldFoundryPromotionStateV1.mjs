import { createHash } from 'node:crypto';

import {
  SPATIAL_PROMOTION_STATES,
  validateSpatialAssetRecord,
  validateSpatialBuildOrder,
} from './spatialWorldFoundryContractsV1.mjs';
import {
  planSpatialFoundryValidation,
} from './spatialWorldFoundryValidatorFrameworkV1.mjs';

export const SPATIAL_PROMOTION_PLAN_SCHEMA_VERSION = 'stephanos.spatial-world-foundry.promotion-plan.v1';
export const SPATIAL_PROMOTION_REVIEW_STATUS = Object.freeze({
  READY: 'PROMOTION_REVIEW_READY',
  BLOCKED_INVALID_BUILD_ORDER: 'BLOCKED_INVALID_BUILD_ORDER',
  BLOCKED_INVALID_ASSET: 'BLOCKED_INVALID_ASSET',
  BLOCKED_VALIDATION_NOT_READY: 'BLOCKED_VALIDATION_NOT_READY',
  BLOCKED_UNSUPPORTED_CURRENT_STATE: 'BLOCKED_UNSUPPORTED_CURRENT_STATE',
  BLOCKED_LIVE_STATE: 'BLOCKED_LIVE_STATE',
  BLOCKED_REQUESTED_STATE: 'BLOCKED_REQUESTED_STATE',
});

const FIRST_PROMOTION_STATE = 'AGENT_TESTED';

function freeze(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freeze(entry)])));
}

function authority() {
  return freeze({
    validationExecutionAllowed: false,
    registryMutationAllowed: false,
    assetMutationAllowed: false,
    promotionExecutionAllowed: false,
    sourceMutationAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    liveWorldMutationAllowed: false,
  });
}

function blocked(status, errors, extra = {}) {
  return freeze({
    schemaVersion: SPATIAL_PROMOTION_PLAN_SCHEMA_VERSION,
    status,
    errors: Array.isArray(errors) ? errors : [String(errors || status)],
    authority: authority(),
    ...extra,
  });
}

function proposalDigest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

export function planSpatialFoundryPromotion(buildOrder = {}, assetRecord = {}, input = {}) {
  const buildOrderValidation = validateSpatialBuildOrder(buildOrder);
  if (!buildOrderValidation.valid) {
    return blocked(SPATIAL_PROMOTION_REVIEW_STATUS.BLOCKED_INVALID_BUILD_ORDER, buildOrderValidation.errors);
  }

  const assetValidation = validateSpatialAssetRecord(assetRecord);
  if (!assetValidation.valid) {
    return blocked(SPATIAL_PROMOTION_REVIEW_STATUS.BLOCKED_INVALID_ASSET, assetValidation.errors);
  }

  const validationPlan = planSpatialFoundryValidation(buildOrder, assetRecord, {
    sourceHead: input.sourceHead,
    validators: input.validators,
    evidence: input.evidence,
    requireSemantic: input.requireSemantic === true,
  });

  if (validationPlan.status !== 'READY_FOR_PROMOTION_REVIEW') {
    return blocked(
      SPATIAL_PROMOTION_REVIEW_STATUS.BLOCKED_VALIDATION_NOT_READY,
      validationPlan.errors?.length ? validationPlan.errors : [`validation-status:${validationPlan.status}`],
      { validationStatus: validationPlan.status },
    );
  }

  if (assetRecord.integrationState !== 'DRAFT') {
    return blocked(
      SPATIAL_PROMOTION_REVIEW_STATUS.BLOCKED_UNSUPPORTED_CURRENT_STATE,
      [`unsupported-current-state:${assetRecord.integrationState}`],
      { currentState: assetRecord.integrationState },
    );
  }

  if (assetRecord.liveState !== 'NOT_LIVE') {
    return blocked(
      SPATIAL_PROMOTION_REVIEW_STATUS.BLOCKED_LIVE_STATE,
      [`asset-live-state-must-remain-NOT_LIVE:${assetRecord.liveState}`],
      { currentState: assetRecord.integrationState },
    );
  }

  const requestedState = input.requestedPromotionState || FIRST_PROMOTION_STATE;
  if (requestedState !== FIRST_PROMOTION_STATE || !SPATIAL_PROMOTION_STATES.includes(requestedState)) {
    return blocked(
      SPATIAL_PROMOTION_REVIEW_STATUS.BLOCKED_REQUESTED_STATE,
      [`only-first-promotion-state-allowed:${FIRST_PROMOTION_STATE}`],
      { currentState: assetRecord.integrationState },
    );
  }

  const review = freeze({
    spatialBuildOrderId: buildOrder.spatialBuildOrderId,
    assetIdentity: `${assetRecord.assetId}@${assetRecord.version}`,
    sourceHead: validationPlan.sourceHead,
    currentState: assetRecord.integrationState,
    requestedState,
    proposedAssetPatch: {
      validationState: 'passed',
      integrationState: requestedState,
      liveState: 'NOT_LIVE',
    },
    evidenceRefs: validationPlan.evidenceRefs,
    approvalRequirement: buildOrder.approvalRequirement,
    operatorApprovalRequired: buildOrder.approvalRequirement === 'OPERATOR_REQUIRED',
    policyApprovalRequired: buildOrder.approvalRequirement === 'POLICY_GATED',
  });

  return freeze({
    schemaVersion: SPATIAL_PROMOTION_PLAN_SCHEMA_VERSION,
    status: SPATIAL_PROMOTION_REVIEW_STATUS.READY,
    ...review,
    proposalDigest: proposalDigest(review),
    errors: [],
    authority: authority(),
  });
}
