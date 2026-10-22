import { createHash } from 'node:crypto';
import { classifyParkedMissionRepair } from './parkedMissionRepairClassifierV1.mjs';

export function planParkedMissionProofReentry(mission = {}, evidence = {}, sourceHead = '') {
  const classification = classifyParkedMissionRepair(mission);
  const blockers = classification.blockers;
  const validHead = /^[0-9a-f]{40}$/.test(sourceHead);
  const proofs = Array.isArray(evidence.proofs) ? evidence.proofs : [];
  const matched = validHead ? blockers.filter(blocker => proofs.some(p =>
    p && p.blocker === blocker && p.verified === true
    && p.authority === 'CANONICAL_INDEPENDENT_VERIFIER'
    && p.sourceHead === sourceHead
    && typeof p.receiptId === 'string' && /^[a-z0-9._:-]{8,128}$/.test(p.receiptId)
    && Number.isFinite(Date.parse(p.observedAtUtc))
    && p.sourceMutationAllowed === false && p.mergeAuthority === false
    && p.missionId === mission.missionId && p.missionRevision === mission.revision
  )) : [];
  const unresolved = blockers.filter(b => !matched.includes(b));
  const prepared = classification.classification !== 'NOT_PARKED' && blockers.length > 0
    && unresolved.length === 0 && validHead;
  return Object.freeze({
    schemaVersion: 'stephanos.parked-mission-proof-reentry-plan.v1',
    missionId: classification.missionId, missionRevision: classification.revision,
    classification: prepared ? 'REPAIR_PROOF_READY_FOR_INDEPENDENT_ADJUDICATION' : classification.classification,
    provenResolvedBlockers: Object.freeze(matched),
    unresolvedBlockers: Object.freeze(unresolved),
    // This is only a proposal. Existing mission-store preconditions and
    // the canonical scheduler still own REPAIR_PROVEN and REENTERED events.
    eventProposal: prepared ? Object.freeze({
      eventType: 'MISSION_REPAIR_PROVEN', missionId: mission.missionId,
      expectedRevision: mission.revision, expectedCurrentPhase: 'BLOCKED',
      resolvedBlockers: Object.freeze(matched),
      evidenceDigest: createHash('sha256').update(JSON.stringify(proofs.filter(p => matched.includes(p?.blocker)))).digest('hex'),
    }) : null,
    missionEventWritten: false, automaticReentryAllowed: false,
    completionAllowed: false, mergeAuthority: false,
  });
}
