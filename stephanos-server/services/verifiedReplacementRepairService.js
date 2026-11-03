import {createHash} from 'node:crypto';
import {planReplacementSourceRecovery} from '../../shared/agents/replacementSourceRecoveryPilotV1.mjs';
import {readMissionRecord,appendMissionEvent} from './missionOrchestratorStore.js';

export async function submitVerifiedReplacementRepair({
  sourceHead, collectAcceptance, verifyCurrentHead,
  readMission=readMissionRecord, appendEvent=appendMissionEvent,
  nowUtc=new Date().toISOString(),
}={}) {
  const blocked=(classification,extra={})=>Object.freeze({
    ok:false,classification,eventWritten:false,reentered:false,completed:false,...extra,
  });
  if(typeof collectAcceptance!=='function'||typeof verifyCurrentHead!=='function'
    || !/^[a-f0-9]{40}$/.test(sourceHead)) return blocked('REPAIR_VERIFIER_UNAVAILABLE');
  if(await verifyCurrentHead(sourceHead)!==true) return blocked('REPAIR_EXACT_HEAD_MOVED');
  const loaded=await readMission('critical-1717-elastic-goal');
  const mission=loaded?.state;
  if(mission?.currentPhase!=='BLOCKED'||mission?.continuity?.parkingStatus!=='PARKED_BLOCKED'
    || !Number.isSafeInteger(mission?.revision)) return blocked('REPAIR_MISSION_NOT_PARKED');
  const acceptance=await collectAcceptance(mission,sourceHead);
  const plan=planReplacementSourceRecovery({mission,acceptance,sourceHead,observedAtUtc:nowUtc});
  const proposal=plan.reentry.eventProposal;
  if(!proposal) return blocked('REPAIR_EVIDENCE_INCOMPLETE',{plan});
  if(await verifyCurrentHead(sourceHead)!==true) return blocked('REPAIR_EXACT_HEAD_MOVED');
  const digest=createHash('sha256').update([
    mission.missionId,mission.revision,sourceHead,proposal.evidenceDigest
  ].join(':')).digest('hex').slice(0,24);
  const eventId='verified-replacement-repair-'+digest;
  const result=await appendEvent(mission.missionId,{
    eventId,eventType:'MISSION_REPAIR_PROVEN',
    expectedRevision:mission.revision,expectedCurrentPhase:'BLOCKED',
    resolvedBlockers:proposal.resolvedBlockers,
    receipt:{
      receiptId:eventId,requirement:'independently verified replacement source repair',
      source:'goal-acceptance-live-verifier',evidenceType:'verified-source-and-browser',
      verified:true,sha256:proposal.evidenceDigest,createdAt:nowUtc,
    },
    summary:'Merged VR Link source and live browser evidence repair the original malformed patch, not full goal acceptance.',
  });
  if(result?.preconditionFailed) return blocked('REPAIR_MISSION_REVISION_MOVED');
  const repaired=result?.state?.continuity?.parkingStatus==='REENTRY_READY'
    && result?.state?.currentPhase==='BLOCKED';
  return Object.freeze({
    ok:repaired,classification:repaired?'REPAIR_PROOF_CANONICALLY_ACCEPTED':'REPAIR_EVENT_UNACCEPTED',
    missionId:mission.missionId,eventId,eventWritten:repaired,
    reentered:false,completed:false,revision:result?.state?.revision,
  });
}
