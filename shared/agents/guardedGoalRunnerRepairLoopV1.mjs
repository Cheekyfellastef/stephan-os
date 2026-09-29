import { createHash } from 'node:crypto';
import {
  classifyExecutionReceiptSet,
  createExecutionReceipt,
  EXECUTION_RECEIPT_STATES,
  EXECUTION_RECEIPT_TERMINAL_STATES,
  projectExecutionReceipt,
  validateExecutionReceipt,
} from './executionReceiptV1.mjs';
import {
  EXECUTION_SURFACE_ROUTE,
  EXECUTION_SURFACE_ROUTING_POLICY_V1_SCHEMA,
} from './executionSurfaceRoutingPolicyV1.mjs';

const SHA_RE = /^[0-9a-f]{40}$/i;
const SAFE_WORKER_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/;
const BLOCKING = new Set(['P0', 'P1', 'P2']);
const ACTIVE_EXECUTION_STATES = new Set(['queued', 'accepted', 'started', 'progress']);

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
function safeWorkerId(value) {
  const normalized = text(value).toLowerCase();
  return SAFE_WORKER_ID.test(normalized) ? normalized : null;
}
function safeSourcePath(value) {
  const normalized = text(value).replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.startsWith('//') || /^[a-z]:\//i.test(normalized)) return null;
  if (normalized.split('/').some((part) => part === '..')) return null;
  if (/(^|\/)(dist|build|coverage|node_modules)(\/|$)/i.test(normalized)) return null;
  return normalized;
}

export const GUARDED_REPAIR_RECEIPT_STATES = EXECUTION_RECEIPT_STATES;

function validFinding(finding) {
  return Boolean(finding && typeof finding === 'object' && text(finding.id ?? finding.code) && BLOCKING.has(text(finding.severity).toUpperCase()));
}

export function normalizeGuardedRepairFindings(findings = []) {
  return frozen(findings.map((finding = {}) => ({
    id: text(finding.id ?? finding.code), code: text(finding.code ?? finding.id), severity: text(finding.severity).toUpperCase(),
    type: text(finding.type, 'review_finding'), message: text(finding.message), file: safeSourcePath(finding.file) || null,
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

function canonicalRemoteCodexRoute(availability, remoteCodexWorkerId) {
  const projection = availability.executionSurfaceRoute;
  if (!projection || typeof projection !== 'object') return false;
  const battleBridge = projection.battleBridge;
  return projection.schemaVersion === EXECUTION_SURFACE_ROUTING_POLICY_V1_SCHEMA
    && projection.routeReady === true
    && projection.dispatchAllowed === true
    && projection.selectedRoute === EXECUTION_SURFACE_ROUTE.REMOTE_CODEX_BATTLE_BRIDGE
    && projection.finalVerdict === 'EXECUTION_SURFACE_ROUTE_READY'
    && battleBridge?.attached === true
    && battleBridge?.isWindows === true
    && battleBridge?.canLocalWindowsProof === true
    && battleBridge?.heartbeatFresh === true
    && Boolean(text(battleBridge?.surfaceReceipt))
    && safeWorkerId(battleBridge?.surfaceId) === remoteCodexWorkerId;
}

export function routeGuardedRepairWorker(availability = {}) {
  const githubWorkerId = safeWorkerId(availability.githubFirstWorkerId);
  const openClawWorkerId = safeWorkerId(availability.openClawWorkerId);
  const remoteCodexWorkerId = safeWorkerId(availability.remoteCodexWorkerId);
  if (availability.runtimeRequired !== true && availability.githubFirstAvailable === true && githubWorkerId) return frozen({ route: 'CHATGPT_GITHUB', workerType: 'github-first', workerId: githubWorkerId, reason: 'Bounded repository repair uses the evidenced GitHub-first worker instance.' });
  if (availability.runtimeRequired === true && availability.openClawAvailable === true && openClawWorkerId) return frozen({ route: 'OPENCLAW_LOCAL', workerType: 'openclaw', workerId: openClawWorkerId, reason: 'The repair requires bounded local runtime access.' });
  if (availability.runtimeRequired === true && availability.remoteCodexAvailable === true && remoteCodexWorkerId && canonicalRemoteCodexRoute(availability, remoteCodexWorkerId)) return frozen({ route: 'REMOTE_CODEX', workerType: 'remote-codex', workerId: remoteCodexWorkerId, reason: 'The bounded local route is unavailable and the canonical execution-surface projection proves this exact Remote Codex Battle Bridge worker.' });
  if (availability.runtimeRequired !== true && availability.remoteCodexAvailable === true && remoteCodexWorkerId) return frozen({ route: 'REMOTE_CODEX', workerType: 'remote-codex', workerId: remoteCodexWorkerId, reason: 'GitHub-first execution is unavailable and a qualified provider-neutral fallback is evidenced.' });
  if (availability.runtimeRequired !== true && availability.openClawAvailable === true && openClawWorkerId) return frozen({ route: 'OPENCLAW_LOCAL', workerType: 'openclaw', workerId: openClawWorkerId, reason: 'GitHub-first execution is unavailable and a qualified bounded local fallback is evidenced.' });
  return frozen({ route: 'BLOCKED_UNSAFE_OR_UNKNOWN', workerType: null, workerId: null, reason: 'No qualified evidenced worker instance is available.' });
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
  if (ordered[0]?.state !== 'queued') return { valid: false, receipt: null, stale: true, reason: 'execution-chain-must-start-queued' };
  const receipt = ordered.at(-1) ?? null;
  if (receipt && (receipt.prNumber !== order.prNumber || receipt.workerType !== order.worker.workerType || receipt.workerId !== order.assignedWorkerId)) return { valid: false, receipt: null, stale: true, reason: 'worker-or-pr-identity-mismatch' };
  const projection = projectExecutionReceipt(receipt, { ...options, nowMs });
  return { valid: true, receipt, stale: projection.stale, reason: projection.blocker || '' };
}

function terminalTruth(order, receipts, nowMs) {
  const chain = receiptChain(receipts, order, nowMs);
  return chain.valid && Boolean(chain.receipt && EXECUTION_RECEIPT_TERMINAL_STATES.includes(chain.receipt.state));
}

function orderGeneration(order) { return positiveInt(order?.laneGeneration) ?? positiveInt(order?.retryOrdinal) ?? 1; }

function reconcileLaneCompletion(activeRepairOrders, receipts, lane, nowMs) {
  const matching = activeRepairOrders.filter((entry) => orderMatchesLane(entry, lane));
  if (!matching.length) return { completed: false, invalid: false, reason: '' };
  const reconciled = [];
  for (const order of matching) {
    const chain = receiptChain(receipts, order, nowMs);
    if (!chain.valid) return { completed: false, invalid: true, reason: chain.reason };
    if (!chain.receipt) return { completed: false, invalid: false, reason: 'missing-receipt' };
    if (chain.stale && !EXECUTION_RECEIPT_TERMINAL_STATES.includes(chain.receipt.state)) return { completed: false, invalid: false, reason: 'stale-active-execution' };
    if (!EXECUTION_RECEIPT_TERMINAL_STATES.includes(chain.receipt.state)) return { completed: false, invalid: false, reason: 'nonterminal-execution-owns-lane' };
    reconciled.push({ order, receipt: chain.receipt });
  }
  reconciled.sort((a, b) => orderGeneration(a.order) - orderGeneration(b.order));
  const authoritative = reconciled.at(-1);
  const completed = authoritative?.receipt.state === 'completed';
  return { completed, invalid: false, reason: completed ? '' : `latest-generation-${authoritative?.receipt.state || 'missing'}` };
}

function resolveAllowedFiles(input, findings) {
  const derived = [...new Set(findings.map(({ file }) => safeSourcePath(file)).filter(Boolean))].sort();
  if (input.authorityExpansionRequested === true) return { valid: false, files: [], reason: 'authority-expansion-requested' };
  if (input.allowedFiles === undefined) return { valid: true, files: derived, reason: '' };
  if (!Array.isArray(input.allowedFiles)) return { valid: false, files: [], reason: 'invalid-allowed-files' };
  const requested = [...new Set(input.allowedFiles.map(safeSourcePath).filter(Boolean))].sort();
  if (requested.length !== input.allowedFiles.length || requested.some((path) => !derived.includes(path))) return { valid: false, files: [], reason: 'repair-authority-expansion' };
  return { valid: true, files: requested, reason: '' };
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

function buildOrder({ repository, issueNumber, prNumber, branch, baseSha, headSha, findings, deduplicationKey, worker, allowedFiles, input, retryOrdinal = 1, laneGeneration = 1 }) {
  const identity = shortHash(`${deduplicationKey}:generation-${laneGeneration}:retry-${retryOrdinal}`);
  const repairOrderId = `repair-${issueNumber}-${prNumber}-${headSha.slice(0, 12)}-${identity}`;
  return frozen({
    schemaVersion: 'stephanos.guarded-repair-order.v1', repairOrderId, repository, issueNumber, prNumber, branch, baseSha, headSha,
    findingIds: findings.map(({ id }) => id), findings, deduplicationKey, worker, assignedWorkerId: worker.workerId,
    retryOrdinal, laneGeneration, executionId: `${repairOrderId}-execution`, leaseKey: `${repairOrderId}-lease`, allowedFiles,
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

  const contradictory = activeRepairOrders.find((entry) => entry?.prNumber === prNumber && sha(entry?.headSha) === headSha && !orderMatchesLane(entry, lane));
  if (contradictory) return frozen({ verdict: 'abort-conflicting-repair-order', reason: 'A same-PR exact-head repair order has contradictory canonical lane identity.', repairOrder: contradictory, nextAction: 'STOP_AND_SURFACE_BLOCKER' });

  const findings = normalizeGuardedRepairFindings(rawFindings);
  const deduplicationKey = buildGuardedRepairDeduplicationKey({ repository, issueNumber, prNumber, headSha, findings });

  if (!findings.length) {
    const completion = reconcileLaneCompletion(activeRepairOrders, receipts, lane, nowMs);
    if (completion.invalid) return frozen({ verdict: 'abort-invalid-canonical-receipt-chain', reason: completion.reason, nextAction: 'STOP_AND_SURFACE_BLOCKER' });
    if (!completion.completed) return frozen({ verdict: 'abort-missing-canonical-receipt', reason: `A reconciled completed canonical receipt chain is required (${completion.reason || 'missing'}).`, nextAction: 'WAIT_FOR_CANONICAL_EXECUTION_RECEIPT' });
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
    if (ciExact && input.mergeable === true) return frozen({ verdict: 'safe-to-merge-with-expected-head', expectedHeadSha: headSha, reason: 'Exact-head CI and review are green, the PR is mergeable, finding-free and backed by reconciled canonical completion.', nextAction: 'REQUEST_EXACT_HEAD_MERGE_APPROVAL' });
    return frozen({ verdict: 'repair-published-awaiting-ci', reason: 'Canonical implementation is complete, but exact-head verification or mergeability is incomplete.', nextAction: 'WAIT_FOR_EXACT_HEAD_VERIFICATION' });
  }

  if (findings.some(({ operatorJudgmentRequired }) => operatorJudgmentRequired)) return frozen({ verdict: 'abort-operator-judgment-required', reason: 'A blocking finding requires operator judgment.', nextAction: 'REQUEST_OPERATOR_DECISION' });
  if (findings.some(({ bounded }) => !bounded)) return frozen({ verdict: 'abort-unknown-blocker', reason: 'At least one finding is unbounded or outside the approved lane.', nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  const authority = resolveAllowedFiles(input, findings);
  if (!authority.valid) return frozen({ verdict: 'abort-authority-expansion', reason: authority.reason, nextAction: 'STOP_AND_SURFACE_BLOCKER' });

  const sameHead = activeRepairOrders.filter((order) => orderMatchesLane(order, lane));
  for (const order of sameHead.filter((entry) => entry.deduplicationKey !== deduplicationKey)) {
    const chain = receiptChain(receipts, order, nowMs);
    if (!chain.valid) return frozen({ verdict: 'abort-invalid-canonical-receipt-chain', reason: chain.reason, repairOrder: order, nextAction: 'STOP_AND_SURFACE_BLOCKER' });
    if (!chain.receipt || !EXECUTION_RECEIPT_TERMINAL_STATES.includes(chain.receipt.state) || chain.stale) return frozen({ verdict: 'abort-active-finding-set-change', reason: 'A nonterminal or stale execution already owns this lane and exact head.', repairOrder: order, nextAction: 'WAIT_FOR_ACTIVE_WORKER_RECONCILIATION' });
  }

  const equivalentOrders = sameHead.filter((order) => order.deduplicationKey === deduplicationKey);
  const chains = equivalentOrders.map((order) => ({ order, chain: receiptChain(receipts, order, nowMs) }));
  const invalid = chains.find(({ chain }) => !chain.valid);
  if (invalid) return frozen({ verdict: 'abort-invalid-canonical-receipt-chain', reason: invalid.chain.reason, repairOrder: invalid.order, nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  const active = chains.find(({ chain }) => chain.receipt && ACTIVE_EXECUTION_STATES.has(chain.receipt.state) && !chain.stale);
  if (active) return frozen({ verdict: 'repair-already-active', reason: 'Equivalent repair has fresh canonical ownership evidence.', repairOrder: active.order, executionReceipt: active.chain.receipt, nextAction: 'OBSERVE_EXISTING_REPAIR' });
  const stale = chains.find(({ chain }) => chain.receipt && (ACTIVE_EXECUTION_STATES.has(chain.receipt.state) || chain.receipt.state === 'stalled') && chain.stale);
  if (stale) return frozen({ verdict: 'repair-stale', reason: 'The owning execution heartbeat expired and must terminate before retry.', repairOrder: stale.order, executionReceipt: stale.chain.receipt, nextAction: 'WAIT_FOR_STALE_WORKER_ABORT' });
  const stalled = chains.find(({ chain }) => chain.receipt?.state === 'stalled');
  if (stalled) return frozen({ verdict: 'repair-stalled', reason: stalled.chain.receipt.blocker, repairOrder: stalled.order, executionReceipt: stalled.chain.receipt, nextAction: stalled.chain.receipt.operatorActionRequired ? 'REQUEST_OPERATOR_DECISION' : 'OBSERVE_EXISTING_REPAIR' });
  const withoutReceipt = chains.filter(({ chain }) => !chain.receipt).sort((a, b) => orderGeneration(b.order) - orderGeneration(a.order))[0];
  if (withoutReceipt) {
    const nextReceipt = createQueuedReceipt(withoutReceipt.order, input);
    const receiptValidation = validateExecutionReceipt(nextReceipt, { repository, issueNumber, branch, expectedHead: headSha, executionId: withoutReceipt.order.executionId, leaseKey: withoutReceipt.order.leaseKey });
    if (!receiptValidation.valid) return frozen({ verdict: 'abort-missing-canonical-receipt', reason: receiptValidation.refusalReason, nextAction: 'STOP_AND_SURFACE_BLOCKER' });
    return frozen({ verdict: 'known-blocker-repair-admitted', reason: 'The newest equivalent order exists without execution evidence; its canonical queued receipt must be persisted before routing.', repairOrder: withoutReceipt.order, nextReceipt, nextAction: 'PERSIST_CANONICAL_RECEIPT_THEN_ROUTE_WORKER' });
  }

  for (const order of activeRepairOrders.filter((entry) => entry?.prNumber === prNumber && sha(entry?.headSha) !== headSha)) {
    const chain = receiptChain(receipts, order, nowMs);
    if (!chain.valid || !terminalTruth(order, receipts, nowMs)) return frozen({ verdict: 'abort-stale-worker-active', reason: chain.reason || 'Every prior-head execution must publish a valid canonical terminal chain before rerouting.', repairOrder: order, nextAction: 'WAIT_FOR_STALE_WORKER_ABORT' });
  }

  const worker = routeGuardedRepairWorker(input.workerAvailability ?? {});
  if (worker.route === 'BLOCKED_UNSAFE_OR_UNKNOWN') return frozen({ verdict: 'abort-unknown-blocker', reason: worker.reason, worker, nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  const retryOrdinal = equivalentOrders.length ? Math.max(...equivalentOrders.map((order) => positiveInt(order.retryOrdinal) ?? 1)) + 1 : 1;
  const laneGeneration = sameHead.length ? Math.max(...sameHead.map(orderGeneration)) + 1 : 1;
  const repairOrder = buildOrder({ repository, issueNumber, prNumber, branch, baseSha, headSha, findings, deduplicationKey, worker, allowedFiles: authority.files, input, retryOrdinal, laneGeneration });
  const nextReceipt = createQueuedReceipt(repairOrder, input);
  const receiptValidation = validateExecutionReceipt(nextReceipt, { repository, issueNumber, branch, expectedHead: headSha, executionId: repairOrder.executionId, leaseKey: repairOrder.leaseKey });
  if (!receiptValidation.valid) return frozen({ verdict: 'abort-missing-canonical-receipt', reason: receiptValidation.refusalReason, nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  return frozen({ verdict: 'known-blocker-repair-admitted', reason: laneGeneration > 1 ? 'All prior lane executions are terminal; a new lane-global repair generation with a distinct execution and lease was admitted.' : 'A bounded exact-head blocker was admitted with a distinct canonical execution identity.', repairOrder, nextReceipt, nextAction: 'PERSIST_CANONICAL_RECEIPT_THEN_ROUTE_WORKER' });
}
