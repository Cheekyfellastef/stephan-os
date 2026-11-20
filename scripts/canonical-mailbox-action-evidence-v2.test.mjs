import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inventoryMailboxRotationExecution,localMailboxPublicationRevocations,localMailboxWorkflowNonadmission,
 collectMailboxActionProofsBounded,collectMailboxActionProofsNative,validateMailboxActionProofBatchSpec,
 MAILBOX_ACTION_PROOF_BATCH_SCHEMA,MAILBOX_ACTION_PROOF_BATCH_MAX_TARGETS,
 MAILBOX_ACTION_PROOF_BATCH_MAX_MS,MAILBOX_ACTION_PROOF_READ_MAX_MS,
 MAILBOX_ACTION_PROOF_BATCH_CONCURRENCY} from './canonical-mailbox-action-evidence-v2.mjs';
import {LEGACY_PUBLICATION_CONTRACTS as contracts,mailboxActionsExecutionQuiescent,
 HISTORICAL_SOURCE_NONADMISSION_CONTRACTS as historicalContracts,HISTORICAL_SOURCE_NONADMISSION_MODULES,
 HISTORICAL_SOURCE_NONADMISSION_STATIC_MODULES,HISTORICAL_SOURCE_NONADMISSION_GUARD_BLOB,
 historicalSourceNonadmissionContract} from '../shared/agents/canonicalMailboxRotationActionEvidenceV1.mjs';
import * as mirror from '../shared/agents/mailboxReceiptIndexGitHubMirror.mjs';
import * as reset from '../shared/agents/codexBankedResetTelemetryMirror.mjs';
import {classifyPostSyncRefresh} from '../shared/agents/postSyncRuntimeRefreshCoordinator.mjs';

const main='a'.repeat(40),target='b'.repeat(40),now='2026-10-26T20:00:00.000Z';
function fixture(){
 const c=contracts[0],run={id:91,path:c.path,head_sha:c.head,status:'queued',run_attempt:1,workflow_id:315398307,event:'issue_comment',head_branch:'main',repository:{full_name:'Cheekyfellastef/stephan-os'},head_repository:{full_name:'Cheekyfellastef/stephan-os'}};
 const local=localMailboxPublicationRevocations(),reads=[];
 const api=path=>{
  reads.push(path);
  if(path==='commits/main')return{sha:main};
  if(path.startsWith('actions/runs?status='))return path.includes('status=queued&')?{total_count:1,workflow_runs:[structuredClone(run)]}:{total_count:0,workflow_runs:[]};
  if(path==='actions/runs/91')return structuredClone(run);
  if(path==='actions/runs/91/attempts/1/jobs?per_page=100')return{total_count:0,jobs:[]};
  if(path===`contents/${c.path}?ref=${c.head}`)return{path:c.path,sha:c.blob,type:'file',size:5500};
  for(const m of local)if(path===`contents/${m.path}?ref=${main}`||path===`contents/${m.path}?ref=${target}`)return{path:m.path,sha:m.localBlob,type:'file',size:10000};
  throw Error('Unexpected evidence endpoint:'+path);
 };
 return{run,api,local,reads,collect:read=>inventoryMailboxRotationExecution({read:read||api,activationHead:target,now:()=>now})};
}

function pagedFixture(total,{protectedIndexes=[]}={}){
 const original=fixture(),reads=[];
 const runs=Array.from({length:total},(_,i)=>({id:10000+i,status:'queued',run_attempt:1,
  path:protectedIndexes.includes(i)?'.github/workflows/operator-merge-approval-gate.yml':'.github/workflows/unrelated-proof.yml',
  event:'workflow_dispatch',head_sha:'c'.repeat(40)}));
 const api=path=>{
  reads.push(path);
  const match=path.match(/^actions\/runs\?status=(queued|in_progress|waiting|requested|pending)&per_page=100(?:&page=([1-9][0-9]*))?$/);
  if(match){
   const page=Number(match[2]||1);
   return match[1]==='queued'?{total_count:total,workflow_runs:structuredClone(runs.slice((page-1)*100,page*100))}
    :{total_count:0,workflow_runs:[]};
  }
  return original.api(path);
 };
 return{runs,reads,api,collect:read=>inventoryMailboxRotationExecution({read:read||api,activationHead:target,now:()=>now})};
}

test('all 300 queued runs are read and protected runs on later pages remain blocking',()=>{
 const f=pagedFixture(300,{protectedIndexes:[149,299]}),r=f.collect();
 assert.deepEqual(f.reads.filter(p=>p.startsWith('actions/runs?status=queued')),[
  'actions/runs?status=queued&per_page=100','actions/runs?status=queued&per_page=100&page=2',
  'actions/runs?status=queued&per_page=100&page=3']);
 assert.deepEqual(r.pendingRuns.map(p=>p.id),[10149,10299]);
 assert.deepEqual(r.blockingRuns.map(p=>p.id),[10149,10299]);
 assert.equal(mailboxActionsExecutionQuiescent(r),false);
 assert.equal(f.reads.filter(p=>p==='commits/main').length,2);
});

test('empty and single-page inventories retain their existing complete behavior',()=>{
 for(const total of [0,1,99,100]){
  const f=pagedFixture(total),r=f.collect();
  assert.equal(r.complete,true);assert.equal(mailboxActionsExecutionQuiescent(r),true);
  assert.equal(f.reads.filter(p=>p.startsWith('actions/runs?')).length,5);
  assert.equal(f.reads.some(p=>p.includes('&page=')),false);
 }
});

test('the exact 1000-run bound is complete and a larger inventory stays held',()=>{
 const f=pagedFixture(1000,{protectedIndexes:[999]}),r=f.collect();
 assert.equal(f.reads.filter(p=>p.startsWith('actions/runs?status=queued')).length,10);
 assert.deepEqual(r.blockingRuns.map(p=>p.id),[10999]);
 const g=pagedFixture(1001);
 assert.throws(()=>g.collect(),/MAILBOX_ROTATION_ACTIONS_INVENTORY_INCOMPLETE/);
 assert.equal(g.reads.filter(p=>p.startsWith('actions/runs?')).length,1);
});

test('short, empty or overfull later pages cannot certify a complete inventory',()=>{
 for(const length of [0,99,101]){
  const f=pagedFixture(300);
  assert.throws(()=>f.collect(path=>{
   const response=f.api(path);
   if(path.endsWith('&page=2'))response.workflow_runs=Array.from({length},(_,i)=>({...f.runs[100+i%100],id:20000+i}));
   return response;
  }),/MAILBOX_ROTATION_ACTIONS_INVENTORY_INCOMPLETE/);
 }
 const g=pagedFixture(201);
 assert.throws(()=>g.collect(path=>{
  const response=g.api(path);if(path.endsWith('&page=3'))response.workflow_runs=[];return response;
 }),/MAILBOX_ROTATION_ACTIONS_INVENTORY_INCOMPLETE/);
});

test('changed totals between pages stay held instead of accepting a mixed snapshot',()=>{
 for(const total of [299,301]){
  const f=pagedFixture(300);
  assert.throws(()=>f.collect(path=>{
   const response=f.api(path);if(path.endsWith('&page=2'))response.total_count=total;return response;
  }),/MAILBOX_ROTATION_ACTIONS_INVENTORY_INCOMPLETE/);
 }
});

test('malformed page counts and payloads fail closed before source qualification',()=>{
 for(const malformed of [null,{total_count:-1,workflow_runs:[]},{total_count:'300',workflow_runs:[]},
  {total_count:1.5,workflow_runs:[]},{total_count:300,workflow_runs:null}]){
  const f=pagedFixture(300);
  assert.throws(()=>f.collect(path=>path.endsWith('&page=2')?malformed:f.api(path)),/MAILBOX_ROTATION_ACTIONS_INVENTORY_INCOMPLETE/);
 }
});

test('duplicate identities within and across pages stay held even for unrelated workflows',()=>{
 for(const page of [1,2]){
  const f=pagedFixture(300);
  assert.throws(()=>f.collect(path=>{
   const response=f.api(path);
   if(path===`actions/runs?status=queued&per_page=100${page===1?'':'&page=2'}`)
    response.workflow_runs[99]={...f.runs[0]};
   return response;
  }),/MAILBOX_ROTATION_ACTIONS_INVENTORY_INVALID/);
 }
});

test('a run moving between status inventories retains the original conservative pending entry',()=>{
 const f=pagedFixture(1,{protectedIndexes:[0]});
 const r=f.collect(path=>path==='actions/runs?status=in_progress&per_page=100'
  ?{total_count:1,workflow_runs:[{...f.runs[0],status:'in_progress'}]}:f.api(path));
 assert.deepEqual(r.pendingRuns,[{id:10000,workflow:'operator-merge-approval-gate.yml',status:'queued'}]);
 assert.deepEqual(r.blockingRuns,r.pendingRuns);assert.equal(mailboxActionsExecutionQuiescent(r),false);
});

test('malformed later-page run identities, paths and statuses stay held',()=>{
 for(const mutate of [r=>r.id=0,r=>r.id='10299',r=>r.path=null,r=>r.status='unrecognized']){
  const f=pagedFixture(300);
  assert.throws(()=>f.collect(path=>{
   const response=f.api(path);if(path.endsWith('&page=3'))mutate(response.workflow_runs[99]);return response;
  }),/MAILBOX_ROTATION_ACTIONS_INVENTORY_INVALID/);
 }
});

test('a later-page read failure propagates without yielding a partial quiet result',()=>{
 const f=pagedFixture(300);
 assert.throws(()=>f.collect(path=>{if(path.endsWith('&page=2'))throw Error('READ_UNAVAILABLE');return f.api(path);}),/READ_UNAVAILABLE/);
});

test('V1 publication names have no aliases and current V2 publishers remain callable',()=>{
 assert.equal(mirror.MAILBOX_RECEIPT_PUBLICATION_API_VERSION,2);assert.equal('buildTrustedMailboxReceiptIndexGitHubBody' in mirror,false);
 assert.equal(typeof mirror.buildTrustedMailboxReceiptIndexGitHubBodyV2,'function');
 assert.equal(reset.CODEX_BANKED_RESET_PUBLICATION_API_VERSION,2);assert.equal('buildCodexBankedResetTelemetryIssueBody' in reset,false);
 assert.equal(typeof reset.buildCodexBankedResetTelemetryIssueBodyV2,'function');
 assert.ok(localMailboxPublicationRevocations().every(m=>m.apiVersion===2&&m.legacyAbsent&&m.replacementPresent));
});
test('collector binds fresh zero-job evidence to both source epochs and rechecks main',()=>{
 const f=fixture(),r=f.collect();assert.equal(mailboxActionsExecutionQuiescent(r),true);assert.equal(r.pendingRuns[0].status,'queued');
 assert.equal(f.reads.filter(p=>p==='commits/main').length,2);assert.equal(f.reads.filter(p=>p==='actions/runs/91').length,2);
 assert.ok(f.reads.includes('actions/runs/91/attempts/1/jobs?per_page=100'));
});
test('source movement and partial inventory cannot produce a quiet snapshot',()=>{
 let f=fixture(),n=0;assert.throws(()=>f.collect(p=>p==='commits/main'?{sha:++n===1?main:target}:f.api(p)),/MAIN_MOVED/);
 f=fixture();assert.throws(()=>f.collect(p=>p.startsWith('actions/runs?')?{total_count:101,workflow_runs:[]}:f.api(p)),/INCOMPLETE/);
 f=fixture();assert.throws(()=>f.collect(p=>p.startsWith('contents/')?{path:'wrong',sha:'f'.repeat(40)}:f.api(p)),/SOURCE_UNPROVEN/);
});
test('legacy reintroduction, source drift and activation mismatch stay held',()=>{
 for(const mutate of [m=>m.legacyAbsent=false,m=>m.apiVersion=1,m=>m.replacementPresent=false]){
  const f=fixture();const local=()=>f.local.map((m,i)=>{const x={...m};if(i===0)mutate(x);return x;});
  const r=inventoryMailboxRotationExecution({read:f.api,activationHead:target,now:()=>now,local});assert.equal(mailboxActionsExecutionQuiescent(r),false);
 }
 const f=fixture();const r=f.collect(p=>p===`contents/${f.local[0].path}?ref=${target}`?{path:f.local[0].path,sha:'f'.repeat(40),type:'file',size:10000}:f.api(p));
 assert.equal(mailboxActionsExecutionQuiescent(r),false);
});
test('an attempt change or newly created job invalidates the collected proof',()=>{
 const f=fixture();let n=0;const r=f.collect(p=>p==='actions/runs/91'&&++n===2?{...f.run,run_attempt:2}:f.api(p));assert.equal(mailboxActionsExecutionQuiescent(r),false);
 const g=fixture();const s=g.collect(p=>p.endsWith('/jobs?per_page=100')?{total_count:1,jobs:[{id:7,name:'mirror',status:'in_progress'}]}:g.api(p));
 assert.equal(mailboxActionsExecutionQuiescent(s),false);
});
test('invalid local paths and attempt identity never become arbitrary evidence requests',()=>{
 const f=fixture();assert.throws(()=>inventoryMailboxRotationExecution({read:f.api,activationHead:target,local:()=>[{path:'../secrets',localBlob:'c'.repeat(40)}]}),/CONTEXT_INVALID/);
 const g=fixture();const r=g.collect(p=>p==='actions/runs/91'?{...g.run,run_attempt:'../../other'}:g.api(p));
 assert.equal(mailboxActionsExecutionQuiescent(r),false);assert.equal(g.reads.some(p=>p.includes('attempts/../../')),false);
});

test('only the exact native evidence adapters naturally reload and formatters need no runtime restart',()=>{
 const native=['scripts/canonical-mailbox-action-evidence-v2.mjs','shared/agents/canonicalMailboxRotationActionEvidenceV1.mjs',
  'shared/agents/canonicalMailboxRotationV1.mjs','shared/agents/canonicalMailboxRotationFenceV1.mjs'];
 const plan=classifyPostSyncRefresh(native);assert.equal(plan.automaticExecutionAllowed,true);assert.deepEqual(plan.targetIds,['natural-reload']);
 for(const path of native){const sibling=classifyPostSyncRefresh([path.replace('.mjs','-unknown.mjs')]);assert.equal(sibling.targetIds.includes('natural-reload'),false);if(path.startsWith('scripts/'))assert.equal(sibling.automaticExecutionAllowed,false);}
 for(const path of ['shared/agents/mailboxReceiptIndexGitHubMirror.mjs','shared/agents/codexBankedResetTelemetryMirror.mjs']){
  const r=classifyPostSyncRefresh([path]);assert.equal(r.automaticExecutionAllowed,true);assert.equal(r.noRuntimePathCount,1);
 }
});

for(const [i,name] of ['a33-mailbox-receipt-index.yml','a33-codex-banked-reset-telemetry.yml','b84-mailbox-receipt-index.yml'].entries())
test('actual historical script '+name+' fails before any GitHub write against future main',()=>{
 const yaml=readFileSync(new URL('../tests/fixtures/canonical-mailbox-rotation/'+name,import.meta.url),'utf8');
 const marker='          script: |\n',start=yaml.indexOf(marker);assert.ok(start>=0);
 const lines=[];for(const line of yaml.slice(start+marker.length).split('\n')){if(line.trim()&&!line.startsWith('            '))break;lines.push(line.slice(12));}
 const body=lines.join('\n');assert.ok(body.includes(contracts[i].legacyBuilder));
 const harness=`import assert from 'node:assert/strict';\nlet writes=0;\nconst mutation=()=>{writes++;throw Error('UNEXPECTED_GITHUB_MUTATION');};\nconst truth='<!-- stephanos-battle-bridge-receipt-index-truth -->\\n'+String.fromCharCode(96).repeat(3)+'json\\n'+JSON.stringify({schemaVersion:'stephanos.mailbox-receipt-index.v1',recentReceipts:[]})+'\\n'+String.fromCharCode(96).repeat(3);\nconst github={paginate:async()=>[],rest:{issues:{listComments:()=>{},get:async()=>({data:{body:truth}}),update:mutation,createComment:mutation,updateComment:mutation}}};\nconst context={repo:{owner:'Cheekyfellastef',repo:'stephan-os'},runId:1};\nconst core={info:()=>{},setFailed:()=>{}};\nconst AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;\nlet failure='';try{await new AsyncFunction('github','context','core',${JSON.stringify(body)})(github,context,core);}catch(e){failure=String(e.message);}\nassert.equal(writes,0);assert.ok(failure.includes(${JSON.stringify(contracts[i].legacyBuilder)}),failure);console.log(JSON.stringify({writes,legacyEntrypointFailure:true}));`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',harness],{cwd:fileURLToPath(new URL('..',import.meta.url)),shell:false,windowsHide:true,encoding:'utf8',timeout:15000,maxBuffer:1024*1024,
  env:{...process.env,GITHUB_WORKSPACE:fileURLToPath(new URL('..',import.meta.url))}});
 assert.equal(child.status,0,child.stderr||child.stdout);assert.deepEqual(JSON.parse(child.stdout),{writes:0,legacyEntrypointFailure:true});
});

function boundedHistoricalFixture(){
 const runs=historicalContracts.flatMap(c=>c.runIds.map(id=>({id,run_attempt:1,head_sha:c.head,path:c.path,
  status:'queued',event:'issue_comment',head_branch:'main',workflow_id:c.workflowId,
  repository:{full_name:'Cheekyfellastef/stephan-os'},head_repository:{full_name:'Cheekyfellastef/stephan-os'},
  created_at:'2026-11-04T00:00:00.000Z',updated_at:'2026-11-04T00:00:00.000Z',conclusion:null})));
 const local=localMailboxWorkflowNonadmission(),reads=[],stamp='2026-11-20T22:00:00.000Z';
 const spec={schemaVersion:MAILBOX_ACTION_PROOF_BATCH_SCHEMA,repository:'Cheekyfellastef/stephan-os',
  targets:runs.map(run=>{const c=historicalSourceNonadmissionContract(run);return {run:structuredClone(run),
   workflow:{path:c.path,ref:c.head,sha:c.blob}};})};
 const api=path=>{
  reads.push(path);
  if(path==='commits/main')return{sha:main};
  const inventory=path.match(/^actions\/runs\?status=(queued|in_progress|waiting|requested|pending)&per_page=100(?:&page=([1-9][0-9]*))?$/);
  if(inventory){const page=Number(inventory[2]||1);return inventory[1]==='queued'
   ?{total_count:runs.length,workflow_runs:structuredClone(runs.slice((page-1)*100,page*100))}
   :{total_count:0,workflow_runs:[]};}
  const runMatch=path.match(/^actions\/runs\/([1-9][0-9]*)(\/attempts\/1\/jobs\?per_page=100)?$/);
  if(runMatch){const run=runs.find(r=>r.id===Number(runMatch[1]));assert.ok(run,'only a fixed cohort run is read');
   return runMatch[2]?{total_count:0,jobs:[]}:structuredClone(run);}
  for(const c of historicalContracts)if(path==='contents/'+c.path+'?ref='+c.head)return{path:c.path,sha:c.blob,type:'file',size:10000};
  for(const m of HISTORICAL_SOURCE_NONADMISSION_STATIC_MODULES)if(path==='contents/'+m.path+'?ref='+m.ref)
   return{path:m.path,sha:m.sha,type:'file',size:10000};
  for(const m of local.modules)if(path==='contents/'+m.path+'?ref='+main||path==='contents/'+m.path+'?ref='+target)
   return{path:m.path,sha:m.localBlob,type:'file',size:10000};
  throw Error('Unexpected bounded fixture endpoint: '+path);
 };
 return{runs,spec,local,api,reads,stamp};
}

test('all 162 fixed runs use eight concurrent independent before/jobs/after chains and retain queued facts',async()=>{
 const f=boundedHistoricalFixture();let active=0,maximum=0;
 const stages=new Map(),stamps=[];
 const proofs=await collectMailboxActionProofsBounded(f.spec,{
  now:()=>{const value=new Date(Date.parse(f.stamp)+stamps.length).toISOString();stamps.push(value);return value;},
  read:async(path,{signal,timeoutMs})=>{
   assert.ok(timeoutMs>0&&timeoutMs<=15000);assert.equal(signal.aborted,false);
   active++;maximum=Math.max(maximum,active);
   const match=path.match(/^actions\/runs\/([1-9][0-9]*)(\/attempts\/1\/jobs\?per_page=100)?$/);
   assert.ok(match,'no new endpoint family');const id=Number(match[1]),stage=stages.get(id)||0;
   assert.equal(Boolean(match[2]),stage===1,'each attempt must be bracketed by its own run reads');
   stages.set(id,stage+1);
   await new Promise(resolve=>setTimeout(resolve,2));
   active--;return f.api(path);
  },
 });
 assert.equal(proofs.length,162);assert.equal(maximum,8);assert.equal(MAILBOX_ACTION_PROOF_BATCH_CONCURRENCY,8);
 assert.equal(f.reads.length,486);assert.ok([...stages.values()].every(n=>n===3));
 assert.ok(proofs.every(p=>p.run.status==='queued'&&p.runAfter.status==='queued'&&p.jobs.total_count===0
  &&Date.parse(p.startedAt)<=Date.parse(p.jobsObservedAt)&&Date.parse(p.jobsObservedAt)<=Date.parse(p.observedAt)));
 let collectionClock=f.stamp;
 const collected=inventoryMailboxRotationExecution({read:f.api,activationHead:target,now:()=>collectionClock,
  collectProofs:spec=>{assert.deepEqual(spec,f.spec);collectionClock=stamps.at(-1);return proofs;}});
 assert.equal(collected.pendingRuns.length,162);assert.equal(collected.blockingRuns.length,0);
 assert.equal(mailboxActionsExecutionQuiescent(collected,{now:stamps.at(-1),mainHead:main,activationHead:target}),true);
 assert.ok(collected.aggregateDispositions.every(p=>p.reason==='HISTORICAL_WORKFLOW_SOURCE_NOT_ADMITTED'));
 assert.ok(collected.pendingRuns.every(p=>p.status==='queued'));
 assert.equal(mailboxActionsExecutionQuiescent(collected,{now:new Date(Date.parse(f.stamp)+120001).toISOString()}),false,
  'consumer freshness starts before the first authenticated run read');
});

test('bounded target specification rejects widened endpoints, source identity, extra arguments and overlarge input before reads',async()=>{
 const f=boundedHistoricalFixture(),one=()=>({...structuredClone(f.spec),targets:[structuredClone(f.spec.targets[0])]});
 const mutations=[
  s=>s.repository='another/repository',s=>s.url='https://example.test',
  s=>s.targets[0].run.path='../../private',s=>s.targets[0].run.id='1/attempts/2',
  s=>s.targets[0].run.head_sha='a'.repeat(40),s=>s.targets[0].run.repository.full_name='fork/repository',
  s=>s.targets[0].workflow.path='.github/workflows/unknown.yml',s=>s.targets[0].workflow.sha='a'.repeat(40),
  s=>s.targets.push(structuredClone(s.targets[0])),s=>s.targets[0].command='anything',
 ];
 for(const mutate of mutations){
  const spec=one();mutate(spec);let reads=0;
  await assert.rejects(collectMailboxActionProofsBounded(spec,{read:async()=>{reads++;return{};}}),/MAILBOX_ACTION_BATCH_SPEC_INVALID/);
  assert.equal(reads,0);
 }
 const legacyRun={...f.spec.targets[0].run,head_sha:contracts[0].head,path:contracts[0].path};
 const makeMany=count=>({schemaVersion:MAILBOX_ACTION_PROOF_BATCH_SCHEMA,repository:f.spec.repository,
  targets:Array.from({length:count},(_,i)=>({run:{...structuredClone(legacyRun),id:100000+i},
   workflow:{path:contracts[0].path,ref:contracts[0].head,sha:contracts[0].blob}}))});
 assert.equal(validateMailboxActionProofBatchSpec(makeMany(200)).targets.length,200);
 assert.throws(()=>validateMailboxActionProofBatchSpec(makeMany(201)),/SPEC_INVALID/);
 assert.equal(MAILBOX_ACTION_PROOF_BATCH_MAX_TARGETS,200);
 const huge=one();huge.extra='x'.repeat(256*1024);
 assert.throws(()=>validateMailboxActionProofBatchSpec(huge),/BATCH_TOO_LARGE/);
});

test('fresh run or attempt drift anywhere in a chain yields no batch proof',async()=>{
 const f=boundedHistoricalFixture(),spec={...f.spec,targets:[f.spec.targets[0]]};
 const changes=[r=>r.run_attempt=2,r=>r.head_sha='d'.repeat(40),r=>r.path='.github/workflows/unknown.yml',
  r=>r.id++,r=>r.workflow_id++,r=>r.status='in_progress',r=>r.event='workflow_dispatch',
  r=>r.head_branch='other',r=>r.repository.full_name='fork/repository',r=>r.head_repository.full_name='fork/repository',
  r=>r.created_at='2026-11-05T00:00:00.000Z',r=>r.updated_at='2026-11-05T00:00:00.000Z',r=>r.conclusion='success'];
 for(const mutate of changes){
  let reads=0;
  await assert.rejects(collectMailboxActionProofsBounded(spec,{now:()=>f.stamp,read:async path=>{
   const value=f.api(path);if(!path.includes('/attempts/')&&++reads===2)mutate(value);return value;
  }}),/MAILBOX_ACTION_BATCH_RUN_DRIFT/);
 }
});

test('partial jobs response or any newly picked-up historical job cannot become nonblocking',async()=>{
 const f=boundedHistoricalFixture(),spec={...f.spec,targets:[f.spec.targets[0]]};
 for(const jobs of [null,{total_count:1,jobs:[]},{total_count:101,jobs:[]},{total_count:'0',jobs:[]}]){
  await assert.rejects(collectMailboxActionProofsBounded(spec,{now:()=>f.stamp,
   read:async p=>p.includes('/attempts/')?jobs:f.api(p)}),/MAILBOX_ACTION_BATCH_JOBS_INVALID/);
 }
 const proofs=await collectMailboxActionProofsBounded(spec,{now:()=>f.stamp,read:async p=>p.includes('/attempts/')
  ?{total_count:1,jobs:[{id:1,run_id:spec.targets[0].run.id,status:'queued',head_sha:spec.targets[0].run.head_sha}]}:f.api(p)});
 const allProofs=await collectMailboxActionProofsBounded(f.spec,{now:()=>f.stamp,read:async p=>f.api(p)});
 allProofs[0]=proofs[0];
 const evidence=inventoryMailboxRotationExecution({read:f.api,activationHead:target,now:()=>f.stamp,collectProofs:()=>allProofs});
 assert.equal(evidence.pendingRuns.length,162);assert.equal(evidence.blockingRuns.length,1);
 assert.equal(mailboxActionsExecutionQuiescent(evidence),false);
});

test('batch deadline covers the whole chain and aborts pending work without timestamp repair',async()=>{
 const f=boundedHistoricalFixture(),spec={...f.spec,targets:[f.spec.targets[0]]};let elapsed=0,reads=0,timestamps=0;
 await assert.rejects(collectMailboxActionProofsBounded(spec,{
  budgetMs:10,requestTimeoutMs:15,clock:()=>elapsed,now:()=>{timestamps++;return f.stamp;},
  read:async p=>{reads++;elapsed+=4;return f.api(p);},
 }),/MAILBOX_ACTION_BATCH_DEADLINE/);
 assert.equal(reads,3);assert.equal(timestamps,2,'no post-read timestamp is minted after the deadline');
 assert.equal(MAILBOX_ACTION_PROOF_BATCH_MAX_MS,75000);assert.equal(MAILBOX_ACTION_PROOF_READ_MAX_MS,15000);
});

test('a hung GET is bounded, cancelled and never retried; raw read errors are sanitized',async()=>{
 const f=boundedHistoricalFixture();let reads=0,aborted=0;
 await assert.rejects(collectMailboxActionProofsBounded(f.spec,{
  budgetMs:1000,requestTimeoutMs:10,read:async(_,{signal})=>{
   reads++;signal.addEventListener('abort',()=>{aborted++;},{once:true});return new Promise(()=>{});
  },
 }),/MAILBOX_ACTION_BATCH_READ_TIMEOUT/);
 assert.equal(reads,8);assert.equal(aborted,8);
 await assert.rejects(collectMailboxActionProofsBounded({...f.spec,targets:[f.spec.targets[0]]},{
  read:async()=>{throw Error('SENSITIVE_TEST_SENTINEL raw native auth failure');},
 }),error=>{assert.equal(error.message,'MAILBOX_ACTION_BATCH_READ_FAILED');return true;});
});

test('native batching retains a synchronous finite same-file child and validates its complete output',async()=>{
 const f=boundedHistoricalFixture(),spec={...f.spec,targets:[f.spec.targets[0]]};
 const proofs=await collectMailboxActionProofsBounded(spec,{now:()=>f.stamp,read:async p=>f.api(p)});
 const success={schemaVersion:MAILBOX_ACTION_PROOF_BATCH_SCHEMA,ok:true,proofs};
 let called=0;
 const result=collectMailboxActionProofsNative(spec,{spawnSyncFn:(executable,args,options)=>{
  called++;assert.equal(executable,process.execPath);
  assert.deepEqual(args,[fileURLToPath(new URL('./canonical-mailbox-action-evidence-v2.mjs',import.meta.url)),
   '--mailbox-action-proof-batch-v1']);
  assert.equal(options.shell,false);assert.equal(options.windowsHide,true);assert.equal(options.timeout,75000);
  assert.deepEqual(JSON.parse(options.input),spec);
  return{status:0,stdout:JSON.stringify(success),stderr:''};
 }});
 assert.equal(called,1);assert.equal(typeof result?.then,'undefined');assert.deepEqual(result,proofs);
 for(const value of [
  {status:0,stdout:'{}',stderr:'SENSITIVE_TEST_SENTINEL'},
  {status:0,stdout:JSON.stringify({...success,proofs:[]}),stderr:''},
  {status:0,stdout:JSON.stringify({...success,proofs:[{...proofs[0],runAfter:{...proofs[0].runAfter,run_attempt:2}}]}),stderr:''},
  {status:1,stdout:JSON.stringify({ok:false,blocker:'SENSITIVE_TEST_SENTINEL'}),stderr:'SENSITIVE_TEST_SENTINEL'},
  {error:{code:'ETIMEDOUT',message:'SENSITIVE_TEST_SENTINEL'},stdout:'',stderr:'SENSITIVE_TEST_SENTINEL'},
 ]){
  assert.throws(()=>collectMailboxActionProofsNative(spec,{spawnSyncFn:()=>value}),error=>{
   assert.match(error.message,/^MAILBOX_ACTION_BATCH_/);assert.equal(error.message.includes('SENSITIVE_TEST_SENTINEL'),false);return true;
  });
 }
});

test('actual child rejects hostile input before any native authenticated endpoint or command is selected',()=>{
 const f=boundedHistoricalFixture();f.spec.targets[0].run.path='https://SENSITIVE_TEST_SENTINEL.invalid/';
 const child=spawnSync(process.execPath,[fileURLToPath(new URL('./canonical-mailbox-action-evidence-v2.mjs',import.meta.url)),
  '--mailbox-action-proof-batch-v1'],{input:JSON.stringify(f.spec),encoding:'utf8',shell:false,windowsHide:true,timeout:5000,maxBuffer:1024*1024});
 assert.equal(child.status,1);assert.equal(child.stderr,'');
 assert.deepEqual(JSON.parse(child.stdout),{schemaVersion:MAILBOX_ACTION_PROOF_BATCH_SCHEMA,ok:false,blocker:'MAILBOX_ACTION_BATCH_SPEC_INVALID'});
 assert.equal(child.stdout.includes('SENSITIVE_TEST_SENTINEL'),false);
});

test('actual loaded guard and all six source modules bind preparation and activation before historical proof collection',()=>{
 const f=boundedHistoricalFixture();
 assert.equal(f.local.policyVersion,1);assert.equal(f.local.eventSourceGuardVerified,true);
 assert.deepEqual(f.local.modules.map(m=>m.path),HISTORICAL_SOURCE_NONADMISSION_MODULES);
 assert.equal(f.local.modules[0].localBlob,HISTORICAL_SOURCE_NONADMISSION_GUARD_BLOB);
 let batchCalls=0;
 for(const changed of [...f.local.modules.map(m=>'contents/'+m.path+'?ref='+target),
  ...HISTORICAL_SOURCE_NONADMISSION_STATIC_MODULES.map(m=>'contents/'+m.path+'?ref='+m.ref)]){
  assert.throws(()=>inventoryMailboxRotationExecution({activationHead:target,now:()=>f.stamp,
   read:p=>{const value=f.api(p);return p===changed?{...value,sha:'e'.repeat(40)}:value;},
   collectProofs:()=>{batchCalls++;return[];},
  }),/MAILBOX_ACTION_NONADMISSION_SOURCE_UNPROVEN/);
 }
 assert.equal(batchCalls,0);
 assert.equal(f.reads.some(p=>p.includes('contents/shared/agents/canonicalMailboxAuthorityV1.mjs')),false,
  'the deliberately changed activation authority is not required to be byte-identical');
});

test('collector opt-in rejects async or incomplete adapters and rechecks main after the full batch',async()=>{
 const f=boundedHistoricalFixture();
 assert.throws(()=>inventoryMailboxRotationExecution({read:f.api,activationHead:target,now:()=>f.stamp,collectProofs:()=>Promise.resolve([])}),
  /MAILBOX_ACTION_BATCH_RESULT_INVALID/);
 assert.throws(()=>inventoryMailboxRotationExecution({read:f.api,activationHead:target,now:()=>f.stamp,collectProofs:()=>[]}),
  /MAILBOX_ACTION_BATCH_RESULT_INVALID/);
 const proofs=await collectMailboxActionProofsBounded(f.spec,{now:()=>f.stamp,read:async p=>f.api(p)});
 let mainReads=0;
 assert.throws(()=>inventoryMailboxRotationExecution({activationHead:target,now:()=>f.stamp,collectProofs:()=>proofs,
  read:p=>p==='commits/main'?{sha:++mainReads===1?main:target}:f.api(p),
 }),/MAILBOX_ACTION_MAIN_MOVED/);
});

test('serial historical compatibility path rejects full listed-to-before identity and lifecycle drift',()=>{
 const mutations=[r=>r.id++,r=>r.workflow_id++,r=>r.run_attempt=2,r=>r.head_sha='e'.repeat(40),
  r=>r.status='in_progress',r=>r.head_branch='other',r=>r.event='workflow_dispatch',
  r=>r.repository.full_name='fork/repository',r=>r.head_repository.full_name='fork/repository',
  r=>r.created_at='2026-11-05T00:00:00.000Z',r=>r.updated_at='2026-11-05T00:00:00.000Z',
  r=>r.conclusion='success'];
 for(const mutate of mutations){
  const f=boundedHistoricalFixture();f.runs.splice(1);let runReads=0;
  const result=inventoryMailboxRotationExecution({activationHead:target,now:()=>f.stamp,
   read:p=>{const value=f.api(p);if(/^actions\/runs\/[0-9]+$/.test(p)&&++runReads===1)mutate(value);return value;}});
  assert.equal(result.pendingRuns.length,1);assert.equal(result.blockingRuns.length,1);
  assert.equal(result.executionEvidence.proofs.length,0);assert.equal(mailboxActionsExecutionQuiescent(result),false);
  assert.equal(f.reads.some(p=>p.includes('/attempts/')),false,'drifted identity must not select a jobs endpoint');
 }
});

test('two individually bounded slow source reads cannot renew the initial complete inventory',()=>{
 for(const kind of ['legacy','historical']){
  const f=kind==='legacy'?fixture():boundedHistoricalFixture();
  if(kind==='historical')f.runs.splice(1);
  const first=Date.parse(kind==='legacy'?now:f.stamp);let clock=first,sourceReads=0,batchCalls=0;
  assert.throws(()=>inventoryMailboxRotationExecution({activationHead:target,now:()=>new Date(clock).toISOString(),
   read:path=>{const value=f.api(path);if(path.startsWith('contents/')&&sourceReads<2){sourceReads++;clock+=90001;}return value;},
   collectProofs:()=>{batchCalls++;return[];},
  }),/MAILBOX_ACTION_COLLECTION_STALE/);
  assert.equal(sourceReads,2);assert.equal(clock-first,180002);assert.equal(batchCalls,0);
  assert.equal(f.reads.some(path=>/actions\/runs\/[0-9]+/.test(path)),false);
 }
 const f=fixture(),control=f.collect();
 assert.equal(mailboxActionsExecutionQuiescent(control,{now}),true);
 assert.deepEqual(control.executionEvidence.collection,{startedAt:now,completedAt:now});
});

test('the first main read and every complete-inventory page are inside the unchanged freshness bound',()=>{
 for(const delayed of ['commits/main','actions/runs?status=queued&per_page=100','actions/runs?status=queued&per_page=100&page=2']){
  const f=pagedFixture(200);let clock=Date.parse(now);
  assert.throws(()=>inventoryMailboxRotationExecution({activationHead:target,now:()=>new Date(clock).toISOString(),
   read:path=>{const value=f.api(path);if(path===delayed)clock+=120001;return value;},
  }),/MAILBOX_ACTION_COLLECTION_STALE/);
 }
});

test('a valid collection retains its original start for later consumer expiry',()=>{
 const f=fixture(),first=Date.parse(now);let clock=first,sourceReads=0;
 const result=inventoryMailboxRotationExecution({activationHead:target,now:()=>new Date(clock).toISOString(),
  read:path=>{const value=f.api(path);if(path.startsWith('contents/')&&sourceReads++<2)clock+=45000;return value;},
 });
 assert.equal(result.observedAt,now);
 assert.deepEqual(result.executionEvidence.collection,{startedAt:now,completedAt:new Date(first+90000).toISOString()});
 assert.equal(result.executionEvidence.proofs[0].observedAt,new Date(first+90000).toISOString());
 assert.equal(result.pendingRuns[0].status,'queued');assert.equal(result.pendingRuns.length,1);
 assert.equal(mailboxActionsExecutionQuiescent(result,{now:new Date(first+120000).toISOString()}),true);
 assert.equal(mailboxActionsExecutionQuiescent(result,{now:new Date(first+120001).toISOString()}),false);
});

test('empty actual collections keep whole-inventory freshness and validate evidence before the empty fastpath',()=>{
 const f=pagedFixture(0),first=Date.parse(now);let clock=first;
 const result=inventoryMailboxRotationExecution({read:f.api,activationHead:target,now:()=>new Date(clock).toISOString()});
 assert.equal(result.pendingRuns.length,0);assert.equal(result.observedAt,now);
 assert.equal(mailboxActionsExecutionQuiescent(result,{now}),true);
 assert.equal(mailboxActionsExecutionQuiescent(result,{now:new Date(first+120001).toISOString()}),false);
 const tampered=structuredClone(result);delete tampered.executionEvidence.collection;
 assert.equal(mailboxActionsExecutionQuiescent(tampered,{now}),false);
 assert.throws(()=>inventoryMailboxRotationExecution({activationHead:target,now:()=>new Date(clock).toISOString(),
  read:path=>{const value=f.api(path);if(path.startsWith('actions/runs?status=queued'))clock+=120001;return value;},
 }),/MAILBOX_ACTION_COLLECTION_STALE/);
});

test('invalid or backward collection clocks fail before yielding refreshed evidence',()=>{
 for(const value of ['invalid',null,123]){
  const f=fixture();let reads=0;
  assert.throws(()=>inventoryMailboxRotationExecution({activationHead:target,now:()=>value,
   read:path=>{reads++;return f.api(path);}}),/MAILBOX_ACTION_COLLECTION_CLOCK_INVALID/);
  assert.equal(reads,0);
 }
 for(const invalidAfterRead of ['invalid','backward']){
  const f=fixture();let clock=Date.parse(now),invalid=false;
  assert.throws(()=>inventoryMailboxRotationExecution({activationHead:target,
   now:()=>invalid?'invalid':new Date(clock).toISOString(),
   read:path=>{const value=f.api(path);if(invalidAfterRead==='backward')clock--;else invalid=true;return value;},
  }),/MAILBOX_ACTION_COLLECTION_CLOCK_INVALID/);
 }
});
