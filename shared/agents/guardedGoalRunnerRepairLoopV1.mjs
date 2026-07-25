import { createHash } from 'node:crypto';
import {
  classifyExecutionReceiptSet,
  createExecutionReceipt,
  EXECUTION_RECEIPT_STATES,
  EXECUTION_RECEIPT_TERMINAL_STATES,
  projectExecutionReceipt,
  validateExecutionReceipt,
} from './executionReceiptV1.mjs';

const SHA_RE = /^[0-9a-f]{40}$/i;
const BLOCKING = new Set(['P0', 'P1', 'P2']);
const ACTIVE_EXECUTION_STATES = new Set(['accepted', 'started', 'progress']);

function text(value, fallback = '') { return typeof value === 'string' && value.trim() ? value.trim() : fallback; }
function positiveInt(value) { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null; }
function sha(value) { return typeof value === 'string' && SHA_RE.test(value.trim()) ? value.trim().toLowerCase() : null; }
function frozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozen));
  if (value && typeof value === 'object') return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, frozen(entry)])));
  return value;
}
function shortHash(value) { return createHash('sha256').update(String(value)).digest('hex').slice(0, 12); }
function exactHeadEvidence(flag, observedHead, headSha) { return flag === true && sha(observedHead) === headSha; }

export const GUARDED_REPAIR_RECEIPT_STATES = EXECUTION_RECEIPT_STATES;

function validFinding(finding) {
  return Boolean(finding && typeof finding === 'object' && text(finding.id ?? finding.code) && BLOCKING.has(text(finding.severity).toUpperCase()));
}

export function normalizeGuardedRepairFindings(findings = []) {
  return frozen(findings.map((finding = {}) => ({
    id: text(finding.id ?? finding.code), code: text(finding.code ?? finding.id), severity: text(finding.severity).toUpperCase(),
    type: text(finding.type, 'review_finding'), message: text(finding.message), file: text(finding.file) || null,
    bounded: finding.bounded === true, operatorJudgmentRequired: finding.operatorJudgmentRequired === true,
  })).filter((finding) => finding.id && BLOCKING.has(finding.severity)).sort((a, b) => a.id.localeCompare(b.id)));
}

export function buildGuardedRepairDeduplicationKey(input = {}) {
  const repository = text(input.repository).toLowerCase();
  const issueNumber = positiveInt(input.issueNumber); const prNumber = positiveInt(input.prNumber); const headSha = sha(input.headSha);
  const findingIds = [...new Set(normalizeGuardedRepairFindings(input.findings).map(({ id }) => id))];
  if (!repository || !issueNumber || !prNumber || !headSha || !findingIds.length) return null;
  const encodedFindings = Buffer.from(JSON.stringify(findingIds), 'utf8').toString('base64url');
  return `${repository}#${issueNumber}/pr-${prNumber}@${headSha}:${encodedFindings}`;
}

export function routeGuardedRepairWorker(availability = {}) {
  if (availability.runtimeRequired !== true && availability.githubFirstAvailable === true) return frozen({ route: 'CHATGPT_GITHUB', workerType: 'github-first', workerId: 'worker-github-first', reason: 'Bounded repository repair uses the evidenced GitHub-first default.' });
  if (availability.runtimeRequired === true && availability.openClawAvailable === true) return frozen({ route: 'OPENCLAW_LOCAL', workerType: 'openclaw', workerId: 'worker-openclaw', reason: 'The repair requires bounded local runtime access.' });
  if (availability.remoteCodexAvailable === true) return frozen({ route: 'REMOTE_CODEX', workerType: 'remote-codex', workerId: 'worker-remote-codex', reason: availability.runtimeRequired === true ? 'Runtime access is required and the bounded local route is unavailable.' : 'GitHub-first execution is unavailable and a qualified provider-neutral fallback is evidenced.' });
  if (availability.openClawAvailable === true) return frozen({ route: 'OPENCLAW_LOCAL', workerType: 'openclaw', workerId: 'worker-openclaw', reason: 'GitHub-first execution is unavailable and a qualified bounded local fallback is evidenced.' });
  return frozen({ route: 'BLOCKED_UNSAFE_OR_UNKNOWN', workerType: null, workerId: null, reason: 'No qualified evidenced worker is available.' });
}

function orderMatchesLane(order, lane) {
  return Boolean(order && order.repository === lane.repository && order.issueNumber === lane.issueNumber && order.prNumber === lane.prNumber && order.branch === lane.branch && sha(order.headSha) === lane.headSha);
}

function receiptChain(receipts, order, nowMs) {
  if (!order) return { valid: false, receipt: null, stale: true, reason: 'missing-order' };
  const candidates = receipts.filter((receipt) => receipt?.executionId === order.executionId || receipt?.leaseKey === order.leaseKey);
  if (!candidates.length) return { valid: true, receipt: null, stale: false, reason: '' };
  const options = { repository: order.repository, issueNumber: order.issueNumber, branch: order.branch, expectedHead: order.headSha, executionId: order.executionId, leaseKey: order.leaseKey };
  const classification = classifyExecutionReceiptSet(candidates, options);
  if (classification.finalVerdict !== 'EXECUTION_RECEIPT_SET_PASS') return { valid: false, receipt: null, stale: true, reason: classification.chainErrors[0] || classification.finalVerdict };
  const ordered = [...classification.validReceipts].sort((a, b) => a.sequence - b.sequence);
  const receipt = ordered.at(-1) ?? null;
  if (receipt && (receipt.prNumber !== order.prNumber || receipt.workerType !== order.worker.workerType || receipt.workerId !== order.assignedWorkerId)) return { valid: false, receipt: null, stale: true, reason: 'worker-or-pr-identity-mismatch' };
  const projection = projectExecutionReceipt(receipt, { ...options, nowMs });
  return { valid: true, receipt, stale: projection.stale, reason: projection.blocker || '' };
}

function terminalTruth(order, receipts, nowMs) {
  const chain = receiptChain(receipts, order, nowMs);
  return chain.valid && Boolean(chain.receipt && EXECUTION_RECEIPT_TERMINAL_STATES.includes(chain.receipt.state));
}

function completedReceiptForLane(activeRepairOrders, receipts, lane, nowMs) {
  for (const order of activeRepairOrders.filter((entry) => orderMatchesLane(entry, lane))) {
    const chain = receiptChain(receipts, order, nowMs);
    if (!chain.valid) return { completed: false, invalid: true, reason: chain.reason };
    if (chain.receipt?.state === 'completed') return { completed: true, invalid: false, reason: '' };
  }
  return { completed: false, invalid: false, reason: '' };
}

function createQueuedReceipt(order, input) {
  return createExecutionReceipt({
    repository: order.repository, issueNumber: order.issueNumber, prNumber: order.prNumber, branch: order.branch, sourceHead: order.headSha,
    workerId: order.assignedWorkerId, workerType: order.worker.workerType, executionId: order.executionId, leaseKey: order.leaseKey,
    state: 'queued', phase: 'repair-admitted-awaiting-worker-acceptance', sequence: 1,
    timestampUtc: text(input.receiptTimestampUtc, '1970-01-01T00:00:00.000Z'), heartbeatExpiresAtUtc: text(input.receiptHeartbeatExpiresAtUtc, '1970-01-01T00:02:00.000Z'),
    proofRefs: Array.isArray(input.proofRefs) && input.proofRefs.length ? input.proofRefs : [`proofs/${order.repairOrderId}`],
    expectedNextAction: 'Worker must append an accepted receipt before implementation or publication begins.',
  });
}

function buildOrder({ repository, issueNumber, prNumber, branch, baseSha, headSha, findings, deduplicationKey, worker, input, retryOrdinal = 1 }) {
  const identity = shortHash(`${deduplicationKey}:retry-${retryOrdinal}`);
  const repairOrderId = `repair-${issueNumber}-${prNumber}-${headSha.slice(0, 12)}-${identity}`;
  return frozen({
    schemaVersion: 'stephanos.guarded-repair-order.v1', repairOrderId, repository, issueNumber, prNumber, branch, baseSha, headSha,
    findingIds: findings.map(({ id }) => id), findings, deduplicationKey, worker, assignedWorkerId: worker.workerId,
    retryOrdinal, executionId: `${repairOrderId}-execution`, leaseKey: `${repairOrderId}-lease`,
    allowedFiles: [...new Set((input.allowedFiles ?? findings.map(({ file }) => file)).filter(Boolean))].sort(),
    allowedTests: [...new Set((input.allowedTests ?? []).map(String).filter(Boolean))].sort(),
    mergePolicy: { automaticApproval: false, expectedHeadSha: headSha },
    abortConditions: ['head_changed', 'base_changed', 'conflicting_pr', 'unknown_blocker', 'operator_judgment_required', 'authority_expansion_requested'],
  });
}

export function evaluateGuardedRepairLoop(rawInput = {}) {
  const input = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput : {};
  const repository = text(input.repository).toLowerCase(); const issueNumber = positiveInt(input.issueNumber); const prNumber = positiveInt(input.prNumber);
  const branch = text(input.branch); const baseSha = sha(input.baseSha); const expectedBaseSha = sha(input.expectedBaseSha); const headSha = sha(input.headSha);
  const rawFindings = input.findings; const activeRepairOrders = Array.isArray(input.activeRepairOrders) ? input.activeRepairOrders : []; const receipts = Array.isArray(input.receipts) ? input.receipts : [];
  const nowMs = Number.isFinite(Date.parse(input.nowUtc)) ? Date.parse(input.nowUtc) : Date.now();
  const lane = { repository, issueNumber, prNumber, branch, headSha };

  if (input.activeLaneKnown !== true || !repository || !issueNumber || !prNumber || !branch || !baseSha || !expectedBaseSha || !headSha) return frozen({ verdict: 'abort-missing-proof', reason: 'Canonical lane identity, branch and independently evidenced full source SHAs are required.', nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  if (!Number.isSafeInteger(Number(input.currentPrCount)) || Number(input.currentPrCount) !== 1) return frozen({ verdict: 'abort-conflicting-pr', reason: 'Exactly one evidenced PR must own the active implementation lane.', nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  if (baseSha !== expectedBaseSha) return frozen({ verdict: 'abort-stale-base', reason: 'The observed base SHA no longer matches the independently evidenced expected base.', nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  if (!exactHeadEvidence(input.reviewProofAvailable, input.reviewHeadSha, headSha)) return frozen({ verdict: 'abort-missing-proof', reason: 'Independent review evidence is absent or not bound to the evaluated exact head.', nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  if (input.findingsEvidenceAvailable !== true || !Array.isArray(rawFindings) || rawFindings.some((finding) => !validFinding(finding))) return frozen({ verdict: 'abort-missing-proof', reason: 'A complete, valid exact-head blocking-finding set is required, including an evidenced empty set.', nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  if (Number(input.repeatedBlockerCount ?? 0) > 1) return frozen({ verdict: 'abort-repeated-blocker', reason: 'The same blocker exceeded the bounded repair budget.', nextAction: 'STOP_AND_SURFACE_BLOCKER' });

  const findings = normalizeGuardedRepairFindings(rawFindings);
  const deduplicationKey = buildGuardedRepairDeduplicationKey({ repository, issueNumber, prNumber, headSha, findings });

  if (!findings.length) {
    const completion = completedReceiptForLane(activeRepairOrders, receipts, lane, nowMs);
    if (completion.invalid) return frozen({ verdict: 'abort-invalid-canonical-receipt-chain', reason: completion.reason, nextAction: 'STOP_AND_SURFACE_BLOCKER' });
    if (!completion.completed) return frozen({ verdict: 'abort-missing-canonical-receipt', reason: 'A completed canonical receipt chain bound to this lane and exact head is required.', nextAction: 'WAIT_FOR_CANONICAL_EXECUTION_RECEIPT' });
    const ciExact = exactHeadEvidence(input.ciGreen, input.ciHeadSha, headSha);
    if (input.merged === true) {
      if (!exactHeadEvidence(input.operatorApprovalRecorded, input.approvalHeadSha, headSha) || positiveInt(input.approvalPrNumber) !== prNumber) return frozen({ verdict: 'abort-missing-exact-head-approval', reason: 'Merged completion requires explicit operator approval evidence for this PR and exact head.', nextAction: 'STOP_AND_SURFACE_BLOCKER' });
      if (!ciExact) return frozen({ verdict: 'repair-published-awaiting-ci', reason: 'The exact merged head has not yet produced green CI proof.', nextAction: 'WAIT_FOR_EXACT_HEAD_VERIFICATION' });
      if (input.runtimeProofRequired === true) {
        const runtimeExact = exactHeadEvidence(input.runtimeProofGreen, input.runtimeHeadSha, headSha);
        return frozen({ verdict: runtimeExact ? 'goal-green' : 'repair-published-awaiting-ci', reason: runtimeExact ? 'Approved exact head is merged with exact-head CI, runtime proof and canonical completion.' : 'Post-merge runtime verification is incomplete or stale.', nextAction: runtimeExact ? 'COMPLETE_AND_SELECT_NEXT_GOAL' : 'WAIT_FOR_EXACT_HEAD_VERIFICATION' });
      }
      if (input.runtimeProofRequired === false) return frozen({ verdict: 'goal-green', reason: 'Approved exact head is merged with exact-head CI and canonical completion; no runtime proof is required.', nextAction: 'COMPLETE_AND_SELECT_NEXT_GOAL' });
      return frozen({ verdict: 'repair-published-awaiting-ci', reason: 'Runtime proof scope is unknown.', nextAction: 'WAIT_FOR_EXACT_HEAD_VERIFICATION' });
    }
    if (ciExact && input.mergeable === true) return frozen({ verdict: 'safe-to-merge-with-expected-head', expectedHeadSha: headSha, reason: 'Exact-head CI and review are green, the PR is mergeable, finding-free and backed by a completed canonical chain.', nextAction: 'REQUEST_EXACT_HEAD_MERGE_APPROVAL' });
    return frozen({ verdict: 'repair-published-awaiting-ci', reason: 'Canonical implementation is complete, but exact-head verification or mergeability is incomplete.', nextAction: 'WAIT_FOR_EXACT_HEAD_VERIFICATION' });
  }

  if (findings.some(({ operatorJudgmentRequired }) => operatorJudgmentRequired)) return frozen({ verdict: 'abort-operator-judgment-required', reason: 'A blocking finding requires operator judgment.', nextAction: 'REQUEST_OPERATOR_DECISION' });
  if (findings.some(({ bounded }) => !bounded)) return frozen({ verdict: 'abort-unknown-blocker', reason: 'At least one finding is unbounded or outside the approved lane.', nextAction: 'STOP_AND_SURFACE_BLOCKER' });

  const sameHead = activeRepairOrders.filter((order) => orderMatchesLane(order, lane));
  for (const order of sameHead.filter((entry) => entry.deduplicationKey !== deduplicationKey)) {
    const chain = receiptChain(receipts, order, nowMs);
    if (!chain.valid) return frozen({ verdict: 'abort-invalid-canonical-receipt-chain', reason: chain.reason, repairOrder: order, nextAction: 'STOP_AND_SURFACE_BLOCKER' });
    if (!chain.receipt || !EXECUTION_RECEIPT_TERMINAL_STATES.includes(chain.receipt.state) || chain.stale) return frozen({ verdict: 'abort-active-finding-set-change', reason: 'A nonterminal or stale execution already owns this lane and exact head.', repairOrder: order, nextAction: 'WAIT_FOR_ACTIVE_WORKER_RECONCILIATION' });
  }

  const existing = sameHead.find((order) => order.deduplicationKey === deduplicationKey);
  if (existing) {
    const chain = receiptChain(receipts, existing, nowMs);
    if (!chain.valid) return frozen({ verdict: 'abort-invalid-canonical-receipt-chain', reason: chain.reason, repairOrder: existing, nextAction: 'STOP_AND_SURFACE_BLOCKER' });
    if (chain.receipt && ACTIVE_EXECUTION_STATES.has(chain.receipt.state) && !chain.stale) return frozen({ verdict: 'repair-already-active', reason: 'Equivalent repair has fresh canonical active evidence.', repairOrder: existing, executionReceipt: chain.receipt, nextAction: 'OBSERVE_EXISTING_REPAIR' });
    if (chain.receipt && ACTIVE_EXECUTION_STATES.has(chain.receipt.state) && chain.stale) return frozen({ verdict: 'repair-stale', reason: 'The active execution heartbeat expired and must terminate before retry.', repairOrder: existing, executionReceipt: chain.receipt, nextAction: 'WAIT_FOR_STALE_WORKER_ABORT' });
    if (chain.receipt?.state === 'stalled') return frozen({ verdict: 'repair-stalled', reason: chain.receipt.blocker, repairOrder: existing, executionReceipt: chain.receipt, nextAction: chain.receipt.operatorActionRequired ? 'REQUEST_OPERATOR_DECISION' : 'OBSERVE_EXISTING_REPAIR' });
    const worker = routeGuardedRepairWorker(input.workerAvailability ?? {});
    if (worker.route === 'BLOCKED_UNSAFE_OR_UNKNOWN') return frozen({ verdict: 'abort-unknown-blocker', reason: worker.reason, worker, repairOrder: existing, nextAction: 'STOP_AND_SURFACE_BLOCKER' });
    if (chain.receipt && EXECUTION_RECEIPT_TERMINAL_STATES.includes(chain.receipt.state)) {
      const retryOrdinal = Math.max(2, ...sameHead.filter((order) => order.deduplicationKey === deduplicationKey).map((order) => Number(order.retryOrdinal) + 1 || 2));
      const retryOrder = buildOrder({ repository, issueNumber, prNumber, branch, baseSha, headSha, findings, deduplicationKey, worker, input, retryOrdinal });
      return frozen({ verdict: 'known-blocker-repair-admitted', reason: 'Terminal execution requires a distinct retry execution and lease.', repairOrder: retryOrder, nextReceipt: createQueuedReceipt(retryOrder, input), nextAction: 'PERSIST_CANONICAL_RECEIPT_THEN_ROUTE_WORKER' });
    }
    return frozen({ verdict: 'known-blocker-repair-admitted', reason: 'The order exists without active execution evidence; route its assigned worker only after persisting the queued receipt.', repairOrder: existing, nextAction: 'ROUTE_OR_FAIL_OVER_WORKER' });
  }

  for (const order of activeRepairOrders.filter((entry) => entry?.prNumber === prNumber && sha(entry?.headSha) !== headSha)) {
    const chain = receiptChain(receipts, order, nowMs);
    if (!chain.valid || !terminalTruth(order, receipts, nowMs)) return frozen({ verdict: 'abort-stale-worker-active', reason: chain.reason || 'Every prior-head execution must publish a valid canonical terminal chain before rerouting.', repairOrder: order, nextAction: 'WAIT_FOR_STALE_WORKER_ABORT' });
  }

  const worker = routeGuardedRepairWorker(input.workerAvailability ?? {});
  if (worker.route === 'BLOCKED_UNSAFE_OR_UNKNOWN') return frozen({ verdict: 'abort-unknown-blocker', reason: worker.reason, worker, nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  const repairOrder = buildOrder({ repository, issueNumber, prNumber, branch, baseSha, headSha, findings, deduplicationKey, worker, input });
  const nextReceipt = createQueuedReceipt(repairOrder, input);
  const receiptValidation = validateExecutionReceipt(nextReceipt, { repository, issueNumber, branch, expectedHead: headSha, executionId: repairOrder.executionId, leaseKey: repairOrder.leaseKey });
  if (!receiptValidation.valid) return frozen({ verdict: 'abort-missing-canonical-receipt', reason: receiptValidation.refusalReason, nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  return frozen({ verdict: 'known-blocker-repair-admitted', reason: 'A bounded exact-head blocker was admitted with a distinct canonical execution identity.', repairOrder, nextReceipt, nextAction: 'PERSIST_CANONICAL_RECEIPT_THEN_ROUTE_WORKER' });
}
