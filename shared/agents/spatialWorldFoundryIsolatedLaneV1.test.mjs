import assert from 'node:assert/strict';
import test from 'node:test';

import { SPATIAL_BUILD_ORDER_SCHEMA_VERSION } from './spatialWorldFoundryContractsV1.mjs';
import {
  assertSpatialAgentWriteMayBegin,
  createSpatialIsolatedLaneCandidate,
  planSpatialIsolatedLaneAdmission,
} from './spatialWorldFoundryIsolatedLaneV1.mjs';

const BASE = '9284b9ff4e2db890c7134aa6dca142453eedf13b';
const HEAD = '94ad98de02fa7f14d3c054b30e65ea5d50a6e880';
const NOW = Date.parse('2026-08-14T11:30:00.000Z');

function buildOrder(overrides = {}) {
  return {
    schemaVersion:SPATIAL_BUILD_ORDER_SCHEMA_VERSION,
    spatialBuildOrderId:'sbo.idea-planet-001.crate-001',
    intentId:'intent.idea-planet-001',
    missionId:'mission.spatial-world-foundry-001',
    planetId:'idea-planet-001',
    regionId:'landing-bay',
    objectIds:['crate-001'],
    operatorRequest:'Create a small original storage crate candidate.',
    interpretationSummary:'Build one isolated candidate asset without touching live world state.',
    designGenomeVersion:'planet-genome.v1',
    researchRefs:['vr-research/spatial-foundry/primitive-assets'],
    requiredOutcome:'One previewable candidate asset with provenance.',
    assetClasses:['mesh'],
    codeClasses:[],
    dependencies:[],
    ownedResourceScopes:['region:idea-planet-001/landing-bay'],
    allowedOperations:['GENERATE_ASSET','WRITE_SANDBOX','RUN_VALIDATION'],
    forbiddenOperations:['MERGE','DEPLOY','VOICE_EXECUTE','LEASE_SEIZE'],
    requiredAgents:['mesh-agent'],
    performanceBudget:{ maxTriangles:5000 },
    comfortBudget:{ flashingForbidden:true },
    licenceAndProvenanceRequirements:'Original generated content only.',
    previewRequirement:'REQUIRED',
    verificationContract:'spatial-primitive-preview-v1',
    approvalRequirement:'POLICY_GATED',
    rollbackTarget:{ scope:'REGION', targetId:'landing-bay', snapshotId:null },
    status:'DRAFT',
    createdAtUtc:'2026-08-14T11:20:00.000Z',
    ...overrides,
  };
}

function emptyInventory() {
  return { constructionLanes:[], integrationLane:null, completedGoalIds:[] };
}

function planningInput(overrides = {}) {
  return {
    branch:'agent/spatial-crate-001',
    baseSha:BASE,
    headSha:HEAD,
    inventorySnapshot:emptyInventory(),
    ...overrides,
  };
}

test('M3 maps a valid spatial build order into the existing canonical construction admission model', () => {
  const prepared = createSpatialIsolatedLaneCandidate(buildOrder(), planningInput());
  assert.equal(prepared.valid, true);
  assert.equal(prepared.candidate.ownership.paths.length, 0);
  assert.deepEqual(prepared.resourceScopes, ['spatial-resource:region:idea-planet-001/landing-bay']);
  assert.equal(prepared.canonicalGoal, '#1760');

  const plan = planSpatialIsolatedLaneAdmission(buildOrder(), planningInput());
  assert.equal(plan.status, 'ADMITTED_TO_CANONICAL_LEASE_AUTHORITY');
  assert.equal(plan.canonicalAdmission.status, 'ADMITTED');
  assert.equal(plan.leaseIssueRequired, true);
  assert.equal(plan.mayBeginAgentWrites, false);
  assert.equal(plan.authority.leaseIssueAllowed, false);
});

test('two non-overlapping spatial resource scopes can be admitted independently', () => {
  const first = createSpatialIsolatedLaneCandidate(buildOrder(), planningInput()).candidate;
  const active = {
    ...first,
    state:'BUILDING',
  };
  const secondOrder = buildOrder({
    spatialBuildOrderId:'sbo.idea-planet-001.lamp-001',
    regionId:'observation-deck',
    objectIds:['lamp-001'],
    ownedResourceScopes:['region:idea-planet-001/observation-deck'],
  });
  const plan = planSpatialIsolatedLaneAdmission(secondOrder, planningInput({
    branch:'agent/spatial-lamp-001',
    inventorySnapshot:{ constructionLanes:[active], integrationLane:null, completedGoalIds:[] },
  }));
  assert.equal(plan.status, 'ADMITTED_TO_CANONICAL_LEASE_AUTHORITY');
});

test('overlapping region ownership serialises instead of admitting a competing writer', () => {
  const first = createSpatialIsolatedLaneCandidate(buildOrder(), planningInput()).candidate;
  const active = { ...first, state:'BUILDING' };
  const secondOrder = buildOrder({
    spatialBuildOrderId:'sbo.idea-planet-001.crate-002',
    objectIds:['crate-002'],
  });
  const plan = planSpatialIsolatedLaneAdmission(secondOrder, planningInput({
    branch:'agent/spatial-crate-002',
    inventorySnapshot:{ constructionLanes:[active], integrationLane:null, completedGoalIds:[] },
  }));
  assert.equal(plan.status, 'WAITING_FOR_RESOURCE_LEASE');
  assert.equal(plan.canonicalAdmission.status, 'SERIAL_QUEUE');
  assert.ok(plan.errors.includes('CONTRACT_OWNERSHIP_OVERLAP'));
});

test('missing canonical inventory fails closed instead of assuming the resource is free', () => {
  const plan = planSpatialIsolatedLaneAdmission(buildOrder(), planningInput({ inventorySnapshot:null }));
  assert.equal(plan.status, 'BLOCKED_CONSTRUCTION_INVENTORY');
  assert.equal(plan.authority.sourceMutationAllowed, false);
});

test('authority-bearing capabilities cannot be smuggled into a spatial construction lane', () => {
  const prepared = createSpatialIsolatedLaneCandidate(buildOrder(), planningInput({ capabilities:['ASSET_GENERATE','MERGE'] }));
  assert.equal(prepared.valid, false);
  assert.ok(prepared.errors.includes('authority-bearing-capability-forbidden'));
});

test('agent writes remain blocked until an exact canonical lease is returned', () => {
  const plan = planSpatialIsolatedLaneAdmission(buildOrder(), planningInput());
  assert.throws(() => assertSpatialAgentWriteMayBegin(plan, {}, { nowMs:NOW }), /exact active canonical construction lease required/);
});

test('exact unexpired canonical lease binds agent writes to the admitted resource scope only', () => {
  const plan = planSpatialIsolatedLaneAdmission(buildOrder(), planningInput());
  const lease = {
    schema:'Stephanos Bounded Construction Lease V1',
    laneId:plan.laneId,
    goalId:'spatial-goal-placeholder',
    branch:plan.branch,
    baseSha:plan.baseSha,
    headSha:plan.headSha,
    state:'ADMITTED',
    issuedAt:'2026-08-14T11:29:00.000Z',
    expiresAt:'2026-08-14T12:29:00.000Z',
    ownedPaths:[],
    ownedContracts:[...plan.resourceScopes],
    mergeAuthority:false,
    deploymentAuthority:false,
    approvalAuthority:false,
    leaseSeizureAllowed:false,
    runtimeMutationAllowed:false,
    reservationId:'reservation-spatial-001',
    inventoryFingerprint:'inventory-001',
  };
  const verdict = assertSpatialAgentWriteMayBegin(plan, lease, { nowMs:NOW });
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.verdict, 'SPATIAL_AGENT_WRITE_LEASE_BOUND');
  assert.deepEqual(verdict.resourceScopes, plan.resourceScopes);
  assert.equal(verdict.mergeAuthority, false);
});

test('expired lease is rejected even when all identities and resource scopes still match', () => {
  const plan = planSpatialIsolatedLaneAdmission(buildOrder(), planningInput());
  const expired = {
    schema:'Stephanos Bounded Construction Lease V1',
    laneId:plan.laneId,
    branch:plan.branch,
    baseSha:plan.baseSha,
    headSha:plan.headSha,
    expiresAt:'2026-08-14T11:29:59.000Z',
    ownedContracts:[...plan.resourceScopes],
    mergeAuthority:false,
    deploymentAuthority:false,
    approvalAuthority:false,
    leaseSeizureAllowed:false,
    runtimeMutationAllowed:false,
    reservationId:'reservation-expired',
  };
  assert.throws(() => assertSpatialAgentWriteMayBegin(plan, expired, { nowMs:NOW }), /exact active canonical construction lease required/);
});

test('lease for another spatial scope cannot authorize this build order', () => {
  const plan = planSpatialIsolatedLaneAdmission(buildOrder(), planningInput());
  const wrongScope = {
    schema:'Stephanos Bounded Construction Lease V1',
    laneId:plan.laneId,
    branch:plan.branch,
    baseSha:plan.baseSha,
    headSha:plan.headSha,
    expiresAt:'2026-08-14T12:29:00.000Z',
    ownedContracts:['spatial-resource:region:idea-planet-001/observation-deck'],
    mergeAuthority:false,
    deploymentAuthority:false,
    approvalAuthority:false,
    leaseSeizureAllowed:false,
    runtimeMutationAllowed:false,
    reservationId:'reservation-wrong-scope',
  };
  assert.throws(() => assertSpatialAgentWriteMayBegin(plan, wrongScope, { nowMs:NOW }), /exact active canonical construction lease required/);
});
