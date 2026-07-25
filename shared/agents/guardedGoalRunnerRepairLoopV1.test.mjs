import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGuardedRepairDeduplicationKey,
  evaluateGuardedRepairLoop,
  routeGuardedRepairWorker,
} from './guardedGoalRunnerRepairLoopV1.mjs';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const FINDINGS = [
  { id: 'P2-source-label', severity: 'P2', type: 'review_finding', bounded: true, file: 'shared/runtime/goalDashboardStatusProjection.mjs' },
  { id: 'P2-receipt-binding', severity: 'P2', type: 'review_finding', bounded: true, file: 'shared/runtime/goalDashboardStatusProjection.test.mjs' },
];

function input(overrides = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1385,
    prNumber: 1582,
    baseSha: BASE,
    expectedBaseSha: BASE,
    headSha: HEAD,
    proofHeadSha: HEAD,
    activeLaneKnown: true,
    currentPrCount: 1,
    proofAvailable: true,
    findingsEvidenceAvailable: true,
    findings: FINDINGS,
    allowedTests: ['node --test shared/runtime/goalDashboardStatusProjection.test.mjs'],
    workerAvailability: { githubFirstAvailable: true },
    ...overrides,
  };
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

test('PR 1582 bounded review findings admit one GitHub-first repair immediately', () => {
  const result = evaluateGuardedRepairLoop(input());
  assert.equal(result.verdict, 'known-blocker-repair-admitted');
  assert.equal(result.repairOrder.worker.route, 'CHATGPT_GITHUB');
  assert.equal(result.repairOrder.prNumber, 1582);
  assert.deepEqual(result.repairOrder.findingIds, ['P2-receipt-binding', 'P2-source-label']);
  assert.equal(result.repairOrder.mergePolicy.automaticApproval, false);
  assert.equal(result.repairOrder.mergePolicy.expectedHeadSha, HEAD);
  assert.equal(result.nextReceipt.state, 'repair_requested');
});

test('equivalent order is not duplicated and requires receipt binding to order and head', () => {
  const admitted = evaluateGuardedRepairLoop(input());
  const activeRepairOrders = [admitted.repairOrder];
  const noWorkerReceipt = evaluateGuardedRepairLoop(input({ activeRepairOrders, receipts: [admitted.nextReceipt] }));
  assert.equal(noWorkerReceipt.verdict, 'known-blocker-repair-admitted');
  assert.equal(noWorkerReceipt.nextAction, 'ROUTE_OR_FAIL_OVER_WORKER');

  const malformed = evaluateGuardedRepairLoop(input({
    activeRepairOrders,
    receipts: [{ ...admitted.nextReceipt, state: 'repair_started', workerTaskId: 'task', repairOrderId: 'wrong' }],
  }));
  assert.equal(malformed.verdict, 'known-blocker-repair-admitted');

  const started = evaluateGuardedRepairLoop(input({
    activeRepairOrders,
    receipts: [{ ...admitted.nextReceipt, state: 'repair_started', workerTaskId: 'github-first-task-1582' }],
  }));
  assert.equal(started.verdict, 'repair-already-active');
  assert.equal(started.nextAction, 'OBSERVE_EXISTING_REPAIR');
});

test('existing order refreshes its worker route when current availability requires failover', () => {
  const admitted = evaluateGuardedRepairLoop(input());
  const failedOver = evaluateGuardedRepairLoop(input({
    activeRepairOrders: [admitted.repairOrder],
    receipts: [admitted.nextReceipt],
    workerAvailability: { githubFirstAvailable: false, remoteCodexAvailable: true },
  }));
  assert.equal(failedOver.verdict, 'known-blocker-repair-admitted');
  assert.equal(failedOver.nextAction, 'ROUTE_OR_FAIL_OVER_WORKER');
  assert.equal(failedOver.repairOrder.worker.route, 'REMOTE_CODEX');
});

test('same-head finding-set changes cannot create a concurrent repair', () => {
  const admitted = evaluateGuardedRepairLoop(input());
  const changedFindings = [...FINDINGS, { id: 'P1-new-review', severity: 'P1', bounded: true, file: 'shared/agents/guardedGoalRunnerRepairLoopV1.mjs' }];
  const blocked = evaluateGuardedRepairLoop(input({
    findings: changedFindings,
    activeRepairOrders: [admitted.repairOrder],
    receipts: [{ ...admitted.nextReceipt, state: 'repair_started', workerTaskId: 'task-1582' }],
  }));
  assert.equal(blocked.verdict, 'abort-active-finding-set-change');
  assert.equal(blocked.nextAction, 'WAIT_FOR_ACTIVE_WORKER_RECONCILIATION');

  const reconciled = evaluateGuardedRepairLoop(input({
    findings: changedFindings,
    activeRepairOrders: [admitted.repairOrder],
    receipts: [{ ...admitted.nextReceipt, state: 'aborted' }],
  }));
  assert.equal(reconciled.verdict, 'known-blocker-repair-admitted');
  assert.notEqual(reconciled.repairOrder.deduplicationKey, admitted.repairOrder.deduplicationKey);
});

test('head change waits for every prior worker terminal receipt before rerouting', () => {
  const old = evaluateGuardedRepairLoop(input());
  const olderHead = 'e'.repeat(40);
  const older = { ...old.repairOrder, headSha: olderHead, deduplicationKey: `${old.repairOrder.deduplicationKey}-older`, repairOrderId: 'older-order' };
  const nextHead = 'd'.repeat(40);
  const waiting = evaluateGuardedRepairLoop(input({ headSha: nextHead, proofHeadSha: nextHead, activeRepairOrders: [old.repairOrder, older] }));
  assert.equal(waiting.verdict, 'abort-stale-worker-active');
  assert.equal(waiting.nextAction, 'WAIT_FOR_STALE_WORKER_ABORT');

  const stillWaiting = evaluateGuardedRepairLoop(input({
    headSha: nextHead,
    proofHeadSha: nextHead,
    activeRepairOrders: [old.repairOrder, older],
    receipts: [{ ...old.nextReceipt, state: 'aborted' }],
  }));
  assert.equal(stillWaiting.verdict, 'abort-stale-worker-active');

  const next = evaluateGuardedRepairLoop(input({
    headSha: nextHead,
    proofHeadSha: nextHead,
    activeRepairOrders: [old.repairOrder, older],
    receipts: [
      { ...old.nextReceipt, state: 'aborted' },
      { state: 'complete', repairOrderId: older.repairOrderId, deduplicationKey: older.deduplicationKey, headSha: older.headSha },
    ],
  }));
  assert.equal(next.verdict, 'known-blocker-repair-admitted');
  assert.notEqual(next.repairOrder.deduplicationKey, old.repairOrder.deduplicationKey);
  assert.equal(next.repairOrder.headSha, nextHead);
});

test('safety gates fail closed when evidence is omitted, malformed or contradictory', () => {
  assert.equal(evaluateGuardedRepairLoop(input({ expectedBaseSha: 'c'.repeat(40) })).verdict, 'abort-stale-base');
  assert.equal(evaluateGuardedRepairLoop(input({ expectedBaseSha: undefined })).verdict, 'abort-missing-proof');
  assert.equal(evaluateGuardedRepairLoop(input({ currentPrCount: 2 })).verdict, 'abort-conflicting-pr');
  assert.equal(evaluateGuardedRepairLoop(input({ currentPrCount: undefined })).verdict, 'abort-conflicting-pr');
  assert.equal(evaluateGuardedRepairLoop(input({ proofAvailable: false })).verdict, 'abort-missing-proof');
  assert.equal(evaluateGuardedRepairLoop(input({ proofAvailable: undefined })).verdict, 'abort-missing-proof');
  assert.equal(evaluateGuardedRepairLoop(input({ proofHeadSha: 'c'.repeat(40) })).verdict, 'abort-missing-proof');
  assert.equal(evaluateGuardedRepairLoop(input({ findingsEvidenceAvailable: undefined })).verdict, 'abort-missing-proof');
  assert.equal(evaluateGuardedRepairLoop(input({ findings: undefined })).verdict, 'abort-missing-proof');
  assert.equal(evaluateGuardedRepairLoop(input({ findings: [{ severity: 'P1', bounded: true }] })).verdict, 'abort-missing-proof');
  assert.equal(evaluateGuardedRepairLoop(input({ findings: [{ id: 'bad', severity: 'UNKNOWN', bounded: true }] })).verdict, 'abort-missing-proof');
  assert.equal(evaluateGuardedRepairLoop(input({ repeatedBlockerCount: 2 })).verdict, 'abort-repeated-blocker');
  assert.equal(evaluateGuardedRepairLoop(input({ findings: [{ ...FINDINGS[0], bounded: false }] })).verdict, 'abort-unknown-blocker');
  assert.equal(evaluateGuardedRepairLoop(input({ findings: [{ ...FINDINGS[0], operatorJudgmentRequired: true }] })).verdict, 'abort-operator-judgment-required');
});

test('worker routing requires positive availability evidence and fails over neutrally', () => {
  assert.equal(routeGuardedRepairWorker({ githubFirstAvailable: true }).route, 'CHATGPT_GITHUB');
  assert.equal(routeGuardedRepairWorker({}).route, 'BLOCKED_UNSAFE_OR_UNKNOWN');
  assert.equal(routeGuardedRepairWorker({ githubFirstAvailable: false, remoteCodexAvailable: true }).route, 'REMOTE_CODEX');
  assert.equal(routeGuardedRepairWorker({ githubFirstAvailable: false, openClawAvailable: true }).route, 'OPENCLAW_LOCAL');
  assert.equal(routeGuardedRepairWorker({ runtimeRequired: true, openClawAvailable: true }).route, 'OPENCLAW_LOCAL');
  assert.equal(routeGuardedRepairWorker({ runtimeRequired: true, remoteCodexAvailable: true }).route, 'REMOTE_CODEX');
  assert.equal(routeGuardedRepairWorker({ runtimeRequired: true }).route, 'BLOCKED_UNSAFE_OR_UNKNOWN');
});

test('green exact head reaches approval gate only with exact-head proof', () => {
  const result = evaluateGuardedRepairLoop(input({ findings: [], ciGreen: true, mergeable: true }));
  assert.equal(result.verdict, 'safe-to-merge-with-expected-head');
  assert.equal(result.expectedHeadSha, HEAD);
  assert.equal(result.nextAction, 'REQUEST_EXACT_HEAD_MERGE_APPROVAL');

  const stale = evaluateGuardedRepairLoop(input({ findings: [], headSha: 'c'.repeat(40), proofHeadSha: HEAD, ciGreen: true, mergeable: true }));
  assert.equal(stale.verdict, 'abort-missing-proof');
});

test('runtime proof cannot bypass merge approval and is evaluated only after merge', () => {
  const preMerge = evaluateGuardedRepairLoop(input({ findings: [], ciGreen: true, mergeable: true, runtimeProofRequired: true, runtimeProofGreen: true }));
  assert.equal(preMerge.verdict, 'safe-to-merge-with-expected-head');
  assert.equal(preMerge.nextAction, 'REQUEST_EXACT_HEAD_MERGE_APPROVAL');

  const waiting = evaluateGuardedRepairLoop(input({ findings: [], merged: true, runtimeProofRequired: true, runtimeProofGreen: false }));
  assert.equal(waiting.verdict, 'repair-published-awaiting-ci');
  const green = evaluateGuardedRepairLoop(input({ findings: [], merged: true, runtimeProofRequired: true, runtimeProofGreen: true }));
  assert.equal(green.verdict, 'goal-green');
  assert.equal(green.nextAction, 'COMPLETE_AND_SELECT_NEXT_GOAL');
});

test('merged source-only repair completes when exact-head CI is green', () => {
  const green = evaluateGuardedRepairLoop(input({ findings: [], merged: true, runtimeProofRequired: false, ciGreen: true }));
  assert.equal(green.verdict, 'goal-green');
  assert.equal(green.nextAction, 'COMPLETE_AND_SELECT_NEXT_GOAL');

  const waiting = evaluateGuardedRepairLoop(input({ findings: [], merged: true, runtimeProofRequired: false, ciGreen: false }));
  assert.equal(waiting.verdict, 'repair-published-awaiting-ci');
});
