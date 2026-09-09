import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  STALL_SENTINEL_CAPACITY_ROUTE,
  STALL_SENTINEL_RULE,
  STALL_SENTINEL_STATE,
  projectStallSentinelReviewPipeline,
} from './stallSentinelReviewPipelineV1.mjs';

const NOW = '2026-08-08T16:40:00Z';
const HEAD = 'a'.repeat(40);
const MAIN = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const BASE = 'd'.repeat(40);

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function signedReceipt(core) {
  return {
    ...core,
    payloadSha256: createHash('sha256').update(canonicalJson(core), 'utf8').digest('hex'),
  };
}

function lane(overrides = {}) {
  return {
    goalId: '#1509',
    prNumber: 1706,
    title: 'Add independent Recovery Mesh guardian V1',
    branch: 'fix/battle-bridge-recovery-mesh-guardian-v1',
    headSha: HEAD,
    baseSha: BASE,
    lastMeaningfulActivityAt: '2026-08-08T16:10:00Z',
    sourceChanging: false,
    requiredChecksSuccessful: true,
    reviewRequired: true,
    evidenceRefs: ['actions/run/31266276411'],
    review: {},
    ...overrides,
  };
}

function projection(lanes, overrides = {}) {
  return projectStallSentinelReviewPipeline({
    repository: 'Cheekyfellastef/stephan-os',
    now: NOW,
    lanes,
    receiptTimeoutMs: 10 * 60 * 1000,
    ...overrides,
  });
}

function forgeSidecar(overrides = {}) {
  return {
    goalId: '#1671',
    repository: 'Cheekyfellastef/stephan-os',
    canonicalMainHead: MAIN,
    canonicalMainTree: TREE,
    mirrorHead: MAIN,
    mirrorTree: TREE,
    sourceReady: true,
    m2Receipt: signedReceipt({
      schemaVersion: 'stephanos.forge-shadow-m2-runtime-receipt.v1',
      receiptId: 'forge-m2-runtime-receipt-001',
      repository: 'Cheekyfellastef/stephan-os',
      sourceHead: MAIN,
      sourceTree: TREE,
      mirrorHead: MAIN,
      mirrorTree: TREE,
      operation: 'INSTALL_FORGE_SHADOW_M2',
      state: 'DONE',
      finalVerdict: 'FORGE_SHADOW_M2_READY',
      completedAt: '2026-08-08T16:30:00Z',
      proofRefs: ['receipts/forge/m2-001.json'],
    }),
    m3RuntimeReceipt: signedReceipt({
      schemaVersion: 'stephanos.forge-shadow-m3-runner-runtime-receipt.v1',
      receiptId: 'forge-m3-runtime-receipt-001',
      repository: 'Cheekyfellastef/stephan-os',
      sourceHead: MAIN,
      sourceTree: TREE,
      artifactSetDigest: `sha256:${'e'.repeat(64)}`,
      runnerIdentities: ['stephanos-forge-linux-runner-01', 'stephanos-forge-windows-proof-runner-01'],
      linuxReviewRunnerConnected: true,
      windowsProofRunnerConnected: true,
      teardownComplete: true,
      zeroResidualRegistration: true,
      zeroResidualCredential: true,
      zeroResidualWorkspace: true,
      canCarryRealWork: true,
      finalVerdict: 'FORGE_SHADOW_M3_RUNNER_RUNTIME_READY',
      completedAt: '2026-08-08T16:35:00Z',
      proofRefs: ['receipts/forge/m3-001.json'],
    }),
    evidenceRefs: ['receipts/forge/m2-001.json', 'receipts/forge/m3-001.json'],
    ...overrides,
  };
}

function reviewReceipt(overrides = {}) {
  return signedReceipt({
    schemaVersion: 'stephanos.independent-review-route-receipt.v1',
    receiptId: 'independent-review-receipt-001',
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 1706,
    branch: 'fix/battle-bridge-recovery-mesh-guardian-v1',
    sourceHead: HEAD,
    baseSha: BASE,
    reviewClass: 'independent-exact-head',
    conclusion: 'success',
    findingsCount: 0,
    artifactDigest: `sha256:${'f'.repeat(64)}`,
    completedAt: '2026-08-08T16:38:00Z',
    ...overrides,
  });
}

function providerNeutralCapacityReceipt(overrides = {}) {
  return signedReceipt({
    schemaVersion: 'stephanos.provider-neutral-review-capacity-receipt.v1',
    receiptId: 'provider-neutral-capacity-receipt-001',
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 1706,
    branch: 'fix/battle-bridge-recovery-mesh-guardian-v1',
    sourceHead: HEAD,
    baseSha: BASE,
    reviewClass: 'external-qualified',
    supportedOperations: ['EXACT_HEAD_INDEPENDENT_REVIEW'],
    completedAt: '2026-08-08T16:38:00Z',
    expiresAt: '2026-08-08T17:38:00Z',
    evidenceRefs: ['receipts/provider-neutral/capacity-001.json'],
    ...overrides,
  });
}

test('detects a green verification workflow whose coordinate job was skipped', () => {
  const result = projection([lane({
    review: { coordinatorWorkflowConclusion: 'success', coordinateJobConclusion: 'skipped' },
  })]);
  const [record] = result.records;
  assert.equal(record.detectedRule, STALL_SENTINEL_RULE.GREEN_COORDINATOR_SKIPPED);
  assert.equal(record.state, STALL_SENTINEL_STATE.STALLED_RECOVERABLE);
  assert.equal(record.exactNextSafeAction, 'TRIGGER_RESOURCE_SCOPED_COORDINATION_FOR_EVENT_PR');
  assert.equal(record.operatorNotificationRequired, false);
});

test('detects a dispatch with no matching receipt after the bounded window', () => {
  const result = projection([lane({
    review: { dispatchCommentId: 5226946191, dispatchAt: '2026-08-08T16:20:00Z' },
  })]);
  const [record] = result.records;
  assert.equal(record.detectedRule, STALL_SENTINEL_RULE.REVIEW_DISPATCH_NO_RECEIPT);
  assert.equal(record.state, STALL_SENTINEL_STATE.STALLED_RECOVERABLE);
  assert.match(record.exactNextSafeAction, /WITHOUT_DUPLICATE_DISPATCH/);
});

test('rejects incomplete dispatch identity instead of waiting forever', () => {
  assert.equal(projection([lane({ review: { dispatchCommentId: 5226946191 } })]).valid, false);
  assert.equal(projection([lane({ review: { dispatchAt: '2026-08-08T16:20:00Z' } })]).valid, false);
  assert.equal(projection([lane({
    review: { dispatchCommentId: 'not-an-id', dispatchAt: '2026-08-08T16:20:00Z' },
  })]).valid, false);
  assert.equal(projection([lane({
    review: { dispatchCommentId: '5226946191', dispatchAt: '2026-08-08T16:20:00Z' },
  })]).valid, false);
});

test('rate-limited review without artifact schedules one retry after quota reset', () => {
  const result = projection([lane({
    prNumber: 1711,
    title: 'Fix Recovery Mesh guardian review routing',
    branch: 'agent/fix-recovery-guardian-review-routing-v1',
    review: {
      independentReviewConclusion: 'failure',
      independentReviewErrorClass: 'API_RATE_LIMIT_EXCEEDED',
      independentReviewAttempt: 1,
      rateLimitResetAt: '2026-08-08T17:00:00Z',
    },
  })]);
  const [record] = result.records;
  assert.equal(record.detectedRule, STALL_SENTINEL_RULE.REVIEW_RATE_LIMIT_NO_ARTIFACT);
  assert.equal(record.state, STALL_SENTINEL_STATE.STALLED_RECOVERABLE);
  assert.equal(record.exactNextSafeAction, 'RERUN_FAILED_REVIEW_JOB_ONCE_AFTER_RATE_LIMIT_RESET');
  assert.equal(record.capacityRoute, STALL_SENTINEL_CAPACITY_ROUTE.QUOTA_RETRY);
  assert.equal(record.notBefore, '2026-08-08T17:00:00.000Z');
  assert.equal(record.operatorNotificationRequired, false);
});

test('proven Forge runtime preempts quota waiting and takes the exact-head review', () => {
  const result = projection([lane({
    review: {
      independentReviewConclusion: 'failure',
      independentReviewErrorClass: 'API_RATE_LIMIT_EXCEEDED',
      independentReviewAttempt: 1,
      rateLimitResetAt: '2026-08-08T17:00:00Z',
    },
  })], { forgeSidecar: forgeSidecar() });
  const [record] = result.records;
  assert.equal(record.state, STALL_SENTINEL_STATE.STALLED_RECOVERABLE);
  assert.equal(record.capacityRoute, STALL_SENTINEL_CAPACITY_ROUTE.FORGE_SIDECAR);
  assert.equal(record.exactNextSafeAction, 'ROUTE_EXISTING_EXACT_HEAD_TO_PROVEN_FORGE_REVIEW_CAPACITY');
  assert.equal(record.notBefore, null);
  assert.equal(result.forgeSidecar.runtimeReady, true);
  assert.equal(result.summary.forgeRouted, 1);
});

test('Forge M2 and M3 cannot share one receipt identity', () => {
  const sidecar = forgeSidecar();
  const m3Core = { ...sidecar.m3RuntimeReceipt,
    receiptId:sidecar.m2Receipt.receiptId };
  delete m3Core.payloadSha256;
  const result = projection([lane({
    review: {
      independentReviewConclusion: 'failure',
      independentReviewErrorClass: 'API_RATE_LIMIT_EXCEEDED',
      independentReviewAttempt: 2,
    },
  })], { forgeSidecar:forgeSidecar({ m3RuntimeReceipt:signedReceipt(m3Core) }) });
  assert.equal(result.forgeSidecar.m2ReceiptValid, true);
  assert.equal(result.forgeSidecar.m3RuntimeReceiptValid, true);
  assert.equal(result.forgeSidecar.m2ReceiptId, result.forgeSidecar.m3RuntimeReceiptId);
  assert.equal(result.forgeSidecar.runtimeReady, false);
  assert.equal(result.forgeSidecar.canCarryRealWork, false);
  assert.equal(result.forgeSidecar.activationRequired, true);
  assert.equal(result.summary.forgeRouted, 0);
  assert.equal(result.records[0].capacityRoute, STALL_SENTINEL_CAPACITY_ROUTE.FORGE_ACTIVATION);
});

test('source-ready Forge without runtime receipts is activated but never reported available', () => {
  const result = projection([lane({
    review: {
      independentReviewConclusion: 'failure',
      independentReviewErrorClass: 'API_RATE_LIMIT_EXCEEDED',
      independentReviewAttempt: 2,
    },
  })], { forgeSidecar: forgeSidecar({
    m2Receipt: null,
    m3RuntimeReceipt: null,
    evidenceRefs: [],
  }) });
  const [record] = result.records;
  assert.equal(result.forgeSidecar.sourceReady, true);
  assert.equal(result.forgeSidecar.runtimeReady, false);
  assert.equal(result.forgeSidecar.activationRequired, true);
  assert.equal(record.capacityRoute, STALL_SENTINEL_CAPACITY_ROUTE.FORGE_ACTIVATION);
  assert.equal(record.exactNextSafeAction, 'ACTIVATE_EXISTING_FORGE_SIDECAR_AND_CONTINUE_NONCONFLICTING_LOCAL_CONSTRUCTION');
  assert.equal(record.operatorNotificationRequired, false);
  assert.equal(result.summary.forgeActivationRequired, 1);
});

test('payload-tampered Forge readiness never preempts a receipt-proven fallback', () => {
  const rawClaims = projection([lane({
    review: {
      independentReviewConclusion: 'failure',
      independentReviewErrorClass: 'API_RATE_LIMIT_EXCEEDED',
      independentReviewAttempt: 2,
      providerNeutralCapacityReceipt: providerNeutralCapacityReceipt(),
    },
  })], { forgeSidecar: {
    ...forgeSidecar(),
    m2Receipt: { ...forgeSidecar().m2Receipt, payloadSha256: '0'.repeat(64) },
  } });
  assert.equal(rawClaims.forgeSidecar.runtimeReady, false);
  assert.equal(rawClaims.records[0].capacityRoute, STALL_SENTINEL_CAPACITY_ROUTE.PROVIDER_NEUTRAL);

  const unboundEvidence = projection([lane({ review: {
    independentReviewConclusion: 'failure',
    independentReviewErrorClass: 'API_RATE_LIMIT_EXCEEDED',
    independentReviewAttempt: 2,
  } })], { forgeSidecar: forgeSidecar({ evidenceRefs: ['receipts/forge/m2-001.json'] }) });
  assert.equal(unboundEvidence.forgeSidecar.runtimeReady, false);
  assert.equal(unboundEvidence.forgeSidecar.evidenceBound, false);
});

test('retry exhaustion selects existing provider-neutral fallback without asking the operator', () => {
  const result = projection([lane({
    review: {
      independentReviewConclusion: 'failure',
      independentReviewErrorClass: 'API_RATE_LIMIT_EXCEEDED',
      independentReviewAttempt: 2,
      providerNeutralCapacityReceipt: providerNeutralCapacityReceipt(),
    },
  })]);
  const [record] = result.records;
  assert.equal(record.state, STALL_SENTINEL_STATE.STALLED_RECOVERABLE);
  assert.equal(record.exactNextSafeAction, 'ROUTE_EXISTING_EXACT_HEAD_TO_PROVIDER_NEUTRAL_REVIEW_FALLBACK');
  assert.equal(record.capacityRoute, STALL_SENTINEL_CAPACITY_ROUTE.PROVIDER_NEUTRAL);
  assert.equal(record.operatorNotificationRequired, false);
});

test('provider-neutral fallback requires a fresh payload-valid receipt bound to the live lane', () => {
  const baseReview = {
    independentReviewConclusion: 'failure',
    independentReviewErrorClass: 'API_RATE_LIMIT_EXCEEDED',
    independentReviewAttempt: 2,
  };
  const selfAsserted = projection([lane({ review: {
    ...baseReview,
    providerNeutralFallbackAvailable: true,
    providerNeutralFallbackReceiptId: 'provider-neutral-capacity-receipt-001',
  } })]).records[0];
  assert.equal(selfAsserted.capacityRoute, STALL_SENTINEL_CAPACITY_ROUTE.CAPTAIN_DECISION);

  for (const receipt of [
    providerNeutralCapacityReceipt({ sourceHead: '9'.repeat(40) }),
    providerNeutralCapacityReceipt({ prNumber: 1707 }),
    providerNeutralCapacityReceipt({ prNumber: '1706' }),
    providerNeutralCapacityReceipt({ completedAt: '2026-08-07T16:39:59Z' }),
    { ...providerNeutralCapacityReceipt(), payloadSha256: '0'.repeat(64) },
  ]) {
    const record = projection([lane({ review: {
      ...baseReview,
      providerNeutralCapacityReceipt: receipt,
    } })]).records[0];
    assert.equal(record.capacityRoute, STALL_SENTINEL_CAPACITY_ROUTE.CAPTAIN_DECISION);
  }
});

test('only bounded recovery exhaustion without a fallback becomes a Captain decision', () => {
  const result = projection([lane({
    review: {
      independentReviewConclusion: 'failure',
      independentReviewErrorClass: 'API_RATE_LIMIT_EXCEEDED',
      independentReviewAttempt: 2,
    },
  })]);
  const [record] = result.records;
  assert.equal(record.state, STALL_SENTINEL_STATE.CAPTAIN_DECISION);
  assert.equal(record.operatorNotificationRequired, true);
  assert.equal(result.finalVerdict, 'STALL_SENTINEL_CAPTAIN_DECISION_REQUIRED');
});

test('quota retry requires an explicit numeric first attempt', () => {
  for (const independentReviewAttempt of [undefined, 0, '1', 'malformed', -1, 2]) {
    const review = {
      independentReviewConclusion: 'failure',
      independentReviewErrorClass: 'API_RATE_LIMIT_EXCEEDED',
      rateLimitResetAt: '2026-08-08T17:00:00Z',
    };
    if (independentReviewAttempt !== undefined) review.independentReviewAttempt = independentReviewAttempt;
    const [record] = projection([lane({ review })]).records;
    assert.notEqual(record.capacityRoute, STALL_SENTINEL_CAPACITY_ROUTE.QUOTA_RETRY);
    assert.equal(record.capacityRoute, STALL_SENTINEL_CAPACITY_ROUTE.CAPTAIN_DECISION);
  }
});

test('attempt-one retry remains eligible after reset and runs immediately', () => {
  const [record] = projection([lane({
    review: {
      independentReviewConclusion: 'failure',
      independentReviewErrorClass: 'API_RATE_LIMIT_EXCEEDED',
      independentReviewAttempt: 1,
      rateLimitResetAt: '2026-08-08T16:30:00Z',
    },
  })]).records;
  assert.equal(record.capacityRoute, STALL_SENTINEL_CAPACITY_ROUTE.QUOTA_RETRY);
  assert.equal(record.state, STALL_SENTINEL_STATE.STALLED_RECOVERABLE);
  assert.equal(record.notBefore, null);
});

test('stale Forge receipts and missing teardown cannot claim runtime capacity', () => {
  const staleM3 = signedReceipt({
    ...Object.fromEntries(Object.entries(forgeSidecar().m3RuntimeReceipt).filter(([key]) => key !== 'payloadSha256')),
    completedAt: '2026-08-07T16:39:59Z',
  });
  const stale = projection([lane({ review: {
    independentReviewConclusion: 'failure',
    independentReviewErrorClass: 'API_RATE_LIMIT_EXCEEDED',
    independentReviewAttempt: 2,
  } })], { forgeSidecar: forgeSidecar({ m3RuntimeReceipt: staleM3 }) });
  assert.equal(stale.forgeSidecar.runtimeReady, false);

  const noTeardown = signedReceipt({
    ...Object.fromEntries(Object.entries(forgeSidecar().m3RuntimeReceipt).filter(([key]) => key !== 'payloadSha256')),
    teardownComplete: false,
  });
  const missingTeardown = projection([lane({ review: {
    independentReviewConclusion: 'failure',
    independentReviewErrorClass: 'API_RATE_LIMIT_EXCEEDED',
    independentReviewAttempt: 2,
  } })], { forgeSidecar: forgeSidecar({ m3RuntimeReceipt: noTeardown }) });
  assert.equal(missingTeardown.forgeSidecar.runtimeReady, false);
});

test('active source movement and bounded receipt waiting are not false-positive stalls', () => {
  const active = projection([lane({ sourceChanging: true })]).records[0];
  assert.equal(active.state, STALL_SENTINEL_STATE.ACTIVE);
  assert.equal(active.detectedRule, STALL_SENTINEL_RULE.NONE);

  const waiting = projection([lane({
    review: { dispatchCommentId: 99, dispatchAt: '2026-08-08T16:35:00Z' },
  })]).records[0];
  assert.equal(waiting.state, STALL_SENTINEL_STATE.WATCHING);
  assert.equal(waiting.detectedRule, STALL_SENTINEL_RULE.NONE);
});

test('a stationary checked lane advances immediately when review is not required', () => {
  const [record] = projection([lane({ reviewRequired: false })]).records;
  assert.equal(record.state, STALL_SENTINEL_STATE.ACTIVE);
  assert.equal(record.exactNextSafeAction, 'ADVANCE_WITHOUT_REVIEW');

  const [waiting] = projection([lane({ reviewRequired: false, requiredChecksSuccessful: false })]).records;
  assert.equal(waiting.state, STALL_SENTINEL_STATE.WATCHING);
  assert.equal(waiting.exactNextSafeAction, 'WAIT_FOR_REQUIRED_EXACT_HEAD_CHECKS');
});

test('repeated scans observe one existing idempotent recovery instead of duplicating it', () => {
  const first = projection([lane({
    review: { coordinatorWorkflowConclusion: 'success', coordinateJobConclusion: 'skipped' },
  })]);
  const recoveryKey = first.records[0].recoveryKey;
  const repeated = projection([lane({
    review: { coordinatorWorkflowConclusion: 'success', coordinateJobConclusion: 'skipped' },
  })], { existingRecoveryKeys: [recoveryKey] });
  assert.equal(repeated.records[0].state, STALL_SENTINEL_STATE.WATCHING);
  assert.equal(repeated.records[0].recoveryAlreadyRecorded, true);
  assert.equal(repeated.records[0].duplicateRecoveryAllowed, false);
  assert.equal(repeated.records[0].exactNextSafeAction, 'OBSERVE_EXISTING_IDEMPOTENT_RECOVERY');
});

test('idempotency distinguishes a later higher-priority recovery route', () => {
  const rateLimitedLane = lane({
    review: {
      independentReviewConclusion: 'failure',
      independentReviewErrorClass: 'API_RATE_LIMIT_EXCEEDED',
      independentReviewAttempt: 1,
      rateLimitResetAt: '2026-08-08T17:00:00Z',
    },
  });
  const quota = projection([rateLimitedLane]).records[0];
  const forged = projection([rateLimitedLane], {
    forgeSidecar: forgeSidecar(),
    existingRecoveryKeys: [quota.recoveryKey],
  }).records[0];
  assert.equal(forged.capacityRoute, STALL_SENTINEL_CAPACITY_ROUTE.FORGE_SIDECAR);
  assert.equal(forged.state, STALL_SENTINEL_STATE.STALLED_RECOVERABLE);
  assert.equal(forged.recoveryAlreadyRecorded, false);
  assert.notEqual(forged.recoveryKey, quota.recoveryKey);
  assert.equal(forged.recoveryEvidenceIdentity, 'forge-m2-runtime-receipt-001:forge-m3-runtime-receipt-001');
});

test('idempotency is bound to the validated provider-neutral receipt identity', () => {
  const baseReview = {
    independentReviewConclusion: 'failure',
    independentReviewErrorClass: 'API_RATE_LIMIT_EXCEEDED',
    independentReviewAttempt: 2,
  };
  const firstLane = lane({ review: {
    ...baseReview,
    providerNeutralCapacityReceipt: providerNeutralCapacityReceipt(),
  } });
  const first = projection([firstLane]).records[0];
  const nextReceipt = providerNeutralCapacityReceipt({
    receiptId: 'provider-neutral-capacity-receipt-002',
    evidenceRefs: ['receipts/provider-neutral/capacity-002.json'],
  });
  const second = projection([lane({ review: {
    ...baseReview,
    providerNeutralCapacityReceipt: nextReceipt,
  } })], { existingRecoveryKeys: [first.recoveryKey] }).records[0];
  assert.equal(second.capacityRoute, STALL_SENTINEL_CAPACITY_ROUTE.PROVIDER_NEUTRAL);
  assert.equal(second.recoveryEvidenceIdentity, 'provider-neutral-capacity-receipt-002');
  assert.equal(second.recoveryAlreadyRecorded, false);
  assert.notEqual(second.recoveryKey, first.recoveryKey);
});

test('only a payload-valid review receipt bound to the live lane advances the gate', () => {
  const valid = projection([lane({ review: { receipt: reviewReceipt() } })]).records[0];
  assert.equal(valid.exactNextSafeAction, 'ADVANCE_EXISTING_EXACT_HEAD_GATE');

  const stale = reviewReceipt({ sourceHead: '9'.repeat(40) });
  const staleResult = projection([lane({ review: { receipt: stale } })]).records[0];
  assert.notEqual(staleResult.exactNextSafeAction, 'ADVANCE_EXISTING_EXACT_HEAD_GATE');

  const arbitrary = projection([lane({ review: { receiptId: 'x' } })]).records[0];
  assert.notEqual(arbitrary.exactNextSafeAction, 'ADVANCE_EXISTING_EXACT_HEAD_GATE');

  const wrongBase = reviewReceipt({ baseSha: '8'.repeat(40) });
  assert.notEqual(
    projection([lane({ review: { receipt: wrongBase } })]).records[0].exactNextSafeAction,
    'ADVANCE_EXISTING_EXACT_HEAD_GATE',
  );

  const wrongClass = reviewReceipt({ reviewClass: 'generic' });
  assert.notEqual(
    projection([lane({ review: { receipt: wrongClass } })]).records[0].exactNextSafeAction,
    'ADVANCE_EXISTING_EXACT_HEAD_GATE',
  );
});

test('records remain title-first, exact-head bound and authority-free', () => {
  const result = projection([lane()]);
  assert.equal(result.valid, true);
  assert.equal(result.records[0].prReference, 'PR #1706 — Add independent Recovery Mesh guardian V1');
  assert.equal(result.records[0].liveHeadSha, HEAD);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.deploymentAuthority, false);
  assert.equal(result.runtimeMutationAllowed, false);
  assert.equal(result.arbitraryShellAllowed, false);
});

test('fails closed on malformed, duplicate, sparse or oversized lane evidence', () => {
  assert.equal(projectStallSentinelReviewPipeline().valid, false);
  assert.equal(projection([lane({ headSha: 'short' })]).valid, false);
  assert.equal(projection([lane({ baseSha: 'short' })]).valid, false);
  assert.equal(projection([lane(), lane()]).valid, false);
  const sparse = [];
  sparse[1] = lane();
  assert.equal(projection(sparse).valid, false);
  assert.equal(projection(Array.from({ length: 51 }, (_, index) => lane({
    prNumber: index + 1,
    title: `Lane ${index + 1}`,
    branch: `agent/lane-${index + 1}`,
  }))).valid, false);
  assert.equal(projection([lane()], { forgeSidecar: forgeSidecar({ mirrorHead: 'c'.repeat(39) }) }).valid, false);
  assert.equal(projection([lane()], { forgeSidecar: forgeSidecar({ repository: 'other/repository' }) }).valid, false);
  assert.equal(projection([lane()], { forgeSidecar: forgeSidecar({ evidenceRefs: ['https://unsafe.example/proof'] }) }).valid, false);
});
