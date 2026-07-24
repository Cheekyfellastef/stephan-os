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
    activeLaneKnown: true,
    currentPrCount: 1,
    proofAvailable: true,
    findings: FINDINGS,
    allowedTests: ['node --test shared/runtime/goalDashboardStatusProjection.test.mjs'],
    workerAvailability: { githubFirstAvailable: true },
    ...overrides,
  };
}

test('deduplication key is exact-head and finding-set bound', () => {
  const first = buildGuardedRepairDeduplicationKey(input());
  const reordered = buildGuardedRepairDeduplicationKey(input({ findings: [...FINDINGS].reverse() }));
  const moved = buildGuardedRepairDeduplicationKey(input({ headSha: 'c'.repeat(40) }));
  assert.equal(first, reordered);
  assert.notEqual(first, moved);
  assert.match(first, /pr-1582@b{40}:P2-receipt-binding,P2-source-label$/);
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

test('equivalent order is not duplicated and requires real accepted or started evidence', () => {
  const admitted = evaluateGuardedRepairLoop(input());
  const activeRepairOrders = [admitted.repairOrder];
  const noWorkerReceipt = evaluateGuardedRepairLoop(input({ activeRepairOrders, receipts: [admitted.nextReceipt] }));
  assert.equal(noWorkerReceipt.verdict, 'known-blocker-repair-admitted');
  assert.equal(noWorkerReceipt.nextAction, 'ROUTE_OR_FAIL_OVER_WORKER');

  const started = evaluateGuardedRepairLoop(input({
    activeRepairOrders,
    receipts: [{ ...admitted.nextReceipt, state: 'repair_started', workerTaskId: 'github-first-task-1582' }],
  }));
  assert.equal(started.verdict, 'repair-already-active');
  assert.equal(started.nextAction, 'OBSERVE_EXISTING_REPAIR');
});

test('head change invalidates the deduplication identity and creates a new exact-head order', () => {
  const old = evaluateGuardedRepairLoop(input());
  const nextHead = 'd'.repeat(40);
  const next = evaluateGuardedRepairLoop(input({ headSha: nextHead, activeRepairOrders: [old.repairOrder] }));
  assert.equal(next.verdict, 'known-blocker-repair-admitted');
  assert.notEqual(next.repairOrder.deduplicationKey, old.repairOrder.deduplicationKey);
  assert.equal(next.repairOrder.headSha, nextHead);
});

test('safety gates fail closed', () => {
  assert.equal(evaluateGuardedRepairLoop(input({ expectedBaseSha: 'c'.repeat(40) })).verdict, 'abort-stale-base');
  assert.equal(evaluateGuardedRepairLoop(input({ currentPrCount: 2 })).verdict, 'abort-conflicting-pr');
  assert.equal(evaluateGuardedRepairLoop(input({ proofAvailable: false })).verdict, 'abort-missing-proof');
  assert.equal(evaluateGuardedRepairLoop(input({ repeatedBlockerCount: 2 })).verdict, 'abort-repeated-blocker');
  assert.equal(evaluateGuardedRepairLoop(input({ findings: [{ ...FINDINGS[0], bounded: false }] })).verdict, 'abort-unknown-blocker');
  assert.equal(evaluateGuardedRepairLoop(input({ findings: [{ ...FINDINGS[0], operatorJudgmentRequired: true }] })).verdict, 'abort-operator-judgment-required');
});

test('worker routing is provider-neutral and runtime-aware', () => {
  assert.equal(routeGuardedRepairWorker({ githubFirstAvailable: true }).route, 'CHATGPT_GITHUB');
  assert.equal(routeGuardedRepairWorker({ runtimeRequired: true, openClawAvailable: true }).route, 'OPENCLAW_LOCAL');
  assert.equal(routeGuardedRepairWorker({ runtimeRequired: true, remoteCodexAvailable: true }).route, 'REMOTE_CODEX');
  assert.equal(routeGuardedRepairWorker({ runtimeRequired: true }).route, 'BLOCKED_UNSAFE_OR_UNKNOWN');
});

test('green exact head reaches approval gate but never grants automatic approval', () => {
  const result = evaluateGuardedRepairLoop(input({ findings: [], ciGreen: true, mergeable: true }));
  assert.equal(result.verdict, 'safe-to-merge-with-expected-head');
  assert.equal(result.expectedHeadSha, HEAD);
  assert.equal(result.nextAction, 'REQUEST_EXACT_HEAD_MERGE_APPROVAL');
});

test('runtime proof is required before goal-green', () => {
  const waiting = evaluateGuardedRepairLoop(input({ findings: [], runtimeProofRequired: true, runtimeProofGreen: false }));
  assert.equal(waiting.verdict, 'repair-published-awaiting-ci');
  const green = evaluateGuardedRepairLoop(input({ findings: [], runtimeProofRequired: true, runtimeProofGreen: true }));
  assert.equal(green.verdict, 'goal-green');
  assert.equal(green.nextAction, 'COMPLETE_AND_SELECT_NEXT_GOAL');
});
