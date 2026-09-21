import {
  STEPHANOS_RESEARCH_EXECUTION_STATES,
  createStephanosResearchExecutionHandoffV1,
  reconcileStephanosResearchExecutionReturnV1,
} from './stephanosResearchExecutionHandoffV1.mjs';

export const STEPHANOS_RESEARCH_SCHEDULER_CONSUMER_SCHEMA_VERSION = 'stephanos.research-scheduler-consumer.v1';

const ROUTE_PARTICIPANTS = Object.freeze({
  CHATGPT_GITHUB: 'chatgpt',
  OPENCLAW_LOCAL: 'openclaw-standalone',
  BATTLE_BRIDGE_FIXED_TEST: 'battle-bridge',
  REMOTE_CODEX: 'codex',
});

function authorityBoundary() {
  return Object.freeze({
    sourceMutationAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    openClawMutationAllowed: false,
    arbitraryShellAllowed: false,
    credentialOrAccountChangeAllowed: false,
    spendingAllowed: false,
    knowledgeAutoPromotionAllowed: false,
    schedulerAuthorityAdded: false,
    dispatchPerformed: false,
    finalSynthesisOwner: 'stephanos',
  });
}

function blocked(reason, handoff = null) {
  return Object.freeze({
    schemaVersion: STEPHANOS_RESEARCH_SCHEDULER_CONSUMER_SCHEMA_VERSION,
    valid: false,
    state: 'BLOCKED',
    reason,
    handoff,
    schedulerProjection: null,
    reconciliation: null,
    authority: authorityBoundary(),
  });
}

export function consumeStephanosResearchExecutionV1(input = {}) {
  let handoff;
  try {
    handoff = createStephanosResearchExecutionHandoffV1({
      mission: input.mission,
      executionCapabilities: input.executionCapabilities,
    });
  } catch {
    return blocked('research-execution-handoff-construction-failed');
  }

  if (!handoff?.valid) return blocked(handoff?.reason || 'research-execution-handoff-invalid', handoff || null);

  if (handoff.state === STEPHANOS_RESEARCH_EXECUTION_STATES.NO_EXECUTION_REQUIRED) {
    return Object.freeze({
      schemaVersion: STEPHANOS_RESEARCH_SCHEDULER_CONSUMER_SCHEMA_VERSION,
      valid: true,
      state: 'NO_EXECUTION_REQUIRED',
      reason: handoff.reason,
      handoff,
      schedulerProjection: Object.freeze({
        schedulerOwnerGoal: '#1556',
        researchOwnerGoal: '#1902',
        readyForExistingScheduler: false,
        waitingForQualifiedRoute: false,
        toParticipantId: '',
      }),
      reconciliation: null,
      authority: authorityBoundary(),
    });
  }

  if (handoff.state === STEPHANOS_RESEARCH_EXECUTION_STATES.WAITING_FOR_QUALIFIED_ROUTE) {
    return Object.freeze({
      schemaVersion: STEPHANOS_RESEARCH_SCHEDULER_CONSUMER_SCHEMA_VERSION,
      valid: true,
      state: 'WAITING_FOR_QUALIFIED_ROUTE',
      reason: handoff.reason,
      handoff,
      schedulerProjection: Object.freeze({
        schedulerOwnerGoal: '#1556',
        researchOwnerGoal: '#1902',
        readyForExistingScheduler: false,
        waitingForQualifiedRoute: true,
        toParticipantId: '',
      }),
      reconciliation: null,
      authority: authorityBoundary(),
    });
  }

  if (handoff.state !== STEPHANOS_RESEARCH_EXECUTION_STATES.READY_FOR_EXISTING_SCHEDULER) {
    return blocked('research-handoff-not-routable-through-existing-scheduler', handoff);
  }

  const toParticipantId = ROUTE_PARTICIPANTS[handoff.schedulerRoute] || '';
  if (!toParticipantId) return blocked('research-scheduler-route-has-no-existing-participant', handoff);

  let reconciliation = null;
  if (input.executionReturn) {
    reconciliation = reconcileStephanosResearchExecutionReturnV1({
      mission: input.mission,
      handoff,
      executionReturn: input.executionReturn,
      canonicalFacts: input.canonicalFacts,
      licenceAndReuseNotes: input.licenceAndReuseNotes,
      confidenceBasis: input.confidenceBasis,
      stephanosSynthesis: input.stephanosSynthesis,
      implicationsForStephanos: input.implicationsForStephanos,
      candidateMethodUpdates: input.candidateMethodUpdates,
      candidateCapabilityGaps: input.candidateCapabilityGaps,
      recommendedNextAction: input.recommendedNextAction,
      whatChangedMyView: input.whatChangedMyView,
    });
    if (!reconciliation?.accepted) return blocked('research-execution-return-reconciliation-failed', handoff);
  }

  return Object.freeze({
    schemaVersion: STEPHANOS_RESEARCH_SCHEDULER_CONSUMER_SCHEMA_VERSION,
    valid: true,
    state: reconciliation ? 'RETURN_RECONCILED' : 'READY_FOR_EXISTING_SCHEDULER',
    reason: reconciliation
      ? 'research-execution-return-reconciled-under-exact-mission-identity'
      : 'research-execution-ready-for-existing-qualified-scheduler-route',
    handoff,
    schedulerProjection: Object.freeze({
      schedulerOwnerGoal: '#1556',
      researchOwnerGoal: '#1902',
      researchMissionId: handoff.researchMissionId,
      missionFingerprint: handoff.missionFingerprint,
      requestedTaskType: handoff.requestedTaskType,
      schedulerRoute: handoff.schedulerRoute,
      executionCapabilityRefs: handoff.executionCapabilityRefs,
      readyForExistingScheduler: !reconciliation,
      waitingForQualifiedRoute: false,
      toParticipantId,
      missionIdentityMustRemainExact: true,
      resultContract: handoff.resultContract,
    }),
    reconciliation,
    authority: authorityBoundary(),
  });
}
