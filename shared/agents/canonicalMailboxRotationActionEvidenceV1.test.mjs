import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {LEGACY_PUBLICATION_CONTRACTS as contracts,classifyMailboxActionEvidence,
 HISTORICAL_SOURCE_NONADMISSION_CONTRACTS as historicalContracts,
 HISTORICAL_SOURCE_NONADMISSION_HEAD,HISTORICAL_SOURCE_NONADMISSION_GUARD_BLOB,
 HISTORICAL_SOURCE_NONADMISSION_MODULES,HISTORICAL_SOURCE_NONADMISSION_STATIC_MODULES,
 historicalSourceNonadmissionContract,
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

const historicalNow='2026-11-20T22:00:00.000Z';
function historicalFixture(which=0,id=historicalContracts[which].runIds[0]){
 const c=historicalContracts[which];
 const run={id,path:c.path,head_sha:c.head,workflow_id:c.workflowId,status:'queued',conclusion:null,run_attempt:1,
  event:'issue_comment',head_branch:'main',repository:{full_name:repo},head_repository:{full_name:repo},
  created_at:'2026-11-14T00:00:00Z',updated_at:'2026-11-14T00:00:00Z'};
 const pending={id,workflow:c.path.split('/').at(-1),status:run.status};
 const proof={run,runAfter:clone(run),attempt:1,workflow:{path:c.path,ref:c.head,sha:c.blob},
  jobs:{total_count:0,jobs:[]},startedAt:'2026-11-20T21:59:55.000Z',
  jobsObservedAt:'2026-11-20T21:59:58.000Z',observedAt:historicalNow};
 const source={mainHead:'a'.repeat(40),activationHead:'b'.repeat(40),modules:[],nonadmission:{
  mainHead:'a'.repeat(40),activationHead:'b'.repeat(40),policyVersion:1,eventSourceGuardVerified:true,
  modules:HISTORICAL_SOURCE_NONADMISSION_MODULES.map((path,i)=>{
   const blob=i===0?HISTORICAL_SOURCE_NONADMISSION_GUARD_BLOB:'c'.repeat(40);
   return{path,localBlob:blob,mainBlob:blob,activationBlob:blob};
  }),historicalModules:clone(HISTORICAL_SOURCE_NONADMISSION_STATIC_MODULES),
 }};
 const inventory={complete:true,observedAt:historicalNow,pendingRuns:[pending]};
 return{c,run,pending,proof,source,inventory,actions:()=>withMailboxActionEvidence(inventory,{proofs:[proof],source})};
}

test('fixed historical source contracts match all 162 authenticated IDs and exact inert workflow fixtures',()=>{
 const root=new URL('../../tests/fixtures/canonical-mailbox-rotation/',import.meta.url);
 const manifest=JSON.parse(readFileSync(new URL('historical-0b6-cohort.json',root),'utf8'));
 assert.equal(manifest.head,HISTORICAL_SOURCE_NONADMISSION_HEAD);
 assert.deepEqual(historicalContracts,manifest.contracts.map(({head,path,workflowId,blob,kind,runIds})=>({head,path,workflowId,blob,kind,runIds})));
 const ids=historicalContracts.flatMap(c=>c.runIds).sort((a,b)=>a-b);
 assert.equal(ids.length,162);assert.equal(new Set(ids).size,162);
 assert.equal(mailboxActionEvidenceDigest(ids),'a073a6d0abca2d7b28d04be73142772c05bb23d0dfc84b13226c5306f53df90e');
 for(const c of [...manifest.contracts,...manifest.staticSourceClosure]){
  const raw=readFileSync(new URL(c.fixturePath,root));
  assert.equal(createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex'),c.blob);
 }
 const guard=readFileSync(new URL('../../scripts/canonical-mailbox-workflow-admission-v1.mjs',import.meta.url));
 assert.equal(createHash('sha1').update('blob '+guard.length+'\0').update(guard).digest('hex'),HISTORICAL_SOURCE_NONADMISSION_GUARD_BLOB);
});

test('all 162 source-contained wrappers remain 162 queued aggregates with fresh zero-job evidence',()=>{
 const fixtures=historicalContracts.flatMap((c,i)=>c.runIds.map(id=>historicalFixture(i,id)));
 const inventory={complete:true,observedAt:historicalNow,pendingRuns:fixtures.map(f=>f.pending)};
 const a=withMailboxActionEvidence(inventory,{proofs:fixtures.map(f=>f.proof),source:fixtures[0].source});
 assert.equal(a.pendingRuns.length,162);assert.equal(a.pendingRuns.every(p=>p.status==='queued'),true);
 assert.equal(a.blockingRuns.length,0);
 assert.equal(a.aggregateDispositions.every(d=>d.reason==='HISTORICAL_WORKFLOW_SOURCE_NOT_ADMITTED'),true);
 assert.equal(mailboxActionsExecutionQuiescent(a,{now:historicalNow,mainHead:fixtures[0].source.mainHead,activationHead:fixtures[0].source.activationHead}),true);
 assert.deepEqual(mailboxActionEvidenceSummary(a),{actionPendingAggregateCount:162,actionBlockingCount:0,actionsQuiescenceDigest:a.evidenceDigest});
});

for(const [i,c] of historicalContracts.entries())test('historical '+c.path+' requires exact finite identity, no jobs and stable attempt',()=>{
 const changes=[
  f=>{f.run.id=999;f.proof.runAfter.id=999;f.pending.id=999;},
  f=>f.run.workflow_id++,f=>f.run.head_sha='d'.repeat(40),f=>f.run.path='.github/workflows/other.yml',
  f=>f.run.run_attempt=2,f=>f.proof.attempt=2,f=>f.run.event='workflow_dispatch',f=>f.run.head_branch='other',
  f=>f.run.repository.full_name='other/repo',f=>f.run.head_repository.full_name='other/repo',
  f=>{f.run.status='in_progress';f.pending.status='in_progress';f.proof.runAfter.status='in_progress';},
  f=>f.run.conclusion='success',f=>delete f.run.conclusion,f=>f.proof.runAfter.conclusion='cancelled',
  f=>f.proof.runAfter.updated_at='2026-11-14T00:00:01Z',f=>f.proof.runAfter.created_at='2026-11-13T00:00:00Z',
  f=>{f.run.created_at='invalid';f.proof.runAfter.created_at='invalid';},
  f=>{f.run.updated_at='2026-11-21T00:00:00Z';f.proof.runAfter.updated_at=f.run.updated_at;},
  f=>f.proof.workflow.sha='d'.repeat(40),f=>f.proof.workflow.ref='d'.repeat(40),f=>f.proof.workflow.path='other',
  f=>f.proof.jobs={jobs:[]},f=>f.proof.jobs={total_count:0,jobs:[{id:1}]},
  f=>f.proof.jobs={total_count:1,jobs:[{id:1,status:'completed',conclusion:'skipped'}]},
  f=>f.proof.runAfter=null,
 ];
 for(const change of changes){const f=historicalFixture(i);change(f);assert.equal(mailboxActionsExecutionQuiescent(f.actions()),false);}
 assert.equal(historicalSourceNonadmissionContract(historicalFixture(i).run),c);
});

test('policy claims cannot substitute for the exact loaded guard and all six protected source bindings',()=>{
 const changes=[f=>f.source.nonadmission=null,f=>f.source.nonadmission.policyVersion=0,
  f=>f.source.nonadmission.eventSourceGuardVerified=false,f=>f.source.nonadmission.mainHead='d'.repeat(40),
  f=>f.source.nonadmission.activationHead='d'.repeat(40),
  f=>{f.source.mainHead=HISTORICAL_SOURCE_NONADMISSION_HEAD;f.source.nonadmission.mainHead=f.source.mainHead;},
  f=>{f.source.activationHead=HISTORICAL_SOURCE_NONADMISSION_HEAD;f.source.nonadmission.activationHead=f.source.activationHead;},
  f=>{for(const key of ['localBlob','mainBlob','activationBlob'])f.source.nonadmission.modules[0][key]='d'.repeat(40);},
  f=>f.source.nonadmission.modules.pop(),f=>f.source.nonadmission.modules.push(clone(f.source.nonadmission.modules[0])),
 ];
 for(let i=0;i<HISTORICAL_SOURCE_NONADMISSION_MODULES.length;i++)for(const key of ['localBlob','mainBlob','activationBlob'])
  changes.push(f=>f.source.nonadmission.modules[i][key]='e'.repeat(40));
 for(const change of changes){const f=historicalFixture();change(f);assert.equal(mailboxActionsExecutionQuiescent(f.actions()),false);}
 const f=historicalFixture();
 assert.equal(mailboxActionsExecutionQuiescent(f.actions(),{mainHead:'d'.repeat(40)}),false);
 assert.equal(mailboxActionsExecutionQuiescent(f.actions(),{activationHead:'d'.repeat(40)}),false);
});

test('static checkout wrappers additionally require the two immutable historical admission modules',()=>{
 const index=historicalContracts.findIndex(c=>c.kind==='static-checkout');
 const changes=[f=>delete f.source.nonadmission.historicalModules,f=>f.source.nonadmission.historicalModules.pop(),
  f=>f.source.nonadmission.historicalModules.push(clone(f.source.nonadmission.historicalModules[0]))];
 for(let i=0;i<2;i++)for(const key of ['path','ref','sha'])changes.push(f=>f.source.nonadmission.historicalModules[i][key]='invalid');
 for(const change of changes){const f=historicalFixture(index);change(f);assert.equal(mailboxActionsExecutionQuiescent(f.actions()),false);}
});

test('historical evidence age covers the entire before/jobs/after chain and cannot be refreshed by later timestamps',()=>{
 const changes=[f=>delete f.proof.startedAt,f=>delete f.proof.jobsObservedAt,f=>f.proof.startedAt='invalid',
  f=>f.proof.startedAt='2026-11-20T21:57:00Z',f=>f.proof.jobsObservedAt='2026-11-20T21:59:54Z',
  f=>f.proof.jobsObservedAt='2026-11-20T22:00:01Z',f=>f.inventory.observedAt='2026-11-20T22:02:00Z'];
 for(const change of changes){const f=historicalFixture();change(f);assert.equal(mailboxActionsExecutionQuiescent(f.actions()),false);}
 const f=historicalFixture();
 assert.equal(mailboxActionsExecutionQuiescent(f.actions(),{now:'2026-11-20T22:01:54.000Z'}),true);
 assert.equal(mailboxActionsExecutionQuiescent(f.actions(),{now:'2026-11-20T22:01:56.000Z'}),false);
 assert.equal(mailboxActionsExecutionQuiescent(f.actions(),{now:'2026-11-20T21:59:59.000Z'}),false);
});

test('one unproven current or unknown run holds cutover alongside all contained historical wrappers',()=>{
 const f=historicalFixture(),unknown={id:123456789,workflow:f.pending.workflow,status:'queued'};
 const a=withMailboxActionEvidence({...f.inventory,pendingRuns:[f.pending,unknown]},{proofs:[f.proof],source:f.source});
 assert.equal(a.pendingRuns.length,2);assert.equal(a.blockingRuns.length,1);
 assert.equal(mailboxActionsExecutionQuiescent(a),false);assert.equal(mailboxActionEvidenceSummary(a).actionBlockingCount,1);
 const incomplete=withMailboxActionEvidence(f.inventory,{source:f.source});
 assert.equal(mailboxActionsExecutionQuiescent(incomplete),false);
});
