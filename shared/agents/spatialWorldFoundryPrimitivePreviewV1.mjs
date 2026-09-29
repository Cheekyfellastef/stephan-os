import { createHash } from 'node:crypto';

import {
  SPATIAL_ASSET_RECORD_SCHEMA_VERSION,
  validateSpatialBuildOrder,
} from './spatialWorldFoundryContractsV1.mjs';
import {
  canonicalSpatialAssetContentAddress,
  planSpatialAssetRegistration,
  validateSpatialAssetRegistry,
} from './spatialWorldFoundryAssetRegistryV1.mjs';
import {
  assertSpatialAgentWriteMayBegin,
  SPATIAL_ISOLATED_LANE_PLAN_SCHEMA_VERSION,
} from './spatialWorldFoundryIsolatedLaneV1.mjs';

export const SPATIAL_PRIMITIVE_PREVIEW_PLAN_SCHEMA_VERSION = 'stephanos.spatial-world-foundry.primitive-preview-plan.v1';
export const SPATIAL_PRIMITIVE_SPEC_SCHEMA_VERSION = 'stephanos.spatial-world-foundry.primitive-spec.v1';

export const SPATIAL_PRIMITIVE_TYPES = Object.freeze(['BOX', 'SPHERE', 'CYLINDER', 'PLANE']);

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SAFE_VERSION = /^[a-z0-9][a-z0-9._+:-]{0,127}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function text(value, maximum = 1024) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && value.length <= maximum
    && !CONTROL.test(value)
    ? value
    : '';
}

function plain(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
}

function finiteVector(value, { positive = false } = {}) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const output = [];
  for (let index = 0; index < 3; index += 1) {
    if (!Object.hasOwn(value, index) || !Number.isFinite(value[index])) return null;
    if (Math.abs(value[index]) > 10000) return null;
    if (positive && value[index] <= 0) return null;
    output.push(value[index]);
  }
  return output;
}

function freeze(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  const output = {};
  for (const [key, entry] of Object.entries(value)) output[key] = freeze(entry);
  return Object.freeze(output);
}

function authority() {
  return freeze({
    primitiveGenerationExecutionAllowed: false,
    sandboxWriteExecutionAllowed: false,
    storageWriteAllowed: false,
    registryMutationAllowed: false,
    sourceMutationAllowed: false,
    leaseIssueAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    liveWorldMutationAllowed: false,
  });
}

export function validateSpatialPrimitiveSpec(spec = {}) {
  const errors = [];
  const keys = ['schemaVersion', 'primitiveType', 'dimensions', 'materialHint', 'transform'];
  if (!plain(spec)) errors.push('primitive-spec-must-be-data-only-object');
  else {
    for (const key of Reflect.ownKeys(spec)) if (typeof key !== 'string' || !keys.includes(key)) errors.push(`primitive-spec-field-invalid:${String(key)}`);
    for (const key of keys) if (!Object.hasOwn(spec, key)) errors.push(`primitive-spec-missing-field:${key}`);
  }
  if (spec.schemaVersion !== SPATIAL_PRIMITIVE_SPEC_SCHEMA_VERSION) errors.push('primitive-spec-schema-version-mismatch');
  if (!SPATIAL_PRIMITIVE_TYPES.includes(spec.primitiveType)) errors.push('primitiveType-invalid');
  if (!plain(spec.dimensions)) errors.push('dimensions-invalid');
  else {
    const dimensionKeys = ['x', 'y', 'z'];
    for (const key of Reflect.ownKeys(spec.dimensions)) if (typeof key !== 'string' || !dimensionKeys.includes(key)) errors.push(`dimensions-field-invalid:${String(key)}`);
    for (const key of dimensionKeys) if (!Number.isFinite(spec.dimensions[key]) || spec.dimensions[key] <= 0 || spec.dimensions[key] > 10000) errors.push(`dimensions-${key}-invalid`);
  }
  if (!text(spec.materialHint, 512)) errors.push('materialHint-invalid');
  if (!plain(spec.transform)) errors.push('transform-invalid');
  else {
    const transformKeys = ['position', 'rotationEulerDegrees', 'scale'];
    for (const key of Reflect.ownKeys(spec.transform)) if (typeof key !== 'string' || !transformKeys.includes(key)) errors.push(`transform-field-invalid:${String(key)}`);
    if (!finiteVector(spec.transform.position)) errors.push('transform-position-invalid');
    if (!finiteVector(spec.transform.rotationEulerDegrees)) errors.push('transform-rotation-invalid');
    if (!finiteVector(spec.transform.scale, { positive: true })) errors.push('transform-scale-invalid');
  }
  const unique = [...new Set(errors)];
  return freeze({ valid: unique.length === 0, errors: unique, refusalReason: unique[0] || '' });
}

function canonicalPrimitivePayload(spec) {
  return {
    schemaVersion: spec.schemaVersion,
    primitiveType: spec.primitiveType,
    dimensions: { x: spec.dimensions.x, y: spec.dimensions.y, z: spec.dimensions.z },
    materialHint: spec.materialHint,
    transform: {
      position: [...spec.transform.position],
      rotationEulerDegrees: [...spec.transform.rotationEulerDegrees],
      scale: [...spec.transform.scale],
    },
  };
}

export function planSpatialPrimitivePreview(buildOrder = {}, registry = {}, lanePlan = {}, lease = {}, input = {}) {
  const buildOrderValidation = validateSpatialBuildOrder(buildOrder);
  if (!buildOrderValidation.valid) return freeze({ schemaVersion: SPATIAL_PRIMITIVE_PREVIEW_PLAN_SCHEMA_VERSION, status: 'BLOCKED_INVALID_BUILD_ORDER', errors: buildOrderValidation.errors, authority: authority() });
  const registryValidation = validateSpatialAssetRegistry(registry);
  if (!registryValidation.valid) return freeze({ schemaVersion: SPATIAL_PRIMITIVE_PREVIEW_PLAN_SCHEMA_VERSION, status: 'BLOCKED_INVALID_REGISTRY', errors: registryValidation.errors, authority: authority() });
  if (registry.planetId !== buildOrder.planetId) return freeze({ schemaVersion: SPATIAL_PRIMITIVE_PREVIEW_PLAN_SCHEMA_VERSION, status: 'BLOCKED_PLANET_MISMATCH', errors: ['registry-build-order-planet-mismatch'], authority: authority() });
  if (buildOrder.previewRequirement === 'NOT_APPLICABLE') return freeze({ schemaVersion: SPATIAL_PRIMITIVE_PREVIEW_PLAN_SCHEMA_VERSION, status: 'BLOCKED_PREVIEW_NOT_AUTHORIZED_BY_BUILD_ORDER', errors: ['preview-required-for-m4'], authority: authority() });
  for (const requiredOperation of ['GENERATE_ASSET', 'WRITE_SANDBOX', 'RUN_VALIDATION']) {
    if (!buildOrder.allowedOperations.includes(requiredOperation)) return freeze({ schemaVersion: SPATIAL_PRIMITIVE_PREVIEW_PLAN_SCHEMA_VERSION, status: 'BLOCKED_BUILD_ORDER_OPERATION', errors: [`build-order-missing-operation:${requiredOperation}`], authority: authority() });
  }
  if (lanePlan?.schemaVersion !== SPATIAL_ISOLATED_LANE_PLAN_SCHEMA_VERSION || lanePlan.spatialBuildOrderId !== buildOrder.spatialBuildOrderId) {
    return freeze({ schemaVersion: SPATIAL_PRIMITIVE_PREVIEW_PLAN_SCHEMA_VERSION, status: 'BLOCKED_INVALID_LANE_PLAN', errors: ['exact-m3-lane-plan-required'], authority: authority() });
  }

  let leaseBinding;
  try {
    leaseBinding = assertSpatialAgentWriteMayBegin(lanePlan, lease, Number.isFinite(input.nowMs) ? { nowMs: input.nowMs } : {});
  } catch (error) {
    return freeze({ schemaVersion: SPATIAL_PRIMITIVE_PREVIEW_PLAN_SCHEMA_VERSION, status: 'WAITING_FOR_EXACT_RESOURCE_LEASE', errors: [error instanceof Error ? error.message : 'exact-resource-lease-required'], authority: authority() });
  }

  const specValidation = validateSpatialPrimitiveSpec(input.primitiveSpec);
  if (!specValidation.valid) return freeze({ schemaVersion: SPATIAL_PRIMITIVE_PREVIEW_PLAN_SCHEMA_VERSION, status: 'BLOCKED_INVALID_PRIMITIVE_SPEC', errors: specValidation.errors, authority: authority() });
  if (!SAFE_ID.test(text(input.assetId, 128)) || !SAFE_VERSION.test(text(input.assetVersion, 128)) || !SAFE_ID.test(text(input.creatorAgentId, 128)) || !SAFE_ID.test(text(input.performanceClass, 128))) {
    return freeze({ schemaVersion: SPATIAL_PRIMITIVE_PREVIEW_PLAN_SCHEMA_VERSION, status: 'BLOCKED_INVALID_ASSET_IDENTITY', errors: ['asset-identity-fields-invalid'], authority: authority() });
  }
  const dependencies = Array.isArray(input.dependencies) ? [...input.dependencies] : [];
  const compatibility = Array.isArray(input.engineOrRuntimeCompatibility) ? [...input.engineOrRuntimeCompatibility] : [];
  if (compatibility.length === 0) return freeze({ schemaVersion: SPATIAL_PRIMITIVE_PREVIEW_PLAN_SCHEMA_VERSION, status: 'BLOCKED_INVALID_ASSET_IDENTITY', errors: ['engine-or-runtime-compatibility-required'], authority: authority() });

  const payload = canonicalPrimitivePayload(input.primitiveSpec);
  const hashHex = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const assetRecord = freeze({
    schemaVersion: SPATIAL_ASSET_RECORD_SCHEMA_VERSION,
    assetId: input.assetId,
    assetType: 'primitive-mesh',
    version: input.assetVersion,
    contentHash: `sha256:${hashHex}`,
    sourceLocation: `cas://sha256/${hashHex}`,
    largeAssetLocation: null,
    creatorAgentId: input.creatorAgentId,
    creatingBuildOrderId: buildOrder.spatialBuildOrderId,
    planetId: buildOrder.planetId,
    regionId: buildOrder.regionId,
    parentVersion: input.parentVersion ?? null,
    sourceAndInfluenceRefs: [...buildOrder.researchRefs],
    licenceAndRightsState: 'GENERATED_WITH_PROVENANCE',
    dependencies,
    dependents: [],
    engineOrRuntimeCompatibility: compatibility,
    performanceClass: input.performanceClass,
    validationState: 'pending',
    integrationState: 'DRAFT',
    liveState: 'NOT_LIVE',
    rollbackRefs: [],
    createdAtUtc: input.createdAtUtc,
  });
  const registration = planSpatialAssetRegistration(registry, assetRecord);
  if (!['REGISTER', 'NOOP_ALREADY_REGISTERED'].includes(registration.action)) {
    return freeze({ schemaVersion: SPATIAL_PRIMITIVE_PREVIEW_PLAN_SCHEMA_VERSION, status: 'BLOCKED_ASSET_REGISTRATION', assetRecord, registration, errors: registration.errors, authority: authority() });
  }

  return freeze({
    schemaVersion: SPATIAL_PRIMITIVE_PREVIEW_PLAN_SCHEMA_VERSION,
    status: 'PRIMITIVE_PREVIEW_CANDIDATE_PLANNED',
    spatialBuildOrderId: buildOrder.spatialBuildOrderId,
    laneId: lanePlan.laneId,
    sandboxId: lanePlan.sandboxId,
    reservationId: leaseBinding.reservationId,
    leaseExpiresAt: leaseBinding.expiresAt,
    leaseBoundSandboxWriteEligible: true,
    primitiveSpec: payload,
    assetRecord,
    contentAddress: canonicalSpatialAssetContentAddress(assetRecord),
    registration,
    preview: {
      state: 'GHOST_CANDIDATE',
      source: 'SANDBOX_ONLY',
      requiresValidation: true,
      requiresPromotionReview: true,
      live: false,
    },
    errors: [],
    authority: authority(),
  });
}
