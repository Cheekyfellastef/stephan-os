import test from 'node:test';
import assert from 'node:assert/strict';

import { planSpatialFoundryPromotion } from './spatialWorldFoundryPromotionStateV1.mjs';

const SOURCE_HEAD = 'a'.repeat(40);
const CONTENT_HASH = `sha256:${'b'.repeat(64)}`;

function buildOrder(overrides = {}) {
  return {
    schemaVersion: 'stephanos.spatial-build-order.v1',
    spatialBuildOrderId: 'build-order-a',
    intentId: 'intent-a',
    missionId: 'mission-a',
    planetId: 'planet-a',
    regionId: 'region-a',
    objectIds: [],
    operatorRequest: 'Create one bounded primitive candidate.',
    interpretationSummary: 'One previewable test asset only.',
    designGenomeVersion: 'genome-v1',
    researchRefs: ['research:primitive'],
    requiredOutcome: 'A validated preview candidate.',
    assetClasses: ['mesh'],
    codeClasses: [],
    dependencies: [],
    ownedResourceScopes: ['region:planet-a/region-a'],
    allowedOperations: ['GENERATE_ASSET', 'WRITE_SANDBOX', 'RUN_VALIDATION'],
    forbiddenOperations: ['MERGE', 'DEPLOY'],
    requiredAgents: ['mesh'],
    performanceBudget: { frameTimeMs: 11.1 },
    comfortBudget: { flashingAllowed: false },
    licenceAndProvenanceRequirements: 'Generated with complete provenance.',
    previewRequirement: 'REQUIRED',
    verificationContract: 'Source, asset, budget and preview proof.',
    approvalRequirement: 'OPERATOR_REQUIRED',
    rollbackTarget: { scope: 'REGION', snapshotId: null, targetId: 'region-a' },
    status: 'DRAFT',
    createdAtUtc: '2026-08-18T10:00:00.000Z',
    ...overrides,
  };
}

function asset(overrides = {}) {
  return {
    schemaVersion: 'stephanos.spatial-asset-registry-record.v1',
    assetId: 'asset-a',
    assetType: 'mesh',
    version: 'v1',
    contentHash: CONTENT_HASH,
    sourceLocation: `cas://sha256/${'b'.repeat(64)}`,
    largeAssetLocation: null,
    creatorAgentId: 'mesh-agent',
    creatingBuildOrderId: 'build-order-a',
    planetId: 'planet-a',
    regionId: 'region-a',
    parentVersion: null,
    sourceAndInfluenceRefs: ['research:primitive'],
    licenceAndRightsState: 'GENERATED_WITH_PROVENANCE',
    dependencies: [],
    dependents: [],
    engineOrRuntimeCompatibility: ['engine-neutral'],
    performanceClass: 'small',
    validationState: 'pending',
    integrationState: 'DRAFT',
    liveState: 'NOT_LIVE',
    rollbackRefs: [],
    createdAtUtc: '2026-08-18T10:00:00.000Z',
    ...overrides,
  };
}

const validators = [
  { validatorId: 'source-validator', version: 'v1', classes: ['SOURCE_CONTRACT', 'ASSET_INTEGRITY', 'DEPENDENCY_INTEGRITY'], deterministic: true, engineNeutral: true },
  { validatorId: 'budget-validator', version: 'v1', classes: ['PERFORMANCE_BUDGET', 'COMFORT_BUDGET'], deterministic: true, engineNeutral: true },
  { validatorId: 'preview-validator', version: 'v1', classes: ['PREVIEW'], deterministic: false, engineNeutral: true },
];

function passEvidence(validationClass, validatorId, overrides = {}) {
  return {
    validatorId,
    validatorVersion: 'v1',
    class: validationClass,
    verdict: 'PASS',
    spatialBuildOrderId: 'build-order-a',
    assetId: 'asset-a',
    assetVersion: 'v1',
    sourceHead: SOURCE_HEAD,
    evidenceRef: `proof:${validationClass.toLowerCase()}`,
    observedAtUtc: '2026-08-18T10:01:00.000Z',
    ...overrides,
  };
}

function completeEvidence() {
  return [
    passEvidence('SOURCE_CONTRACT', 'source-validator'),
    passEvidence('ASSET_INTEGRITY', 'source-validator'),
    passEvidence('DEPENDENCY_INTEGRITY', 'source-validator'),
    passEvidence('PERFORMANCE_BUDGET', 'budget-validator'),
    passEvidence('COMFORT_BUDGET', 'budget-validator'),
    passEvidence('PREVIEW', 'preview-validator'),
  ];
}

function input(overrides = {}) {
  return { sourceHead: SOURCE_HEAD, validators, evidence: completeEvidence(), ...overrides };
}

test('validated DRAFT candidate reaches promotion review without promotion authority', () => {
  const plan = planSpatialFoundryPromotion(buildOrder(), asset(), input());
  assert.equal(plan.status, 'PROMOTION_REVIEW_READY', plan.errors?.join('\n'));
  assert.equal(plan.currentState, 'DRAFT');
  assert.equal(plan.requestedState, 'AGENT_TESTED');
  assert.deepEqual(plan.proposedAssetPatch, {
    validationState: 'passed',
    integrationState: 'AGENT_TESTED',
    liveState: 'NOT_LIVE',
  });
  assert.equal(plan.operatorApprovalRequired, true);
  assert.match(plan.proposalDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(plan.authority.promotionExecutionAllowed, false);
  assert.equal(plan.authority.registryMutationAllowed, false);
  assert.equal(plan.authority.runtimeMutationAllowed, false);
});

test('missing validation evidence remains blocked', () => {
  const plan = planSpatialFoundryPromotion(buildOrder(), asset(), input({ evidence: [] }));
  assert.equal(plan.status, 'BLOCKED_VALIDATION_NOT_READY');
  assert.equal(plan.validationStatus, 'VALIDATION_REQUIRED');
  assert.equal(plan.authority.assetMutationAllowed, false);
});

test('wrong-head validation evidence fails closed', () => {
  const evidence = completeEvidence().map((entry) => entry.class === 'SOURCE_CONTRACT'
    ? { ...entry, sourceHead: 'c'.repeat(40) }
    : entry);
  const plan = planSpatialFoundryPromotion(buildOrder(), asset(), input({ evidence }));
  assert.equal(plan.status, 'BLOCKED_VALIDATION_NOT_READY');
  assert.equal(plan.validationStatus, 'BLOCKED_INVALID_EVIDENCE');
});

test('planner cannot skip directly to a later promotion state', () => {
  const plan = planSpatialFoundryPromotion(buildOrder(), asset(), input({ requestedPromotionState: 'MAIN_ACCEPTED' }));
  assert.equal(plan.status, 'BLOCKED_REQUESTED_STATE');
  assert.equal(plan.authority.promotionExecutionAllowed, false);
});

test('already-advanced integration state is not silently re-promoted', () => {
  const plan = planSpatialFoundryPromotion(buildOrder(), asset({ integrationState: 'AGENT_TESTED' }), input());
  assert.equal(plan.status, 'BLOCKED_UNSUPPORTED_CURRENT_STATE');
});

test('anything claiming a live state is held', () => {
  const plan = planSpatialFoundryPromotion(buildOrder(), asset({ liveState: 'LIVE_STAGED' }), input());
  assert.equal(plan.status, 'BLOCKED_LIVE_STATE');
  assert.equal(plan.authority.liveWorldMutationAllowed, false);
});

test('policy gate is preserved as evidence rather than execution authority', () => {
  const plan = planSpatialFoundryPromotion(buildOrder({ approvalRequirement: 'POLICY_GATED' }), asset(), input());
  assert.equal(plan.status, 'PROMOTION_REVIEW_READY');
  assert.equal(plan.operatorApprovalRequired, false);
  assert.equal(plan.policyApprovalRequired, true);
  assert.equal(plan.authority.promotionExecutionAllowed, false);
});
