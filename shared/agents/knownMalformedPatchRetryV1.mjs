import { createHash } from 'node:crypto';

// One original failed attempt, not a general PATCH_CHECK_FAILED exemption.
export const KNOWN_MALFORMED_PATCH_REPAIR_V1 = Object.freeze({
  missionId: 'critical-1372-elastic-goal', issueNumber: 1372,
  repository: 'Cheekyfellastef/stephan-os', branch: 'openclaw/elastic-goal-1372',
  actionId: 'critical-1372-elastic-goal-r1-8c82f73d2847', adapter: 'foundry-forge',
  originalSourceHead: 'e34d3a8b5744c64d1ab7e7a24c9c40631e643506',
  repairCommit: '0e9296c5e7055b807a57111d48d86ce81daec047',
  blocker: 'PROVIDER_NEUTRAL_PATCH_CHECK_FAILED:error: new file shared/agents/lessonMemoryStore.mjs depends on old contents',
});
const C = KNOWN_MALFORMED_PATCH_REPAIR_V1;
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
export const knownMalformedPatchDigestV1 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function isKnownMalformedPatchRetryV1(mission = {}) {
  return mission.missionId === C.missionId && mission.repository === C.repository
    && mission.git?.branch === C.branch && mission.git?.clean === true
    && mission.git?.worktreeReady === true && mission.git.changedFiles?.length === 0
    && !mission.git.commitSha && !mission.git.pushed && !mission.pullRequest?.number
    && mission.currentPhase === 'BLOCKED' && mission.continuity?.parkingStatus === 'PARKED_BLOCKED'
    && mission.cancelled === false && mission.activeWriter === 'none'
    && mission.dispatch?.status === 'failed' && mission.dispatch.adapter === C.adapter
    && mission.dispatch.resultId === C.actionId
    && mission.repair?.currentRound === 0 && mission.repair.maximumRounds > 0
    && Number.isSafeInteger(mission.revision) && mission.revision >= 4
    && !mission.storeMetadata?.originalSourceAttemptFence && !mission.storeMetadata?.supervisedRecoveryMaintenance
    && Array.isArray(mission.blockers) && mission.blockers.length === 1 && mission.blockers[0] === C.blocker;
}

export function projectKnownMalformedPatchTerminalV1(item, result, itemSha256, resultSha256) {
  const grant = item?.actionGrant, binding = item?.executionBinding;
  if (item?.schemaVersion !== 'stephanos.mission-worker-queue-item.v1'
      || item.missionId !== C.missionId || item.actionId !== C.actionId || item.adapter !== C.adapter
      || grant?.schemaVersion !== 'stephanos.mission-worker-action-grant.v1'
      || binding?.schemaVersion !== 'stephanos.mission-worker-queue-execution-binding.v1'
      || typeof grant.grantId !== 'string' || !grant.grantId.trim()
      || grant?.missionId !== C.missionId || grant.actionId !== C.actionId || grant.adapter !== C.adapter
      || grant.repository !== C.repository || grant.issueNumber !== C.issueNumber || grant.branch !== C.branch
      || grant.sourceRevision !== C.originalSourceHead || grant.missionRevision !== 1
      || binding?.missionId !== C.missionId || binding.executionId !== C.actionId
      || binding.repository !== C.repository || binding.issueNumber !== C.issueNumber || binding.branch !== C.branch
      || binding.sourceRevision !== C.originalSourceHead || binding.missionRevision !== 1
      || (binding.headSha !== undefined && binding.headSha !== C.originalSourceHead)
      || binding.grantId !== grant.grantId || binding.leaseKey !== `${C.missionId}-r1-lease`
      || result?.schemaVersion !== 'stephanos.provider-neutral-source-builder.v1'
      || result.missionId !== C.missionId || result.actionId !== C.actionId
      || result.adapter !== C.adapter || result.providerAdapter !== C.adapter
      || result.processed !== true || result.success !== false || result.providerInvoked !== true
      || result.providerCompleted !== true || result.failureStage !== 'SOURCE_OR_TEST'
      || result.finalVerdict !== 'PROVIDER_NEUTRAL_SOURCE_BUILD_BLOCKED' || result.error !== C.blocker
      || !DIGEST.test(itemSha256) || !DIGEST.test(resultSha256)) return null;
  return Object.freeze({ schemaVersion: 'stephanos.known-malformed-patch-terminal.v1',
    missionId: C.missionId, actionId: C.actionId, blocker: C.blocker,
    originalSourceHead: C.originalSourceHead, itemSha256, resultSha256 });
}

export function knownMalformedPatchEvidenceMatchesV1(proof, mission, sourceHead) {
  const terminal = proof?.terminal;
  return isKnownMalformedPatchRetryV1(mission)
    && proof?.schemaVersion === 'stephanos.known-malformed-patch-retry.v1'
    && proof.missionId === C.missionId && proof.missionRevision === mission.revision
    && SHA.test(sourceHead) && proof.sourceHead === sourceHead && proof.repairCommit === C.repairCommit
    && terminal?.schemaVersion === 'stephanos.known-malformed-patch-terminal.v1'
    && terminal.missionId === C.missionId && terminal.actionId === C.actionId
    && terminal.blocker === C.blocker && terminal.originalSourceHead === C.originalSourceHead
    && DIGEST.test(terminal.itemSha256) && DIGEST.test(terminal.resultSha256)
    && DIGEST.test(proof.mechanismSha256) && DIGEST.test(proof.sourceBlobSetSha256);
}
