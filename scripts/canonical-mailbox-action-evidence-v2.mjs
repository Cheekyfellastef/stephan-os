import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFile,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as index from '../shared/agents/mailboxReceiptIndexGitHubMirror.mjs';
import * as telemetry from '../shared/agents/codexBankedResetTelemetryMirror.mjs';
import * as actionEvidence from '../shared/agents/canonicalMailboxRotationActionEvidenceV1.mjs';
import * as workflowAdmission from './canonical-mailbox-workflow-admission-v1.mjs';
import {BATTLE_BRIDGE_WINDOWS_HOST} from '../shared/agents/battleBridgeWindowsHosts.mjs';
import {evaluateMailboxRotationActionInventory,MAILBOX_ROTATION_ACTIONS_PAGE_SIZE,MAILBOX_ROTATION_ACTIONS_MAX_PAGES} from '../shared/agents/canonicalMailboxRotationFenceV1.mjs';
import {legacyPublicationContract,withMailboxActionEvidence} from '../shared/agents/canonicalMailboxRotationActionEvidenceV1.mjs';

const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const modules=[
 {path:'shared/agents/mailboxReceiptIndexGitHubMirror.mjs',namespace:index,version:'MAILBOX_RECEIPT_PUBLICATION_API_VERSION',legacyBuilder:'buildTrustedMailboxReceiptIndexGitHubBody',replacement:'buildTrustedMailboxReceiptIndexGitHubBodyV2'},
 {path:'shared/agents/codexBankedResetTelemetryMirror.mjs',namespace:telemetry,version:'CODEX_BANKED_RESET_PUBLICATION_API_VERSION',legacyBuilder:'buildCodexBankedResetTelemetryIssueBody',replacement:'buildCodexBankedResetTelemetryIssueBodyV2'},
];
export function localMailboxPublicationRevocations(){
 return modules.map(m=>{
  const raw=Buffer.from(readFileSync(new URL('../'+m.path,import.meta.url),'utf8').replaceAll('\r\n','\n'));
  return{path:m.path,localBlob:createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex'),
   legacyBuilder:m.legacyBuilder,apiVersion:m.namespace[m.version],legacyAbsent:!(m.legacyBuilder in m.namespace),replacementPresent:typeof m.namespace[m.replacement]==='function'};
 });
}

export const MAILBOX_ACTION_PROOF_BATCH_SCHEMA='stephanos.mailbox-action-proof-batch.v1';
export const MAILBOX_ACTION_PROOF_BATCH_MAX_TARGETS=200;
export const MAILBOX_ACTION_PROOF_BATCH_MAX_MS=75000;
export const MAILBOX_ACTION_PROOF_READ_MAX_MS=15000;
export const MAILBOX_ACTION_PROOF_BATCH_CONCURRENCY=8;
const batchRepository='Cheekyfellastef/stephan-os';
const batchArgument='--mailbox-action-proof-batch-v1';
const batchSpecMaxBytes=256*1024, batchResultMaxBytes=2*1024*1024, readMaxBytes=512*1024;
const batchBlockers=new Set([
 'MAILBOX_ACTION_BATCH_SPEC_INVALID','MAILBOX_ACTION_BATCH_TOO_LARGE','MAILBOX_ACTION_BATCH_PATH_DENIED',
 'MAILBOX_ACTION_BATCH_DEADLINE','MAILBOX_ACTION_BATCH_READ_TIMEOUT','MAILBOX_ACTION_BATCH_READ_FAILED',
 'MAILBOX_ACTION_BATCH_RUN_DRIFT','MAILBOX_ACTION_BATCH_JOBS_INVALID','MAILBOX_ACTION_BATCH_RESULT_INVALID',
 'MAILBOX_ACTION_BATCH_CHILD_FAILED',
]);
const batchError=code=>Error(batchBlockers.has(code)?code:'MAILBOX_ACTION_BATCH_CHILD_FAILED');
const positive=value=>Number.isSafeInteger(value)&&value>0;
const contractForRun=run=>legacyPublicationContract(run)||actionEvidence.historicalSourceNonadmissionContract?.(run)||null;
function plainRecord(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const prototype=Object.getPrototypeOf(value);
 return (prototype===Object.prototype||prototype===null)
  &&Object.values(Object.getOwnPropertyDescriptors(value)).every(d=>Object.hasOwn(d,'value'));
}
function exactKeys(value,keys){
 return plainRecord(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
}
const runKeys=['id','run_attempt','head_sha','path','status','event','head_branch','workflow_id','repository','head_repository',
 'created_at','updated_at','conclusion'];
function runIdentity(run){
 return {id:run.id,run_attempt:run.run_attempt,head_sha:run.head_sha,path:run.path,status:run.status,
  event:run.event,head_branch:run.head_branch,workflow_id:run.workflow_id,
  repository:{full_name:run.repository?.full_name},head_repository:{full_name:run.head_repository?.full_name},
  created_at:run.created_at,updated_at:run.updated_at,conclusion:run.conclusion};
}
function admittedRunIdentity(run){
 return plainRecord(run)&&positive(run.id)&&positive(run.run_attempt)&&positive(run.workflow_id)&&sha(run.head_sha)
  &&['queued','in_progress','waiting','requested','pending'].includes(run.status)
  &&run.event==='issue_comment'&&run.head_branch==='main'
  &&run.repository?.full_name===batchRepository&&run.head_repository?.full_name===batchRepository
  &&Number.isFinite(Date.parse(run.created_at))&&Number.isFinite(Date.parse(run.updated_at))
  &&Date.parse(run.created_at)<=Date.parse(run.updated_at)&&run.conclusion===null
  &&Boolean(contractForRun(run));
}
function sameRunIdentity(actual,expected){
 return admittedRunIdentity(actual)&&runKeys.every(key=>key==='repository'||key==='head_repository'
  ?actual[key]?.full_name===expected[key]?.full_name:actual[key]===expected[key]);
}
function boundedJsonBytes(value,limit,blocker){
 let text;
 try{text=JSON.stringify(value);}catch{throw batchError(blocker);}
 if(typeof text!=='string'||Buffer.byteLength(text)>limit)throw batchError(blocker);
 return text;
}
export function validateMailboxActionProofBatchSpec(spec){
 boundedJsonBytes(spec,batchSpecMaxBytes,'MAILBOX_ACTION_BATCH_TOO_LARGE');
 if(!exactKeys(spec,['schemaVersion','repository','targets'])||spec.schemaVersion!==MAILBOX_ACTION_PROOF_BATCH_SCHEMA
   ||spec.repository!==batchRepository||!Array.isArray(spec.targets)||!spec.targets.length
   ||spec.targets.length>MAILBOX_ACTION_PROOF_BATCH_MAX_TARGETS)throw batchError('MAILBOX_ACTION_BATCH_SPEC_INVALID');
 const ids=new Set();
 for(const target of spec.targets){
  if(!exactKeys(target,['run','workflow'])||!exactKeys(target.run,runKeys)
    ||!exactKeys(target.run.repository,['full_name'])||!exactKeys(target.run.head_repository,['full_name'])
    ||!admittedRunIdentity(target.run)||ids.has(target.run.id)
    ||!exactKeys(target.workflow,['path','ref','sha']))throw batchError('MAILBOX_ACTION_BATCH_SPEC_INVALID');
  const contract=contractForRun(target.run);
  if(target.workflow.path!==contract.path||target.workflow.ref!==contract.head||target.workflow.sha!==contract.blob)
   throw batchError('MAILBOX_ACTION_BATCH_SPEC_INVALID');
  ids.add(target.run.id);
 }
 return spec;
}
function validateJobs(jobs){
 if(!plainRecord(jobs)||!Number.isSafeInteger(jobs.total_count)||jobs.total_count<0||jobs.total_count>100
  ||!Array.isArray(jobs.jobs)||jobs.jobs.length!==jobs.total_count)throw batchError('MAILBOX_ACTION_BATCH_JOBS_INVALID');
 boundedJsonBytes(jobs,readMaxBytes,'MAILBOX_ACTION_BATCH_JOBS_INVALID');
 return {total_count:jobs.total_count,jobs:jobs.jobs.map(job=>{
  if(!plainRecord(job))throw batchError('MAILBOX_ACTION_BATCH_JOBS_INVALID');
  return {id:job.id,name:job.name,run_id:job.run_id,head_sha:job.head_sha,status:job.status,
   conclusion:job.conclusion,completed_at:job.completed_at,
   ...(Array.isArray(job.steps)?{steps:job.steps.map(step=>({name:step?.name,status:step?.status}))}:{})};
 })};
}
function allowedBatchReadPath(path){
 const match=typeof path==='string'&&path.match(/^actions\/runs\/([1-9][0-9]*)(?:\/attempts\/([1-9][0-9]*)\/jobs\?per_page=100)?$/);
 return Boolean(match&&positive(Number(match[1]))&&(!match[2]||positive(Number(match[2]))));
}
function readFixedMailboxActionJson(path,{signal,timeoutMs}){
 if(!allowedBatchReadPath(path))throw batchError('MAILBOX_ACTION_BATCH_PATH_DENIED');
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>MAILBOX_ACTION_PROOF_READ_MAX_MS)
  throw batchError('MAILBOX_ACTION_BATCH_SPEC_INVALID');
 return new Promise((resolve,reject)=>{
  execFile(BATTLE_BRIDGE_WINDOWS_HOST.githubCli,['api','--method','GET','repos/'+batchRepository+'/'+path],{
   cwd:fileURLToPath(new URL('..',import.meta.url)),shell:false,windowsHide:true,encoding:'utf8',
   timeout:Math.ceil(timeoutMs),signal,maxBuffer:readMaxBytes,
  },(error,stdout)=>{
   if(error){reject(batchError('MAILBOX_ACTION_BATCH_READ_FAILED'));return;}
   try{
    if(Buffer.byteLength(stdout)>readMaxBytes)throw Error();
    resolve(JSON.parse(stdout));
   }catch{reject(batchError('MAILBOX_ACTION_BATCH_READ_FAILED'));}
  });
 });
}

// A finite read-only batch: eight independent before -> attempt jobs -> after
// chains. Neither retries nor cached evidence can extend the wall-clock budget.
export async function collectMailboxActionProofsBounded(spec,{
 read=readFixedMailboxActionJson,now=()=>new Date().toISOString(),clock=()=>performance.now(),
 budgetMs=MAILBOX_ACTION_PROOF_BATCH_MAX_MS,requestTimeoutMs=MAILBOX_ACTION_PROOF_READ_MAX_MS,
}={}){
 validateMailboxActionProofBatchSpec(spec);
 if(typeof read!=='function'||typeof now!=='function'||typeof clock!=='function'
  ||!Number.isFinite(budgetMs)||budgetMs<=0||budgetMs>MAILBOX_ACTION_PROOF_BATCH_MAX_MS
  ||!Number.isFinite(requestTimeoutMs)||requestTimeoutMs<=0||requestTimeoutMs>MAILBOX_ACTION_PROOF_READ_MAX_MS)
  throw batchError('MAILBOX_ACTION_BATCH_SPEC_INVALID');
 const started=clock();
 if(!Number.isFinite(started))throw batchError('MAILBOX_ACTION_BATCH_SPEC_INVALID');
 const deadline=started+budgetMs,batch=new AbortController();
 const timer=setTimeout(()=>batch.abort(),budgetMs);
 const checkDeadline=()=>{
  const current=clock();
  if(batch.signal.aborted||!Number.isFinite(current)||current<started||current>=deadline)
   throw batchError('MAILBOX_ACTION_BATCH_DEADLINE');
  return deadline-current;
 };
 const readOne=async path=>{
  if(!allowedBatchReadPath(path))throw batchError('MAILBOX_ACTION_BATCH_PATH_DENIED');
  const remaining=checkDeadline(),timeoutMs=Math.min(requestTimeoutMs,remaining),request=new AbortController();
  let requestTimer,onAbort;
  const stopped=new Promise((_,reject)=>{
   onAbort=()=>{request.abort();reject(batchError('MAILBOX_ACTION_BATCH_DEADLINE'));};
   batch.signal.addEventListener('abort',onAbort,{once:true});
   requestTimer=setTimeout(()=>{
    request.abort();
    reject(batchError(timeoutMs===remaining?'MAILBOX_ACTION_BATCH_DEADLINE':'MAILBOX_ACTION_BATCH_READ_TIMEOUT'));
   },timeoutMs);
  });
  try{
   const value=await Promise.race([Promise.resolve().then(()=>read(path,{signal:request.signal,timeoutMs})),stopped]);
   checkDeadline();
   return value;
  }catch(error){
   if(batch.signal.aborted)throw batchError('MAILBOX_ACTION_BATCH_DEADLINE');
   throw batchError(batchBlockers.has(error?.message)?error.message:'MAILBOX_ACTION_BATCH_READ_FAILED');
  }finally{
   clearTimeout(requestTimer);batch.signal.removeEventListener('abort',onAbort);request.abort();
  }
 };
 const proofs=new Array(spec.targets.length);let next=0;
 const worker=async()=>{
  while(next<spec.targets.length){
   checkDeadline();
   const position=next++,target=spec.targets[position],path='actions/runs/'+target.run.id;
   const startedAt=now();
   const before=await readOne(path);
   if(!sameRunIdentity(before,target.run))throw batchError('MAILBOX_ACTION_BATCH_RUN_DRIFT');
   const jobs=validateJobs(await readOne(path+'/attempts/'+before.run_attempt+'/jobs?per_page=100'));
   const jobsObservedAt=now();
   const after=await readOne(path);
   if(!sameRunIdentity(after,before))throw batchError('MAILBOX_ACTION_BATCH_RUN_DRIFT');
   const observedAt=now();
   if(![startedAt,jobsObservedAt,observedAt].every(t=>Number.isFinite(Date.parse(t)))
    ||Date.parse(startedAt)>Date.parse(jobsObservedAt)||Date.parse(jobsObservedAt)>Date.parse(observedAt))
    throw batchError('MAILBOX_ACTION_BATCH_RESULT_INVALID');
   proofs[position]={run:runIdentity(before),runAfter:runIdentity(after),workflow:{...target.workflow},
    attempt:before.run_attempt,jobs,startedAt,jobsObservedAt,observedAt};
  }
 };
 try{
  await Promise.all(Array.from({length:Math.min(MAILBOX_ACTION_PROOF_BATCH_CONCURRENCY,spec.targets.length)},worker));
  checkDeadline();
  boundedJsonBytes(proofs,batchResultMaxBytes,'MAILBOX_ACTION_BATCH_RESULT_INVALID');
  return proofs;
 }finally{clearTimeout(timer);batch.abort();}
}

// The existing synchronous native sync/guard contract is retained. This exact
// module is a bounded child for authenticated GETs only, never a new controller.
export function collectMailboxActionProofsNative(spec,{spawnSyncFn=spawnSync}={}){
 validateMailboxActionProofBatchSpec(spec);
 const input=boundedJsonBytes(spec,batchSpecMaxBytes,'MAILBOX_ACTION_BATCH_TOO_LARGE');
 const result=spawnSyncFn(process.execPath,[fileURLToPath(import.meta.url),batchArgument],{
  cwd:fileURLToPath(new URL('..',import.meta.url)),shell:false,windowsHide:true,encoding:'utf8',
  input,timeout:MAILBOX_ACTION_PROOF_BATCH_MAX_MS,maxBuffer:batchResultMaxBytes,
 });
 if(result?.error?.code==='ETIMEDOUT')throw batchError('MAILBOX_ACTION_BATCH_DEADLINE');
 if(result?.error)throw batchError('MAILBOX_ACTION_BATCH_CHILD_FAILED');
 let value;
 try{
  if(typeof result?.stdout!=='string'||Buffer.byteLength(result.stdout)>batchResultMaxBytes)throw Error();
  value=JSON.parse(result.stdout);
 }catch{throw batchError('MAILBOX_ACTION_BATCH_RESULT_INVALID');}
 if(result.status!==0||value?.ok!==true){
  throw batchError(batchBlockers.has(value?.blocker)?value.blocker:'MAILBOX_ACTION_BATCH_CHILD_FAILED');
 }
 if(!exactKeys(value,['schemaVersion','ok','proofs'])||value.schemaVersion!==MAILBOX_ACTION_PROOF_BATCH_SCHEMA
  ||!Array.isArray(value.proofs)||value.proofs.length!==spec.targets.length)throw batchError('MAILBOX_ACTION_BATCH_RESULT_INVALID');
 for(let i=0;i<spec.targets.length;i++){
  const target=spec.targets[i],proof=value.proofs[i];
  if(!plainRecord(proof)||!sameRunIdentity(proof.run,target.run)||!sameRunIdentity(proof.runAfter,proof.run)
   ||proof.attempt!==target.run.run_attempt||proof.workflow?.path!==target.workflow.path
   ||proof.workflow?.ref!==target.workflow.ref||proof.workflow?.sha!==target.workflow.sha
   ||![proof.startedAt,proof.jobsObservedAt,proof.observedAt].every(t=>Number.isFinite(Date.parse(t)))
   ||Date.parse(proof.startedAt)>Date.parse(proof.jobsObservedAt)
   ||Date.parse(proof.jobsObservedAt)>Date.parse(proof.observedAt))throw batchError('MAILBOX_ACTION_BATCH_RESULT_INVALID');
  validateJobs(proof.jobs);
 }
 return value.proofs;
}

const nonadmissionGuardBlob=actionEvidence.HISTORICAL_SOURCE_NONADMISSION_GUARD_BLOB;
const nonadmissionPaths=actionEvidence.HISTORICAL_SOURCE_NONADMISSION_MODULES;
const historicalGuardModules=actionEvidence.HISTORICAL_SOURCE_NONADMISSION_STATIC_MODULES;
export function localMailboxWorkflowNonadmission(){
 const modules=nonadmissionPaths.map(path=>{
  const raw=Buffer.from(readFileSync(new URL('../'+path,import.meta.url),'utf8').replaceAll('\r\n','\n'));
  return {path,localBlob:createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex')};
 });
 const sourceHead='f'.repeat(40),historicalHead=actionEvidence.HISTORICAL_SOURCE_NONADMISSION_HEAD;
 const env={GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'issue_comment',GITHUB_REPOSITORY:batchRepository,
  GITHUB_REPOSITORY_ID:'1179385578',GITHUB_REPOSITORY_OWNER:'Cheekyfellastef',GITHUB_REPOSITORY_OWNER_ID:'267490109',
  GITHUB_REF:'refs/heads/main',GITHUB_WORKFLOW_REF:batchRepository+'/.github/workflows/mailbox-receipt-index.yml@refs/heads/main',
  GITHUB_WORKFLOW_SHA:sourceHead,GITHUB_SHA:sourceHead,GITHUB_JOB:'mirror',GITHUB_RUN_ID:'1',GITHUB_RUN_ATTEMPT:'1'};
 let eventSourceGuardVerified=false;
 if(sha(historicalHead)&&modules[0].localBlob===nonadmissionGuardBlob
   &&workflowAdmission.MAILBOX_WORKFLOW_EVENT_SOURCE_POLICY_VERSION===1
   &&typeof workflowAdmission.evaluateMailboxWorkflowEventSource==='function'){
  const evaluate=patch=>workflowAdmission.evaluateMailboxWorkflowEventSource({mode:'receipt',sourceHead,env:{...env,...patch}});
  const current=evaluate({}),old=evaluate({GITHUB_SHA:historicalHead,GITHUB_WORKFLOW_SHA:historicalHead});
  const missing=evaluate({GITHUB_SHA:undefined});
  eventSourceGuardVerified=current.admitted===true&&current.reason==='MAILBOX_WORKFLOW_EVENT_SOURCE_ADMITTED'
   &&old.admitted===false&&old.reason==='MAILBOX_WORKFLOW_EVENT_SOURCE_STALE'
   &&missing.admitted===false&&missing.reason==='MAILBOX_WORKFLOW_EVENT_CONTEXT_INVALID';
 }
 return {policyVersion:workflowAdmission.MAILBOX_WORKFLOW_EVENT_SOURCE_POLICY_VERSION,eventSourceGuardVerified,modules};
}
function collectMailboxWorkflowNonadmissionSource(read,mainHead,activationHead){
 const local=localMailboxWorkflowNonadmission();
 if(local.policyVersion!==1||local.eventSourceGuardVerified!==true)
  throw Error('MAILBOX_ACTION_NONADMISSION_LOCAL_GUARD_UNPROVEN');
 const modules=local.modules.map(module=>{
  const main=read('contents/'+module.path+'?ref='+mainHead);
  const activation=mainHead===activationHead?main:read('contents/'+module.path+'?ref='+activationHead);
  for(const source of [main,activation]){
   if(source?.path!==module.path||source?.type!=='file'||source?.sha!==module.localBlob
    ||!Number.isSafeInteger(source.size)||source.size<=0||source.size>128*1024)
    throw Error('MAILBOX_ACTION_NONADMISSION_SOURCE_UNPROVEN');
  }
  return {...module,mainBlob:main.sha,activationBlob:activation.sha};
 });
 const historicalModules=historicalGuardModules.map(module=>{
  const ref=module.ref,source=read('contents/'+module.path+'?ref='+ref);
  if(source?.path!==module.path||source?.type!=='file'||source?.sha!==module.sha
   ||!Number.isSafeInteger(source.size)||source.size<=0||source.size>128*1024)
   throw Error('MAILBOX_ACTION_NONADMISSION_SOURCE_UNPROVEN');
  return {path:module.path,ref,sha:source.sha};
 });
 return {mainHead,activationHead,policyVersion:1,eventSourceGuardVerified:true,modules,historicalModules};
}

// Fixed public GET evidence only. The production caller supplies its existing
// authenticated GitHub reader; no caller controls endpoints or proof results.
// Fixed, non-secret stage codes make native pagination failures diagnosable.
// Each failure still rejects the entire snapshot; never infer missing runs.
function incompleteMailboxActionPage(status,reason){
 if(!['queued','in_progress','waiting','requested','pending'].includes(status)
   ||!['READ','RESPONSE','TOTAL_DRIFT','PAGE_LENGTH','PAGE_LIMIT'].includes(reason))
  throw Error('MAILBOX_ROTATION_ACTIONS_INVENTORY_INCOMPLETE');
 throw Error(`MAILBOX_ROTATION_ACTIONS_INVENTORY_INCOMPLETE_${status.toUpperCase()}_${reason}`);
}
function readMailboxActionRuns(read,status){
 const runs=[],seen=new Set();let total,effectivePageSize;
 for(let page=1;page<=MAILBOX_ROTATION_ACTIONS_MAX_PAGES;page++){
  let response;
  try{
   response=read(`actions/runs?status=${status}&per_page=${MAILBOX_ROTATION_ACTIONS_PAGE_SIZE}${page===1?'':`&page=${page}`}`);
  }catch(error){
   // Our own freshness/clock guards are stronger than provider-read errors.
   // Keep their exact typed blockers; redact only raw provider exceptions.
   // The owner's bounded transcript adapter throws a private per-read probe;
   // its WeakMap identity check must see the ORIGINAL exception to continue.
   // Re-throwing it grants no execution or evidence: an unregistered exception
   // is still denied by the owner reader's identity guard.
   if(error?.message==='next fixed read'
     ||error?.message==='MAILBOX_ACTION_COLLECTION_STALE'
     ||error?.message==='MAILBOX_ACTION_COLLECTION_CLOCK_INVALID')throw error;
   incompleteMailboxActionPage(status,'READ');
  }
  if(!response||!Number.isSafeInteger(response.total_count)||response.total_count<0
    ||response.total_count>MAILBOX_ROTATION_ACTIONS_PAGE_SIZE*MAILBOX_ROTATION_ACTIONS_MAX_PAGES
    ||!Array.isArray(response.workflow_runs))
   incompleteMailboxActionPage(status,'RESPONSE');
  if(total!==undefined&&response.total_count!==total)
   incompleteMailboxActionPage(status,'TOTAL_DRIFT');
  total=response.total_count;
  // Some authenticated API transports return a smaller effective page size
  // than requested. A short first page is not proof of completion: retain the
  // provider's total, require every subsequent full page to match its size,
  // and deny the snapshot if all records cannot fit within the fixed bound.
  if(page===1){
   effectivePageSize=response.workflow_runs.length;
   if((total>0&&effectivePageSize===0)||effectivePageSize>MAILBOX_ROTATION_ACTIONS_PAGE_SIZE)
    incompleteMailboxActionPage(status,'PAGE_LENGTH');
   if(total>effectivePageSize*MAILBOX_ROTATION_ACTIONS_MAX_PAGES)
    incompleteMailboxActionPage(status,'PAGE_LIMIT');
  }
  if(response.workflow_runs.length!==Math.min(effectivePageSize,total-runs.length))
   incompleteMailboxActionPage(status,'PAGE_LENGTH');
  for(const run of response.workflow_runs){
   if(!Number.isSafeInteger(run?.id)||run.id<=0||seen.has(run.id))throw Error('MAILBOX_ROTATION_ACTIONS_INVENTORY_INVALID');
   seen.add(run.id);runs.push(run);
  }
  if(runs.length===total)return{total_count:total,workflow_runs:runs};
 }
 incompleteMailboxActionPage(status,'PAGE_LIMIT');
}

export function inventoryMailboxRotationExecution({read,activationHead,now=()=>new Date().toISOString(),local=localMailboxPublicationRevocations,collectProofs}={}){
 if(typeof read!=='function'||typeof now!=='function'||!sha(activationHead))throw Error('MAILBOX_ACTION_EVIDENCE_CONTEXT_INVALID');
 if(collectProofs!==undefined&&typeof collectProofs!=='function')throw Error('MAILBOX_ACTION_EVIDENCE_CONTEXT_INVALID');
 // Inventory age begins before the first authenticated read, including main
 // and source qualification. Completing later proof reads never refreshes it.
 const collectionStartedAt=now(),collectionStart=Date.parse(collectionStartedAt);
 if(typeof collectionStartedAt!=='string'||!Number.isFinite(collectionStart))throw Error('MAILBOX_ACTION_COLLECTION_CLOCK_INVALID');
 let lastCollectionClock=collectionStart;
 const collectionNow=()=>{
  const stamp=now(),clock=Date.parse(stamp);
  if(typeof stamp!=='string'||!Number.isFinite(clock)||clock<lastCollectionClock)throw Error('MAILBOX_ACTION_COLLECTION_CLOCK_INVALID');
  if(clock-collectionStart>120000)throw Error('MAILBOX_ACTION_COLLECTION_STALE');
  lastCollectionClock=clock;return stamp;
 };
 const readSource=read;
 read=path=>{collectionNow();const value=readSource(path);collectionNow();return value;};
 const main=(read('commits/main'))?.sha;
 if(!sha(main))throw Error('MAILBOX_ACTION_MAIN_UNPROVEN');
 const responses=[];
 for(const status of ['queued','in_progress','waiting','requested','pending'])responses.push(readMailboxActionRuns(read,status));
 const inventory=evaluateMailboxRotationActionInventory(responses,collectionStartedAt);
 const raw=responses.flatMap(r=>r.workflow_runs),proofs=[];
 const locals=local();let source=null;
 if(!Array.isArray(locals)||locals.length!==modules.length||modules.some(m=>locals.filter(x=>x.path===m.path&&x.legacyBuilder===m.legacyBuilder&&sha(x.localBlob)).length!==1))
  throw Error('MAILBOX_ACTION_LOCAL_REVOCATION_CONTEXT_INVALID');
 if(inventory.pendingRuns.some(p=>raw.some(r=>r.id===p.id&&r.status==='queued'&&legacyPublicationContract(r)))){
  const bound=[];
  for(const m of locals){
   const a=read(`contents/${m.path}?ref=${main}`),b=main===activationHead?a:read(`contents/${m.path}?ref=${activationHead}`);
   if(a?.path!==m.path||b?.path!==m.path||!sha(a?.sha)||!sha(b?.sha)
     ||a.type!=='file'||b.type!=='file'||!Number.isSafeInteger(a.size)||!Number.isSafeInteger(b.size)
     ||a.size<=0||b.size<=0||a.size>128*1024||b.size>128*1024)throw Error('MAILBOX_ACTION_REVOCATION_SOURCE_UNPROVEN');
   bound.push({...m,mainBlob:a.sha,activationBlob:b.sha});
  }
  source={mainHead:main,activationHead,modules:bound};
 }
 if(inventory.pendingRuns.some(p=>raw.some(r=>r.id===p.id&&actionEvidence.historicalSourceNonadmissionContract?.(r)))){
  const nonadmission=collectMailboxWorkflowNonadmissionSource(read,main,activationHead);
  source={...(source||{mainHead:main,activationHead,modules:[]}),nonadmission};
 }
 const workflows=new Map();
 if(collectProofs){
  const targets=[];
  for(const pending of inventory.pendingRuns){
   const listed=raw.find(r=>r.id===pending.id),contract=contractForRun(listed);
   if(!contract)continue;
   const key=contract.head+':'+contract.path;
   if(!workflows.has(key)){
    const workflow=read('contents/'+contract.path+'?ref='+contract.head);
    workflows.set(key,{path:workflow?.path,ref:contract.head,sha:workflow?.sha});
   }
   targets.push({run:runIdentity(listed),workflow:workflows.get(key)});
  }
  if(targets.length){
   const spec={schemaVersion:MAILBOX_ACTION_PROOF_BATCH_SCHEMA,repository:batchRepository,targets};
   validateMailboxActionProofBatchSpec(spec);
   const collected=collectProofs(spec);
   collectionNow();
   if(!Array.isArray(collected)||collected.length!==targets.length)throw batchError('MAILBOX_ACTION_BATCH_RESULT_INVALID');
   proofs.push(...collected);
  }
 }
 for(const pending of collectProofs?[]:inventory.pendingRuns){
  const listed=raw.find(r=>r.id===pending.id),c=contractForRun(listed);
  if(!c)continue; // Unknown/execution-capable records remain in blockingRuns.
  const startedAt=collectionNow();
  const before=read(`actions/runs/${pending.id}`);
  if(actionEvidence.historicalSourceNonadmissionContract?.(listed)&&!sameRunIdentity(before,listed))continue;
  if(before?.id!==pending.id||!Number.isSafeInteger(before.run_attempt)||before.run_attempt<=0
    ||before.run_attempt!==listed.run_attempt||before.head_sha!==listed.head_sha||before.status!==listed.status
    ||before.path!==c.path||before.event!=='issue_comment')continue;
  const key=c.head+':'+c.path;
  if(!workflows.has(key)){
   const w=read(`contents/${c.path}?ref=${c.head}`);
   workflows.set(key,{path:w?.path,ref:c.head,sha:w?.sha});
  }
  const jobs=read(`actions/runs/${pending.id}/attempts/${before.run_attempt}/jobs?per_page=100`);
  const jobsObservedAt=collectionNow();
  const after=read(`actions/runs/${pending.id}`);
  proofs.push({run:before,runAfter:after,workflow:workflows.get(key),attempt:before.run_attempt,jobs,startedAt,jobsObservedAt,observedAt:collectionNow()});
 }
 if((read('commits/main'))?.sha!==main)throw Error('MAILBOX_ACTION_MAIN_MOVED');
 return withMailboxActionEvidence(inventory,{proofs,source,
  collection:{startedAt:collectionStartedAt,completedAt:collectionNow()}});
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 try{
  if(process.argv.length!==3||process.argv[2]!==batchArgument)throw batchError('MAILBOX_ACTION_BATCH_SPEC_INVALID');
  const chunks=[];let bytes=0;
  for await(const chunk of process.stdin){
   bytes+=chunk.length;
   if(bytes>batchSpecMaxBytes)throw batchError('MAILBOX_ACTION_BATCH_TOO_LARGE');
   chunks.push(chunk);
  }
  let spec;
  try{spec=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw batchError('MAILBOX_ACTION_BATCH_SPEC_INVALID');}
   const proofs=await collectMailboxActionProofsBounded(spec,{budgetMs:70000});
  process.stdout.write(JSON.stringify({schemaVersion:MAILBOX_ACTION_PROOF_BATCH_SCHEMA,ok:true,proofs})+'\n');
 }catch(error){
  const blocker=batchBlockers.has(error?.message)?error.message:'MAILBOX_ACTION_BATCH_CHILD_FAILED';
  process.stdout.write(JSON.stringify({schemaVersion:MAILBOX_ACTION_PROOF_BATCH_SCHEMA,ok:false,blocker})+'\n');
  process.exitCode=1;
 }
}
