import { planParkedMissionProofReentry } from './parkedMissionProofReentryPlanV1.mjs';

export function planReplacementSourceRecovery({ mission = {}, acceptance = {}, sourceHead = '', observedAtUtc = '' } = {}) {
  const blocked = mission.currentPhase === 'BLOCKED' && mission.continuity?.parkingStatus === 'PARKED_BLOCKED';
  const blockers = Array.isArray(mission.blockers) ? mission.blockers : [];
  const malformed = blockers.length === 1 && blockers[0].startsWith('PROVIDER_NEUTRAL_PATCH_CHECK_FAILED:');
  const verified = Array.isArray(acceptance.proofs) ? acceptance.proofs : [];
  const required = ['SOURCE_MERGED','LOCAL_ROUTE_HTTP_200','DESKTOP_FALLBACK_BROWSER_PROVEN'];
  const matching = required.every(requirement => verified.some(proof => proof.requirement === requirement
    && proof.authority === 'CANONICAL_INDEPENDENT_VERIFIER'
    && proof.sourceHead === sourceHead && proof.verified === true
    && proof.sourceMutationAllowed === false && proof.mergeAuthority === false));
  const eligible = mission.missionId === 'critical-1717-elastic-goal' && blocked && malformed
    && /^[0-9a-f]{40}$/.test(sourceHead) && Number.isFinite(Date.parse(observedAtUtc))
    && matching && acceptance.reconciliation?.completionAllowed === false;
  const repairProofs = eligible ? [{
    blocker:blockers[0], missionId:mission.missionId, missionRevision:mission.revision,
    receiptId:'replacement-source-1717-'+sourceHead.slice(0,12),sourceHead,observedAtUtc,
    verified:true,authority:'CANONICAL_INDEPENDENT_VERIFIER',
    sourceMutationAllowed:false,mergeAuthority:false,
  }] : [];
  const reentry = planParkedMissionProofReentry(mission,{proofs:repairProofs},sourceHead);
  return Object.freeze({
    schemaVersion:'stephanos.replacement-source-recovery-pilot.v1',
    missionId:mission.missionId || '', classification:reentry.eventProposal
      ? 'REPLACEMENT_SOURCE_REPAIR_PROPOSAL_READY'
      : 'REPLACEMENT_SOURCE_EVIDENCE_INCOMPLETE',
    reentry, proposalOnly:true, sourceMutationAllowed:false,
    missionEventWritten:false, completionAllowed:false, mergeAuthority:false,
  });
}
