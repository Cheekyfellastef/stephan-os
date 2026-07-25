import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionReceipt, EXECUTION_RECEIPT_SCHEMA_VERSION } from './executionReceiptV1.mjs';
import {
  buildGuardedRepairDeduplicationKey,
  evaluateGuardedRepairLoop,
  routeGuardedRepairWorker,
} from './guardedGoalRunnerRepairLoopV1.mjs';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const BRANCH = 'fix/goal-dashboard-truth';
const NOW = '2026-07-25T12:00:00.000Z';
const FINDINGS = [
  { id: 'P2-source-label', severity: 'P2', type: 'review_finding', bounded: true, file: 'shared/runtime/goalDashboardStatusProjection.mjs' },
  { id: 'P2-receipt-binding', severity: 'P2', type: 'review_finding', bounded: true, file: 'shared/runtime/goalDashboardStatusProjection.test.mjs' },
];

function input(overrides = {}) {
  return {
    repository: 'cheekyfellastef/stephan-os',
    issueNumber: 1385,
    prNumber: 1582,
    branch: BRANCH,
    baseSha: BASE,
    expectedBaseSha: BASE,
    headSha: HEAD,
    proofHeadSha: HEAD,
    activeLaneKnown: true,
    currentPrCount: 1,
    proofAvailable: true,
    findingsEvidenceAvailable: true,
    findings: FINDINGS,
    receiptTimestampUtc: NOW,
    receiptHeartbeatExpiresAtUtc: '2026-07-25T12:02:00.000Z',
    proofRefs: ['proofs/pr-1582-review'],
    allowedTests: ['node --test shared/runtime/goalDashboardStatusProjection.test.mjs'],
    workerAvailability: { githubFirstAvailable: true },
    ...overrides,
  };
}

function admitted(overrides = {}) {
  return evaluateGuardedRepairLoop(input(overrides));
}

function canonicalReceipt(order, state, overrides = {}) {
  return createExecutionReceipt({
    repository: order.repository,
    issueNumber: order.issueNumber,
    prNumber: order.prNumber,
    branch: order.branch,
    sourceHead: order.headSha,
    workerId: `worker-${order.worker.workerType}`,
    workerType: order.worker.workerType,
    executionId: order.executionId,
    leaseKey: order.leaseKey,
    state,
    phase: state,
    sequence: 1,
    timestampUtc: NOW,
    heartbeatExpiresAtUtc: '2026-07-25T12:02:00.000Z',
    blocker: state === 'stalled' ? 'WAITING_EXTERNAL_PROOF' : '',
    operatorActionRequired: false,
    proofRefs: ['proofs/pr-1582-review'],
    expectedNextAction: ['completed', 'failed', 'cancelled'].includes(state) ? '' : 'Continue bounded repair.',
    ...overrides,
  });
}

test('deduplication key is exact-head and unambiguously finding-set bound', () => {
  const first = buildGuardedRepairDeduplicationKey(input());
  const reordered = buildGuardedRepairDeduplicationKey(input({ findings: [...FINDINGS].reverse() }));
  const moved = buildGuardedRepairDeduplicationKey(input({ headSha: 'c'.repeat(40) }));
  const commaA = buildGuardedRepairDeduplicationKey(input({ findings: [{ id: 'a,b', severity: 'P1', bounded: true }, { id: 'c', severity: 'P1', bounded: true }] }));
  const commaB = buildGuardedRepairDeduplicationKey(input({ findings: [{ id: 'a', severity: 'P1', bounded: true }, { id: 'b,c', severity: 'P1', bounded: true }] }));
  assert.equal(first, reordered);
  assert.notEqual(first, moved);
  assert.notEqual(commaA, commaB);
});

test('new repair prepares the canonical queued receipt and does not claim execution', () => {
  const result = admitted();
  assert.equal(result.verdict, 'known-blocker-repair-admitted');
  assert.equal(result.nextAction, 'PERSIST_CANONICAL_RECEIPT_THEN_ROUTE_WORKER');
  assert.equal(result.nextReceipt.schemaVersion, EXECUTION_RECEIPT_SCHEMA_VERSION);
  assert.equal(result.nextReceipt.state, 'queued');
  assert.equal(result.nextReceipt.repository, result.repairOrder.repository);
  assert.equal(result.nextReceipt.prNumber, result.repairOrder.prNumber);
  assert.equal(result.nextReceipt.sourceHead, HEAD);
  assert.equal(result.nextReceipt.executionId, result.repairOrder.executionId);
});

test('ad-hoc historical repair objects cannot establish active execution', () => {
  const first = admitted();
  const result = admitted({
    activeRepairOrders: [first.repairOrder],
    receipts: [{ state: 'repair_started', repairOrderId: first.repairOrder.repairOrderId, deduplicationKey: first.repairOrder.deduplicationKey, headSha: HEAD, workerTaskId: 'task-1582' }],
  });
  assert.equal(result.verdict, 'known-blocker-repair-admitted');
  assert.equal(result.nextAction, 'ROUTE_OR_FAIL_OVER_WORKER');
});

test('only an exact-bound canonical accepted or started receipt establishes active execution', () => {
  const first = admitted();
  for (const state of ['accepted', 'started', 'progress']) {
    const receipt = canonicalReceipt(first.repairOrder, state);
    const result = admitted({ activeRepairOrders: [first.repairOrder], receipts: [receipt] });
    assert.equal(result.verdict, 'repair-already-active', state);
    assert.equal(result.executionReceipt.state, state);
  }

  const wrongHead = canonicalReceipt(first.repairOrder, 'started', { sourceHead: 'c'.repeat(40) });
  const rejected = admitted({ activeRepairOrders: [first.repairOrder], receipts: [wrongHead] });
  assert.equal(rejected.verdict, 'known-blocker-repair-admitted');
});

test('canonical stalled and terminal states remain distinct from active execution', () => {
  const first = admitted();
  const stalled = admitted({ activeRepairOrders: [first.repairOrder], receipts: [canonicalReceipt(first.repairOrder, 'stalled')] });
  assert.equal(stalled.verdict, 'repair-stalled');

  const failed = admitted({ activeRepairOrders: [first.repairOrder], receipts: [canonicalReceipt(first.repairOrder, 'failed')] });
  assert.equal(failed.verdict, 'known-blocker-repair-admitted');
  assert.equal(failed.nextAction, 'ROUTE_OR_FAIL_OVER_WORKER');
});

test('same-head finding-set changes wait for canonical terminal evidence', () => {
  const first = admitted();
  const changedFindings = [...FINDINGS, { id: 'P1-new-review', severity: 'P1', bounded: true, file: 'shared/agents/guardedGoalRunnerRepairLoopV1.mjs' }];
  const blocked = admitted({
    findings: changedFindings,
    activeRepairOrders: [first.repairOrder],
    receipts: [canonicalReceipt(first.repairOrder, 'started')],
  });
  assert.equal(blocked.verdict, 'abort-active-finding-set-change');

  const reconciled = admitted({
    findings: changedFindings,
    activeRepairOrders: [first.repairOrder],
    receipts: [canonicalReceipt(first.repairOrder, 'cancelled')],
  });
  assert.equal(reconciled.verdict, 'known-blocker-repair-admitted');
});

test('head movement waits for canonical terminal evidence from every prior order', () => {
  const first = admitted();
  const nextHead = 'd'.repeat(40);
  const waiting = admitted({ headSha: nextHead, proofHeadSha: nextHead, activeRepairOrders: [first.repairOrder], receipts: [canonicalReceipt(first.repairOrder, 'started')] });
  assert.equal(waiting.verdict, 'abort-stale-worker-active');

  const released = admitted({ headSha: nextHead, proofHeadSha: nextHead, activeRepairOrders: [first.repairOrder], receipts: [canonicalReceipt(first.repairOrder, 'cancelled')] });
  assert.equal(released.verdict, 'known-blocker-repair-admitted');
});

test('review, merge approval and completion fail closed without a completed canonical receipt', () => {
  const first = admitted();
  const missing = admitted({ findings: [], ciGreen: true, mergeable: true, activeRepairOrders: [first.repairOrder], receipts: [canonicalReceipt(first.repairOrder, 'progress')] });
  assert.equal(missing.verdict, 'abort-missing-canonical-receipt');

  const complete = canonicalReceipt(first.repairOrder, 'completed');
  const ready = admitted({ findings: [], ciGreen: true, mergeable: true, activeRepairOrders: [first.repairOrder], receipts: [complete] });
  assert.equal(ready.verdict, 'safe-to-merge-with-expected-head');
  assert.equal(ready.nextAction, 'REQUEST_EXACT_HEAD_MERGE_APPROVAL');

  const green = admitted({ findings: [], merged: true, ciGreen: true, runtimeProofRequired: false, activeRepairOrders: [first.repairOrder], receipts: [complete] });
  assert.equal(green.verdict, 'goal-green');
});

test('canonical receipt identity mismatches fail closed', () => {
  const first = admitted();
  const mismatches = [
    { repository: 'other/repo' },
    { issueNumber: 9999 },
    { prNumber: 9999 },
    { branch: 'other/branch' },
    { sourceHead: 'c'.repeat(40) },
    { executionId: 'other-execution' },
    { leaseKey: 'other-lease' },
  ];
  for (const mismatch of mismatches) {
    const result = admitted({ activeRepairOrders: [first.repairOrder], receipts: [canonicalReceipt(first.repairOrder, 'started', mismatch)] });
    assert.notEqual(result.verdict, 'repair-already-active', JSON.stringify(mismatch));
  }
});

test('safety gates fail closed when lane evidence is missing or contradictory', () => {
  assert.equal(admitted({ branch: undefined }).verdict, 'abort-missing-proof');
  assert.equal(admitted({ expectedBaseSha: 'c'.repeat(40) }).verdict, 'abort-stale-base');
  assert.equal(admitted({ currentPrCount: 2 }).verdict, 'abort-conflicting-pr');
  assert.equal(admitted({ proofAvailable: false }).verdict, 'abort-missing-proof');
  assert.equal(admitted({ proofHeadSha: 'c'.repeat(40) }).verdict, 'abort-missing-proof');
  assert.equal(admitted({ findingsEvidenceAvailable: false }).verdict, 'abort-missing-proof');
  assert.equal(admitted({ findings: [{ severity: 'P1', bounded: true }] }).verdict, 'abort-missing-proof');
  assert.equal(admitted({ repeatedBlockerCount: 2 }).verdict, 'abort-repeated-blocker');
  assert.equal(admitted({ findings: [{ ...FINDINGS[0], bounded: false }] }).verdict, 'abort-unknown-blocker');
  assert.equal(admitted({ findings: [{ ...FINDINGS[0], operatorJudgmentRequired: true }] }).verdict, 'abort-operator-judgment-required');
});

test('worker routing requires positive availability evidence and maps to canonical worker types', () => {
  assert.deepEqual(routeGuardedRepairWorker({ githubFirstAvailable: true }).workerType, 'github-first');
  assert.equal(routeGuardedRepairWorker({}).route, 'BLOCKED_UNSAFE_OR_UNKNOWN');
  assert.equal(routeGuardedRepairWorker({ githubFirstAvailable: false, remoteCodexAvailable: true }).workerType, 'remote-codex');
  assert.equal(routeGuardedRepairWorker({ githubFirstAvailable: false, openClawAvailable: true }).workerType, 'openclaw');
});

test('runtime proof remains behind completed implementation, merge and exact-head approval', () => {
  const first = admitted();
  const complete = canonicalReceipt(first.repairOrder, 'completed');
  const preMerge = admitted({ findings: [], ciGreen: true, mergeable: true, runtimeProofRequired: true, runtimeProofGreen: true, activeRepairOrders: [first.repairOrder], receipts: [complete] });
  assert.equal(preMerge.verdict, 'safe-to-merge-with-expected-head');

  const waiting = admitted({ findings: [], merged: true, ciGreen: true, runtimeProofRequired: true, runtimeProofGreen: false, activeRepairOrders: [first.repairOrder], receipts: [complete] });
  assert.equal(waiting.verdict, 'repair-published-awaiting-ci');
  const green = admitted({ findings: [], merged: true, ciGreen: true, runtimeProofRequired: true, runtimeProofGreen: true, activeRepairOrders: [first.repairOrder], receipts: [complete] });
  assert.equal(green.verdict, 'goal-green');
});
