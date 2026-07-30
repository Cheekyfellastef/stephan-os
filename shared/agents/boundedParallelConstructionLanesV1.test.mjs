import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createConstructionLaneLease,
  createReadyForIntegrationReceipt,
  evaluateConstructionLaneAdmission,
} from './boundedParallelConstructionLanesV1.mjs';
import { createVerifierResult } from './verificationHarness.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

function candidate(overrides = {}) {
  return {
    id:'lane-1618',
    goalId:'1618',
    branch:'feat/whatsapp-merge-ready',
    baseSha:SHA_A,
    headSha:SHA_B,
    state:'BUILDING',
    ownership:{
      paths:['shared/notifications/whatsapp'],
      contracts:['merge-readiness-outbox-v1'],
    },
    capabilities:['SOURCE_WRITE'],
    dependencies:[],
    ...overrides,
  };
}

function activeLane(overrides = {}) {
  return candidate({
    id:'lane-ui',
    goalId:'1700',
    branch:'feat/ui-tile',
    state:'TESTING',
    ownership:{ paths:['stephanos-ui/src/components/ParallelLaneTile.jsx'], contracts:['parallel-lane-projection-v1'] },
    ...overrides,
  });
}

function inventory(overrides = {}) {
  return {
    constructionLanes:[],
    integrationLane:null,
    completedGoalIds:[],
    ...overrides,
  };
}

function exactEvidence(evidenceKind, overrides = {}) {
  const ref = overrides.ref ?? `proof/${evidenceKind.toLowerCase()}-lane-1618.json`;
  return {
    ...createVerifierResult({
      checkId:`${evidenceKind.toLowerCase()}-lane-1618`,
      verifierType:evidenceKind === 'TEST' ? 'BuildVerifier' : 'ProofReferenceVerifier',
      status:'PASS',
      target:'lane-1618',
      evidence:[`${evidenceKind.toLowerCase()}Passed=true`],
      timestampUtc:'2026-07-29T14:45:00Z',
      finalVerdict:`CONSTRUCTION_${evidenceKind}_PASS`,
      proofRefs:[ref],
    }),
    evidenceKind,
    ref,
    branch:'feat/whatsapp-merge-ready',
    headSha:SHA_B,
    ...overrides,
  };
}

test('admits two independent isolated construction lanes', () => {
  const result = evaluateConstructionLaneAdmission(candidate(), inventory({
    constructionLanes:[activeLane()],
  }));
  assert.equal(result.status, 'ADMITTED');
  assert.equal(result.mergeAuthority, false);
  assert.deepEqual(result.reasonCodes, []);
});

test('rejects overlapping path ownership into serial queue', () => {
  const result = evaluateConstructionLaneAdmission(candidate(), inventory({
    constructionLanes:[activeLane({ ownership:{ paths:['shared/notifications'], contracts:['another-contract'] } })],
  }));
  assert.equal(result.status, 'SERIAL_QUEUE');
  assert.ok(result.reasonCodes.includes('PATH_OWNERSHIP_OVERLAP'));
});

test('rejects shared contract overlap even when paths differ', () => {
  const result = evaluateConstructionLaneAdmission(candidate(), inventory({
    constructionLanes:[activeLane({ ownership:{ paths:['docs/status'], contracts:['merge-readiness-outbox-v1'] } })],
  }));
  assert.equal(result.status, 'SERIAL_QUEUE');
  assert.ok(result.reasonCodes.includes('CONTRACT_OWNERSHIP_OVERLAP'));
});

test('rejects overlap with the sole integration lane', () => {
  const result = evaluateConstructionLaneAdmission(candidate(), inventory({
    integrationLane:{
      id:'integration-1617',
      branch:'feat/durable-flywheel-controller-vnext',
      state:'CI_REVIEW',
      ownership:{ paths:['shared/notifications'], contracts:[] },
    },
  }));
  assert.equal(result.status, 'SERIAL_QUEUE');
  assert.ok(result.reasonCodes.includes('INTEGRATION_LANE_PATH_OVERLAP'));
});

test('duplicate goal or branch fails closed', () => {
  const duplicateGoal = evaluateConstructionLaneAdmission(candidate(), inventory({
    constructionLanes:[activeLane({ goalId:'1618' })],
  }));
  assert.ok(duplicateGoal.reasonCodes.includes('DUPLICATE_ACTIVE_GOAL'));

  const duplicateBranch = evaluateConstructionLaneAdmission(candidate(), inventory({
    constructionLanes:[activeLane({ branch:'feat/whatsapp-merge-ready' })],
  }));
  assert.ok(duplicateBranch.reasonCodes.includes('DUPLICATE_ACTIVE_BRANCH'));
});

test('dependency-incomplete work remains in the serial queue', () => {
  const result = evaluateConstructionLaneAdmission(candidate({ dependencies:['1617'] }), inventory());
  assert.equal(result.status, 'SERIAL_QUEUE');
  assert.deepEqual(result.reasonCodes, ['DEPENDENCIES_INCOMPLETE']);
});

test('dependency-complete work may be admitted', () => {
  const result = evaluateConstructionLaneAdmission(candidate({ dependencies:['1617'] }), inventory({
    completedGoalIds:['1617'],
  }));
  assert.equal(result.status, 'ADMITTED');
});

test('capacity is bounded', () => {
  const lanes = [0, 1].map((index) => activeLane({
    id:`lane-${index}`,
    goalId:`17${index}`,
    branch:`feat/lane-${index}`,
    ownership:{ paths:[`isolated/${index}`], contracts:[`contract-${index}`] },
  }));
  const result = evaluateConstructionLaneAdmission(candidate(), inventory({
    constructionLanes:lanes,
  }), { maxLanes:2 });
  assert.equal(result.status, 'SERIAL_QUEUE');
  assert.deepEqual(result.reasonCodes, ['CONSTRUCTION_CAPACITY_FULL']);

  for (const maxLanes of ['1', 0, 1.5]) {
    const invalidLimit = evaluateConstructionLaneAdmission(candidate(), inventory(), { maxLanes });
    assert.equal(invalidLimit.status, 'REJECTED');
    assert.deepEqual(invalidLimit.reasonCodes, ['CONSTRUCTION_CAPACITY_LIMIT_INVALID']);
  }
});

test('malformed active inventory fails closed', () => {
  const result = evaluateConstructionLaneAdmission(candidate(), inventory({
    constructionLanes:[null],
  }));
  assert.equal(result.status, 'REJECTED');
  assert.deepEqual(result.reasonCodes, ['ACTIVE_LANE_INVENTORY_INVALID']);

  const nonArray = evaluateConstructionLaneAdmission(candidate(), inventory({
    constructionLanes:{ lane:'hidden' },
  }));
  assert.equal(nonArray.status, 'REJECTED');
  assert.deepEqual(nonArray.reasonCodes, ['ACTIVE_LANE_INVENTORY_INVALID']);

  const missing = evaluateConstructionLaneAdmission(candidate(), {
    completedGoalIds:[],
  });
  assert.equal(missing.status, 'REJECTED');
  assert.deepEqual(missing.reasonCodes, ['ACTIVE_LANE_INVENTORY_INVALID']);

  const missingIntegration = evaluateConstructionLaneAdmission(candidate(), {
    constructionLanes:[],
    completedGoalIds:[],
  });
  assert.equal(missingIntegration.status, 'REJECTED');
  assert.deepEqual(missingIntegration.reasonCodes, ['INTEGRATION_LANE_INVENTORY_INVALID']);
});

test('candidate cannot request merge, deploy, approval, lease seizure or runtime mutation', () => {
  for (const capability of ['MERGE', 'DEPLOY', 'APPROVE', 'LEASE_SEIZE', 'RUNTIME_MUTATE']) {
    const result = evaluateConstructionLaneAdmission(candidate({ capabilities:[capability] }), inventory());
    assert.equal(result.status, 'REJECTED');
    assert.deepEqual(result.reasonCodes, ['CANDIDATE_CONTRACT_INVALID']);
  }
  assert.equal(evaluateConstructionLaneAdmission(candidate({ capabilities:'MERGE' }), inventory()).status, 'REJECTED');
  assert.equal(evaluateConstructionLaneAdmission(candidate({ dependencies:'1617' }), inventory()).status, 'REJECTED');
});

test('construction lease preserves bounded authority', () => {
  const currentInventory = inventory();
  const admission = evaluateConstructionLaneAdmission(candidate(), currentInventory);
  assert.throws(() => createConstructionLaneLease(admission, {
    laneId:'lane-other',
    issuedAt:'2026-07-29T14:30:00Z',
    expiresAt:'2026-07-29T15:30:00Z',
    inventorySnapshot:currentInventory,
  }), /exactly match/);
  const lease = createConstructionLaneLease(admission, {
    laneId:'lane-1618',
    issuedAt:'2026-07-29T14:30:00Z',
    expiresAt:'2026-07-29T15:30:00Z',
    inventorySnapshot:currentInventory,
  });
  assert.equal(lease.mergeAuthority, false);
  assert.equal(lease.deploymentAuthority, false);
  assert.equal(lease.runtimeMutationAllowed, false);
  assert.deepEqual(lease.ownedPaths, ['shared/notifications/whatsapp']);
  assert.throws(() => createConstructionLaneLease(admission, {
    laneId:'lane-1618',
    issuedAt:'2026-07-29T14:30:00Z',
    expiresAt:'2026-07-29T15:30:00Z',
    inventorySnapshot:currentInventory,
  }), /already been consumed/);
  assert.throws(() => createConstructionLaneLease(structuredClone(admission), {
    laneId:'lane-1618',
    issuedAt:'2026-07-29T14:30:00Z',
    expiresAt:'2026-07-29T15:30:00Z',
    inventorySnapshot:currentInventory,
  }), /returned by the evaluator/);

  const overlongInventory = inventory();
  const overlongAdmission = evaluateConstructionLaneAdmission(candidate(), overlongInventory);
  assert.throws(() => createConstructionLaneLease(overlongAdmission, {
    laneId:'lane-1618',
    issuedAt:'2026-07-29T14:30:00Z',
    expiresAt:'2026-07-31T14:30:00Z',
    inventorySnapshot:overlongInventory,
  }), /valid increasing timestamps/);

  const staleInventory = inventory();
  const staleAdmission = evaluateConstructionLaneAdmission(candidate(), staleInventory);
  assert.throws(() => createConstructionLaneLease(staleAdmission, {
    laneId:'lane-1618',
    issuedAt:'2026-07-29T14:30:00Z',
    expiresAt:'2026-07-29T15:30:00Z',
    inventorySnapshot:inventory({
      constructionLanes:[activeLane({
        ownership:{ paths:['shared/notifications'], contracts:[] },
      })],
    }),
  }), /inventory is stale/);
});

test('ready-for-integration receipt binds exact branch heads and records main drift', () => {
  const receipt = createReadyForIntegrationReceipt(candidate(), {
    currentMainSha:SHA_C,
    observedAt:'2026-07-29T14:45:00Z',
    testRefs:[exactEvidence('TEST')],
    proofRefs:[exactEvidence('PROOF')],
  });
  assert.equal(receipt.status, 'READY_FOR_INTEGRATION');
  assert.equal(receipt.baseSha, SHA_A);
  assert.equal(receipt.headSha, SHA_B);
  assert.equal(receipt.currentMainSha, SHA_C);
  assert.equal(receipt.mainDrifted, true);
  assert.equal(receipt.requiresFreshIntegrationValidation, true);
  assert.equal(receipt.mergeAuthority, false);
});

test('ready-for-integration receipt requires tests, proof and current main', () => {
  assert.throws(() => createReadyForIntegrationReceipt(candidate(), {
    observedAt:'2026-07-29T14:45:00Z',
    currentMainSha:SHA_C,
    testRefs:[],
    proofRefs:[exactEvidence('PROOF')],
  }), /non-empty/);
});

test('unknown states, dot-segment overlap and malformed integration ownership fail closed', () => {
  const unknown = evaluateConstructionLaneAdmission(candidate(), inventory({
    constructionLanes:[activeLane({ state:'BUILDNG' })],
  }));
  assert.deepEqual(unknown.reasonCodes, ['ACTIVE_LANE_INVENTORY_INVALID']);

  const dotOverlap = evaluateConstructionLaneAdmission(candidate({
    ownership:{ paths:['shared/./notifications'], contracts:[] },
  }), inventory({
    constructionLanes:[activeLane({
      ownership:{ paths:['shared/notifications/whatsapp'], contracts:[] },
    })],
  }));
  assert.ok(dotOverlap.reasonCodes.includes('PATH_OWNERSHIP_OVERLAP'));

  const malformedIntegration = evaluateConstructionLaneAdmission(candidate(), inventory({
    integrationLane:{
      id:'integration-1617',
      branch:'feat/integration',
      state:'BUILDING',
      ownership:{ paths:'shared/notifications', contracts:[] },
    },
  }));
  assert.deepEqual(malformedIntegration.reasonCodes, ['INTEGRATION_LANE_INVENTORY_INVALID']);

  const windowsAbsolute = evaluateConstructionLaneAdmission(candidate({
    ownership:{ paths:['C:\\outside\\file'], contracts:[] },
  }), inventory());
  assert.deepEqual(windowsAbsolute.reasonCodes, ['CANDIDATE_CONTRACT_INVALID']);

  const windowsDriveRelative = evaluateConstructionLaneAdmission(candidate({
    ownership:{ paths:['C:outside\\file'], contracts:[] },
  }), inventory());
  assert.deepEqual(windowsDriveRelative.reasonCodes, ['CANDIDATE_CONTRACT_INVALID']);

  const caseOnlyOverlap = evaluateConstructionLaneAdmission(candidate({
    ownership:{ paths:['shared/Foo'], contracts:[] },
  }), inventory({
    constructionLanes:[activeLane({
      ownership:{ paths:['shared/foo'], contracts:[] },
    })],
  }));
  assert.ok(caseOnlyOverlap.reasonCodes.includes('PATH_OWNERSHIP_OVERLAP'));

  const unsafeBranch = evaluateConstructionLaneAdmission(candidate({
    branch:'feat/../outside',
  }), inventory());
  assert.deepEqual(unsafeBranch.reasonCodes, ['CANDIDATE_CONTRACT_INVALID']);
});

test('ready-for-integration evidence is structured, exact-head bound and time-valid', () => {
  assert.throws(() => createReadyForIntegrationReceipt(candidate(), {
    currentMainSha:SHA_C,
    observedAt:'2026-07-29T14:45:00Z',
    testRefs:[exactEvidence('TEST', { headSha:SHA_A })],
    proofRefs:[exactEvidence('PROOF')],
  }), /exact head/);
  assert.throws(() => createReadyForIntegrationReceipt(candidate(), {
    currentMainSha:SHA_C,
    observedAt:'2026-07-29T14:45:00Z',
    testRefs:[exactEvidence('TEST', { timestampUtc:'not-a-time' })],
    proofRefs:[exactEvidence('PROOF')],
  }), /exact head/);
  assert.throws(() => createReadyForIntegrationReceipt(candidate(), {
    currentMainSha:SHA_C,
    observedAt:'not-a-time',
    testRefs:[exactEvidence('TEST')],
    proofRefs:[exactEvidence('PROOF')],
  }), /must be valid/);
  assert.throws(() => createReadyForIntegrationReceipt(candidate(), {
    currentMainSha:SHA_C,
    observedAt:'2026-02-30T14:45:00Z',
    testRefs:[exactEvidence('TEST')],
    proofRefs:[exactEvidence('PROOF')],
  }), /must be valid/);

  assert.throws(() => createReadyForIntegrationReceipt(candidate(), {
    currentMainSha:SHA_C,
    observedAt:'2026-07-29T14:45:00Z',
    testRefs:[{ ref:'made-up', branch:'feat/whatsapp-merge-ready', headSha:SHA_B }],
    proofRefs:[exactEvidence('PROOF')],
  }), /exact head/);
});

test('candidate admission rejects terminal states', () => {
  for (const state of ['READY_FOR_INTEGRATION', 'FAILED', 'CANCELLED', 'SUPERSEDED', 'BLOCKED']) {
    const result = evaluateConstructionLaneAdmission(candidate({ state }), inventory());
    assert.equal(result.status, 'REJECTED');
    assert.deepEqual(result.reasonCodes, ['CANDIDATE_STATE_NOT_ADMISSIBLE']);
  }
});

test('lane and integration identities cannot collide even with isolated ownership', () => {
  const duplicateLane = evaluateConstructionLaneAdmission(candidate(), inventory({
    constructionLanes:[activeLane({
      id:'lane-1618',
      ownership:{ paths:['isolated/ui'], contracts:['isolated-ui'] },
    })],
  }));
  assert.ok(duplicateLane.reasonCodes.includes('DUPLICATE_ACTIVE_LANE_ID'));

  const integrationId = evaluateConstructionLaneAdmission(candidate(), inventory({
    integrationLane:{
      id:'lane-1618',
      branch:'feat/integration',
      state:'INTEGRATING',
      ownership:{ paths:['isolated/integration'], contracts:['isolated-integration'] },
    },
  }));
  assert.ok(integrationId.reasonCodes.includes('INTEGRATION_LANE_ID_COLLISION'));

  const integrationBranch = evaluateConstructionLaneAdmission(candidate(), inventory({
    integrationLane:{
      id:'integration-1617',
      branch:'feat/whatsapp-merge-ready',
      state:'INTEGRATING',
      ownership:{ paths:['isolated/integration'], contracts:['isolated-integration'] },
    },
  }));
  assert.ok(integrationBranch.reasonCodes.includes('INTEGRATION_LANE_BRANCH_COLLISION'));
});

test('terminal lane outcomes cannot be converted into readiness receipts', () => {
  for (const state of ['FAILED', 'CANCELLED', 'SUPERSEDED', 'BLOCKED']) {
    assert.throws(() => createReadyForIntegrationReceipt(candidate({ state }), {
      currentMainSha:SHA_C,
      observedAt:'2026-07-29T14:45:00Z',
      testRefs:[exactEvidence('TEST')],
      proofRefs:[exactEvidence('PROOF')],
    }), /not eligible/);
  }
});
