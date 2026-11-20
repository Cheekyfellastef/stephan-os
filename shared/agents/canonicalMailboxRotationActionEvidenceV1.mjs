import {createHash} from 'node:crypto';

export const MAILBOX_ACTION_EVIDENCE_SCHEMA = 'stephanos.mailbox-actions-execution-evidence.v1';
export const LEGACY_PUBLICATION_CONTRACTS = Object.freeze([
 Object.freeze({head:'a33f134c32783a7315fb8afde1ac1c9ddf828fb1',path:'.github/workflows/mailbox-receipt-index.yml',blob:'e8365079c489770113c2fbfb8260da7963bf812d',module:'shared/agents/mailboxReceiptIndexGitHubMirror.mjs',legacyBuilder:'buildTrustedMailboxReceiptIndexGitHubBody'}),
 Object.freeze({head:'a33f134c32783a7315fb8afde1ac1c9ddf828fb1',path:'.github/workflows/codex-banked-reset-telemetry.yml',blob:'4a5ceed577b8d46dad9dbc7a731593ef87d334cc',module:'shared/agents/codexBankedResetTelemetryMirror.mjs',legacyBuilder:'buildCodexBankedResetTelemetryIssueBody'}),
 Object.freeze({head:'b84edbda829e871aeda03333645659d363d7da92',path:'.github/workflows/mailbox-receipt-index.yml',blob:'710622f4964c0e58c25f82eebe4fa301481087ef',module:'shared/agents/mailboxReceiptIndexGitHubMirror.mjs',legacyBuilder:'buildTrustedMailboxReceiptIndexGitHubBody'}),
]);

// This finite cohort is source-bound, not age-exempt. Provider aggregate states
// remain unchanged; every native observation must reacquire the whole attempt.
export const HISTORICAL_SOURCE_NONADMISSION_HEAD = '0b6d131bf9b359c2a118b881f8dedeff4acd8692';
export const HISTORICAL_SOURCE_NONADMISSION_CONTRACTS = Object.freeze([
 Object.freeze({head:HISTORICAL_SOURCE_NONADMISSION_HEAD,path:'.github/workflows/battle-bridge-out-of-band-observer-v1.yml',workflowId:337025205,blob:'360daa7169a151fc36eceda1e9cf953de6957284',kind:'event-generation',runIds:Object.freeze([43096297193,43096449512,43096673217,43096953161,43097019768,43097188613,43097206909,43097219638,43097316478,43097336933,43097350454,43097586820,43097635485,43097643553,43097829265,43098179216,43098316466])}),
 Object.freeze({head:HISTORICAL_SOURCE_NONADMISSION_HEAD,path:'.github/workflows/battle-bridge-tailscale-bootstrap-pipe.yml',workflowId:329359425,blob:'5df955566cc5460d83b9bd4cda64a733c1177b7f',kind:'event-generation',runIds:Object.freeze([43096297168,43096449748,43096673270,43096953103,43097019863,43097188506,43097207361,43097219493,43097316577,43097336946,43097350441,43097586867,43097635490,43097643585,43097829260,43098179090,43098316505])}),
 Object.freeze({head:HISTORICAL_SOURCE_NONADMISSION_HEAD,path:'.github/workflows/codex-banked-reset-telemetry.yml',workflowId:317321687,blob:'cb7be265e349d58565aeedb644295ad0be954602',kind:'event-generation',runIds:Object.freeze([43096213186,43096245937,43096297110,43096297401,43096310896,43096405525,43096443642,43096449666,43096501699,43096610825,43096626260,43096673288,43096694264,43096722199,43096831465,43096849818,43096860790,43096953024,43096966906,43097019766,43097063951,43097083705,43097174790,43097188359,43097201076,43097207017,43097219473,43097273640,43097288213,43097316427,43097336860,43097350475,43097378470,43097405356,43097475422,43097586784,43097587964,43097606287,43097635402,43097643471,43097780334,43097809633,43097829296,43097866750,43097975599,43098003759,43098068602,43098179159,43098183515,43098255492,43098272342,43098283313,43098316434,43098358461,43098461275,43098566375])}),
 Object.freeze({head:HISTORICAL_SOURCE_NONADMISSION_HEAD,path:'.github/workflows/mailbox-receipt-index.yml',workflowId:315398307,blob:'74603b77a7b63ad09ac5c279fce9935669b3fa28',kind:'event-generation',runIds:Object.freeze([43096213166,43096246001,43096297065,43096297226,43096310921,43096405298,43096443629,43096449574,43096501670,43096610684,43096626145,43096673215,43096694271,43096722523,43096831416,43096849886,43096860820,43096953047,43096967007,43097019804,43097064050,43097083654,43097174822,43097188531,43097201091,43097219673,43097273567,43097288269,43097316519,43097337071,43097350412,43097378390,43097405399,43097475453,43097586806,43097587881,43097606421,43097635418,43097643549,43097780177,43097809552,43097829297,43097866767,43097975558,43098003700,43098068632,43098179223,43098183514,43098255407,43098272285,43098283575,43098316544,43098358536,43098461334,43098566328])}),
 Object.freeze({head:HISTORICAL_SOURCE_NONADMISSION_HEAD,path:'.github/workflows/protected-workflow-dispatch-mailbox.yml',workflowId:345768759,blob:'3d22fe929aea9955e091c07eed109e5dd23415fc',kind:'static-checkout',runIds:Object.freeze([43096297298,43096449573,43096673221,43096954295,43097019845,43097188385,43097207001,43097219636,43097316457,43097337030,43097350554,43097586805,43097635446,43097643384,43097829465,43098179072,43098316698])}),
]);
export const HISTORICAL_SOURCE_NONADMISSION_GUARD_BLOB = '48f1d23bf15dadd043f508264f9b44c8e9cfb627';
export const HISTORICAL_SOURCE_NONADMISSION_MODULES = Object.freeze([
 'scripts/canonical-mailbox-workflow-admission-v1.mjs',
 'scripts/canonical-mailbox-workflow-event-gate.mjs',
 'shared/agents/canonicalMailboxRotationFenceV1.mjs',
 'shared/agents/canonicalMailboxRotationV1.mjs',
 'shared/agents/canonicalMailboxRotationActionEvidenceV1.mjs',
 'shared/agents/mailboxHistoricalTerminalAttestationV1.mjs',
]);
export const HISTORICAL_SOURCE_NONADMISSION_STATIC_MODULES = Object.freeze([
 Object.freeze({path:'scripts/canonical-mailbox-workflow-event-gate.mjs',ref:HISTORICAL_SOURCE_NONADMISSION_HEAD,sha:'abc87cbcb6b5176592cf5fbf9479a0f7dd4a1f31'}),
 Object.freeze({path:'scripts/canonical-mailbox-workflow-admission-v1.mjs',ref:HISTORICAL_SOURCE_NONADMISSION_HEAD,sha:'12ecd4d01230981548ae6deb8940e00ea7eedbfc'}),
]);

const repository='Cheekyfellastef/stephan-os';
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const positive=x=>Number.isSafeInteger(x)&&x>0;
const terminal=new Set(['success','failure','cancelled','skipped','timed_out','neutral','action_required','stale']);
export const mailboxActionEvidenceDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function legacyPublicationContract(run){
 return LEGACY_PUBLICATION_CONTRACTS.find(c=>run?.head_sha===c.head&&run?.path===c.path)||null;
}

export function historicalSourceNonadmissionContract(run){
 return HISTORICAL_SOURCE_NONADMISSION_CONTRACTS.find(c=>run?.head_sha===c.head
   &&run?.path===c.path&&run?.workflow_id===c.workflowId&&c.runIds.includes(run?.id))||null;
}

function historicalObservationTimes(proof){
 const times=[proof?.startedAt,proof?.jobsObservedAt,proof?.observedAt].map(Date.parse);
 return times.every(Number.isFinite)&&times[0]<=times[1]&&times[1]<=times[2]
   &&times[2]-times[0]<=120000;
}

function exactRun(pending,proof){
 const r=proof?.run,c=legacyPublicationContract(r)||historicalSourceNonadmissionContract(r);
 if(!c||r.id!==pending?.id||r.status!==pending.status||!['queued','in_progress','waiting','requested','pending'].includes(r.status)||r.path!==`.github/workflows/${pending.workflow}`
   ||r.event!=='issue_comment'||r.head_branch!=='main'||!positive(r.run_attempt)||!positive(r.workflow_id)
   ||r.repository?.full_name!==repository||r.head_repository?.full_name!==repository
   ||proof.workflow?.path!==c.path||proof.workflow?.ref!==c.head||proof.workflow?.sha!==c.blob)return null;
 const after=proof.runAfter;
 if(!after||after.id!==r.id||after.run_attempt!==r.run_attempt||after.head_sha!==r.head_sha
   ||after.status!==r.status||after.path!==r.path||after.workflow_id!==r.workflow_id||after.event!==r.event
   ||after.head_branch!==r.head_branch||after.repository?.full_name!==repository||after.head_repository?.full_name!==repository
   ||!Number.isFinite(Date.parse(proof.observedAt)))return null;
 const j=proof.jobs;
 if(!j||!Number.isSafeInteger(j.total_count)||j.total_count<0||j.total_count>100
   ||!Array.isArray(j.jobs)||j.jobs.length!==j.total_count||proof.attempt!==r.run_attempt)return null;
 if(c.runIds){
  // No rerun, started job, incomplete API response, or lifecycle drift can use
  // source nonadmission. A new attempt is a new execution, outside this cohort.
  if(r.status!=='queued'||r.conclusion!==null||after.conclusion!==null||r.run_attempt!==1
    ||after.created_at!==r.created_at||after.updated_at!==r.updated_at
    ||!Number.isFinite(Date.parse(r.created_at))||!Number.isFinite(Date.parse(r.updated_at))
    ||Date.parse(r.created_at)>Date.parse(r.updated_at)
    ||Date.parse(r.updated_at)>Date.parse(proof.startedAt)
    ||!historicalObservationTimes(proof)||j.total_count!==0||j.jobs.length!==0)return null;
 }
 return{r,c,j};
}

function revokedEntryPoint(source,contract){
 if(!source||!sha(source.mainHead)||!sha(source.activationHead)||!Array.isArray(source.modules))return false;
 const entries=source.modules.filter(m=>m.path===contract.module);
 if(entries.length!==1)return false;
 const m=entries[0];
 return m.legacyBuilder===contract.legacyBuilder&&m.apiVersion===2&&m.legacyAbsent===true
   &&m.replacementPresent===true&&sha(m.localBlob)&&m.mainBlob===m.localBlob&&m.activationBlob===m.localBlob;
}

function historicalSourceNotAdmitted(source,contract){
 const n=source?.nonadmission;
 if(!source||!sha(source.mainHead)||!sha(source.activationHead)
   ||source.mainHead===contract.head||source.activationHead===contract.head
   ||n?.mainHead!==source.mainHead||n?.activationHead!==source.activationHead
   ||n.policyVersion!==1||n.eventSourceGuardVerified!==true
   ||!Array.isArray(n.modules)||n.modules.length!==HISTORICAL_SOURCE_NONADMISSION_MODULES.length)return false;
 for(const path of HISTORICAL_SOURCE_NONADMISSION_MODULES){
  const matches=n.modules.filter(m=>m?.path===path);
  if(matches.length!==1)return false;
  const m=matches[0];
  if(!sha(m.localBlob)||m.mainBlob!==m.localBlob||m.activationBlob!==m.localBlob)return false;
  if(path===HISTORICAL_SOURCE_NONADMISSION_MODULES[0]&&m.localBlob!==HISTORICAL_SOURCE_NONADMISSION_GUARD_BLOB)return false;
 }
 if(contract.kind==='static-checkout'){
  if(!Array.isArray(n.historicalModules)||n.historicalModules.length!==HISTORICAL_SOURCE_NONADMISSION_STATIC_MODULES.length)return false;
  for(const expected of HISTORICAL_SOURCE_NONADMISSION_STATIC_MODULES){
   const matches=n.historicalModules.filter(m=>m?.path===expected.path);
   if(matches.length!==1||matches[0].ref!==expected.ref||matches[0].sha!==expected.sha)return false;
  }
 }
 return true;
}

export function classifyMailboxActionEvidence(pending,proof,source){
 const exact=exactRun(pending,proof);
 if(!exact)return{quiescent:false,reason:'ACTION_EXECUTION_UNPROVEN'};
 const {r,c,j}=exact;
 if(c.runIds)return historicalSourceNotAdmitted(source,c)
  ?{quiescent:true,reason:'HISTORICAL_WORKFLOW_SOURCE_NOT_ADMITTED',attempt:r.run_attempt,workflowBlob:c.blob,sourceKind:c.kind}
  :{quiescent:false,reason:'HISTORICAL_WORKFLOW_SOURCE_UNPROVEN'};
 // A future queued checkout is contained only by the exact immutable caller
 // and physically absent V1 builder in both protected-main and activation.
 if(r.status==='queued'&&j.total_count===0&&revokedEntryPoint(source,c))
   return{quiescent:true,reason:'LEGACY_PUBLICATION_ENTRYPOINT_REVOKED',attempt:r.run_attempt,workflowBlob:c.blob};
 // Complete the entire known two-job DAG, never an empty or partial list.
 if(j.total_count!==2||new Set(j.jobs.map(x=>x.id)).size!==2
   ||JSON.stringify(j.jobs.map(x=>x.name).sort())!==JSON.stringify(['mirror','proof']))
   return{quiescent:false,reason:'ACTION_JOB_DAG_INCOMPLETE'};
 for(const job of j.jobs){
  if(!positive(job.id)||job.run_id!==r.id||job.head_sha!==r.head_sha||job.status!=='completed'
    ||!terminal.has(job.conclusion)||!Number.isFinite(Date.parse(job.completed_at))
    ||Date.parse(job.completed_at)>Date.parse(proof.observedAt))
    return{quiescent:false,reason:'ACTION_JOB_NOT_TERMINAL'};
  if(job.name==='proof'&&job.conclusion==='skipped')continue;
  if(!Array.isArray(job.steps)||!job.steps.length||job.steps.some(s=>s.status!=='completed')
    ||job.steps.at(-1).name!=='Complete job')return{quiescent:false,reason:'ACTION_JOB_FINAL_STEP_UNPROVEN'};
 }
 return{quiescent:true,reason:'EXACT_WORKFLOW_DAG_TERMINAL',attempt:r.run_attempt,workflowBlob:c.blob};
}

export function withMailboxActionEvidence(inventory,{proofs=[],source=null,collection}={}){
 if(inventory?.complete!==true||!Array.isArray(inventory.pendingRuns))throw Error('MAILBOX_ACTION_INVENTORY_INCOMPLETE');
 const evidence={schemaVersion:MAILBOX_ACTION_EVIDENCE_SCHEMA,proofs,source,...(collection===undefined?{}:{collection})};
 const dispositions=inventory.pendingRuns.map(p=>({id:p.id,...classifyMailboxActionEvidence(p,proofs.find(x=>x?.run?.id===p.id),source)}));
 return{...inventory,executionEvidence:evidence,blockingRuns:inventory.pendingRuns.filter((_,i)=>!dispositions[i].quiescent),
   aggregateDispositions:dispositions,evidenceDigest:mailboxActionEvidenceDigest({pending:inventory.pendingRuns,evidence})};
}

function validEvidenceEnvelope(actions){
 if(actions?.complete!==true||!Array.isArray(actions.pendingRuns))return false;
 const e=actions.executionEvidence;
 const started=Date.parse(actions.observedAt);
 if(e?.schemaVersion!==MAILBOX_ACTION_EVIDENCE_SCHEMA||!Array.isArray(e.proofs)||!Number.isFinite(started))return false;
 const hasCollection=Object.hasOwn(e,'collection'),c=e.collection;
 let observed=started;
 if(hasCollection){
  if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).length!==2
    ||!Object.hasOwn(c,'startedAt')||!Object.hasOwn(c,'completedAt')
    ||typeof c.startedAt!=='string'||typeof c.completedAt!=='string'
    ||c.startedAt!==actions.observedAt||!Number.isFinite(Date.parse(c.completedAt)))return false;
  observed=Date.parse(c.completedAt);
  if(observed<started||observed-started>120000
    ||e.proofs.some(p=>['startedAt','jobsObservedAt','observedAt'].some(key=>Object.hasOwn(p||{},key)
      &&(typeof p[key]!=='string'||!Number.isFinite(Date.parse(p[key]))||Date.parse(p[key])<started||Date.parse(p[key])>observed))))return false;
 }
 // Legacy evidence remains readable, but the newly admitted historical cohort
 // must bind the complete inventory/source observation interval into its digest.
 if(!hasCollection&&e.proofs.some(p=>historicalSourceNonadmissionContract(p?.run)))return false;
 if(e.proofs.some(x=>!Number.isFinite(Date.parse(x?.observedAt))||observed-Date.parse(x.observedAt)<0||observed-Date.parse(x.observedAt)>120000)
   ||e.proofs.some(x=>historicalSourceNonadmissionContract(x?.run)
     &&(!historicalObservationTimes(x)||observed-Date.parse(x.startedAt)<0||observed-Date.parse(x.startedAt)>120000))
   ||new Set(actions.pendingRuns.map(x=>x.id)).size!==actions.pendingRuns.length
   ||!actions.pendingRuns.every(p=>positive(p.id)&&typeof p.workflow==='string'&&typeof p.status==='string')
   ||new Set(e.proofs.map(x=>x?.run?.id)).size!==e.proofs.length
   ||e.proofs.some(x=>!actions.pendingRuns.some(p=>p.id===x?.run?.id))
   ||actions.evidenceDigest!==mailboxActionEvidenceDigest({pending:actions.pendingRuns,evidence:e}))return false;
 return true;
}

export function mailboxActionsExecutionQuiescent(actions,{now,mainHead,activationHead}={}){
 if(actions?.complete!==true||!Array.isArray(actions.pendingRuns))return false;
 if(now!==undefined&&(!Number.isFinite(Date.parse(now))||!Number.isFinite(Date.parse(actions.observedAt))
   ||Date.parse(now)-Date.parse(actions.observedAt)<0||Date.parse(now)-Date.parse(actions.observedAt)>120000))return false;
 if(Object.hasOwn(actions,'executionEvidence')||Object.hasOwn(actions,'evidenceDigest')){
  if(!validEvidenceEnvelope(actions)||(now!==undefined&&actions.executionEvidence.collection
    &&Date.parse(now)<Date.parse(actions.executionEvidence.collection.completedAt)))return false;
 }
 if(actions.pendingRuns.length===0)return true;
 if(!validEvidenceEnvelope(actions))return false;
 const e=actions.executionEvidence;
 if(now!==undefined&&e.proofs.some(x=>{
  const first=historicalSourceNonadmissionContract(x?.run)?x.startedAt:x.observedAt;
  return Date.parse(now)-Date.parse(first)<0||Date.parse(now)-Date.parse(first)>120000;
 }))return false;
 const needsSource=actions.pendingRuns.some(p=>['LEGACY_PUBLICATION_ENTRYPOINT_REVOKED','HISTORICAL_WORKFLOW_SOURCE_NOT_ADMITTED']
  .includes(classifyMailboxActionEvidence(p,e.proofs.find(x=>x?.run?.id===p.id),e.source).reason));
 if(needsSource&&((mainHead!==undefined&&e.source?.mainHead!==mainHead)||(activationHead!==undefined&&e.source?.activationHead!==activationHead)))return false;
 return actions.pendingRuns.every(p=>classifyMailboxActionEvidence(p,e.proofs.find(x=>x?.run?.id===p.id),e.source).quiescent);
}

export function mailboxActionEvidenceSummary(actions){
 const count=actions?.complete===true&&Array.isArray(actions.pendingRuns)?actions.pendingRuns.length:-1;
 const quiet=mailboxActionsExecutionQuiescent(actions);
 const e=actions?.executionEvidence;
 const blocking=quiet?0:validEvidenceEnvelope(actions)?actions.pendingRuns.filter(p=>!classifyMailboxActionEvidence(p,e.proofs.find(x=>x?.run?.id===p.id),e.source).quiescent).length:count;
 return{actionPendingAggregateCount:count,actionBlockingCount:blocking,
  actionsQuiescenceDigest:quiet&&count>0?actions.evidenceDigest:''};
}
