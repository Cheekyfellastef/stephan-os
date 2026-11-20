import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inventoryMailboxRotationExecution,localMailboxPublicationRevocations} from './canonical-mailbox-action-evidence-v2.mjs';
import {LEGACY_PUBLICATION_CONTRACTS as contracts,mailboxActionsExecutionQuiescent} from '../shared/agents/canonicalMailboxRotationActionEvidenceV1.mjs';
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
