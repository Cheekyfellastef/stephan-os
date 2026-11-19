import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {LEGACY_PUBLICATION_CONTRACTS as contracts,classifyMailboxActionEvidence,
 withMailboxActionEvidence,mailboxActionsExecutionQuiescent,mailboxActionEvidenceDigest,
 mailboxActionEvidenceSummary} from './canonicalMailboxRotationActionEvidenceV1.mjs';

const now='2026-10-26T20:00:00.000Z',repo='Cheekyfellastef/stephan-os';
const clone=structuredClone;
function fixture(which=0,id=100){
 const c=contracts[which],run={id,path:c.path,head_sha:c.head,status:'queued',run_attempt:1,workflow_id:315398307,
  event:'issue_comment',head_branch:'main',repository:{full_name:repo},head_repository:{full_name:repo}};
 const pending={id,workflow:c.path.split('/').at(-1),status:run.status};
 const proof={run,runAfter:clone(run),attempt:1,workflow:{path:c.path,ref:c.head,sha:c.blob},jobs:{total_count:0,jobs:[]},observedAt:now};
 const source={mainHead:'a'.repeat(40),activationHead:'b'.repeat(40),modules:contracts.slice(0,2).map(c=>({path:c.module,legacyBuilder:c.legacyBuilder,
  apiVersion:2,legacyAbsent:true,replacementPresent:true,localBlob:'c'.repeat(40),mainBlob:'c'.repeat(40),activationBlob:'c'.repeat(40)}))};
 const inventory={complete:true,observedAt:now,pendingRuns:[pending]};
 return{c,run,pending,proof,source,inventory,actions:()=>withMailboxActionEvidence(inventory,{proofs:[proof],source})};
}
function closed(){
 const f=fixture(2);f.run.status=f.pending.status='in_progress';f.proof.runAfter=clone(f.run);
 f.proof.jobs={total_count:2,jobs:[
  {id:11,run_id:f.run.id,head_sha:f.run.head_sha,name:'mirror',status:'completed',conclusion:'success',completed_at:'2026-10-22T13:09:31Z',steps:[{name:'Update compact receipt truth surfaces',status:'completed'},{name:'Complete job',status:'completed'}]},
  {id:12,run_id:f.run.id,head_sha:f.run.head_sha,name:'proof',status:'completed',conclusion:'skipped',completed_at:'2026-10-22T13:09:20Z',steps:null},
 ]};return f;
}

test('reviewed historical workflow fixtures have their exact immutable Git blob identities',()=>{
 for(const [i,name] of ['a33-mailbox-receipt-index.yml','a33-codex-banked-reset-telemetry.yml','b84-mailbox-receipt-index.yml'].entries()){
  const raw=readFileSync(new URL('../../tests/fixtures/canonical-mailbox-rotation/'+name,import.meta.url));
  assert.equal(createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex'),contracts[i].blob);
 }
});
test('queued lifecycle stays visible and is quiescent only after exact legacy API revocation',()=>{
 const f=fixture(),a=f.actions();assert.equal(a.pendingRuns.length,1);assert.equal(a.pendingRuns[0].status,'queued');
 assert.equal(a.blockingRuns.length,0);assert.equal(a.aggregateDispositions[0].reason,'LEGACY_PUBLICATION_ENTRYPOINT_REVOKED');
 assert.equal(mailboxActionsExecutionQuiescent(a),true);
 assert.equal(classifyMailboxActionEvidence(f.pending,f.proof,null).quiescent,false);
 assert.deepEqual(mailboxActionEvidenceSummary(a),{actionPendingAggregateCount:1,actionBlockingCount:0,actionsQuiescenceDigest:a.evidenceDigest});
});
for(const which of [0,1,2])test('legacy contract '+which+' requires revocation in both main and activation',()=>{
 for(const mutate of [s=>s.modules[which===1?1:0].mainBlob='d'.repeat(40),s=>s.modules[which===1?1:0].activationBlob='d'.repeat(40),
  s=>s.modules[which===1?1:0].legacyAbsent=false,s=>s.modules[which===1?1:0].replacementPresent=false,
  s=>s.modules[which===1?1:0].apiVersion=1,s=>s.modules=[]]){
  const f=fixture(which);mutate(f.source);assert.equal(mailboxActionsExecutionQuiescent(f.actions()),false);
 }
});
test('age, actor, workflow path and zero-job count alone confer no containment',()=>{
 const f=fixture();f.run.actor={login:'chatgpt-codex-connector[bot]'};f.run.created_at='2020-01-01T00:00:00Z';f.proof.runAfter=clone(f.run);
 const a=withMailboxActionEvidence(f.inventory,{proofs:[f.proof]});assert.equal(mailboxActionsExecutionQuiescent(a),false);
});
test('unknown workflow bytes, source, repository, event and partial metadata all remain blocking',()=>{
 const mutations=[f=>f.proof.workflow.sha='e'.repeat(40),f=>f.proof.workflow.ref='e'.repeat(40),f=>f.run.head_sha='e'.repeat(40),
  f=>f.run.repository.full_name='other/repo',f=>f.run.head_repository.full_name='other/repo',f=>f.run.event='workflow_dispatch',
  f=>f.run.head_branch='other',f=>f.proof.attempt=2,f=>f.proof.runAfter.run_attempt=2,f=>f.proof.runAfter.status='completed',
  f=>f.proof.runAfter=null,f=>f.proof.jobs.total_count=1,f=>f.proof.jobs={total_count:101,jobs:[]},f=>f.proof.observedAt='not-time'];
 for(const change of mutations){const f=fixture();change(f);assert.equal(mailboxActionsExecutionQuiescent(f.actions()),false);}
});
test('a queued run that acquires any job is not covered by the future-checkout proof',()=>{
 const f=fixture();f.proof.jobs={total_count:1,jobs:[{id:1,name:'mirror',status:'in_progress'}]};
 assert.equal(mailboxActionsExecutionQuiescent(f.actions()),false);
});
test('complete current-attempt two-job DAG proves execution closure without relabeling the aggregate',()=>{
 const f=closed(),a=f.actions();assert.equal(a.pendingRuns[0].status,'in_progress');assert.equal(a.blockingRuns.length,0);
 assert.equal(a.aggregateDispositions[0].reason,'EXACT_WORKFLOW_DAG_TERMINAL');assert.equal(mailboxActionsExecutionQuiescent(a),true);
});
test('terminal closure rejects a missing, extra, running, foreign, future or unfinished job',()=>{
 const mutations=[f=>{f.proof.jobs.jobs.pop();f.proof.jobs.total_count=1;},f=>f.proof.jobs.jobs[1].name='extra',
  f=>f.proof.jobs.jobs[1].id=11,f=>f.proof.jobs.jobs[0].status='in_progress',f=>f.proof.jobs.jobs[0].run_id=999,
  f=>f.proof.jobs.jobs[0].head_sha='f'.repeat(40),f=>f.proof.jobs.jobs[0].completed_at='2026-12-01T00:00:00Z',
  f=>f.proof.jobs.jobs[0].conclusion=null,f=>f.proof.jobs.jobs[0].steps=[],f=>f.proof.jobs.jobs[0].steps[0].status='in_progress',
  f=>f.proof.jobs.jobs[0].steps.at(-1).name='Update complete',f=>f.proof.runAfter.run_attempt=2];
 for(const change of mutations){const f=closed();change(f);assert.equal(mailboxActionsExecutionQuiescent(f.actions()),false);}
});
test('forged empty blocking list and digest cannot hide unproven or duplicate records',()=>{
 const f=fixture();let a=f.actions();a.pendingRuns.push({id:999,workflow:'operator-merge-approval-gate.yml',status:'waiting'});a.blockingRuns=[];
 a.evidenceDigest=mailboxActionEvidenceDigest({pending:a.pendingRuns,evidence:a.executionEvidence});assert.equal(mailboxActionsExecutionQuiescent(a),false);
 a=f.actions();a.executionEvidence.proofs.push(clone(f.proof));a.evidenceDigest=mailboxActionEvidenceDigest({pending:a.pendingRuns,evidence:a.executionEvidence});assert.equal(mailboxActionsExecutionQuiescent(a),false);
 a=f.actions();a.evidenceDigest='0'.repeat(64);assert.equal(mailboxActionsExecutionQuiescent(a),false);
});
test('all five contained aggregates remain five real records; one execution-capable addition holds cutover',()=>{
 const list=[fixture(0,1),fixture(1,2),fixture(0,3),fixture(1,4),closed()];
 const inventory={complete:true,observedAt:now,pendingRuns:list.map(f=>f.pending)};
 const a=withMailboxActionEvidence(inventory,{proofs:list.map(f=>f.proof),source:list[0].source});
 assert.equal(a.pendingRuns.length,5);assert.equal(a.blockingRuns.length,0);assert.equal(mailboxActionsExecutionQuiescent(a),true);
 const b=withMailboxActionEvidence({...inventory,pendingRuns:[...inventory.pendingRuns,{id:999,workflow:'operator-merge-approval-gate.yml',status:'waiting'}]},
  {proofs:list.map(f=>f.proof),source:list[0].source});
 assert.equal(b.pendingRuns.length,6);assert.equal(b.blockingRuns.length,1);assert.equal(mailboxActionsExecutionQuiescent(b),false);
 assert.equal(mailboxActionEvidenceSummary(b).actionBlockingCount,1);
});
test('incomplete inventories fail closed and existing genuinely empty complete inventories stay compatible',()=>{
 assert.equal(mailboxActionsExecutionQuiescent({complete:false,pendingRuns:[]}),false);
 assert.equal(mailboxActionsExecutionQuiescent({complete:true,pendingRuns:[]}),true);
 assert.throws(()=>withMailboxActionEvidence({complete:false,pendingRuns:[]}),/INCOMPLETE/);
});

test('old job evidence cannot be refreshed by advancing only the inventory timestamp',()=>{
 const f=fixture(),a=f.actions();a.observedAt='2026-10-26T20:10:00.000Z';
 assert.equal(mailboxActionsExecutionQuiescent(a),false);
 assert.equal(mailboxActionsExecutionQuiescent(f.actions(),{now:'2026-10-26T20:03:00.000Z'}),false);
 assert.equal(mailboxActionsExecutionQuiescent(f.actions(),{now:'2026-10-26T20:00:30.000Z'}),true);
 assert.equal(mailboxActionsExecutionQuiescent(f.actions(),{mainHead:'d'.repeat(40)}),false);
 assert.equal(mailboxActionsExecutionQuiescent(f.actions(),{activationHead:'d'.repeat(40)}),false);
 assert.equal(mailboxActionsExecutionQuiescent(f.actions(),{mainHead:f.source.mainHead,activationHead:f.source.activationHead}),true);
});
