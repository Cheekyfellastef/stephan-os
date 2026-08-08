import assert from 'node:assert/strict';
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
    canonicalMainHead: MAIN,
    mirrorHead: MAIN,
    sourceReady: true,
    m2Verdict: 'FORGE_SHADOW_M2_READY',
    m2ReceiptId: 'forge-m2-runtime-receipt-001',
    m3RuntimeReceiptSchema: 'stephanos.forge-shadow-m3-runner-runtime-receipt.v1',
    m3RuntimeVerdict: 'FORGE_SHADOW_M3_RUNNER_RUNTIME_READY',
    m3RuntimeReceiptId: 'forge-m3-runtime-receipt-001',
    linuxReviewRunnerConnected: true,
    windowsProofRunnerConnected: true,
    canCarryRealWork: true,
    evidenceRefs: ['receipts/forge/m2-001.json', 'receipts/forge/m3-001.json'],
    ...overrides,
  };
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
    m2Verdict: '',
    m2ReceiptId: '',
    m3RuntimeReceiptSchema: '',
    m3RuntimeVerdict: '',
    m3RuntimeReceiptId: '',
    linuxReviewRunnerConnected: false,
    windowsProofRunnerConnected: false,
    canCarryRealWork: false,
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
  assert.equal(projection([lane()], { forgeSidecar: forgeSidecar({ evidenceRefs: ['https://unsafe.example/proof'] }) }).valid, false);
});
