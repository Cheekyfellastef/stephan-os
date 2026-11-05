export function classifyParkedMissionRepair(state = {}) {
 const blocked=state.currentPhase==='BLOCKED' && state.continuity?.parkingStatus==='PARKED_BLOCKED';
 const reasons=Array.isArray(state.blockers)?state.blockers.filter(x=>typeof x==='string'):[];
 const kind=!blocked?'NOT_PARKED'
   :reasons.some(x=>x.includes('PROVIDER_NEUTRAL_PATCH_CHECK_FAILED')||x.includes('PROVIDER_NEUTRAL_STRUCTURED_EDIT_ANCHOR_MISMATCH'))?'SOURCE_GENERATION_REPAIR_REQUIRED'
   :reasons.some(x=>x.includes('CONTROLLER_STALLED_MISSION')||x.includes('FORGE_PUBLICATION_REQUIRES_FRESH_SOURCE_ARTIFACT'))?'FRESH_SOURCE_ESCROW_REQUIRED'
   :reasons.length?'INDEPENDENT_REPAIR_PROOF_REQUIRED':'BLOCKER_EVIDENCE_MISSING';
 return Object.freeze({missionId:state.missionId||'',revision:state.revision,
  classification:kind,automaticReentryAllowed:false,repairReceiptIssued:false,
  nextAction:kind==='SOURCE_GENERATION_REPAIR_REQUIRED'?'Regenerate bounded source change and validate tests against current head'
  :kind==='FRESH_SOURCE_ESCROW_REQUIRED'?'Rebuild exact-parent source escrow; preserve stale artifact and receipt'
  :kind==='INDEPENDENT_REPAIR_PROOF_REQUIRED'?'Collect independent proof against each exact blocker'
  :kind==='BLOCKER_EVIDENCE_MISSING'?'Inspect canonical mission event history':'No repair required',
  blockers:Object.freeze(reasons),sourceMutationAllowed:false,mergeAuthority:false});
}
