import {
  createExecutionReceipt,
  EXECUTION_RECEIPT_STATES,
  EXECUTION_RECEIPT_TERMINAL_STATES,
  validateExecutionReceipt,
} from './executionReceiptV1.mjs';

const SHA_RE = /^[0-9a-f]{40}$/i;
const BLOCKING = new Set(['P0', 'P1', 'P2']);
const ACTIVE_EXECUTION_STATES = new Set(['accepted', 'started', 'progress']);

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
function positiveInt(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
function sha(value) {
  return typeof value === 'string' && SHA_RE.test(value.trim()) ? value.trim().toLowerCase() : null;
}
function frozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozen));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, frozen(entry)])));
  }
  return value;
}

export const GUARDED_REPAIR_RECEIPT_STATES = EXECUTION_RECEIPT_STATES;

function validFinding(finding) {
  return Boolean(
    finding
    && typeof finding === 'object'
    && text(finding.id ?? finding.code)
    && BLOCKING.has(text(finding.severity).toUpperCase()),
  );
}

export function normalizeGuardedRepairFindings(findings = []) {
  return frozen(findings
    .map((finding = {}) => ({
      id: text(finding.id ?? finding.code),
      code: text(finding.code ?? finding.id),
      severity: text(finding.severity).toUpperCase(),
      type: text(finding.type, 'review_finding'),
      message: text(finding.message),
      file: text(finding.file) || null,
      bounded: finding.bounded === true,
      operatorJudgmentRequired: finding.operatorJudgmentRequired === true,
    }))
    .filter((finding) => finding.id && BLOCKING.has(finding.severity))
    .sort((a, b) => a.id.localeCompare(b.id)));
}

export function buildGuardedRepairDeduplicationKey(input = {}) {
  const repository = text(input.repository).toLowerCase();
  const issueNumber = positiveInt(input.issueNumber);
  const prNumber = positiveInt(input.prNumber);
  const headSha = sha(input.headSha);
  const findingIds = [...new Set(normalizeGuardedRepairFindings(input.findings).map(({ id }) => id))];
  if (!repository || !issueNumber || !prNumber || !headSha || !findingIds.length) return null;
  const encodedFindings = Buffer.from(JSON.stringify(findingIds), 'utf8').toString('base64url');
  return `${repository}#${issueNumber}/pr-${prNumber}@${headSha}:${encodedFindings}`;
}

export function routeGuardedRepairWorker(availability = {}) {
  if (availability.runtimeRequired !== true && availability.githubFirstAvailable === true) {
    return frozen({ route: 'CHATGPT_GITHUB', workerType: 'github-first', reason: 'Bounded repository repair uses the evidenced GitHub-first default.' });
  }
  if (availability.runtimeRequired === true && availability.openClawAvailable === true) {
    return frozen({ route: 'OPENCLAW_LOCAL', workerType: 'openclaw', reason: 'The repair requires bounded local runtime access.' });
  }
  if (availability.remoteCodexAvailable === true) {
    return frozen({ route: 'REMOTE_CODEX', workerType: 'remote-codex', reason: availability.runtimeRequired === true ? 'Runtime access is required and the bounded local route is unavailable.' : 'GitHub-first execution is unavailable and a qualified provider-neutral fallback is evidenced.' });
  }
  if (availability.openClawAvailable === true) {
    return frozen({ route: 'OPENCLAW_LOCAL', workerType: 'openclaw', reason: 'GitHub-first execution is unavailable and a qualified bounded local fallback is evidenced.' });
  }
  return frozen({ route: 'BLOCKED_UNSAFE_OR_UNKNOWN', workerType: null, reason: 'No qualified evidenced worker is available.' });
}

function canonicalReceiptForOrder(receipt, order) {
  if (!receipt || !order) return null;
  const validation = validateExecutionReceipt(receipt, {
    repository: order.repository,
    issueNumber: order.issueNumber,
    branch: order.branch,
    expectedHead: order.headSha,
    executionId: order.executionId,
    leaseKey: order.leaseKey,
  });
  if (!validation.valid) return null;
  if (receipt.prNumber !== order.prNumber || receipt.workerType !== order.worker.workerType) return null;
  return receipt;
}

function latestReceipt(receipts, order) {
  return [...receipts].reverse().map((receipt) => canonicalReceiptForOrder(receipt, order)).find(Boolean) ?? null;
}

function hasTerminalReceipt(order, receipts) {
  const receipt = latestReceipt(receipts, order);
  return Boolean(receipt && EXECUTION_RECEIPT_TERMINAL_STATES.includes(receipt.state));
}

function completedReceiptForCurrentHead(activeRepairOrders, receipts, prNumber, headSha) {
  const orders = activeRepairOrders.filter((order) => order?.prNumber === prNumber && sha(order?.headSha) === headSha);
  return orders.some((order) => latestReceipt(receipts, order)?.state === 'completed');
}

function createQueuedReceipt(order, input) {
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
    state: 'queued',
    phase: 'repair-admitted-awaiting-worker-acceptance',
    sequence: 1,
    timestampUtc: text(input.receiptTimestampUtc, '1970-01-01T00:00:00.000Z'),
    heartbeatExpiresAtUtc: text(input.receiptHeartbeatExpiresAtUtc, '1970-01-01T00:02:00.000Z'),
    proofRefs: Array.isArray(input.proofRefs) && input.proofRefs.length ? input.proofRefs : [`proofs/${order.repairOrderId}`],
    expectedNextAction: 'Worker must append an accepted receipt before implementation or publication begins.',
  });
}

export function evaluateGuardedRepairLoop(rawInput = {}) {
  const input = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput : {};
  const repository = text(input.repository).toLowerCase();
  const issueNumber = positiveInt(input.issueNumber);
  const prNumber = positiveInt(input.prNumber);
  const branch = text(input.branch);
  const baseSha = sha(input.baseSha);
  const expectedBaseSha = sha(input.expectedBaseSha);
  const headSha = sha(input.headSha);
  const proofHeadSha = sha(input.proofHeadSha);
  const rawFindings = input.findings;
  const activeRepairOrders = Array.isArray(input.activeRepairOrders) ? input.activeRepairOrders : [];
  const receipts = Array.isArray(input.receipts) ? input.receipts : [];

  if (input.activeLaneKnown !== true || !repository || !issueNumber || !prNumber || !branch || !baseSha || !expectedBaseSha || !headSha) {
    return frozen({ verdict: 'abort-missing-proof', reason: 'Canonical lane identity, branch and independently evidenced full source SHAs are required.', nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  }
  if (!Number.isSafeInteger(Number(input.currentPrCount)) || Number(input.currentPrCount) !== 1) {
    return frozen({ verdict: 'abort-conflicting-pr', reason: 'Exactly one evidenced PR must own the active implementation lane.', nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  }
  if (baseSha !== expectedBaseSha) {
    return frozen({ verdict: 'abort-stale-base', reason: 'The observed base SHA no longer matches the independently evidenced expected base.', nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  }
  if (input.proofAvailable !== true || !proofHeadSha || proofHeadSha !== headSha) {
    return frozen({ verdict: 'abort-missing-proof', reason: 'Required CI, review or runtime evidence is absent or not bound to the evaluated exact head.', nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  }
  if (input.findingsEvidenceAvailable !== true || !Array.isArray(rawFindings) || rawFindings.some((finding) => !validFinding(finding))) {
    return frozen({ verdict: 'abort-missing-proof', reason: 'A complete, valid exact-head blocking-finding set is required, including an evidenced empty set.', nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  }
  if (Number(input.repeatedBlockerCount ?? 0) > 1) {
    return frozen({ verdict: 'abort-repeated-blocker', reason: 'The same blocker exceeded the bounded repair budget.', nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  }

  const findings = normalizeGuardedRepairFindings(rawFindings);
  const deduplicationKey = buildGuardedRepairDeduplicationKey({ repository, issueNumber, prNumber, headSha, findings });

  if (!findings.length) {
    const implementationCompleted = completedReceiptForCurrentHead(activeRepairOrders, receipts, prNumber, headSha);
    if (!implementationCompleted) {
      return frozen({ verdict: 'abort-missing-canonical-receipt', reason: 'A completed canonical stephanos.execution-receipt.v1 receipt bound to this PR and exact head is required before review, merge approval or completion can be claimed.', nextAction: 'WAIT_FOR_CANONICAL_EXECUTION_RECEIPT' });
    }
    if (input.merged === true && input.runtimeProofRequired === true) {
      if (input.ciGreen !== true) return frozen({ verdict: 'repair-published-awaiting-ci', reason: 'The exact merged head has not yet produced green CI proof.', nextAction: 'WAIT_FOR_EXACT_HEAD_VERIFICATION' });
      return frozen({
        verdict: input.runtimeProofGreen === true ? 'goal-green' : 'repair-published-awaiting-ci',
        reason: input.runtimeProofGreen === true ? 'The approved exact head is merged, exact-head CI is green, runtime proof is green and canonical execution is completed.' : 'Post-merge runtime verification is incomplete.',
        nextAction: input.runtimeProofGreen === true ? 'COMPLETE_AND_SELECT_NEXT_GOAL' : 'WAIT_FOR_EXACT_HEAD_VERIFICATION',
      });
    }
    if (input.merged === true && input.runtimeProofRequired === false && input.ciGreen === true) {
      return frozen({ verdict: 'goal-green', reason: 'The approved exact head is merged, exact-head CI is green, canonical execution is completed and no runtime proof is required.', nextAction: 'COMPLETE_AND_SELECT_NEXT_GOAL' });
    }
    if (input.ciGreen === true && input.mergeable === true && input.merged !== true) {
      return frozen({ verdict: 'safe-to-merge-with-expected-head', expectedHeadSha: headSha, reason: 'The exact head is green, mergeable, finding-free and backed by a completed canonical execution receipt.', nextAction: 'REQUEST_EXACT_HEAD_MERGE_APPROVAL' });
    }
    return frozen({ verdict: 'repair-published-awaiting-ci', reason: 'Canonical implementation is complete, but exact-head verification, explicit proof scope or merge state is incomplete.', nextAction: 'WAIT_FOR_EXACT_HEAD_VERIFICATION' });
  }

  if (findings.some(({ operatorJudgmentRequired }) => operatorJudgmentRequired)) {
    return frozen({ verdict: 'abort-operator-judgment-required', reason: 'A blocking finding requires operator judgment.', nextAction: 'REQUEST_OPERATOR_DECISION' });
  }
  if (findings.some(({ bounded }) => !bounded)) {
    return frozen({ verdict: 'abort-unknown-blocker', reason: 'At least one finding is unbounded or outside the approved lane.', nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  }

  const sameHeadConflicts = activeRepairOrders.filter((order) => order?.prNumber === prNumber && sha(order?.headSha) === headSha && order?.deduplicationKey !== deduplicationKey);
  const nonterminalSameHead = sameHeadConflicts.find((order) => !hasTerminalReceipt(order, receipts));
  if (nonterminalSameHead) {
    return frozen({ verdict: 'abort-active-finding-set-change', reason: 'A nonterminal canonical execution already owns this PR and exact head; reconcile or terminate it before admitting another finding set.', repairOrder: nonterminalSameHead, nextAction: 'WAIT_FOR_ACTIVE_WORKER_RECONCILIATION' });
  }

  const existing = activeRepairOrders.find((order) => order?.deduplicationKey === deduplicationKey);
  if (existing) {
    const receipt = latestReceipt(receipts, existing);
    if (receipt && ACTIVE_EXECUTION_STATES.has(receipt.state)) {
      return frozen({ verdict: 'repair-already-active', reason: 'An equivalent repair has canonical accepted, started or progress evidence bound to this order and exact head.', repairOrder: existing, executionReceipt: receipt, nextAction: 'OBSERVE_EXISTING_REPAIR' });
    }
    if (receipt?.state === 'stalled') {
      return frozen({ verdict: 'repair-stalled', reason: receipt.blocker, repairOrder: existing, executionReceipt: receipt, nextAction: receipt.operatorActionRequired ? 'REQUEST_OPERATOR_DECISION' : 'OBSERVE_EXISTING_REPAIR' });
    }
    const refreshedWorker = routeGuardedRepairWorker(input.workerAvailability ?? {});
    if (refreshedWorker.route === 'BLOCKED_UNSAFE_OR_UNKNOWN') {
      return frozen({ verdict: 'abort-unknown-blocker', reason: refreshedWorker.reason, worker: refreshedWorker, repairOrder: existing, nextAction: 'STOP_AND_SURFACE_BLOCKER' });
    }
    return frozen({ verdict: 'known-blocker-repair-admitted', reason: 'The order exists without canonical active execution evidence; its route may be refreshed but implementation must not be claimed until an accepted receipt exists.', repairOrder: frozen({ ...existing, worker: refreshedWorker }), nextAction: 'ROUTE_OR_FAIL_OVER_WORKER' });
  }

  const staleActive = activeRepairOrders.filter((order) => order?.prNumber === prNumber && sha(order?.headSha) !== headSha);
  const nonterminalStale = staleActive.find((order) => !hasTerminalReceipt(order, receipts));
  if (nonterminalStale) {
    return frozen({ verdict: 'abort-stale-worker-active', reason: 'Every prior-head execution must publish a canonical terminal receipt before rerouting.', repairOrder: nonterminalStale, nextAction: 'WAIT_FOR_STALE_WORKER_ABORT' });
  }

  const worker = routeGuardedRepairWorker(input.workerAvailability ?? {});
  if (worker.route === 'BLOCKED_UNSAFE_OR_UNKNOWN') {
    return frozen({ verdict: 'abort-unknown-blocker', reason: worker.reason, worker, nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  }

  const repairOrderId = `repair-${issueNumber}-${prNumber}-${headSha.slice(0, 12)}`;
  const repairOrder = frozen({
    schemaVersion: 'stephanos.guarded-repair-order.v1',
    repairOrderId,
    repository,
    issueNumber,
    prNumber,
    branch,
    baseSha,
    headSha,
    findingIds: findings.map(({ id }) => id),
    findings,
    deduplicationKey,
    worker,
    executionId: repairOrderId,
    leaseKey: repairOrderId,
    allowedFiles: [...new Set((input.allowedFiles ?? findings.map(({ file }) => file)).filter(Boolean))].sort(),
    allowedTests: [...new Set((input.allowedTests ?? []).map(String).filter(Boolean))].sort(),
    mergePolicy: { automaticApproval: false, expectedHeadSha: headSha },
    abortConditions: ['head_changed', 'base_changed', 'conflicting_pr', 'unknown_blocker', 'operator_judgment_required', 'authority_expansion_requested'],
  });
  const nextReceipt = createQueuedReceipt(repairOrder, input);
  const receiptValidation = validateExecutionReceipt(nextReceipt, { repository, issueNumber, branch, expectedHead: headSha, executionId: repairOrder.executionId, leaseKey: repairOrder.leaseKey });
  if (!receiptValidation.valid) {
    return frozen({ verdict: 'abort-missing-canonical-receipt', reason: receiptValidation.refusalReason, nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  }

  return frozen({
    verdict: 'known-blocker-repair-admitted',
    reason: 'A bounded exact-head blocker was admitted and a canonical queued receipt was prepared. No implementation or publication may be claimed until the worker appends accepted/started evidence.',
    repairOrder,
    nextReceipt,
    nextAction: 'PERSIST_CANONICAL_RECEIPT_THEN_ROUTE_WORKER',
  });
}
