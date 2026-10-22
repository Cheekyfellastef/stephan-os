export const ONION_CONTINUATION_SCHEMA = 'stephanos.onion-continuation.v1';

export const ONION_TERMINAL_STATE = Object.freeze({
  ORIGINAL_OUTCOME_PROVEN: 'ORIGINAL_OUTCOME_PROVEN',
  OPERATOR_PHYSICAL_AUTHORITY_BOUNDARY: 'OPERATOR_PHYSICAL_AUTHORITY_BOUNDARY',
  NO_SAFE_REPAIR_CURRENTLY_AVAILABLE: 'NO_SAFE_REPAIR_CURRENTLY_AVAILABLE',
});

function text(value) {
  return String(value ?? '').trim();
}

function evidenceRefs(value) {
  return Object.freeze(
    (Array.isArray(value) ? value : [])
      .map((entry) => text(entry))
      .filter(Boolean)
      .slice(0, 32),
  );
}

function terminalPacket(input, requiredIdentity) {
  const originalOutcomeId = text(input.originalOutcomeId);
  const terminalIdentity = text(input.terminalIdentity);
  const refs = evidenceRefs(input.evidenceRefs);
  const terminalOwner = text(input.terminalOwner);
  const terminalAction = text(input.terminalAction);
  const reEvaluationTrigger = text(input.reEvaluationTrigger);
  const valid = Boolean(
    originalOutcomeId
    && requiredIdentity
    && terminalIdentity === requiredIdentity
    && refs.length > 0
    && terminalOwner
    && terminalAction
    && reEvaluationTrigger
  );
  return Object.freeze({
    valid,
    terminalIdentity,
    evidenceRefs: refs,
    terminalOwner,
    terminalAction,
    reEvaluationTrigger,
  });
}

export function projectOnionContinuationV1(input = {}) {
  const originalOutcomeId = text(input.originalOutcomeId);
  const originalOutcomeProven = input.originalOutcomeProven === true;
  const hardBoundary = input.hardBoundary === true;
  const safeRepairAvailable = input.safeRepairAvailable !== false;
  const blocker = text(input.blocker);
  const depth = Number.isSafeInteger(Number(input.blockerDepth)) && Number(input.blockerDepth) >= 0
    ? Number(input.blockerDepth)
    : 0;

  const requestedIdentity = originalOutcomeProven
    ? originalOutcomeId
    : hardBoundary
      ? text(input.boundaryId) || blocker
      : !safeRepairAvailable
        ? text(input.noSafeRepairId) || blocker
        : '';
  const packet = terminalPacket(input, requestedIdentity);
  const terminalRequested = originalOutcomeProven || hardBoundary || !safeRepairAvailable;

  let terminalState = '';
  if (packet.valid && originalOutcomeProven) {
    terminalState = ONION_TERMINAL_STATE.ORIGINAL_OUTCOME_PROVEN;
  } else if (packet.valid && hardBoundary) {
    terminalState = ONION_TERMINAL_STATE.OPERATOR_PHYSICAL_AUTHORITY_BOUNDARY;
  } else if (packet.valid && !safeRepairAvailable) {
    terminalState = ONION_TERMINAL_STATE.NO_SAFE_REPAIR_CURRENTLY_AVAILABLE;
  }

  return Object.freeze({
    schemaVersion: ONION_CONTINUATION_SCHEMA,
    originalOutcomeId,
    blocker,
    blockerDepth: depth,
    originalOutcomeProven,
    hardBoundary,
    safeRepairAvailable,
    terminalState,
    terminalRequested,
    terminalPacketValid: packet.valid,
    terminalRequestRejected: terminalRequested && !packet.valid,
    terminalIdentity: packet.terminalIdentity,
    evidenceRefs: packet.evidenceRefs,
    terminalOwner: packet.terminalOwner,
    terminalAction: packet.terminalAction,
    reEvaluationTrigger: packet.reEvaluationTrigger,
    shouldContinue: terminalState === '',
    nextBlockerDepth: terminalState === '' && blocker ? depth + 1 : depth,
    intermediateRepairIsCompletion: false,
    arbitraryDepthLimitAllowed: false,
    persistAcrossDaemonCycles: true,
    replayOriginalOutcomeAfterRepair: true,
    teachFlywheelAfterVerifiedRepair: true,
    reusableSovereignCapabilityCandidate: true,
  });
}
