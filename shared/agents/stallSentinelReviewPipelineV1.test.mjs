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
    conclusion: 'success',
    findingsCount: 0,
    artifactDigest: `sha256:${'f'.repeat(64)}`,
    completedAt: '2026-08-08T16:38:00Z',
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

test('self-asserted or payload-tampered Forge readiness never preempts a proven fallback', () => {
  const rawClaims = projection([lane({
    review: {
      independentReviewConclusion: 'failure',
      independentReviewErrorClass: 'API_RATE_LIMIT_EXCEEDED',
      independentReviewAttempt: 2,
      providerNeutralFallbackAvailable: true,
    },
  })], { forgeSidecar: {
    ...forgeSidecar(),
    m2Receipt: { ...forgeSidecar().m2Receipt, payloadSha256: '0'.repeat(64) },
  } });
  assert.equal(rawClaims.forgeSidecar.runtimeReady, false);
  assert.equal(rawClaims.records[0].capacityRoute, STALL_SENTINEL_CAPACITY_ROUTE.PROVIDER_NEUTRAL);
});

test('retry exhaustion selects existing provider-neutral fallback without asking the operator', () => {
  const result = projection([lane({
    review: {
      independentReviewConclusion: 'failure',
      independentReviewErrorClass: 'API_RATE_LIMIT_EXCEEDED',
      independentReviewAttempt: 2,
      providerNeutralFallbackAvailable: true,
    },
  })]);
  const [record] = result.records;
  assert.equal(record.state, STALL_SENTINEL_STATE.STALLED_RECOVERABLE);
  assert.equal(record.exactNextSafeAction, 'ROUTE_EXISTING_EXACT_HEAD_TO_PROVIDER_NEUTRAL_REVIEW_FALLBACK');
  assert.equal(record.capacityRoute, STALL_SENTINEL_CAPACITY_ROUTE.PROVIDER_NEUTRAL);
  assert.equal(record.operatorNotificationRequired, false);
});

test('only bounded recovery exhaustion without a fallback becomes a Captain decision', () => {
  const result = projection([lane({
    review: {
      independentReviewConclusion: 'failure',
      independentReviewErrorClass: 'API_RATE_LIMIT_EXCEEDED',
      independentReviewAttempt: 2,
      providerNeutralFallbackAvailable: false,
    },
  })]);
  const [record] = result.records;
  assert.equal(record.state, STALL_SENTINEL_STATE.CAPTAIN_DECISION);
  assert.equal(record.operatorNotificationRequired, true);
  assert.equal(result.finalVerdict, 'STALL_SENTINEL_CAPTAIN_DECISION_REQUIRED');
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
});

test('only a payload-valid review receipt bound to the live lane advances the gate', () => {
  const valid = projection([lane({ review: { receipt: reviewReceipt() } })]).records[0];
  assert.equal(valid.exactNextSafeAction, 'ADVANCE_EXISTING_EXACT_HEAD_GATE');

  const stale = reviewReceipt({ sourceHead: '9'.repeat(40) });
  const staleResult = projection([lane({ review: { receipt: stale } })]).records[0];
  assert.notEqual(staleResult.exactNextSafeAction, 'ADVANCE_EXISTING_EXACT_HEAD_GATE');

  const arbitrary = projection([lane({ review: { receiptId: 'x' } })]).records[0];
  assert.notEqual(arbitrary.exactNextSafeAction, 'ADVANCE_EXISTING_EXACT_HEAD_GATE');
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
