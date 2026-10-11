export const GOAL_EVIDENCE_RECONCILIATION_SCHEMA = 'stephanos.goal-evidence-reconciliation.v1';
const REQUIREMENTS = Object.freeze({
  1646: ['SOURCE_MERGED', 'DIRECT_METER_OBSERVATION_OR_EXACT_BLOCKER', 'METER_AWARE_FALLBACK_PROVEN', 'DASHBOARD_TRUTH_PROVEN'],
  1717: ['SOURCE_MERGED', 'LOCAL_ROUTE_HTTP_200', 'DESKTOP_FALLBACK_BROWSER_PROVEN', 'WINDOWS_SHORTCUT_PROVEN', 'HEADSET_SESSION_OR_UNSUPPORTED_PROOF', 'APP_ENTRY_PROVEN'],
  1723: ['SOURCE_MERGED', 'QA_ROUTE_HTTP_200', 'TEN_QUESTION_ROUTE_PROVEN', 'INDEPENDENT_PROOF_BINDING', 'GAP_DEDUP_PERSISTENCE', 'VR_LAB_CONSUMER_PROVEN'],
});
function safeProof(proof, requirement, head) {
  return proof && proof.requirement === requirement
    && proof.verified === true
    && typeof proof.receiptId === 'string' && /^[a-zA-Z0-9._:-]{4,128}$/.test(proof.receiptId)
    && typeof proof.sourceHead === 'string' && /^[0-9a-f]{40}$/.test(proof.sourceHead)
    && proof.sourceHead === head
    && typeof proof.observedAtUtc === 'string' && Number.isFinite(Date.parse(proof.observedAtUtc))
    && proof.authority === 'CANONICAL_INDEPENDENT_VERIFIER'
    && proof.sourceMutationAllowed === false && proof.mergeAuthority === false;
}
export function reconcileGoalAcceptance({ goalNumber, mission, sourceHead, proofs = [] } = {}) {
  const requirements = REQUIREMENTS[goalNumber];
  if (!requirements) return Object.freeze({
    schemaVersion: GOAL_EVIDENCE_RECONCILIATION_SCHEMA, goalNumber,
    classification: 'UNSUPPORTED_GOAL_ACCEPTANCE', completionAllowed: false,
    missing: [], verified: [], sourceMutationAllowed: false, mergeAuthority: false,
  });
  const identityValid = mission?.missionId === 'critical-' + goalNumber + '-elastic-goal'
    && /^[0-9a-f]{40}$/.test(String(sourceHead || ''))
    && ['BLOCKED', 'COMPLETE', 'VERIFYING', 'GITHUB_COMMIT', 'CHECK_PULL_REQUEST'].includes(mission?.currentPhase)
    && Array.isArray(proofs);
  const verified = identityValid
    ? requirements.filter((requirement) => proofs.some((proof) => safeProof(proof, requirement, sourceHead)))
    : [];
  const missing = requirements.filter((requirement) => !verified.includes(requirement));
  return Object.freeze({
    schemaVersion: GOAL_EVIDENCE_RECONCILIATION_SCHEMA, goalNumber,
    missionId: identityValid ? mission.missionId : '',
    missionPhase: mission?.currentPhase || 'UNKNOWN',
    classification: !identityValid ? 'MISSION_IDENTITY_OR_HEAD_UNPROVEN'
      : missing.length ? 'GOAL_ACCEPTANCE_EVIDENCE_INCOMPLETE'
        : 'GOAL_ACCEPTANCE_EVIDENCE_PRESENT_AWAITING_CANONICAL_COMPLETION',
    verified: Object.freeze(verified), missing: Object.freeze(missing),
    completionAllowed: false, sourceMutationAllowed: false, mergeAuthority: false,
    nextAction: missing.length ? 'Collect independently verified proof: ' + missing[0]
      : 'Reconcile protected PR, operator approval and deployment through existing mission state machine',
  });
}
