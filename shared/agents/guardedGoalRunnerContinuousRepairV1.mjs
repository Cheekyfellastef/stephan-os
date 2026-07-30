import { createHash } from 'node:crypto';
import { createExecutionReceipt } from './executionReceiptV1.mjs';
import { evaluateGuardedRepairLoop } from './guardedGoalRunnerRepairLoopV1.mjs';

const SHA_RE = /^[0-9a-f]{40}$/i;
const ACTIONS = new Set(['OBSERVE_EXISTING_REPAIR', 'WAIT_FOR_CANONICAL_EXECUTION_RECEIPT']);
const CYCLE_SCHEMA = 'Stephanos Guarded Continuous Repair Cycle V1';

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sha(value) {
  const candidate = text(value);
  return candidate && SHA_RE.test(candidate) ? candidate.toLowerCase() : null;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

function requiredFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function validAttemptId(value) {
  const candidate = text(value);
  return candidate && candidate.length <= 120 ? candidate : null;
}

function cycleId(snapshot, verdict, iteration, attemptId, predecessorCycleId) {
  const identity = [
    text(snapshot.repository)?.toLowerCase(),
    snapshot.issueNumber,
    snapshot.prNumber,
    text(snapshot.branch),
    sha(snapshot.headSha),
    attemptId,
    predecessorCycleId,
    iteration,
    verdict.verdict,
    verdict.repairOrder?.findingIds ?? [],
  ];
  return `repair-cycle-${snapshot.prNumber ?? 'unknown'}-${sha(snapshot.headSha)?.slice(0, 12) ?? 'unknown'}-${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 16)}`;
}

function cycleReceipt(snapshot, verdict, iteration, status, context, extra = {}) {
  const predecessorCycleId = text(context.previousReceipt?.cycleId);
  return freeze({
    schema:CYCLE_SCHEMA,
    cycleId:cycleId(snapshot, verdict, iteration, context.attemptId, predecessorCycleId),
    attemptId:context.attemptId,
    predecessorCycleId,
    repository:text(snapshot.repository),
    issueNumber:snapshot.issueNumber,
    prNumber:snapshot.prNumber,
    branch:text(snapshot.branch),
    headSha:sha(snapshot.headSha),
    iteration,
    status,
    verdict:verdict.verdict,
    nextAction:verdict.nextAction,
    repairOrderId:verdict.repairOrder?.repairOrderId ?? null,
    findingIds:verdict.repairOrder?.findingIds ?? [],
    ...extra,
    mergeAuthority:false,
    approvalAuthority:false,
  });
}

function result(status, last, history) {
  return freeze({
    status,
    receipt:last,
    history:[...history],
    mergeAuthority:false,
    approvalAuthority:false,
  });
}

function snapshotValid(snapshot) {
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot);
}

function historyReceiptMatchesLane(entry, snapshot) {
  return Boolean(
    entry
    && entry.schema === CYCLE_SCHEMA
    && text(entry.cycleId)
    && validAttemptId(entry.attemptId)
    && text(entry.repository)?.toLowerCase() === text(snapshot.repository)?.toLowerCase()
    && entry.issueNumber === snapshot.issueNumber
    && entry.prNumber === snapshot.prNumber
    && text(entry.branch) === text(snapshot.branch)
    && sha(entry.headSha)
    && entry.mergeAuthority === false
    && entry.approvalAuthority === false
  );
}

function pendingVerification(history, snapshot) {
  return [...history].reverse().find((entry) => (
    entry?.status === 'verification-requested'
    && entry.verificationAccepted === true
    && sha(entry.headSha) === sha(snapshot.headSha)
    && text(entry.verificationId)
  )) ?? null;
}

function terminalDispatchReceipt(queuedReceipt, snapshot, reason) {
  const queuedAt = Date.parse(queuedReceipt.timestampUtc);
  const snapshotAt = Date.parse(snapshot.nowUtc);
  const timestampMs = Number.isFinite(snapshotAt) && snapshotAt > queuedAt ? snapshotAt : queuedAt + 1;
  return createExecutionReceipt({
    repository:queuedReceipt.repository,
    issueNumber:queuedReceipt.issueNumber,
    prNumber:queuedReceipt.prNumber,
    branch:queuedReceipt.branch,
    sourceHead:queuedReceipt.sourceHead,
    workerId:queuedReceipt.workerId,
    workerType:queuedReceipt.workerType,
    executionId:queuedReceipt.executionId,
    leaseKey:queuedReceipt.leaseKey,
    state:'failed',
    phase:'repair-dispatch-rejected',
    sequence:queuedReceipt.sequence + 1,
    predecessorReceiptId:queuedReceipt.receiptId,
    timestampUtc:new Date(timestampMs).toISOString(),
    heartbeatExpiresAtUtc:new Date(timestampMs + 60_000).toISOString(),
    blocker:text(reason) ?? 'REPAIR_DISPATCH_REJECTED',
    operatorActionRequired:false,
    proofRefs:Array.isArray(queuedReceipt.proofRefs) ? queuedReceipt.proofRefs : [],
    expectedNextAction:'',
  });
}

export async function runGuardedContinuousRepairCycle(options = {}) {
  const loadSnapshot = requiredFunction(options.loadSnapshot, 'loadSnapshot');
  const persistCycleReceipt = requiredFunction(options.persistCycleReceipt, 'persistCycleReceipt');
  const persistExecutionReceipt = requiredFunction(options.persistExecutionReceipt, 'persistExecutionReceipt');
  const dispatchRepair = requiredFunction(options.dispatchRepair, 'dispatchRepair');
  const requestExactHeadVerification = requiredFunction(options.requestExactHeadVerification, 'requestExactHeadVerification');
  const attemptId = validAttemptId(options.attemptId);
  if (!attemptId) throw new TypeError('attemptId must be a durable non-empty identifier');

  const maxIterations = Number.isSafeInteger(options.maxIterations) && options.maxIterations > 0
    ? options.maxIterations
    : 12;
  const maxRepairsPerHead = Number.isSafeInteger(options.maxRepairsPerHead) && options.maxRepairsPerHead > 0
    ? options.maxRepairsPerHead
    : 4;

  let historySource;
  let historyLoadError = null;
  if (Array.isArray(options.history)) {
    historySource = options.history;
  } else if (typeof options.loadCycleHistory === 'function') {
    try {
      historySource = await options.loadCycleHistory({ attemptId });
    } catch (error) {
      historyLoadError = error;
    }
  }

  const provisionalHistory = Array.isArray(historySource) ? [...historySource] : [];
  let snapshot = await loadSnapshot({
    iteration:1,
    previousReceipt:provisionalHistory.at(-1) ?? null,
  });
  if (!snapshotValid(snapshot)) {
    const verdict = { verdict:'abort-missing-proof', nextAction:'STOP_AND_SURFACE_BLOCKER' };
    const blocked = cycleReceipt({}, verdict, 1, 'blocked', {
      attemptId,
      previousReceipt:null,
    }, {
      reason:'Durable repair snapshot is missing or malformed.',
    });
    await persistCycleReceipt(blocked);
    return result('BLOCKED', blocked, [blocked]);
  }

  if (!Array.isArray(historySource) || historyLoadError) {
    const verdict = { verdict:'abort-history-unavailable', nextAction:'STOP_AND_SURFACE_BLOCKER' };
    const blocked = cycleReceipt(snapshot, verdict, 1, 'blocked-history-unavailable', {
      attemptId,
      previousReceipt:null,
    }, {
      reason:historyLoadError ? 'Durable cycle history could not be loaded.' : 'Durable cycle history is required.',
    });
    await persistCycleReceipt(blocked);
    return result('BLOCKED_HISTORY_UNAVAILABLE', blocked, [blocked]);
  }
  if (provisionalHistory.some((entry) => !historyReceiptMatchesLane(entry, snapshot))) {
    const verdict = { verdict:'abort-history-invalid', nextAction:'STOP_AND_SURFACE_BLOCKER' };
    const blocked = cycleReceipt(snapshot, verdict, 1, 'blocked-history-invalid', {
      attemptId,
      previousReceipt:null,
    }, {
      reason:'Durable cycle history is malformed or belongs to another lane.',
    });
    await persistCycleReceipt(blocked);
    return result('BLOCKED_HISTORY_INVALID', blocked, [blocked]);
  }

  const history = provisionalHistory;
  let lastSnapshot = snapshot;
  let lastVerdict = { verdict:'abort-missing-proof', nextAction:'STOP_AND_SURFACE_BLOCKER' };
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    if (iteration > 1) {
      snapshot = await loadSnapshot({
        iteration,
        previousReceipt:history.at(-1) ?? null,
      });
      if (!snapshotValid(snapshot)) {
        const blocked = cycleReceipt({}, lastVerdict, iteration, 'blocked', {
          attemptId,
          previousReceipt:history.at(-1) ?? null,
        }, {
          reason:'Durable repair snapshot is missing or malformed.',
        });
        await persistCycleReceipt(blocked);
        history.push(blocked);
        return result('BLOCKED', blocked, history);
      }
    }
    lastSnapshot = snapshot;
    const verdict = evaluateGuardedRepairLoop(snapshot);
    lastVerdict = verdict;

    if (verdict.nextAction === 'PERSIST_CANONICAL_RECEIPT_THEN_ROUTE_WORKER') {
      const count = history.filter((entry) => (
        entry?.status === 'repair-dispatched'
        && sha(entry.headSha) === sha(snapshot.headSha)
      )).length;
      if (count >= maxRepairsPerHead) {
        const blocked = cycleReceipt(snapshot, verdict, iteration, 'blocked-repair-budget', {
          attemptId,
          previousReceipt:history.at(-1) ?? null,
        }, {
          reason:'Automatic repair budget exhausted for this exact head.',
        });
        await persistCycleReceipt(blocked);
        history.push(blocked);
        return result('BLOCKED_REPAIR_BUDGET', blocked, history);
      }
      await persistExecutionReceipt(verdict.nextReceipt, { snapshot, verdict });
      let dispatched;
      let dispatchError = null;
      try {
        dispatched = await dispatchRepair(verdict.repairOrder, { snapshot, verdict });
      } catch (error) {
        dispatchError = error;
      }
      if (dispatched?.accepted !== true) {
        const reason = text(dispatched?.reason) ?? text(dispatchError?.message) ?? 'REPAIR_DISPATCH_REJECTED';
        const terminal = terminalDispatchReceipt(verdict.nextReceipt, snapshot, reason);
        await persistExecutionReceipt(terminal, { snapshot, verdict, terminal:true });
        const blocked = cycleReceipt(snapshot, verdict, iteration, 'blocked-dispatch-rejected', {
          attemptId,
          previousReceipt:history.at(-1) ?? null,
        }, {
          reason,
          dispatchAccepted:false,
          terminalExecutionReceiptId:terminal.receiptId,
        });
        await persistCycleReceipt(blocked);
        history.push(blocked);
        return result('BLOCKED_DISPATCH_REJECTED', blocked, history);
      }
      const dispatchedReceipt = cycleReceipt(snapshot, verdict, iteration, 'repair-dispatched', {
        attemptId,
        previousReceipt:history.at(-1) ?? null,
      }, {
        dispatchAccepted:true,
        workerTaskId:text(dispatched.workerTaskId),
      });
      await persistCycleReceipt(dispatchedReceipt);
      history.push(dispatchedReceipt);
      return result('WAITING_FOR_REPAIR', dispatchedReceipt, history);
    }

    if (ACTIONS.has(verdict.nextAction)) {
      const waiting = cycleReceipt(snapshot, verdict, iteration, 'waiting-repair', {
        attemptId,
        previousReceipt:history.at(-1) ?? null,
      }, {
        reason:verdict.reason,
      });
      await persistCycleReceipt(waiting);
      history.push(waiting);
      continue;
    }

    if (verdict.nextAction === 'WAIT_FOR_EXACT_HEAD_VERIFICATION') {
      const existing = pendingVerification(history, snapshot);
      if (existing) return result('WAITING_FOR_VERIFICATION', existing, history);
      let verification;
      let verificationError = null;
      try {
        verification = await requestExactHeadVerification({
          snapshot,
          verdict,
          headSha:sha(snapshot.headSha),
        });
      } catch (error) {
        verificationError = error;
      }
      const accepted = verification?.accepted === true;
      const verificationReceipt = cycleReceipt(
        snapshot,
        verdict,
        iteration,
        accepted ? 'verification-requested' : 'blocked-verification-rejected',
        {
          attemptId,
          previousReceipt:history.at(-1) ?? null,
        },
        {
          reason:accepted ? verdict.reason : text(verification?.reason) ?? text(verificationError?.message) ?? 'EXACT_HEAD_VERIFICATION_REJECTED',
          verificationAccepted:accepted,
          verificationId:text(verification?.verificationId),
        },
      );
      await persistCycleReceipt(verificationReceipt);
      history.push(verificationReceipt);
      return result(
        accepted ? 'WAITING_FOR_VERIFICATION' : 'BLOCKED_VERIFICATION_REJECTED',
        verificationReceipt,
        history,
      );
    }

    if (verdict.nextAction === 'REQUEST_EXACT_HEAD_MERGE_APPROVAL') {
      const mergeReady = cycleReceipt(snapshot, verdict, iteration, 'merge-ready', {
        attemptId,
        previousReceipt:history.at(-1) ?? null,
      }, {
        expectedHeadSha:sha(verdict.expectedHeadSha ?? snapshot.headSha),
        reason:verdict.reason,
      });
      await persistCycleReceipt(mergeReady);
      history.push(mergeReady);
      return result('MERGE_READY', mergeReady, history);
    }

    if (verdict.nextAction === 'COMPLETE_AND_SELECT_NEXT_GOAL') {
      const complete = cycleReceipt(snapshot, verdict, iteration, 'complete', {
        attemptId,
        previousReceipt:history.at(-1) ?? null,
      }, {
        reason:verdict.reason,
      });
      await persistCycleReceipt(complete);
      history.push(complete);
      return result('COMPLETE', complete, history);
    }

    const blocked = cycleReceipt(snapshot, verdict, iteration, 'blocked', {
      attemptId,
      previousReceipt:history.at(-1) ?? null,
    }, {
      reason:verdict.reason,
    });
    await persistCycleReceipt(blocked);
    history.push(blocked);
    return result('BLOCKED', blocked, history);
  }

  const exhausted = cycleReceipt(lastSnapshot, lastVerdict, maxIterations + 1, 'blocked-iteration-budget', {
    attemptId,
    previousReceipt:history.at(-1) ?? null,
  }, {
    reason:'Continuous repair iteration budget exhausted.',
  });
  await persistCycleReceipt(exhausted);
  history.push(exhausted);
  return result('BLOCKED_ITERATION_BUDGET', exhausted, history);
}
