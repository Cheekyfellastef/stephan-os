import test from 'node:test';
import assert from 'node:assert/strict';

import { planSpatialFoundryValidation } from './spatialWorldFoundryValidatorFrameworkV1.mjs';

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
    createdAtUtc: '2026-08-17T15:00:00.000Z',
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
    createdAtUtc: '2026-08-17T15:00:00.000Z',
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
    observedAtUtc: '2026-08-17T15:01:00.000Z',
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

test('plans missing validation without executing validators', () => {
  const plan = planSpatialFoundryValidation(buildOrder(), asset(), { sourceHead: SOURCE_HEAD, validators, evidence: [] });
  assert.equal(plan.status, 'VALIDATION_REQUIRED');
  assert.equal(plan.missingEvidence.includes('PREVIEW'), true);
  assert.equal(plan.authority.validatorExecutionAllowed, false);
  assert.equal(plan.authority.promotionAllowed, false);
});

test('complete exact-bound PASS evidence reaches promotion review, not promotion', () => {
  const plan = planSpatialFoundryValidation(buildOrder(), asset(), { sourceHead: SOURCE_HEAD, validators, evidence: completeEvidence() });
  assert.equal(plan.status, 'READY_FOR_PROMOTION_REVIEW', plan.errors?.join('\n'));
  assert.equal(plan.evidenceRefs.length, 6);
  assert.equal(plan.authority.promotionAllowed, false);
  assert.equal(plan.authority.runtimeMutationAllowed, false);
});

test('failed evidence blocks the candidate', () => {
  const evidence = completeEvidence().map((entry) => entry.class === 'PERFORMANCE_BUDGET' ? { ...entry, verdict: 'FAIL' } : entry);
  const plan = planSpatialFoundryValidation(buildOrder(), asset(), { sourceHead: SOURCE_HEAD, validators, evidence });
  assert.equal(plan.status, 'VALIDATION_FAILED');
  assert.deepEqual(plan.failedClasses, ['PERFORMANCE_BUDGET']);
});

test('semantic validation can be required later without inventing an implementation', () => {
  const plan = planSpatialFoundryValidation(buildOrder(), asset(), { sourceHead: SOURCE_HEAD, validators, evidence: completeEvidence(), requireSemantic: true });
  assert.equal(plan.status, 'BLOCKED_INVALID_VALIDATOR_CATALOGUE');
  assert.equal(plan.errors.some((error) => error.includes('SEMANTIC_WORLD')), true);
});

test('wrong-head evidence fails closed', () => {
  const evidence = completeEvidence().map((entry) => entry.class === 'SOURCE_CONTRACT' ? { ...entry, sourceHead: 'c'.repeat(40) } : entry);
  const plan = planSpatialFoundryValidation(buildOrder(), asset(), { sourceHead: SOURCE_HEAD, validators, evidence });
  assert.equal(plan.status, 'BLOCKED_INVALID_EVIDENCE');
  assert.equal(plan.errors.some((error) => error.includes('identity-mismatch')), true);
});
