import {
  validateBattleBridgeMainAdvanceSignal,
  BATTLE_BRIDGE_MAIN_ADVANCE_REPOSITORY,
} from './battleBridgeMainAdvanceSignalV1.mjs';

// Goal #2315: publish immutable GitHub-hosted OBSERVATION proof without sending a
// command or receipt into a finite GitHub issue-comment mailbox.
// This projection never authenticates or claims a Windows-side consumer.
export const BATTLE_BRIDGE_MAIN_ADVANCE_ARTIFACT_SCHEMA = 'stephanos.battle-bridge-main-advance-artifact.v1';
export const BATTLE_BRIDGE_MAIN_ADVANCE_ARTIFACT_FILE = 'stephanos-main-advance-observation.json';

export function createBattleBridgeMainAdvanceArtifactV1(rawSignal) {
  const evaluated = validateBattleBridgeMainAdvanceSignal(rawSignal);
  if (!evaluated.ok || !evaluated.signal) {
    throw new Error('MAIN_ADVANCE_ARTIFACT_SIGNAL_NOT_VERIFIED');
  }
  const signal = evaluated.signal;
  const runUrl = 'https://github.com/' + BATTLE_BRIDGE_MAIN_ADVANCE_REPOSITORY
    + '/actions/runs/' + signal.workflowRunId;
  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_MAIN_ADVANCE_ARTIFACT_SCHEMA,
    repository: signal.repository,
    branch: signal.branch,
    prNumber: signal.prNumber,
    verifiedMainHead: signal.mainHead,
    mergedAtUtc: signal.mergedAtUtc,
    authenticatedWorkflowRunId: signal.workflowRunId,
    workflowRunUrl: runUrl,
    observationKind: 'VERIFIED_MAIN_ADVANCE_ON_GITHUB',
    publicationCarrier: 'GITHUB_ACTIONS_ARTIFACT',
    publicationState: 'LOCAL_ARTIFACT_STAGED',
    commentMailboxPublicationPerformed: false,
    sourceMutationAuthority: false,
    nativeCommandAuthority: false,
    protectedMergeAuthority: false,
    nativeSyncReceived: false,
    physicalHostPickupProven: false,
    exactHostHeadProven: false,
    hostDeliveryState: 'UNKNOWN',
    nextEvidence: 'REQUIRE_INDEPENDENT_INSTALLED_GITHUB_SYNC_STATUS_AND_HOST_HEAD',
  });
}
