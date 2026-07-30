import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createConstructionLaneLease,
  createReadyForIntegrationReceipt,
  evaluateConstructionLaneAdmission,
} from './boundedParallelConstructionLanesV1.mjs';

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

test('admits two independent isolated construction lanes', () => {
  const result = evaluateConstructionLaneAdmission(candidate(), {
    constructionLanes:[activeLane()],
    completedGoalIds:[],
  });
  assert.equal(result.status, 'ADMITTED');
  assert.equal(result.mergeAuthority, false);
  assert.deepEqual(result.reasonCodes, []);
});

test('rejects overlapping path ownership into serial queue', () => {
  const result = evaluateConstructionLaneAdmission(candidate(), {
    constructionLanes:[activeLane({ ownership:{ paths:['shared/notifications'], contracts:['another-contract'] } })],
    completedGoalIds:[],
  });
  assert.equal(result.status, 'SERIAL_QUEUE');
  assert.ok(result.reasonCodes.includes('PATH_OWNERSHIP_OVERLAP'));
});

test('rejects shared contract overlap even when paths differ', () => {
  const result = evaluateConstructionLaneAdmission(candidate(), {
    constructionLanes:[activeLane({ ownership:{ paths:['docs/status'], contracts:['merge-readiness-outbox-v1'] } })],
    completedGoalIds:[],
  });
  assert.equal(result.status, 'SERIAL_QUEUE');
  assert.ok(result.reasonCodes.includes('CONTRACT_OWNERSHIP_OVERLAP'));
});

test('rejects overlap with the sole integration lane', () => {
  const result = evaluateConstructionLaneAdmission(candidate(), {
    constructionLanes:[],
    completedGoalIds:[],
    integrationLane:{
      id:'integration-1617',
      branch:'feat/durable-flywheel-controller-vnext',
      state:'CI_REVIEW',
      ownership:{ paths:['shared/notifications'], contracts:[] },
    },
  });
  assert.equal(result.status, 'SERIAL_QUEUE');
  assert.ok(result.reasonCodes.includes('INTEGRATION_LANE_PATH_OVERLAP'));
});

test('duplicate goal or branch fails closed', () => {
  const duplicateGoal = evaluateConstructionLaneAdmission(candidate(), {
    constructionLanes:[activeLane({ goalId:'1618' })],
    completedGoalIds:[],
  });
  assert.ok(duplicateGoal.reasonCodes.includes('DUPLICATE_ACTIVE_GOAL'));

  const duplicateBranch = evaluateConstructionLaneAdmission(candidate(), {
    constructionLanes:[activeLane({ branch:'feat/whatsapp-merge-ready' })],
    completedGoalIds:[],
  });
  assert.ok(duplicateBranch.reasonCodes.includes('DUPLICATE_ACTIVE_BRANCH'));
});

test('dependency-incomplete work remains in the serial queue', () => {
  const result = evaluateConstructionLaneAdmission(candidate({ dependencies:['1617'] }), {
    constructionLanes:[],
    completedGoalIds:[],
  });
  assert.equal(result.status, 'SERIAL_QUEUE');
  assert.deepEqual(result.reasonCodes, ['DEPENDENCIES_INCOMPLETE']);
});

test('dependency-complete work may be admitted', () => {
  const result = evaluateConstructionLaneAdmission(candidate({ dependencies:['1617'] }), {
    constructionLanes:[],
    completedGoalIds:['1617'],
  });
  assert.equal(result.status, 'ADMITTED');
});

test('capacity is bounded', () => {
  const lanes = [0, 1].map((index) => activeLane({
    id:`lane-${index}`,
    goalId:`17${index}`,
    branch:`feat/lane-${index}`,
    ownership:{ paths:[`isolated/${index}`], contracts:[`contract-${index}`] },
  }));
  const result = evaluateConstructionLaneAdmission(candidate(), {
    constructionLanes:lanes,
    completedGoalIds:[],
  }, { maxLanes:2 });
  assert.equal(result.status, 'SERIAL_QUEUE');
  assert.deepEqual(result.reasonCodes, ['CONSTRUCTION_CAPACITY_FULL']);
});

test('malformed active inventory fails closed', () => {
  const result = evaluateConstructionLaneAdmission(candidate(), {
    constructionLanes:[null],
    completedGoalIds:[],
  });
  assert.equal(result.status, 'REJECTED');
  assert.deepEqual(result.reasonCodes, ['ACTIVE_LANE_INVENTORY_INVALID']);

  const nonArray = evaluateConstructionLaneAdmission(candidate(), {
    constructionLanes:{ lane:'hidden' },
    completedGoalIds:[],
  });
  assert.equal(nonArray.status, 'REJECTED');
  assert.deepEqual(nonArray.reasonCodes, ['ACTIVE_LANE_INVENTORY_INVALID']);
});

test('candidate cannot request merge, deploy, approval, lease seizure or runtime mutation', () => {
  for (const capability of ['MERGE', 'DEPLOY', 'APPROVE', 'LEASE_SEIZE', 'RUNTIME_MUTATE']) {
    const result = evaluateConstructionLaneAdmission(candidate({ capabilities:[capability] }), {
      constructionLanes:[],
      completedGoalIds:[],
    });
    assert.equal(result.status, 'REJECTED');
    assert.deepEqual(result.reasonCodes, ['CANDIDATE_CONTRACT_INVALID']);
  }
  assert.equal(evaluateConstructionLaneAdmission(candidate({ capabilities:'MERGE' }), {
    constructionLanes:[],
    completedGoalIds:[],
  }).status, 'REJECTED');
  assert.equal(evaluateConstructionLaneAdmission(candidate({ dependencies:'1617' }), {
    constructionLanes:[],
    completedGoalIds:[],
  }).status, 'REJECTED');
});

test('construction lease preserves bounded authority', () => {
  const admission = evaluateConstructionLaneAdmission(candidate(), {
    constructionLanes:[],
    completedGoalIds:[],
  });
  const lease = createConstructionLaneLease(admission, {
    laneId:'lane-1618',
    issuedAt:'2026-07-29T14:30:00Z',
    expiresAt:'2026-07-29T15:30:00Z',
  });
  assert.equal(lease.mergeAuthority, false);
  assert.equal(lease.deploymentAuthority, false);
  assert.equal(lease.runtimeMutationAllowed, false);
  assert.deepEqual(lease.ownedPaths, ['shared/notifications/whatsapp']);
  assert.throws(() => createConstructionLaneLease(admission, {
    laneId:'lane-other',
    issuedAt:'2026-07-29T14:30:00Z',
    expiresAt:'2026-07-29T15:30:00Z',
  }), /exactly match/);
});

test('ready-for-integration receipt binds exact branch heads and records main drift', () => {
  const receipt = createReadyForIntegrationReceipt(candidate(), {
    currentMainSha:SHA_C,
    observedAt:'2026-07-29T14:45:00Z',
    testRefs:[{ ref:'node-test:bounded-parallel-construction-lanes-v1', branch:'feat/whatsapp-merge-ready', headSha:SHA_B }],
    proofRefs:[{ ref:'github:commit:proof', branch:'feat/whatsapp-merge-ready', headSha:SHA_B }],
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
    proofRefs:[{ ref:'proof', branch:'feat/whatsapp-merge-ready', headSha:SHA_B }],
  }), /non-empty/);
});

test('unknown states, dot-segment overlap and malformed integration ownership fail closed', () => {
  const unknown = evaluateConstructionLaneAdmission(candidate(), {
    constructionLanes:[activeLane({ state:'BUILDNG' })],
    completedGoalIds:[],
  });
  assert.deepEqual(unknown.reasonCodes, ['ACTIVE_LANE_INVENTORY_INVALID']);

  const dotOverlap = evaluateConstructionLaneAdmission(candidate({
    ownership:{ paths:['shared/./notifications'], contracts:[] },
  }), {
    constructionLanes:[activeLane({
      ownership:{ paths:['shared/notifications/whatsapp'], contracts:[] },
    })],
    completedGoalIds:[],
  });
  assert.ok(dotOverlap.reasonCodes.includes('PATH_OWNERSHIP_OVERLAP'));

  const malformedIntegration = evaluateConstructionLaneAdmission(candidate(), {
    constructionLanes:[],
    completedGoalIds:[],
    integrationLane:{
      id:'integration-1617',
      branch:'feat/integration',
      state:'BUILDING',
      ownership:{ paths:'shared/notifications', contracts:[] },
    },
  });
  assert.deepEqual(malformedIntegration.reasonCodes, ['INTEGRATION_LANE_INVENTORY_INVALID']);
});

test('ready-for-integration evidence is structured, exact-head bound and time-valid', () => {
  assert.throws(() => createReadyForIntegrationReceipt(candidate(), {
    currentMainSha:SHA_C,
    observedAt:'2026-07-29T14:45:00Z',
    testRefs:[{ ref:'test-old-head', branch:'feat/whatsapp-merge-ready', headSha:SHA_A }],
    proofRefs:[{ ref:'proof', branch:'feat/whatsapp-merge-ready', headSha:SHA_B }],
  }), /exact head/);
  assert.throws(() => createReadyForIntegrationReceipt(candidate(), {
    currentMainSha:SHA_C,
    observedAt:'not-a-time',
    testRefs:[{ ref:'test', branch:'feat/whatsapp-merge-ready', headSha:SHA_B }],
    proofRefs:[{ ref:'proof', branch:'feat/whatsapp-merge-ready', headSha:SHA_B }],
  }), /must be valid/);
});
