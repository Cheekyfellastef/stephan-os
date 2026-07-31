import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBoundedParallelConstructionAuthority,
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
  const result = createVerifierResult({
      checkId:`${evidenceKind.toLowerCase()}-lane-1618`,
      verifierType:evidenceKind === 'TEST' ? 'BuildVerifier' : 'ProofReferenceVerifier',
      status:'PASS',
      target:'lane-1618',
      evidence:[`${evidenceKind.toLowerCase()}Passed=true`],
      timestampUtc:'2026-07-29T14:45:00Z',
      finalVerdict:`CONSTRUCTION_${evidenceKind}_PASS`,
      proofRefs:[ref],
    });
  return {
    authenticated:true,
    immutable:true,
    evidenceKind,
    ref,
    branch:'feat/whatsapp-merge-ready',
    headSha:SHA_B,
    result,
    ...overrides,
  };
}

function authorityHarness(options = {}) {
  const evidence = new Map();
  const reservations = new Map();
  const reservedFingerprints = new Set();
  const reserveCalls = [];
  const api = createBoundedParallelConstructionAuthority({
    nowMs:typeof options.nowMs === 'function'
      ? options.nowMs
      : () => Date.parse(options.nowUtc ?? '2026-07-29T14:30:00Z'),
    reserveConstructionLane:async (request) => {
      reserveCalls.push(request);
      let result;
      if (typeof options.reserveConstructionLane === 'function') {
        result = await options.reserveConstructionLane(request);
      } else if (reservedFingerprints.has(request.expectedInventoryFingerprint)) {
        result = { accepted:false, reason:'CAPACITY_ALREADY_RESERVED' };
      } else {
        reservedFingerprints.add(request.expectedInventoryFingerprint);
        result = {
          accepted:true,
          reservationId:`reservation-${reserveCalls.length}`,
          inventoryFingerprint:request.expectedInventoryFingerprint,
        };
      }
      if (result?.accepted === true) {
        reservations.set(result.reservationId, {
          authenticated:true,
          active:true,
          immutable:true,
          reservationId:result.reservationId,
          inventoryFingerprint:result.inventoryFingerprint,
          issuedAt:request.lease.issuedAt,
          expiresAt:request.lease.expiresAt,
          lane:request.lane,
        });
      }
      return result;
    },
    resolveConstructionLaneReservation:async ({ reservationId }) => {
      if (typeof options.resolveConstructionLaneReservation === 'function') {
        return options.resolveConstructionLaneReservation({ reservationId });
      }
      return reservations.get(reservationId) ?? null;
    },
    resolveVerifierEvidence:async ({ ref }) => {
      const record = evidence.get(ref) ?? null;
      if (typeof options.onResolveVerifierEvidence === 'function') {
        await options.onResolveVerifierEvidence({ ref, record });
      }
      return record;
    },
  });
  return {
    api,
    reserveCalls,
    addEvidence(evidenceKind, overrides = {}) {
      const record = exactEvidence(evidenceKind, overrides);
      evidence.set(record.ref, record);
      return record.ref;
    },
    updateReservation(reservationId, overrides = {}) {
      const current = reservations.get(reservationId);
      if (!current) throw new TypeError('reservation does not exist');
      reservations.set(reservationId, {
        ...current,
        ...overrides,
        lane:overrides.lane ? { ...current.lane, ...overrides.lane } : current.lane,
      });
    },
  };
}

async function issueAuthenticatedLease(authority, candidateOverrides = {}, snapshot = inventory()) {
  const admission = authority.api.evaluateAdmission(candidate(candidateOverrides), snapshot);
  assert.equal(admission.status, 'ADMITTED');
  return authority.api.issueLease(admission, {
    laneId:candidateOverrides.id ?? 'lane-1618',
    issuedAt:'2026-07-29T14:30:00Z',
    expiresAt:'2026-07-29T15:30:00Z',
    inventorySnapshot:snapshot,
  });
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

  const undefinedIntegration = evaluateConstructionLaneAdmission(candidate(), inventory({
    integrationLane:undefined,
  }));
  assert.equal(undefinedIntegration.status, 'REJECTED');
  assert.deepEqual(undefinedIntegration.reasonCodes, ['INTEGRATION_LANE_INVENTORY_INVALID']);

  const sparseInventory = evaluateConstructionLaneAdmission(candidate(), inventory({
    constructionLanes:new Array(1),
  }));
  assert.equal(sparseInventory.status, 'REJECTED');
  assert.deepEqual(sparseInventory.reasonCodes, ['ACTIVE_LANE_INVENTORY_INVALID']);
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

test('construction lease preserves bounded authority through an atomic reservation', async () => {
  const authority = authorityHarness();
  const currentInventory = inventory();
  const admission = authority.api.evaluateAdmission(candidate(), currentInventory);
  await assert.rejects(() => authority.api.issueLease(admission, {
    laneId:'lane-other',
    issuedAt:'2026-07-29T14:30:00Z',
    expiresAt:'2026-07-29T15:30:00Z',
    inventorySnapshot:currentInventory,
  }), /exactly match/);
  const lease = await authority.api.issueLease(admission, {
    laneId:'lane-1618',
    issuedAt:'2026-07-29T14:30:00Z',
    expiresAt:'2026-07-29T15:30:00Z',
    inventorySnapshot:currentInventory,
  });
  assert.equal(lease.mergeAuthority, false);
  assert.equal(lease.deploymentAuthority, false);
  assert.equal(lease.runtimeMutationAllowed, false);
  assert.equal(lease.reservationId, 'reservation-1');
  assert.deepEqual(lease.ownedPaths, ['shared/notifications/whatsapp']);
  await assert.rejects(() => authority.api.issueLease(admission, {
    laneId:'lane-1618',
    issuedAt:'2026-07-29T14:30:00Z',
    expiresAt:'2026-07-29T15:30:00Z',
    inventorySnapshot:currentInventory,
  }), /already been consumed/);
  await assert.rejects(() => authority.api.issueLease(structuredClone(admission), {
    laneId:'lane-1618',
    issuedAt:'2026-07-29T14:30:00Z',
    expiresAt:'2026-07-29T15:30:00Z',
    inventorySnapshot:currentInventory,
  }), /returned by the evaluator/);

  const overlongInventory = inventory();
  const overlongAdmission = authority.api.evaluateAdmission(candidate(), overlongInventory);
  await assert.rejects(() => authority.api.issueLease(overlongAdmission, {
    laneId:'lane-1618',
    issuedAt:'2026-07-29T14:30:00Z',
    expiresAt:'2026-07-31T14:30:00Z',
    inventorySnapshot:overlongInventory,
  }), /valid bounded timestamp/);

  const staleInventory = inventory();
  const staleAdmission = authority.api.evaluateAdmission(candidate(), staleInventory);
  await assert.rejects(() => authority.api.issueLease(staleAdmission, {
    laneId:'lane-1618',
    issuedAt:'2026-07-29T14:30:00Z',
    expiresAt:'2026-07-29T15:30:00Z',
    inventorySnapshot:inventory({
      constructionLanes:[activeLane({
        ownership:{ paths:['shared/notifications'], contracts:[] },
      })],
    }),
  }), /inventory is stale/);

  const futureInventory = inventory();
  const futureAdmission = authority.api.evaluateAdmission(candidate(), futureInventory);
  await assert.rejects(() => authority.api.issueLease(futureAdmission, {
    laneId:'lane-1618',
    issuedAt:'2099-01-01T00:00:00Z',
    expiresAt:'2099-01-01T01:00:00Z',
    inventorySnapshot:futureInventory,
  }), /trusted issuance clock/);
});

test('concurrent admissions cannot both reserve the same final capacity slot', async () => {
  const authority = authorityHarness();
  const currentInventory = inventory();
  const first = authority.api.evaluateAdmission(candidate(), currentInventory, { maxLanes:1 });
  const second = authority.api.evaluateAdmission(candidate({
    id:'lane-1619',
    goalId:'1619',
    branch:'feat/another-isolated-lane',
    ownership:{ paths:['isolated/other'], contracts:['isolated-other-v1'] },
  }), currentInventory, { maxLanes:1 });
  const options = (laneId) => ({
    laneId,
    issuedAt:'2026-07-29T14:30:00Z',
    expiresAt:'2026-07-29T15:30:00Z',
    inventorySnapshot:currentInventory,
    maxLanes:1,
  });
  const results = await Promise.allSettled([
    authority.api.issueLease(first, options('lane-1618')),
    authority.api.issueLease(second, options('lane-1619')),
  ]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(results.filter(({ status }) => status === 'rejected').length, 1);
  assert.equal(authority.reserveCalls.length, 2);
});

test('ready-for-integration receipt binds authenticated exact-head evidence and records main drift', async () => {
  const authority = authorityHarness();
  const lease = await issueAuthenticatedLease(authority);
  const receipt = await authority.api.createReadyReceipt(lease.reservationId, {
    currentMainSha:SHA_C,
    observedAt:'2026-07-29T14:30:00Z',
    testRefs:[authority.addEvidence('TEST')],
    proofRefs:[authority.addEvidence('PROOF')],
  });
  assert.equal(receipt.status, 'READY_FOR_INTEGRATION');
  assert.equal(receipt.baseSha, SHA_A);
  assert.equal(receipt.headSha, SHA_B);
  assert.equal(receipt.currentMainSha, SHA_C);
  assert.equal(receipt.mainDrifted, true);
  assert.equal(receipt.requiresFreshIntegrationValidation, true);
  assert.equal(receipt.mergeAuthority, false);
});

test('ready-for-integration receipt requires tests, proof and current main', async () => {
  const authority = authorityHarness();
  const lease = await issueAuthenticatedLease(authority);
  await assert.rejects(() => authority.api.createReadyReceipt(lease.reservationId, {
    observedAt:'2026-07-29T14:30:00Z',
    currentMainSha:SHA_C,
    testRefs:[],
    proofRefs:[authority.addEvidence('PROOF')],
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

  const repositoryControlPath = evaluateConstructionLaneAdmission(candidate({
    ownership:{ paths:['.GiT/refs/heads/main'], contracts:[] },
  }), inventory());
  assert.deepEqual(repositoryControlPath.reasonCodes, ['CANDIDATE_CONTRACT_INVALID']);

  const windowsRepositoryControlAlias = evaluateConstructionLaneAdmission(candidate({
    ownership:{ paths:['.git./refs/heads/main'], contracts:[] },
  }), inventory());
  assert.deepEqual(windowsRepositoryControlAlias.reasonCodes, ['CANDIDATE_CONTRACT_INVALID']);

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

test('ready-for-integration evidence is authenticated, exact-head bound and time-valid', async () => {
  const wrongHead = authorityHarness();
  const wrongHeadLease = await issueAuthenticatedLease(wrongHead);
  await assert.rejects(() => wrongHead.api.createReadyReceipt(wrongHeadLease.reservationId, {
    currentMainSha:SHA_C,
    observedAt:'2026-07-29T14:30:00Z',
    testRefs:[wrongHead.addEvidence('TEST', { headSha:SHA_A })],
    proofRefs:[wrongHead.addEvidence('PROOF')],
  }), /exact head/);
  const badTimestamp = authorityHarness();
  const badTimestampLease = await issueAuthenticatedLease(badTimestamp);
  await assert.rejects(() => badTimestamp.api.createReadyReceipt(badTimestampLease.reservationId, {
    currentMainSha:SHA_C,
    observedAt:'2026-07-29T14:30:00Z',
    testRefs:[badTimestamp.addEvidence('TEST', {
      result:{ ...exactEvidence('TEST').result, timestampUtc:'not-a-time' },
    })],
    proofRefs:[badTimestamp.addEvidence('PROOF')],
  }), /exact head/);
  const invalidObserved = authorityHarness();
  const invalidObservedLease = await issueAuthenticatedLease(invalidObserved);
  await assert.rejects(() => invalidObserved.api.createReadyReceipt(invalidObservedLease.reservationId, {
    currentMainSha:SHA_C,
    observedAt:'not-a-time',
    testRefs:[invalidObserved.addEvidence('TEST')],
    proofRefs:[invalidObserved.addEvidence('PROOF')],
  }), /must be valid/);
  const invalidCalendar = authorityHarness();
  const invalidCalendarLease = await issueAuthenticatedLease(invalidCalendar);
  await assert.rejects(() => invalidCalendar.api.createReadyReceipt(invalidCalendarLease.reservationId, {
    currentMainSha:SHA_C,
    observedAt:'2026-02-30T14:45:00Z',
    testRefs:[invalidCalendar.addEvidence('TEST')],
    proofRefs:[invalidCalendar.addEvidence('PROOF')],
  }), /must be valid/);

  const futureObserved = authorityHarness();
  const futureObservedLease = await issueAuthenticatedLease(futureObserved);
  await assert.rejects(() => futureObserved.api.createReadyReceipt(futureObservedLease.reservationId, {
    currentMainSha:SHA_C,
    observedAt:'2099-01-01T00:00:00Z',
    testRefs:[futureObserved.addEvidence('TEST')],
    proofRefs:[futureObserved.addEvidence('PROOF')],
  }), /trusted observation clock/);

  const forged = authorityHarness();
  const forgedLease = await issueAuthenticatedLease(forged);
  await assert.rejects(() => forged.api.createReadyReceipt(forgedLease.reservationId, {
    currentMainSha:SHA_C,
    observedAt:'2026-07-29T14:30:00Z',
    testRefs:[{ ref:'made-up', branch:'feat/whatsapp-merge-ready', headSha:SHA_B }],
    proofRefs:[forged.addEvidence('PROOF')],
  }), /immutable evidence references/);

  const unresolved = authorityHarness();
  const unresolvedLease = await issueAuthenticatedLease(unresolved);
  await assert.rejects(() => unresolved.api.createReadyReceipt(unresolvedLease.reservationId, {
    currentMainSha:SHA_C,
    observedAt:'2026-07-29T14:30:00Z',
    testRefs:['proof/invented-pass.json'],
    proofRefs:[unresolved.addEvidence('PROOF')],
  }), /exact head/);

  const fabricatedLane = authorityHarness();
  await assert.rejects(() => fabricatedLane.api.createReadyReceipt(candidate({
    goalId:'forged-goal',
    baseSha:SHA_C,
    ownership:{ paths:['.github/workflows'], contracts:['forged-authority'] },
  }), {
    currentMainSha:SHA_C,
    observedAt:'2026-07-29T14:30:00Z',
    testRefs:[fabricatedLane.addEvidence('TEST')],
    proofRefs:[fabricatedLane.addEvidence('PROOF')],
  }), /immutable construction-lane reference/);
  await assert.rejects(() => fabricatedLane.api.createReadyReceipt('reservation-invented', {
    currentMainSha:SHA_C,
    observedAt:'2026-07-29T14:30:00Z',
    testRefs:[fabricatedLane.addEvidence('TEST', { ref:'proof/test-invented.json' })],
    proofRefs:[fabricatedLane.addEvidence('PROOF', { ref:'proof/proof-invented.json' })],
  }), /authenticated active exact-head construction lease/);

  let nowUtc = '2026-07-29T14:30:00Z';
  const expiring = authorityHarness({
    nowMs:() => Date.parse(nowUtc),
    onResolveVerifierEvidence:() => { nowUtc = '2026-07-29T16:00:00Z'; },
  });
  const expiringLease = await issueAuthenticatedLease(expiring);
  await assert.rejects(() => expiring.api.createReadyReceipt(expiringLease.reservationId, {
    currentMainSha:SHA_C,
    observedAt:'2026-07-29T16:00:00Z',
    testRefs:[expiring.addEvidence('TEST', { ref:'proof/test-expiring.json' })],
    proofRefs:[expiring.addEvidence('PROOF', { ref:'proof/proof-expiring.json' })],
  }), /authenticated active exact-head construction lease/);
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

test('terminal lane outcomes cannot be converted into readiness receipts', async () => {
  for (const state of ['FAILED', 'CANCELLED', 'SUPERSEDED', 'BLOCKED']) {
    const authority = authorityHarness();
    const lease = await issueAuthenticatedLease(authority);
    authority.updateReservation(lease.reservationId, { lane:{ state } });
    await assert.rejects(() => authority.api.createReadyReceipt(lease.reservationId, {
      currentMainSha:SHA_C,
      observedAt:'2026-07-29T14:30:00Z',
      testRefs:[authority.addEvidence('TEST')],
      proofRefs:[authority.addEvidence('PROOF')],
    }), /authenticated active exact-head construction lease/);
  }
});
