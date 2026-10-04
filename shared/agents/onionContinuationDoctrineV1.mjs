export const ONION_CONTINUATION_SCHEMA = 'stephanos.onion-continuation.v1';

export const ONION_TERMINAL_STATE = Object.freeze({
  ORIGINAL_OUTCOME_PROVEN: 'ORIGINAL_OUTCOME_PROVEN',
  OPERATOR_PHYSICAL_AUTHORITY_BOUNDARY: 'OPERATOR_PHYSICAL_AUTHORITY_BOUNDARY',
  NO_SAFE_REPAIR_CURRENTLY_AVAILABLE: 'NO_SAFE_REPAIR_CURRENTLY_AVAILABLE',
});

export function projectOnionContinuationV1(input = {}) {
  const originalOutcomeProven = input.originalOutcomeProven === true;
  const hardBoundary = input.hardBoundary === true;
  const safeRepairAvailable = input.safeRepairAvailable !== false;
  const blocker = String(input.blocker || '').trim();
  const depth = Number.isSafeInteger(Number(input.blockerDepth)) && Number(input.blockerDepth) >= 0
    ? Number(input.blockerDepth)
    : 0;

  let terminalState = '';
  if (originalOutcomeProven) terminalState = ONION_TERMINAL_STATE.ORIGINAL_OUTCOME_PROVEN;
  else if (hardBoundary) terminalState = ONION_TERMINAL_STATE.OPERATOR_PHYSICAL_AUTHORITY_BOUNDARY;
  else if (!safeRepairAvailable) terminalState = ONION_TERMINAL_STATE.NO_SAFE_REPAIR_CURRENTLY_AVAILABLE;

  return Object.freeze({
    schemaVersion: ONION_CONTINUATION_SCHEMA,
    originalOutcomeId: String(input.originalOutcomeId || '').trim(),
    blocker,
    blockerDepth: depth,
    terminalState,
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
