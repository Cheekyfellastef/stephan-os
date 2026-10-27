// Goal #1290: workspace record DISCOVERY, never independent proof acceptance.
export const SHARED_WORKSPACE_PROOF_INDEX_SCHEMA = 'stephanos.shared-workspace-proof-index.v1';
export const PROOF_INDEX_STAGES = Object.freeze(['SOURCE_EDIT','TEST','CI','INDEPENDENT_REVIEW','PROTECTED_MERGE','INSTALLED','SERVED','OS_PICKUP']);
const ROOT='https://github.com/Cheekyfellastef/stephan-os';
const ID=/^[a-z0-9][a-z0-9._-]{0,80}$/i, SHA=/^[a-f0-9]{40}$/, NUMBER=/^[1-9][0-9]{0,9}$/;
const KIND=new Set(['stephanos.shared_workspace.proof','stephanos.shared_workspace.record.receipt']);
const CLASS={SOURCE:'SOURCE_EDIT',COMMIT:'SOURCE_EDIT',FOCUSED_TEST:'TEST',WORKFLOW:'CI',REVIEW:'INDEPENDENT_REVIEW',SPECIALIST_REVIEW:'INDEPENDENT_REVIEW',MERGE:'PROTECTED_MERGE',PICKUP:'OS_PICKUP'};
const str=v=>typeof v==='string'?v.trim():'';
const id=v=>ID.test(str(v))?str(v):'';
const sha=v=>SHA.test(str(v).toLowerCase())?str(v).toLowerCase():'';
const number=v=>{const s=str(typeof v==='number'?String(v):v).replace(/^#/,'').replace(/^goal-/i,'');return NUMBER.test(s)?Number(s):null};
const ext=v=>{const s=str(typeof v==='number'?String(v):v),n=Number(s);return /^[1-9][0-9]{0,15}$/.test(s)&&Number.isSafeInteger(n)?n:null};
const list=(v,n=200)=>Array.isArray(v)?v.slice(0,n):[];
const time=v=>{const n=Date.parse(str(v));return Number.isFinite(n)?n:NaN};
const stage=v=>{const s=str(v).toUpperCase().replace(/[^A-Z0-9]+/g,'_');return PROOF_INDEX_STAGES.includes(s)?s:CLASS[s]||'UNKNOWN'};
const digest=v=>/^(?:sha256:)?[a-f0-9]{64}$/.test(str(v).toLowerCase())?str(v).toLowerCase():'';
const emptyAuthority=Object.freeze({mergeAuthority:false,sourceMutationAllowed:false,leaseSeizureAllowed:false,signerAuthority:false,reviewerQualification:false});
function projectRecord(r,now,titles,heads){
  if(!r||typeof r!=='object'||Array.isArray(r)||!KIND.has(r.kind)||r.schemaVersion!=='shared-agent-workspace-record.v1')return null;
  const proofId=id(r.proofId||r.receiptId),observedAtUtc=str(r.timestampUtc),observed=time(observedAtUtc);
  if(!proofId||!Number.isFinite(observed))return null;
  const goal=number(r.relatedIssue),prNumber=number(r.relatedPr),sourceHead=sha(r.sourceHead||r.headSha||r.expectedHead);
  const runId=ext(r.reviewRunId||r.workflowRunId||r.runId),artifactId=ext(r.artifactId||r.reviewArtifactId),runAttempt=ext(r.runAttempt||r.reviewRunAttempt);
  const status=str(r.status||r.finalVerdict).toUpperCase(),age=now-observed;
  let state='UNVERIFIED',nextGate='AUTHENTICATED_SOURCE_VERIFICATION_REQUIRED';
  if(age< -60000||age>3600000){state='STALE';nextGate='REFRESH_AND_VERIFY_ORIGINAL_PROOF'}
  if(/FAIL|ERROR|BLOCKED|DENIED|REJECTED/.test(status)){state='FAILED';nextGate='INSPECT_ORIGINAL_FAILURE'}
  if(goal&&sourceHead&&heads.get(goal)&&heads.get(goal)!==sourceHead){state='SUPERSEDED';nextGate='OBTAIN_CURRENT_HEAD_PROOF'}
  const sourceLink=runId&&artifactId?ROOT+'/actions/runs/'+runId+'/artifacts/'+artifactId:runId?ROOT+'/actions/runs/'+runId:prNumber&&sourceHead?ROOT+'/pull/'+prNumber+'/commits/'+sourceHead:prNumber?ROOT+'/pull/'+prNumber:'';
  return Object.freeze({proofId,kind:r.kind==='stephanos.shared_workspace.proof'?'PROOF_RECORD':'RECEIPT_RECORD',goal,goalTitle:titles.get(goal)||'',prNumber,
    participant:id(r.participantId||r.sender)||'UNKNOWN',sourceHead,sourceTree:sha(r.sourceTree||r.treeSha),baseSha:sha(r.baseSha||r.expectedBase),
    stage:stage(r.proofClass||r.proofStage||r.stage||r.evidenceClass),state,reportedResult:/^(PASS|SUCCESS|READY|FAILED|FAIL|BLOCKED|DONE|UNKNOWN)$/.test(status)?status:'UNKNOWN',
    runId,runAttempt,artifactId,artifactDigest:digest(r.artifactDigest||r.reviewArtifactDigest),observedAtUtc,observedAgeSeconds:Math.max(0,Math.floor(age/1000)),
    sourceLink,sourceLinkTrust:sourceLink?'UNVERIFIED_METADATA':'NO_EXTERNAL_LINK',nextGate,
    independentVerification:false,reviewerQualification:false,protectedMergeProven:false,installedProven:false,osPickupProven:false});
}
export function projectSharedWorkspaceProofIndex({feed={},goal,pr,head,nowMs=Date.now(),limit=20,currentHeads={}}={}){
  const selectedGoal=goal===undefined||goal===''?null:number(goal),selectedPr=pr===undefined||pr===''?null:number(pr),selectedHead=head===undefined||head===''?'':sha(head);
  const invalid=(goal!==undefined&&goal!==''&&!selectedGoal)||(pr!==undefined&&pr!==''&&!selectedPr)||(head!==undefined&&head!==''&&!selectedHead);
  const base={schemaVersion:SHARED_WORKSPACE_PROOF_INDEX_SCHEMA,readOnly:true,authority:emptyAuthority};
  if(invalid)return Object.freeze({...base,state:'INVALID_FILTER',entries:Object.freeze([]),total:0,blockers:Object.freeze(['PROOF_INDEX_FILTER_INVALID'])});
  if(!['ready','stale'].includes(str(feed?.state)))return Object.freeze({...base,state:'INACCESSIBLE',entries:Object.freeze([]),total:0,
    blockers:Object.freeze(['WORKSPACE_FEED_UNAVAILABLE']),nextAction:'Restore the existing Shared Workspace feed; no missing proof is presumed complete.'});
  const records=feed.records||{},titles=new Map(),heads=new Map();
  for(const r of list(records.goalRecords)){
    const n=number(r?.relatedIssue||r?.issueNumber||r?.goalId),t=str(r?.title);
    if(n&&/^[a-z0-9][a-z0-9 #.,:_()+'/-]{0,159}$/i.test(t)&&!titles.has(n))titles.set(n,t);
  }
  if(currentHeads&&typeof currentHeads==='object'&&!Array.isArray(currentHeads))for(const [k,v] of Object.entries(currentHeads).slice(0,60)){
    const n=number(k),h=sha(v);if(n&&h)heads.set(n,h);
  }
  const candidates=[...list(records.proofRecords),...list(records.receiptRecords)],seen=new Set(),observed=[];
  for(const raw of candidates){const x=projectRecord(raw,nowMs,titles,heads);
    if(!x||(selectedGoal!==null&&x.goal!==selectedGoal)||(selectedPr!==null&&x.prNumber!==selectedPr)||(selectedHead&&x.sourceHead!==selectedHead))continue;
    const key=[x.kind,x.proofId,x.sourceHead,x.stage,x.reportedResult,x.observedAtUtc,x.runId,x.runAttempt].join('|');
    if(!seen.has(key)){seen.add(key);observed.push(x)}
  }
  observed.sort((a,b)=>Date.parse(b.observedAtUtc)-Date.parse(a.observedAtUtc)||a.proofId.localeCompare(b.proofId));
  const entries=Object.freeze(observed.slice(0,Number.isInteger(limit)&&limit>0?Math.min(limit,24):20));
  return Object.freeze({...base,state:feed.state==='stale'?'STALE':'READY',source:'VALIDATED_WORKSPACE_RECORD_METADATA_ONLY',total:observed.length,shown:entries.length,
    truncated:entries.length<observed.length,goal:selectedGoal,prNumber:selectedPr,sourceHead:selectedHead,entries,
    blockers:Object.freeze(observed.length?['EXTERNAL_PROOF_VERIFICATION_NOT_COMMISSIONED']:['NO_SCOPED_WORKSPACE_PROOF_RECORDS']),
    nextAction:'Verify original GitHub/native evidence for the exact head before upgrading any stage from CLAIMED to PROVEN.'});
}
