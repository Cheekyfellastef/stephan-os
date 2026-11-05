export const EXTERNAL_MERGE_OBSERVATION_SCHEMA = 'stephanos.external-merge-observation.v1';
const SHA = /^[a-f0-9]{40}$/;
const REPOSITORY = 'Cheekyfellastef/stephan-os';

// Observation records source integration only. It never supplies the old
// executor's approval, release, deployment or whole-goal acceptance receipt.
export function externalMergeCandidateV1(mission = {}) {
  return mission.repository === REPOSITORY
    && mission.missionKind === 'implementation'
    && mission.currentPhase === 'AWAITING_OPERATOR_APPROVAL'
    && mission.approval?.status === 'pending'
    && mission.cancelled !== true && !(mission.blockers || []).length
    && mission.continuity?.parkingStatus === 'ACTIVE'
    && mission.dispatch?.status === 'complete'
    && mission.activeWriter === 'none'
    && !mission.storeMetadata?.originalSourceAttemptFence
    && !mission.storeMetadata?.supervisedRecoveryMaintenance
    && !mission.externalMergeObservation
    && Number.isSafeInteger(mission.revision) && mission.revision >= 0
    && Number.isSafeInteger(mission.pullRequest?.number) && mission.pullRequest.number > 0
    && SHA.test(mission.pullRequest?.headSha || '')
    && mission.git?.commitSha === mission.pullRequest.headSha
    && mission.pullRequest?.merged !== true;
}

export function validateExternalMergeObservationV1(mission, observation, nowUtc) {
  const errors = [];
  if (!externalMergeCandidateV1(mission)) errors.push('EXTERNAL_MERGE_MISSION_INELIGIBLE');
  const o = observation || {};
  if (o.schemaVersion !== EXTERNAL_MERGE_OBSERVATION_SCHEMA || o.source !== 'github-api'
      || o.repository !== REPOSITORY || o.missionId !== mission?.missionId
      || o.expectedRevision !== mission?.revision || o.prNumber !== mission?.pullRequest?.number
      || o.headSha !== mission?.pullRequest?.headSha || o.branch !== mission?.git?.branch
      || o.baseBranch !== 'main' || o.merged !== true || o.prState !== 'closed'
      || !SHA.test(o.mergeCommitSha || '') || !SHA.test(o.mainHead || '')
      || o.ancestorCommit !== o.mergeCommitSha || o.ancestryMainHead !== o.mainHead
      || o.mainRecheckHead !== o.mainHead || o.mergeAncestorOfMain !== true) {
    errors.push('EXTERNAL_MERGE_OBSERVATION_IDENTITY_UNPROVEN');
  }
  const now = Date.parse(nowUtc), observed = Date.parse(o.observedAtUtc), merged = Date.parse(o.mergedAtUtc);
  if (!Number.isFinite(now) || !Number.isFinite(observed) || observed > now
      || now - observed > 60_000 || !Number.isFinite(merged) || merged > observed) {
    errors.push('EXTERNAL_MERGE_OBSERVATION_TIME_INVALID');
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function hasExternalMergeObservationV1(mission = {}) {
  const o = mission.externalMergeObservation;
  return o?.schemaVersion === EXTERNAL_MERGE_OBSERVATION_SCHEMA
    && o.source === 'github-api' && o.repository === REPOSITORY
    && o.repository === mission.repository && o.missionId === mission.missionId
    && o.prNumber === mission.pullRequest?.number && o.headSha === mission.pullRequest?.headSha
    && o.branch === mission.git?.branch && o.baseBranch === 'main'
    && o.merged === true && o.prState === 'closed' && o.mergeAncestorOfMain === true
    && o.ancestorCommit === o.mergeCommitSha && o.ancestryMainHead === o.mainHead
    && o.mainRecheckHead === o.mainHead && /^[a-f0-9]{64}$/.test(o.evidenceSha256 || '')
    && o.historicalApprovalProven === false && o.runtimeMutationAuthority === false
    && o.goalAcceptanceProven === false
    && SHA.test(o.mergeCommitSha || '') && SHA.test(o.mainHead || '')
    && typeof o.receiptId === 'string' && mission.evidenceReceipts?.some(r =>
      r.receiptId === o.receiptId && r.source === 'completion-guardian-github-observation'
      && r.evidenceType === 'github-merged-observation' && r.verified === true
      && r.commandOutputHash === o.evidenceSha256);
}
