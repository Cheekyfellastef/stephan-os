import { createHash } from 'node:crypto';
import { evaluateGuardedRepairLoop } from './guardedGoalRunnerRepairLoopV1.mjs';

const SHA_RE = /^[0-9a-f]{40}$/i;
const DEFAULT_MAX_ITERATIONS = 12;
const DEFAULT_MAX_REPAIRS_PER_HEAD = 4;
const ACTIONS = Object.freeze({
  PERSIST_AND_ROUTE: 'PERSIST_CANONICAL_RECEIPT_THEN_ROUTE_WORKER',
  OBSERVE_REPAIR: 'OBSERVE_EXISTING_REPAIR',
  WAIT_RECEIPT: 'WAIT_FOR_CANONICAL_EXECUTION_RECEIPT',
  WAIT_VERIFY: 'WAIT_FOR_EXACT_HEAD_VERIFICATION',
  REQUEST_MERGE: 'REQUEST_EXACT_HEAD_MERGE_APPROVAL',
  COMPLETE: 'COMPLETE_AND_SELECT_NEXT_GOAL',
});

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function sha(value) { const candidate = text(value); return candidate && SHA_RE.test(candidate) ? candidate.toLowerCase() : null; }
function positiveInt(value, fallback) { return Number.isSafeInteger(value) && value > 0 ? value : fallback; }
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}
function requireFunction(value, name) { if (typeof value !== 'function') throw new TypeError(`${name} must be a function`); return value; }
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16); }

function cycleIdentity(snapshot, verdict, iteration) {
  return `repair-cycle-${snapshot.prNumber}-${sha(snapshot.headSha)?.slice(0, 12) || 'unknown'}-${iteration}-${digest({ verdict: verdict.verdict, findings: verdict.repairOrder?.findingIds ?? [] })}`;
}

function cycleReceipt(snapshot, verdict, iteration, status, details = {}) {
  return freeze({
    schema: 'Stephanos Guarded Continuous Repair Cycle V1',
    cycleId: cycleIdentity(snapshot, verdict, iteration),
    repository: text(snapshot.repository),
    issueNumber: snapshot.issueNumber,
    prNumber: snapshot.prNumber,
    headSha: sha(snapshot.headSha),
    iteration,
    status,
    verdict: verdict.verdict,
    nextAction: verdict.nextAction,
    repairOrderId: verdict.repairOrder?.repairOrderId ?? null,
    findingIds: verdict.repairOrder?.findingIds ?? [],
    mergeAuthority: false,
    approvalAuthority: false,
    ...details,
  });
}

function repairCountForHead(history, headSha) {
  return history.filter((entry) => entry?.status === 'repair-dispatched' && sha(entry?.headSha) === headSha).length;
}

function terminal(status, receipt, history) {
  return freeze({ status, receipt, history: freeze([...history]), mergeAuthority: false, approvalAuthority: false });
}

/**
 * Drives one active PR through repeated bounded repair observations.
 * All mutation is delegated to explicit adapters. The controller cannot merge
 * or approve; merge-ready is a terminal handoff to the operator gate.
 */
export async function runGuardedContinuousRepairCycle(options = {}) {
  const loadSnapshot = requireFunction(options.loadSnapshot, 'loadSnapshot');
  const persistCycleReceipt = requireFunction(options.persistCycleReceipt, 'persistCycleReceipt');
  const persistExecutionReceipt = requireFunction(options.persistExecutionReceipt, 'persistExecutionReceipt');
  const dispatchRepair = requireFunction(options.dispatchRepair, 'dispatchRepair');
  const requestExactHeadVerification = requireFunction(options.requestExactHeadVerification, 'requestExactHeadVerification');
  const maxIterations = positiveInt(options.maxIterations, DEFAULT_MAX_ITERATIONS);
  const maxRepairsPerHead = positiveInt(options.maxRepairsPerHead, DEFAULT_MAX_REPAIRS_PER_HEAD);
  const history = Array.isArray(options.history) ? [...options.history] : [];
  let previousFingerprint = null;
  let unchangedObservations = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const snapshot = await loadSnapshot({ iteration, previousReceipt: history.at(-1) ?? null });
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      const receipt = cycleReceipt({}, { verdict: 'abort-missing-proof', nextAction: 'STOP_AND_SURFACE_BLOCKER' }, iteration, 'blocked', { reason: 'Durable repair snapshot is missing or malformed.' });
      await persistCycleReceipt(receipt); history.push(receipt);
      return terminal('BLOCKED', receipt, history);
    }

    const verdict = evaluateGuardedRepairLoop(snapshot);
    const fingerprint = digest({
      headSha: sha(snapshot.headSha),
      verdict: verdict.verdict,
      nextAction: verdict.nextAction,
      findings: verdict.repairOrder?.findingIds ?? snapshot.findings ?? [],
      receiptState: verdict.executionReceipt?.state ?? null,
    });
    unchangedObservations = fingerprint === previousFingerprint ? unchangedObservations + 1 : 0;
    previousFingerprint = fingerprint;

    if (unchangedObservations >= 2 && ![ACTIONS.OBSERVE_REPAIR, ACTIONS.WAIT_RECEIPT, ACTIONS.WAIT_VERIFY].includes(verdict.nextAction)) {
      const receipt = cycleReceipt(snapshot, verdict, iteration, 'blocked', { reason: 'The repair loop repeated the same non-waiting state without progress.' });
      await persistCycleReceipt(receipt); history.push(receipt);
      return terminal('BLOCKED_REPEATED_STATE', receipt, history);
    }

    if (verdict.nextAction === ACTIONS.PERSIST_AND_ROUTE) {
      const headSha = sha(snapshot.headSha);
      if (repairCountForHead(history, headSha) >= maxRepairsPerHead) {
        const receipt = cycleReceipt(snapshot, verdict, iteration, 'blocked', { reason: 'The exact head exceeded its bounded automatic repair budget.' });
        await persistCycleReceipt(receipt); history.push(receipt);
        return terminal('BLOCKED_REPAIR_BUDGET', receipt, history);
      }
      await persistExecutionReceipt(verdict.nextReceipt, { snapshot, verdict });
      const dispatchResult = await dispatchRepair(verdict.repairOrder, { snapshot, verdict });
      const receipt = cycleReceipt(snapshot, verdict, iteration, 'repair-dispatched', {
        dispatchAccepted: dispatchResult?.accepted === true,
        workerTaskId: text(dispatchResult?.workerTaskId),
      });
      await persistCycleReceipt(receipt); history.push(receipt);
      if (dispatchResult?.accepted !== true) return terminal('BLOCKED_DISPATCH_REJECTED', receipt, history);
      continue;
    }

    if ([ACTIONS.OBSERVE_REPAIR, ACTIONS.WAIT_RECEIPT].includes(verdict.nextAction)) {
      const receipt = cycleReceipt(snapshot, verdict, iteration, 'waiting-repair', { reason: verdict.reason });
      await persistCycleReceipt(receipt); history.push(receipt);
      continue;
    }

    if (verdict.nextAction === ACTIONS.WAIT_VERIFY) {
      const request = await requestExactHeadVerification({ snapshot, verdict, headSha: sha(snapshot.headSha) });
      const receipt = cycleReceipt(snapshot, verdict, iteration, 'verification-requested', {
        verificationAccepted: request?.accepted === true,
        verificationId: text(request?.verificationId),
      });
      await persistCycleReceipt(receipt); history.push(receipt);
      if (request?.accepted !== true) return terminal('BLOCKED_VERIFICATION_REJECTED', receipt, history);
      continue;
    }

    if (verdict.nextAction === ACTIONS.REQUEST_MERGE) {
      const receipt = cycleReceipt(snapshot, verdict, iteration, 'merge-ready', {
        expectedHeadSha: sha(verdict.expectedHeadSha ?? snapshot.headSha),
        reason: verdict.reason,
      });
      await persistCycleReceipt(receipt); history.push(receipt);
      return terminal('MERGE_READY', receipt, history);
    }

    if (verdict.nextAction === ACTIONS.COMPLETE) {
      const receipt = cycleReceipt(snapshot, verdict, iteration, 'complete', { reason: verdict.reason });
      await persistCycleReceipt(receipt); history.push(receipt);
      return terminal('COMPLETE', receipt, history);
    }

    const receipt = cycleReceipt(snapshot, verdict, iteration, 'blocked', { reason: verdict.reason });
    await persistCycleReceipt(receipt); history.push(receipt);
    return terminal('BLOCKED', receipt, history);
  }

  const last = history.at(-1) ?? freeze({ schema: 'Stephanos Guarded Continuous Repair Cycle V1', status: 'blocked', reason: 'Iteration budget exhausted.' });
  return terminal('BLOCKED_ITERATION_BUDGET', last, history);
}
