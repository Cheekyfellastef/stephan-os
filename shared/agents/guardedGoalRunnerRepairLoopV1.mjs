const SHA_RE = /^[0-9a-f]{40}$/i;
const BLOCKING = new Set(['P0', 'P1', 'P2']);
const ACTIVE_RECEIPTS = new Set(['repair_accepted', 'repair_started', 'repair_heartbeat', 'repair_published', 'verification_waiting']);
const TERMINAL_RECEIPTS = new Set(['blocked', 'complete', 'aborted']);

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

export const GUARDED_REPAIR_RECEIPT_STATES = Object.freeze([
  'repair_requested',
  'repair_accepted',
  'repair_started',
  'repair_heartbeat',
  'repair_published',
  'verification_waiting',
  'blocked',
  'complete',
  'aborted',
]);

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
    return frozen({ route: 'CHATGPT_GITHUB', reason: 'Bounded repository repair uses the evidenced GitHub-first default.' });
  }
  if (availability.runtimeRequired === true && availability.openClawAvailable === true) {
    return frozen({ route: 'OPENCLAW_LOCAL', reason: 'The repair requires bounded local runtime access.' });
  }
  if (availability.remoteCodexAvailable === true) {
    return frozen({ route: 'REMOTE_CODEX', reason: availability.runtimeRequired === true ? 'Runtime access is required and the bounded local route is unavailable.' : 'GitHub-first execution is unavailable and a qualified provider-neutral fallback is evidenced.' });
  }
  if (availability.openClawAvailable === true) {
    return frozen({ route: 'OPENCLAW_LOCAL', reason: 'GitHub-first execution is unavailable and a qualified bounded local fallback is evidenced.' });
  }
  return frozen({ route: 'BLOCKED_UNSAFE_OR_UNKNOWN', reason: 'No qualified evidenced worker is available.' });
}

function latestReceipt(receipts, key) {
  return [...receipts].reverse().find((receipt) => receipt?.deduplicationKey === key) ?? null;
}

function matchingReceipt(receipt, order, headSha) {
  return Boolean(
    receipt
    && receipt.repairOrderId === order.repairOrderId
    && receipt.deduplicationKey === order.deduplicationKey
    && sha(receipt.headSha) === headSha
    && text(receipt.workerTaskId),
  );
}

function hasTerminalReceipt(order, receipts) {
  const receipt = latestReceipt(receipts, order.deduplicationKey);
  return Boolean(
    receipt
    && receipt.repairOrderId === order.repairOrderId
    && sha(receipt.headSha) === sha(order.headSha)
    && TERMINAL_RECEIPTS.has(receipt.state),
  );
}

export function evaluateGuardedRepairLoop(input = {}) {
  const repository = text(input.repository).toLowerCase();
  const issueNumber = positiveInt(input.issueNumber);
  const prNumber = positiveInt(input.prNumber);
  const baseSha = sha(input.baseSha);
  const expectedBaseSha = sha(input.expectedBaseSha);
  const headSha = sha(input.headSha);
  const proofHeadSha = sha(input.proofHeadSha);
  const rawFindings = input.findings;

  if (input.activeLaneKnown !== true || !repository || !issueNumber || !prNumber || !baseSha || !expectedBaseSha || !headSha) {
    return frozen({ verdict: 'abort-missing-proof', reason: 'Canonical lane identity and independently evidenced full source SHAs are required.', nextAction: 'STOP_AND_SURFACE_BLOCKER' });
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
    if (input.merged === true && input.runtimeProofRequired === true) {
      if (input.ciGreen !== true) {
        return frozen({ verdict: 'repair-published-awaiting-ci', reason: 'The exact merged head has not yet produced green CI proof.', nextAction: 'WAIT_FOR_EXACT_HEAD_VERIFICATION' });
      }
      return frozen({
        verdict: input.runtimeProofGreen === true ? 'goal-green' : 'repair-published-awaiting-ci',
        reason: input.runtimeProofGreen === true ? 'The approved exact head is merged, exact-head CI is green and runtime proof is green.' : 'Post-merge runtime verification is incomplete.',
        nextAction: input.runtimeProofGreen === true ? 'COMPLETE_AND_SELECT_NEXT_GOAL' : 'WAIT_FOR_EXACT_HEAD_VERIFICATION',
      });
    }
    if (input.merged === true && input.runtimeProofRequired === false && input.ciGreen === true) {
      return frozen({ verdict: 'goal-green', reason: 'The approved exact head is merged, exact-head CI is green and no runtime proof is required.', nextAction: 'COMPLETE_AND_SELECT_NEXT_GOAL' });
    }
    if (input.ciGreen === true && input.mergeable === true && input.merged !== true) {
      return frozen({ verdict: 'safe-to-merge-with-expected-head', expectedHeadSha: headSha, reason: 'The exact head is green, mergeable and finding-free.', nextAction: 'REQUEST_EXACT_HEAD_MERGE_APPROVAL' });
    }
    return frozen({ verdict: 'repair-published-awaiting-ci', reason: 'No actionable finding remains, but exact-head verification, explicit proof scope or merge state is incomplete.', nextAction: 'WAIT_FOR_EXACT_HEAD_VERIFICATION' });
  }

  if (findings.some(({ operatorJudgmentRequired }) => operatorJudgmentRequired)) {
    return frozen({ verdict: 'abort-operator-judgment-required', reason: 'A blocking finding requires operator judgment.', nextAction: 'REQUEST_OPERATOR_DECISION' });
  }
  if (findings.some(({ bounded }) => !bounded)) {
    return frozen({ verdict: 'abort-unknown-blocker', reason: 'At least one finding is unbounded or outside the approved lane.', nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  }

  const activeRepairOrders = Array.isArray(input.activeRepairOrders) ? input.activeRepairOrders : [];
  const receipts = Array.isArray(input.receipts) ? input.receipts : [];
  const sameHeadConflicts = activeRepairOrders.filter((order) => (
    order?.prNumber === prNumber
    && sha(order?.headSha) === headSha
    && order?.deduplicationKey !== deduplicationKey
  ));
  const nonterminalSameHead = sameHeadConflicts.find((order) => !hasTerminalReceipt(order, receipts));
  if (nonterminalSameHead) {
    return frozen({ verdict: 'abort-active-finding-set-change', reason: 'A nonterminal repair already owns this PR and exact head; reconcile or terminate it before admitting or rerouting another finding set.', repairOrder: nonterminalSameHead, nextAction: 'WAIT_FOR_ACTIVE_WORKER_RECONCILIATION' });
  }

  const existing = activeRepairOrders.find((order) => order?.deduplicationKey === deduplicationKey);
  if (existing) {
    const receipt = latestReceipt(receipts, deduplicationKey);
    const executionEvidenced = matchingReceipt(receipt, existing, headSha) && ACTIVE_RECEIPTS.has(receipt.state);
    if (executionEvidenced) {
      return frozen({
        verdict: 'repair-already-active',
        reason: 'An equivalent repair has accepted or started evidence bound to this order and head.',
        repairOrder: existing,
        nextAction: 'OBSERVE_EXISTING_REPAIR',
      });
    }
    const refreshedWorker = routeGuardedRepairWorker(input.workerAvailability ?? {});
    if (refreshedWorker.route === 'BLOCKED_UNSAFE_OR_UNKNOWN') {
      return frozen({ verdict: 'abort-unknown-blocker', reason: refreshedWorker.reason, worker: refreshedWorker, repairOrder: existing, nextAction: 'STOP_AND_SURFACE_BLOCKER' });
    }
    return frozen({
      verdict: 'known-blocker-repair-admitted',
      reason: 'The order exists without execution evidence; its worker route has been refreshed from current availability truth.',
      repairOrder: frozen({ ...existing, worker: refreshedWorker }),
      nextAction: 'ROUTE_OR_FAIL_OVER_WORKER',
    });
  }

  const staleActive = activeRepairOrders.filter((order) => order?.prNumber === prNumber && sha(order?.headSha) !== headSha);
  const nonterminalStale = staleActive.find((order) => !hasTerminalReceipt(order, receipts));
  if (nonterminalStale) {
    return frozen({ verdict: 'abort-stale-worker-active', reason: 'Every prior-head repair must publish terminal or aborted evidence before rerouting.', repairOrder: nonterminalStale, nextAction: 'WAIT_FOR_STALE_WORKER_ABORT' });
  }

  const worker = routeGuardedRepairWorker(input.workerAvailability ?? {});
  if (worker.route === 'BLOCKED_UNSAFE_OR_UNKNOWN') {
    return frozen({ verdict: 'abort-unknown-blocker', reason: worker.reason, worker, nextAction: 'STOP_AND_SURFACE_BLOCKER' });
  }

  const repairOrder = frozen({
    schemaVersion: 'stephanos.guarded-repair-order.v1',
    repairOrderId: `repair-${issueNumber}-${prNumber}-${headSha.slice(0, 12)}`,
    repository,
    issueNumber,
    prNumber,
    baseSha,
    headSha,
    findingIds: findings.map(({ id }) => id),
    findings,
    deduplicationKey,
    worker,
    allowedFiles: [...new Set((input.allowedFiles ?? findings.map(({ file }) => file)).filter(Boolean))].sort(),
    allowedTests: [...new Set((input.allowedTests ?? []).map(String).filter(Boolean))].sort(),
    mergePolicy: { automaticApproval: false, expectedHeadSha: headSha },
    abortConditions: ['head_changed', 'base_changed', 'conflicting_pr', 'unknown_blocker', 'operator_judgment_required', 'authority_expansion_requested'],
  });

  return frozen({
    verdict: 'known-blocker-repair-admitted',
    reason: 'A bounded exact-head blocker was admitted without operator courier work.',
    repairOrder,
    nextReceipt: { state: 'repair_requested', repairOrderId: repairOrder.repairOrderId, deduplicationKey, headSha },
    nextAction: 'PUBLISH_REPAIR_REQUEST_AND_ROUTE_WORKER',
  });
}
