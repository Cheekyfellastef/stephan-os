import { createHash } from 'node:crypto';
import {
  classifyExecutionReceiptSet,
  createExecutionReceipt,
  EXECUTION_RECEIPT_TERMINAL_STATES,
  validateExecutionReceipt,
} from './executionReceiptV1.mjs';
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

function detailHash(details) {
  return createHash('sha256').update(JSON.stringify(details)).digest('hex');
}

function cycleId(snapshot, verdict, iteration, attemptId, predecessorCycleId, status, integrityDetailsHash) {
  const identity = [
    text(snapshot.repository)?.toLowerCase(),
    snapshot.issueNumber,
    snapshot.prNumber,
    text(snapshot.branch),
    sha(snapshot.headSha),
    attemptId,
    predecessorCycleId,
    iteration,
    status,
    verdict.verdict,
    verdict.nextAction,
    verdict.repairOrder?.findingIds ?? [],
    integrityDetailsHash,
  ];
  return `repair-cycle-${snapshot.prNumber ?? 'unknown'}-${sha(snapshot.headSha)?.slice(0, 12) ?? 'unknown'}-${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 16)}`;
}

function cycleReceipt(snapshot, verdict, iteration, status, context, extra = {}) {
  const predecessorCycleId = text(context.previousReceipt?.cycleId);
  const integrityDetails = freeze({ ...extra });
  const integrityDetailsHash = detailHash(integrityDetails);
  return freeze({
    schema:CYCLE_SCHEMA,
    cycleId:cycleId(
      snapshot,
      verdict,
      iteration,
      context.attemptId,
      predecessorCycleId,
      status,
      integrityDetailsHash,
    ),
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
    integrityDetails,
    integrityDetailsHash,
    ...integrityDetails,
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

async function persistOutcome(persist, receipt, context) {
  try {
    const response = await persist(receipt, context);
    return {
      ok:response?.ok === true,
      reason:text(response?.reason) ?? (response?.ok === true ? null : 'PERSISTENCE_NOT_AFFIRMED'),
    };
  } catch (error) {
    return { ok:false, reason:text(error?.message) ?? 'PERSISTENCE_FAILED' };
  }
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
    && sha(entry.headSha) === sha(snapshot.headSha)
    && entry.mergeAuthority === false
    && entry.approvalAuthority === false
  );
}

function historyEntryInLaneHeadScope(entry, snapshot) {
  return Boolean(
    entry
    && text(entry.repository)?.toLowerCase() === text(snapshot.repository)?.toLowerCase()
    && entry.issueNumber === snapshot.issueNumber
    && entry.prNumber === snapshot.prNumber
    && text(entry.branch) === text(snapshot.branch)
    && sha(entry.headSha) === sha(snapshot.headSha)
  );
}

function historyForLaneHead(history, snapshot) {
  return history.filter((entry) => historyEntryInLaneHeadScope(entry, snapshot));
}

function sameLaneIdentity(left, right) {
  return Boolean(
    text(left?.repository)?.toLowerCase() === text(right?.repository)?.toLowerCase()
    && left?.issueNumber === right?.issueNumber
    && left?.prNumber === right?.prNumber
    && text(left?.branch) === text(right?.branch)
  );
}

function historyValid(history, snapshot) {
  let predecessorCycleId = null;
  const cycleIds = new Set();
  for (const entry of history) {
    const integrityDetails = entry?.integrityDetails;
    const integrityDetailsHash = integrityDetails && typeof integrityDetails === 'object' && !Array.isArray(integrityDetails)
      ? detailHash(integrityDetails)
      : null;
    const topLevelDetailsMatch = integrityDetails && Object.entries(integrityDetails).every(([key, value]) => (
      JSON.stringify(entry[key]) === JSON.stringify(value)
    ));
    if (!historyReceiptMatchesLane(entry, snapshot)
      || !Number.isSafeInteger(entry.iteration)
      || entry.iteration <= 0
      || !text(entry.status)
      || !text(entry.verdict)
      || !text(entry.nextAction)
      || !Array.isArray(entry.findingIds)
      || integrityDetailsHash !== entry.integrityDetailsHash
      || !topLevelDetailsMatch
      || text(entry.predecessorCycleId) !== predecessorCycleId
      || cycleIds.has(entry.cycleId)) {
      return false;
    }
    const expectedCycleId = cycleId(
      entry,
      {
        verdict:entry.verdict,
        nextAction:entry.nextAction,
        repairOrder:{ findingIds:entry.findingIds },
      },
      entry.iteration,
      entry.attemptId,
      predecessorCycleId,
      entry.status,
      entry.integrityDetailsHash,
    );
    if (entry.cycleId !== expectedCycleId) return false;
    cycleIds.add(entry.cycleId);
    predecessorCycleId = entry.cycleId;
  }
  return true;
}

function verificationPurpose(snapshot) {
  const headSha = sha(snapshot.headSha);
  const exactHeadCiGreen = snapshot.ciGreen === true && sha(snapshot.ciHeadSha) === headSha;
  if (snapshot.merged !== true) {
    if (!exactHeadCiGreen) return 'PRE_MERGE_EXACT_HEAD_CI';
    if (snapshot.mergeable !== true) return 'PRE_MERGE_MERGEABILITY';
    return 'PRE_MERGE_GATE_REFRESH';
  }
  if (!exactHeadCiGreen) return 'POST_MERGE_EXACT_HEAD_CI';
  if (snapshot.runtimeProofRequired === true) return 'POST_MERGE_RUNTIME';
  return 'POST_MERGE_RUNTIME_SCOPE';
}

function verificationRequestKey(snapshot, purpose, attemptId, predecessorCycleId) {
  const lifecycleId = createHash('sha256')
    .update(JSON.stringify([attemptId, predecessorCycleId]))
    .digest('hex')
    .slice(0, 12);
  return `verify-${snapshot.prNumber}-${sha(snapshot.headSha)?.slice(0, 12) ?? 'unknown'}-${purpose.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${lifecycleId}`;
}

function pendingVerificationIntent(history, snapshot, purpose) {
  const closedKeys = new Set(history.filter((entry) => (
    ['verification-requested', 'blocked-verification-rejected'].includes(entry?.status)
    && text(entry.verificationRequestKey)
  )).map((entry) => entry.verificationRequestKey));
  return history.findLast((entry) => (
    entry?.status === 'verification-intent-recorded'
    && entry.verificationPurpose === purpose
    && sha(entry.headSha) === sha(snapshot.headSha)
    && text(entry.verificationRequestKey)
    && !closedKeys.has(entry.verificationRequestKey)
  )) ?? null;
}

function repairAttemptsForHead(history, headSha) {
  const explicit = new Set(history.filter((entry) => (
    entry?.status === 'repair-attempt-recorded'
    && sha(entry.headSha) === headSha
    && text(entry.dispatchAttemptId)
  )).map((entry) => entry.dispatchAttemptId));
  const legacy = history.filter((entry) => (
    ['repair-dispatched', 'blocked-dispatch-rejected'].includes(entry?.status)
    && sha(entry.headSha) === headSha
    && !text(entry.dispatchAttemptId)
  ));
  return explicit.size + legacy.length;
}

function pendingTerminalization(history, snapshot) {
  const recovered = new Set(history.filter((entry) => (
    entry?.status === 'dispatch-terminalization-recovered'
    && text(entry.recoveredCycleId)
  )).map((entry) => entry.recoveredCycleId));
  return history.findLast((entry) => (
    entry?.status === 'blocked-dispatch-rejected'
    && entry.terminalExecutionPersisted === false
    && entry.pendingTerminalExecutionReceipt
    && sha(entry.headSha) === sha(snapshot.headSha)
    && !recovered.has(entry.cycleId)
  )) ?? null;
}

function pendingRepairDispatchIntent(history, snapshot) {
  const closedAttemptIds = new Set(history.filter((entry) => (
    ['repair-dispatched', 'blocked-dispatch-rejected', 'dispatch-terminal-reconciled'].includes(entry?.status)
    && text(entry.dispatchAttemptId)
  )).map((entry) => entry.dispatchAttemptId));
  return history.findLast((entry) => {
    const repairOrder = entry?.repairOrder;
    const queuedReceipt = entry?.queuedExecutionReceipt;
    const receiptValidation = queuedReceipt && repairOrder
      ? validateExecutionReceipt(queuedReceipt, {
        repository:text(snapshot.repository)?.toLowerCase(),
        issueNumber:snapshot.issueNumber,
        branch:text(snapshot.branch),
        expectedHead:sha(snapshot.headSha),
        executionId:entry.dispatchAttemptId,
        leaseKey:repairOrder.leaseKey,
      })
      : { valid:false };
    return entry?.status === 'repair-attempt-recorded'
      && sha(entry.headSha) === sha(snapshot.headSha)
      && text(entry.dispatchAttemptId)
      && !closedAttemptIds.has(entry.dispatchAttemptId)
      && repairOrder
      && typeof repairOrder === 'object'
      && text(repairOrder.repository)?.toLowerCase() === text(snapshot.repository)?.toLowerCase()
      && repairOrder.issueNumber === snapshot.issueNumber
      && repairOrder.prNumber === snapshot.prNumber
      && text(repairOrder.branch) === text(snapshot.branch)
      && sha(repairOrder.headSha) === sha(snapshot.headSha)
      && repairOrder.executionId === entry.dispatchAttemptId
      && queuedReceipt
      && typeof queuedReceipt === 'object'
      && queuedReceipt.receiptId === entry.executionReceiptId
      && queuedReceipt.executionId === entry.dispatchAttemptId
      && queuedReceipt.prNumber === snapshot.prNumber
      && queuedReceipt.workerId === repairOrder.assignedWorkerId
      && queuedReceipt.workerType === repairOrder.worker?.workerType
      && queuedReceipt.state === 'queued'
      && receiptValidation.valid;
  }) ?? null;
}

function reconcileRepairIntentExecution(intent, snapshot) {
  const receipts = Array.isArray(snapshot.receipts)
    ? snapshot.receipts.filter((entry) => (
      entry?.executionId === intent.dispatchAttemptId
      || entry?.leaseKey === intent.repairOrder.leaseKey
    ))
    : [];
  if (!receipts.length) return { valid:true, terminalReceipt:null };
  if (receipts.some((entry) => (
    entry?.prNumber !== snapshot.prNumber
    || entry?.workerId !== intent.repairOrder.assignedWorkerId
    || entry?.workerType !== intent.repairOrder.worker?.workerType
  ))) {
    return { valid:false, reason:'Recorded execution evidence conflicts with the pending repair intent.' };
  }
  const classification = classifyExecutionReceiptSet(receipts, {
    repository:text(snapshot.repository)?.toLowerCase(),
    issueNumber:snapshot.issueNumber,
    branch:text(snapshot.branch),
    expectedHead:sha(snapshot.headSha),
    executionId:intent.dispatchAttemptId,
    leaseKey:intent.repairOrder.leaseKey,
  });
  if (classification.finalVerdict !== 'EXECUTION_RECEIPT_SET_PASS') {
    return {
      valid:false,
      reason:classification.chainErrors?.[0] ?? classification.finalVerdict,
    };
  }
  const ordered = [...classification.validReceipts].sort((a, b) => a.sequence - b.sequence);
  const recordedRoot = intent.queuedExecutionReceipt;
  const observedRoot = ordered[0] ?? null;
  const rootMatchesIntent = observedRoot
    && Object.keys(observedRoot).length === Object.keys(recordedRoot).length
    && Object.entries(recordedRoot).every(([key, value]) => (
      JSON.stringify(observedRoot[key]) === JSON.stringify(value)
    ));
  if (!rootMatchesIntent) {
    return {
      valid:false,
      reason:'Canonical execution history does not descend from the queued receipt recorded in the repair intent.',
    };
  }
  const latest = ordered.at(-1) ?? null;
  return {
    valid:true,
    terminalReceipt:latest && EXECUTION_RECEIPT_TERMINAL_STATES.includes(latest.state)
      ? latest
      : null,
  };
}

function outstandingVerifications(history, snapshot) {
  const completed = new Set(history.filter((entry) => (
    entry?.status === 'verification-completed'
    && text(entry.verificationId)
    && text(entry.verificationPurpose)
  )).map((entry) => `${entry.verificationPurpose}:${entry.verificationId}`));
  return history.filter((entry) => (
    entry?.status === 'verification-requested'
    && entry.verificationAccepted === true
    && sha(entry.headSha) === sha(snapshot.headSha)
    && text(entry.verificationId)
    && text(entry.verificationPurpose)
    && !completed.has(`${entry.verificationPurpose}:${entry.verificationId}`)
  ));
}

function pendingVerification(history, snapshot, purpose) {
  return outstandingVerifications(history, snapshot).findLast((entry) => (
    entry.verificationPurpose === purpose
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

  const maxIterationsProvided = Object.hasOwn(options, 'maxIterations');
  const maxRepairsProvided = Object.hasOwn(options, 'maxRepairsPerHead');
  if (maxIterationsProvided && (!Number.isSafeInteger(options.maxIterations) || options.maxIterations <= 0)) {
    throw new TypeError('maxIterations must be a positive safe integer when supplied');
  }
  if (maxRepairsProvided && (!Number.isSafeInteger(options.maxRepairsPerHead) || options.maxRepairsPerHead <= 0)) {
    throw new TypeError('maxRepairsPerHead must be a positive safe integer when supplied');
  }
  const maxIterations = maxIterationsProvided ? options.maxIterations : 12;
  const maxRepairsPerHead = maxRepairsProvided ? options.maxRepairsPerHead : 4;

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
    const persisted = await persistOutcome(persistCycleReceipt, blocked);
    return persisted.ok
      ? result('BLOCKED', blocked, [blocked])
      : result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, []);
  }

  if (!Array.isArray(historySource) || historyLoadError) {
    const verdict = { verdict:'abort-history-unavailable', nextAction:'STOP_AND_SURFACE_BLOCKER' };
    const blocked = cycleReceipt(snapshot, verdict, 1, 'blocked-history-unavailable', {
      attemptId,
      previousReceipt:null,
    }, {
      reason:historyLoadError ? 'Durable cycle history could not be loaded.' : 'Durable cycle history is required.',
    });
    const persisted = await persistOutcome(persistCycleReceipt, blocked);
    return persisted.ok
      ? result('BLOCKED_HISTORY_UNAVAILABLE', blocked, [blocked])
      : result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, []);
  }
  const scopedHistory = historyForLaneHead(provisionalHistory, snapshot);
  if (!historyValid(scopedHistory, snapshot)) {
    const verdict = { verdict:'abort-history-invalid', nextAction:'STOP_AND_SURFACE_BLOCKER' };
    const blocked = cycleReceipt(snapshot, verdict, 1, 'blocked-history-invalid', {
      attemptId,
      previousReceipt:null,
    }, {
      reason:'Durable cycle history is malformed or belongs to another lane.',
    });
    const persisted = await persistOutcome(persistCycleReceipt, blocked);
    return persisted.ok
      ? result('BLOCKED_HISTORY_INVALID', blocked, [blocked])
      : result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, []);
  }

  const history = [...scopedHistory];
  const terminalization = pendingTerminalization(history, snapshot);
  if (terminalization) {
    const terminalPersistence = await persistOutcome(
      persistExecutionReceipt,
      terminalization.pendingTerminalExecutionReceipt,
      { snapshot, terminal:true, recovery:true },
    );
    if (!terminalPersistence.ok) {
      return result('BLOCKED_EXECUTION_RECEIPT_PERSISTENCE', terminalization, history);
    }
    const recovered = cycleReceipt(
      snapshot,
      {
        verdict:terminalization.verdict,
        nextAction:terminalization.nextAction,
        repairOrder:{ findingIds:terminalization.findingIds },
      },
      terminalization.iteration + 1,
      'dispatch-terminalization-recovered',
      {
        attemptId,
        previousReceipt:history.at(-1) ?? null,
      },
      {
        recoveredCycleId:terminalization.cycleId,
        terminalExecutionReceiptId:terminalization.pendingTerminalExecutionReceipt.receiptId,
      },
    );
    const persisted = await persistOutcome(persistCycleReceipt, recovered);
    if (!persisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
    history.push(recovered);
    return result('TERMINALIZATION_RECOVERED', recovered, history);
  }
  const pendingDispatch = pendingRepairDispatchIntent(history, snapshot);
  if (pendingDispatch) {
    const pendingVerdict = {
      verdict:pendingDispatch.verdict,
      nextAction:pendingDispatch.nextAction,
      repairOrder:{
        repairOrderId:pendingDispatch.repairOrderId,
        findingIds:pendingDispatch.findingIds,
      },
    };
    const execution = reconcileRepairIntentExecution(pendingDispatch, snapshot);
    if (!execution.valid) {
      const blocked = cycleReceipt(
        snapshot,
        pendingVerdict,
        (history.at(-1)?.iteration ?? pendingDispatch.iteration) + 1,
        'blocked-execution-reconciliation',
        {
          attemptId,
          previousReceipt:history.at(-1) ?? null,
        },
        {
          reason:execution.reason,
          dispatchAttempted:false,
          dispatchAttemptId:pendingDispatch.dispatchAttemptId,
          recoveredDispatchIntentCycleId:pendingDispatch.cycleId,
        },
      );
      const persisted = await persistOutcome(persistCycleReceipt, blocked);
      if (!persisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
      history.push(blocked);
      return result('BLOCKED_EXECUTION_RECONCILIATION', blocked, history);
    }
    if (execution.terminalReceipt) {
      const reconciled = cycleReceipt(
        snapshot,
        pendingVerdict,
        (history.at(-1)?.iteration ?? pendingDispatch.iteration) + 1,
        'dispatch-terminal-reconciled',
        {
          attemptId,
          previousReceipt:history.at(-1) ?? null,
        },
        {
          dispatchAttemptId:pendingDispatch.dispatchAttemptId,
          recoveredDispatchIntentCycleId:pendingDispatch.cycleId,
          terminalExecutionReceiptId:execution.terminalReceipt.receiptId,
          terminalExecutionState:execution.terminalReceipt.state,
        },
      );
      const persisted = await persistOutcome(persistCycleReceipt, reconciled);
      if (!persisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
      history.push(reconciled);
      return result('TERMINAL_EXECUTION_RECONCILED', reconciled, history);
    }
    const queuedPersistence = await persistOutcome(
      persistExecutionReceipt,
      pendingDispatch.queuedExecutionReceipt,
      { snapshot, recovery:true, pendingDispatch:true },
    );
    if (!queuedPersistence.ok) {
      const blocked = cycleReceipt(
        snapshot,
        pendingVerdict,
        (history.at(-1)?.iteration ?? pendingDispatch.iteration) + 1,
        'blocked-execution-receipt-persistence',
        {
          attemptId,
          previousReceipt:history.at(-1) ?? null,
        },
        {
          reason:queuedPersistence.reason,
          dispatchAttempted:false,
          dispatchAttemptId:pendingDispatch.dispatchAttemptId,
          recoveredDispatchIntentCycleId:pendingDispatch.cycleId,
        },
      );
      const persisted = await persistOutcome(persistCycleReceipt, blocked);
      if (!persisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
      history.push(blocked);
      return result('BLOCKED_EXECUTION_RECEIPT_PERSISTENCE', blocked, history);
    }
    let dispatched;
    let dispatchError = null;
    try {
      dispatched = await dispatchRepair(pendingDispatch.repairOrder, {
        snapshot,
        recovery:true,
        idempotencyKey:pendingDispatch.dispatchAttemptId,
      });
    } catch (error) {
      dispatchError = error;
    }
    const recoveryIteration = (history.at(-1)?.iteration ?? pendingDispatch.iteration) + 1;
    if (dispatched?.accepted !== true) {
      const reason = text(dispatched?.reason) ?? text(dispatchError?.message) ?? 'REPAIR_DISPATCH_REJECTED';
      const terminal = terminalDispatchReceipt(
        pendingDispatch.queuedExecutionReceipt,
        snapshot,
        reason,
      );
      const terminalPersistence = await persistOutcome(
        persistExecutionReceipt,
        terminal,
        { snapshot, recovery:true, terminal:true },
      );
      const blocked = cycleReceipt(
        snapshot,
        pendingVerdict,
        recoveryIteration,
        'blocked-dispatch-rejected',
        {
          attemptId,
          previousReceipt:history.at(-1) ?? null,
        },
        {
          reason,
          dispatchAccepted:false,
          terminalExecutionReceiptId:terminalPersistence.ok ? terminal.receiptId : null,
          terminalExecutionPersisted:terminalPersistence.ok,
          pendingTerminalExecutionReceipt:terminalPersistence.ok ? null : terminal,
          dispatchAttemptId:pendingDispatch.dispatchAttemptId,
          recoveredDispatchIntentCycleId:pendingDispatch.cycleId,
        },
      );
      const persisted = await persistOutcome(persistCycleReceipt, blocked);
      if (!persisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
      history.push(blocked);
      return result(
        terminalPersistence.ok ? 'BLOCKED_DISPATCH_REJECTED' : 'BLOCKED_EXECUTION_RECEIPT_PERSISTENCE',
        blocked,
        history,
      );
    }
    const recoveredDispatch = cycleReceipt(
      snapshot,
      pendingVerdict,
      recoveryIteration,
      'repair-dispatched',
      {
        attemptId,
        previousReceipt:history.at(-1) ?? null,
      },
      {
        dispatchAccepted:true,
        workerTaskId:text(dispatched.workerTaskId),
        dispatchAttemptId:pendingDispatch.dispatchAttemptId,
        recoveredDispatchIntentCycleId:pendingDispatch.cycleId,
      },
    );
    const persisted = await persistOutcome(persistCycleReceipt, recoveredDispatch);
    if (!persisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
    history.push(recoveredDispatch);
    return result('WAITING_FOR_REPAIR', recoveredDispatch, history);
  }
  let lastSnapshot = snapshot;
  let lastVerdict = { verdict:'abort-missing-proof', nextAction:'STOP_AND_SURFACE_BLOCKER' };
  const observedHeadShas = new Set([sha(snapshot.headSha)]);
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    if (iteration > 1) {
      const previousSnapshot = snapshot;
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
        const persisted = await persistOutcome(persistCycleReceipt, blocked);
        if (!persisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
        history.push(blocked);
        return result('BLOCKED', blocked, history);
      }
      if (!sameLaneIdentity(previousSnapshot, snapshot)) {
        const blocked = cycleReceipt(snapshot, lastVerdict, iteration, 'blocked', {
          attemptId,
          previousReceipt:null,
        }, {
          reason:'The canonical repair lane identity changed during one continuous cycle.',
        });
        const persisted = await persistOutcome(persistCycleReceipt, blocked);
        return persisted.ok
          ? result('BLOCKED', blocked, [blocked])
          : result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, []);
      }
      if (sha(previousSnapshot.headSha) !== sha(snapshot.headSha)) {
        const nextHeadSha = sha(snapshot.headSha);
        if (observedHeadShas.has(nextHeadSha)) {
          const blocked = cycleReceipt(
            snapshot,
            { verdict:'abort-head-revisited', nextAction:'STOP_AND_SURFACE_BLOCKER' },
            iteration,
            'blocked-head-revisited',
            {
              attemptId,
              previousReceipt:null,
            },
            {
              reason:'An exact head was revisited during one continuous cycle; restart from durable head-scoped history.',
            },
          );
          const persisted = await persistOutcome(persistCycleReceipt, blocked);
          return persisted.ok
            ? result('BLOCKED_HEAD_REVISITED', blocked, [blocked])
            : result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, []);
        }
        observedHeadShas.add(nextHeadSha);
        const nextHeadHistory = historyForLaneHead(provisionalHistory, snapshot);
        if (!historyValid(nextHeadHistory, snapshot)) {
          const blocked = cycleReceipt(
            snapshot,
            { verdict:'abort-history-invalid', nextAction:'STOP_AND_SURFACE_BLOCKER' },
            iteration,
            'blocked-history-invalid',
            {
              attemptId,
              previousReceipt:null,
            },
            {
              reason:'Durable cycle history for the newly observed exact head is malformed.',
            },
          );
          const persisted = await persistOutcome(persistCycleReceipt, blocked);
          return persisted.ok
            ? result('BLOCKED_HISTORY_INVALID', blocked, [blocked])
            : result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, []);
        }
        history.splice(0, history.length, ...nextHeadHistory);
      }
    }
    lastSnapshot = snapshot;
    const verdict = evaluateGuardedRepairLoop(snapshot);
    lastVerdict = verdict;

    if (verdict.nextAction === 'PERSIST_CANONICAL_RECEIPT_THEN_ROUTE_WORKER') {
      const count = repairAttemptsForHead(history, sha(snapshot.headSha));
      if (count >= maxRepairsPerHead) {
        const blocked = cycleReceipt(snapshot, verdict, iteration, 'blocked-repair-budget', {
          attemptId,
          previousReceipt:history.at(-1) ?? null,
        }, {
          reason:'Automatic repair budget exhausted for this exact head.',
        });
        const persisted = await persistOutcome(persistCycleReceipt, blocked);
        if (!persisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
        history.push(blocked);
        return result('BLOCKED_REPAIR_BUDGET', blocked, history);
      }
      const dispatchAttemptId = verdict.nextReceipt.executionId;
      const attemptReceipt = cycleReceipt(snapshot, verdict, iteration, 'repair-attempt-recorded', {
        attemptId,
        previousReceipt:history.at(-1) ?? null,
      }, {
        dispatchAttemptId,
        executionReceiptId:verdict.nextReceipt.receiptId,
        repairOrder:verdict.repairOrder,
        queuedExecutionReceipt:verdict.nextReceipt,
      });
      const attemptPersisted = await persistOutcome(persistCycleReceipt, attemptReceipt);
      if (!attemptPersisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
      history.push(attemptReceipt);
      const queuedPersistence = await persistOutcome(
        persistExecutionReceipt,
        verdict.nextReceipt,
        { snapshot, verdict },
      );
      if (!queuedPersistence.ok) {
        const blocked = cycleReceipt(snapshot, verdict, iteration, 'blocked-execution-receipt-persistence', {
          attemptId,
          previousReceipt:history.at(-1) ?? null,
        }, {
          reason:queuedPersistence.reason,
          dispatchAttempted:false,
          dispatchAttemptId,
          recoveredDispatchIntentCycleId:attemptReceipt.cycleId,
        });
        const persisted = await persistOutcome(persistCycleReceipt, blocked);
        if (!persisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
        history.push(blocked);
        return result('BLOCKED_EXECUTION_RECEIPT_PERSISTENCE', blocked, history);
      }
      let dispatched;
      let dispatchError = null;
      try {
        dispatched = await dispatchRepair(verdict.repairOrder, {
          snapshot,
          verdict,
          idempotencyKey:dispatchAttemptId,
        });
      } catch (error) {
        dispatchError = error;
      }
      if (dispatched?.accepted !== true) {
        const reason = text(dispatched?.reason) ?? text(dispatchError?.message) ?? 'REPAIR_DISPATCH_REJECTED';
        const terminal = terminalDispatchReceipt(verdict.nextReceipt, snapshot, reason);
        const terminalPersistence = await persistOutcome(
          persistExecutionReceipt,
          terminal,
          { snapshot, verdict, terminal:true },
        );
        const blocked = cycleReceipt(snapshot, verdict, iteration, 'blocked-dispatch-rejected', {
          attemptId,
          previousReceipt:history.at(-1) ?? null,
        }, {
          reason,
          dispatchAccepted:false,
          terminalExecutionReceiptId:terminalPersistence.ok ? terminal.receiptId : null,
          terminalExecutionPersisted:terminalPersistence.ok,
          pendingTerminalExecutionReceipt:terminalPersistence.ok ? null : terminal,
          dispatchAttemptId,
        });
        const persisted = await persistOutcome(persistCycleReceipt, blocked);
        if (!persisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
        history.push(blocked);
        return result(
          terminalPersistence.ok ? 'BLOCKED_DISPATCH_REJECTED' : 'BLOCKED_EXECUTION_RECEIPT_PERSISTENCE',
          blocked,
          history,
        );
      }
      const dispatchedReceipt = cycleReceipt(snapshot, verdict, iteration, 'repair-dispatched', {
        attemptId,
        previousReceipt:history.at(-1) ?? null,
      }, {
        dispatchAccepted:true,
        workerTaskId:text(dispatched.workerTaskId),
        dispatchAttemptId,
      });
      const persisted = await persistOutcome(persistCycleReceipt, dispatchedReceipt);
      if (!persisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
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
      const persisted = await persistOutcome(persistCycleReceipt, waiting);
      if (!persisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
      history.push(waiting);
      continue;
    }

    if (verdict.nextAction === 'WAIT_FOR_EXACT_HEAD_VERIFICATION') {
      const purpose = verificationPurpose(snapshot);
      const existing = pendingVerification(history, snapshot, purpose);
      if (existing) return result('WAITING_FOR_VERIFICATION', existing, history);
      const obsolete = outstandingVerifications(history, snapshot).at(-1) ?? null;
      if (obsolete) {
        const completed = cycleReceipt(snapshot, verdict, iteration, 'verification-completed', {
          attemptId,
          previousReceipt:history.at(-1) ?? null,
        }, {
          reason:'The prior verification request was retired before a different verification purpose was dispatched.',
          verificationId:obsolete.verificationId,
          verificationPurpose:obsolete.verificationPurpose,
          verificationOutcome:'SUPERSEDED_BY_NEW_PURPOSE',
        });
        const persisted = await persistOutcome(persistCycleReceipt, completed);
        if (!persisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
        history.push(completed);
      }
      let verificationIntent = pendingVerificationIntent(history, snapshot, purpose);
      if (!verificationIntent) {
        const intent = cycleReceipt(snapshot, verdict, iteration, 'verification-intent-recorded', {
          attemptId,
          previousReceipt:history.at(-1) ?? null,
        }, {
          verificationPurpose:purpose,
          verificationRequestKey:verificationRequestKey(
            snapshot,
            purpose,
            attemptId,
            text(history.at(-1)?.cycleId),
          ),
        });
        const persisted = await persistOutcome(persistCycleReceipt, intent);
        if (!persisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
        history.push(intent);
        verificationIntent = intent;
      }
      let verification;
      let verificationError = null;
      try {
        verification = await requestExactHeadVerification({
          snapshot,
          verdict,
          headSha:sha(snapshot.headSha),
          purpose,
          idempotencyKey:verificationIntent.verificationRequestKey,
        });
      } catch (error) {
        verificationError = error;
      }
      const verificationId = text(verification?.verificationId);
      const accepted = verification?.accepted === true && Boolean(verificationId);
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
          verificationId,
          verificationPurpose:purpose,
          verificationRequestKey:verificationIntent.verificationRequestKey,
        },
      );
      const persisted = await persistOutcome(persistCycleReceipt, verificationReceipt);
      if (!persisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
      history.push(verificationReceipt);
      return result(
        accepted ? 'WAITING_FOR_VERIFICATION' : 'BLOCKED_VERIFICATION_REJECTED',
        verificationReceipt,
        history,
      );
    }

    const outstandingVerification = outstandingVerifications(history, snapshot).at(-1) ?? null;
    if (outstandingVerification) {
      const completed = cycleReceipt(snapshot, verdict, iteration, 'verification-completed', {
        attemptId,
        previousReceipt:history.at(-1) ?? null,
      }, {
        reason:'A later authoritative cycle outcome retired the outstanding verification request.',
        verificationId:outstandingVerification.verificationId,
        verificationPurpose:outstandingVerification.verificationPurpose,
        verificationOutcome:verdict.verdict,
      });
      const persisted = await persistOutcome(persistCycleReceipt, completed);
      if (!persisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
      history.push(completed);
    }

    if (verdict.nextAction === 'REQUEST_EXACT_HEAD_MERGE_APPROVAL') {
      const mergeReady = cycleReceipt(snapshot, verdict, iteration, 'merge-ready', {
        attemptId,
        previousReceipt:history.at(-1) ?? null,
      }, {
        expectedHeadSha:sha(verdict.expectedHeadSha ?? snapshot.headSha),
        reason:verdict.reason,
      });
      const persisted = await persistOutcome(persistCycleReceipt, mergeReady);
      if (!persisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
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
      const persisted = await persistOutcome(persistCycleReceipt, complete);
      if (!persisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
      history.push(complete);
      return result('COMPLETE', complete, history);
    }

    const blocked = cycleReceipt(snapshot, verdict, iteration, 'blocked', {
      attemptId,
      previousReceipt:history.at(-1) ?? null,
    }, {
      reason:verdict.reason,
    });
    const persisted = await persistOutcome(persistCycleReceipt, blocked);
    if (!persisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
    history.push(blocked);
    return result('BLOCKED', blocked, history);
  }

  const exhausted = cycleReceipt(lastSnapshot, lastVerdict, maxIterations + 1, 'blocked-iteration-budget', {
    attemptId,
    previousReceipt:history.at(-1) ?? null,
  }, {
    reason:'Continuous repair iteration budget exhausted.',
  });
  const persisted = await persistOutcome(persistCycleReceipt, exhausted);
  if (!persisted.ok) return result('BLOCKED_CYCLE_RECEIPT_PERSISTENCE', null, history);
  history.push(exhausted);
  return result('BLOCKED_ITERATION_BUDGET', exhausted, history);
}
