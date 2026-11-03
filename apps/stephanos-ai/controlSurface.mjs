// Presentation only. A chat reply never grants authority or submits an action.
export const CONTROL_WORKFLOW_URL = 'https://github.com/Cheekyfellastef/stephan-os/actions/workflows/stephanos-control-tower-build.yml';
const OPERATIONS = new Set(['OBSERVE_CONTROL_SYSTEM', 'BUILD_NEXT_ELIGIBLE_GOAL']);
const STATE_LABELS = Object.freeze({
  RESERVED: 'Accepted · outcome unproven', UNKNOWN: 'Outcome unproven',
  WAKE_COMPLETED: 'Guarded wake completed', WAKE_BLOCKED: 'Guarded wake held',
  OBSERVATION_COMPLETED: 'Inspection completed', OBSERVATION_BLOCKED: 'Inspection held',
});
const validTime = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));

function requestForDisplay(value) {
  const requestId = /^control-tower-build-[1-9][0-9]{0,15}-1$/.test(value?.requestId || '') ? value.requestId : '';
  const legacyTerminal = value?.detailState === 'LEGACY_DETAIL_UNAVAILABLE'
    && value.ledgerPhase === 'TERMINAL' && ['DONE', 'BLOCKED'].includes(value.terminalState);
  return requestId && Object.hasOwn(STATE_LABELS, value.state) ? {
    requestId, label: legacyTerminal ? `Recorded terminal: ${value.terminalState.toLowerCase()} · detail unavailable` : STATE_LABELS[value.state], state: value.state,
    unresolved: !legacyTerminal && ['RESERVED', 'UNKNOWN'].includes(value.state),
    historical: value.historical === true,
    observedAtUtc: validTime(value.observedAtUtc) ? value.observedAtUtc : '',
  } : null;
}

export function projectControlReplyForSurfaceV1(result, nowMs = Date.now()) {
  const value = result?.data?.sovereign_control_conversation;
  if (!Number.isFinite(nowMs) || value?.schemaVersion !== 'stephanos.sovereign-control-conversation.v1'
    || value.responseSource !== 'CANONICAL_CONTROL_OBSERVATIONS' || value.readOnly !== true
    || value.modelInvoked !== false || value.nativeActionSubmitted !== false
    || value.directParticipantDispatchProven !== false || !validTime(value.observedAtUtc)) return null;
  const latest = value.controlTower?.latestRequestObservation || value.controlTower?.currentRequest;
  const request = requestForDisplay(latest);
  const earlierBuild = requestForDisplay(value.controlTower?.latestBuildRequestObservation);
  const unresolvedBuild = earlierBuild && earlierBuild.requestId !== request?.requestId
    && earlierBuild.unresolved ? earlierBuild : null;
  const candidate = value.handoff;
  let handoff = null;
  if (candidate?.state === 'NOT_SUBMITTED' && candidate.requestSubmitted === false
    && candidate.executionAuthority === false && candidate.reusableAuthority === false
    && candidate.authenticatedOwnerSubmissionRequired === true && candidate.singleAuthenticatedRunRequired === true
    && candidate.workflowUrl === CONTROL_WORKFLOW_URL && candidate.workflowRef === 'main'
    && OPERATIONS.has(candidate.operation) && candidate.workflowInputs?.operation === candidate.operation
    && Object.keys(candidate.workflowInputs).length === 1
    && validTime(candidate.createdAtUtc) && validTime(candidate.expiresAtUtc)
    && Date.parse(candidate.createdAtUtc) <= nowMs + 5000
    && Date.parse(candidate.expiresAtUtc) > Date.parse(candidate.createdAtUtc)
    && Date.parse(candidate.expiresAtUtc) - Date.parse(candidate.createdAtUtc) <= 600000) {
    const expired = Date.parse(candidate.expiresAtUtc) <= nowMs;
    const blocked = typeof candidate.submissionBlockedReason === 'string' && candidate.submissionBlockedReason.length > 0;
    handoff = {
      operation: candidate.operation,
      label: candidate.operation === 'OBSERVE_CONTROL_SYSTEM' ? 'Inspect control system' : 'Request guarded goal building',
      workflowUrl: CONTROL_WORKFLOW_URL,
      expiresAtUtc: candidate.expiresAtUtc,
      available: !expired && !blocked,
      status: expired ? 'Preparation expired · ask again' : blocked ? 'Reconcile existing work first' : 'Prepared · not submitted',
    };
  }
  return { observedAtUtc: value.observedAtUtc, request, unresolvedBuild, handoff };
}
