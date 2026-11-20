import test from 'node:test';
import assert from 'node:assert/strict';

import {
  planSpatialPrimitivePreview,
  SPATIAL_PRIMITIVE_SPEC_SCHEMA_VERSION,
} from './spatialWorldFoundryPrimitivePreviewV1.mjs';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const REGISTRY_SHA = 'c'.repeat(40);
const NOW_MS = Date.parse('2026-08-17T15:00:00.000Z');

function buildOrder(overrides = {}) {
  return {
    schemaVersion: 'stephanos.spatial-build-order.v1',
    spatialBuildOrderId: 'build-order-a',
    intentId: 'intent-a',
    missionId: 'mission-a',
    planetId: 'planet-a',
    regionId: 'region-a',
    objectIds: [],
    operatorRequest: 'Create one simple navigation plinth as a preview.',
    interpretationSummary: 'Generate one bounded box primitive candidate.',
    designGenomeVersion: 'genome-v1',
    researchRefs: ['research:primitive-preview'],
    requiredOutcome: 'One primitive preview candidate with provenance.',
    assetClasses: ['mesh'],
    codeClasses: [],
    dependencies: [],
    ownedResourceScopes: ['region:planet-a/region-a'],
    allowedOperations: ['GENERATE_ASSET', 'WRITE_SANDBOX', 'RUN_VALIDATION'],
    forbiddenOperations: ['MERGE', 'DEPLOY', 'RUNTIME_MUTATE'],
    requiredAgents: ['mesh'],
    performanceBudget: { frameTimeMs: 11.1 },
    comfortBudget: { flashingAllowed: false },
    licenceAndProvenanceRequirements: 'Generated with complete provenance.',
    previewRequirement: 'REQUIRED',
    verificationContract: 'Validate deterministic payload and ghost preview before promotion.',
    approvalRequirement: 'OPERATOR_REQUIRED',
    rollbackTarget: { scope: 'REGION', snapshotId: null, targetId: 'region-a' },
    status: 'DRAFT',
    createdAtUtc: '2026-08-17T15:00:00.000Z',
    ...overrides,
  };
}

function registry() {
  return {
    schemaVersion: 'stephanos.spatial-asset-registry.v1',
    registryId: 'planet-a-registry',
    planetId: 'planet-a',
    sourceHead: REGISTRY_SHA,
    generation: 1,
    entries: [],
    createdAtUtc: '2026-08-17T15:00:00.000Z',
  };
}

function lanePlan() {
  return {
    schemaVersion: 'stephanos.spatial-world-foundry.isolated-lane-plan.v1',
    status: 'ADMITTED_TO_CANONICAL_LEASE_AUTHORITY',
    spatialBuildOrderId: 'build-order-a',
    sandboxId: 'spatial-sandbox-a',
    laneId: 'spatial-lane-a',
    branch: 'agent/spatial-m4-test',
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    resourceScopes: ['spatial-resource:region:planet-a/region-a'],
    leaseIssueRequired: true,
    mayBeginAgentWrites: false,
  };
}

function lease(overrides = {}) {
  return {
    schema: 'Stephanos Bounded Construction Lease V1',
    laneId: 'spatial-lane-a',
    branch: 'agent/spatial-m4-test',
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    mergeAuthority: false,
    deploymentAuthority: false,
    approvalAuthority: false,
    leaseSeizureAllowed: false,
    runtimeMutationAllowed: false,
    ownedContracts: ['spatial-resource:region:planet-a/region-a'],
    reservationId: 'reservation-a',
    expiresAt: '2026-08-17T15:10:00.000Z',
    ...overrides,
  };
}

function primitiveSpec() {
  return {
    schemaVersion: SPATIAL_PRIMITIVE_SPEC_SCHEMA_VERSION,
    primitiveType: 'BOX',
    dimensions: { x: 1.5, y: 0.4, z: 1.5 },
    materialHint: 'neutral emissive navigation material',
    transform: {
      position: [0, 0.2, 0],
      rotationEulerDegrees: [0, 0, 0],
      scale: [1, 1, 1],
    },
  };
}

function input(overrides = {}) {
  return {
    primitiveSpec: primitiveSpec(),
    assetId: 'primitive-plinth-a',
    assetVersion: 'v1',
    creatorAgentId: 'mesh-agent',
    performanceClass: 'small',
    dependencies: [],
    engineOrRuntimeCompatibility: ['engine-neutral', 'webxr'],
    createdAtUtc: '2026-08-17T15:01:00.000Z',
    nowMs: NOW_MS,
    ...overrides,
  };
}

test('plans one deterministic primitive as a ghost preview candidate', () => {
  const plan = planSpatialPrimitivePreview(buildOrder(), registry(), lanePlan(), lease(), input());
  assert.equal(plan.status, 'PRIMITIVE_PREVIEW_CANDIDATE_PLANNED', plan.errors?.join('\n'));
  assert.equal(plan.assetRecord.integrationState, 'DRAFT');
  assert.equal(plan.assetRecord.liveState, 'NOT_LIVE');
  assert.equal(plan.registration.action, 'REGISTER');
  assert.equal(plan.preview.state, 'GHOST_CANDIDATE');
  assert.equal(plan.preview.live, false);
  assert.equal(plan.leaseBoundSandboxWriteEligible, true);
  assert.equal(plan.authority.sandboxWriteExecutionAllowed, false);
  assert.equal(plan.authority.liveWorldMutationAllowed, false);
});

test('same primitive spec produces the same immutable content identity', () => {
  const first = planSpatialPrimitivePreview(buildOrder(), registry(), lanePlan(), lease(), input());
  const second = planSpatialPrimitivePreview(buildOrder(), registry(), lanePlan(), lease(), input());
  assert.equal(first.assetRecord.contentHash, second.assetRecord.contentHash);
  assert.equal(first.contentAddress, second.contentAddress);
});

test('wrong or expired lease cannot reach candidate planning', () => {
  const wrong = planSpatialPrimitivePreview(buildOrder(), registry(), lanePlan(), lease({ laneId: 'another-lane' }), input());
  assert.equal(wrong.status, 'WAITING_FOR_EXACT_RESOURCE_LEASE');

  const expired = planSpatialPrimitivePreview(buildOrder(), registry(), lanePlan(), lease({ expiresAt: '2026-08-17T14:59:59.000Z' }), input());
  assert.equal(expired.status, 'WAITING_FOR_EXACT_RESOURCE_LEASE');
});

test('M4 refuses a build order that does not require or permit preview generation', () => {
  const plan = planSpatialPrimitivePreview(buildOrder({ previewRequirement: 'NOT_APPLICABLE' }), registry(), lanePlan(), lease(), input());
  assert.equal(plan.status, 'BLOCKED_PREVIEW_NOT_AUTHORIZED_BY_BUILD_ORDER');
});
