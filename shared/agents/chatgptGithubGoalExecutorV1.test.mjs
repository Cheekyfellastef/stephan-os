import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatgptGithubGoalExecutorV1 as create } from './chatgptGithubGoalExecutorV1.mjs';
import { createBoundedParallelConstructionAuthority } from './boundedParallelConstructionLanesV1.mjs';
import { appendExecutionReceipt, readExecutionReceiptHistory } from './executionReceiptV1.mjs';

const MAIN = 'a'.repeat(40), HEAD = 'b'.repeat(40), MERGED = 'c'.repeat(40);
const NOW = '2026-10-16T19:00:00.000Z';
const REPO = 'Cheekyfellastef/stephan-os';
const ROOT = `https://api.github.com/repos/${REPO}`;

// The remote API, custody observer and protected collector are controlled test
// doubles, NOT live authentication or independent review. Canonical admission
// and execution-receipt disk persistence below use their real implementations.
async function harness(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(),'chatgpt-executor-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const task = {schemaVersion:'stephanos.chatgpt-source-task.v1', taskId:'bounded-test',
    expectedMain:MAIN, expiresAt:'2026-10-16T19:09:00.000Z', taskClass:'tests-only',
    edits:[{path:'shared/agents/independent-example.test.mjs',content:"import test from 'node:test';\ntest('example',()=>{});\n"}],
    ...options.task};
  const comment = {id:123456, issue_url:`${ROOT}/issues/1574`, user:{login:'Cheekyfellastef',id:267490109,type:'User'},
    author_association:'OWNER', created_at:NOW, updated_at:NOW,
    body:'```stephanos-chatgpt-source-task\n'+JSON.stringify(task)+'\n```', ...options.comment};
  let branch = null, committed = false, pull = null, durable = null, branchReads = 0;
  let claim = null, reservations = 0, ownershipLost = false, completed = false;
  const calls = [], receipts = [];
  const inventory = {constructionLanes:[],integrationLane:null,completedGoalIds:[]};
  const authority = createBoundedParallelConstructionAuthority({nowMs:()=>Date.parse(NOW),
    reserveConstructionLane:async r=>{
      if (claim || options.claimRace) return {accepted:false};
      reservations++; claim = r;
      return {accepted:true,reservationId:'reservation-1574',inventoryFingerprint:r.expectedInventoryFingerprint};
    }, resolveConstructionLaneReservation:async()=>null, resolveVerifierEvidence:async()=>null,
    resolveReadinessAuthoritySnapshot:async()=>null});
  const response = (data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(data)});
  const claims = options.prClaims || [];
  const fetchImpl = async(url,request={})=>{
    const body = request.body ? JSON.parse(request.body) : null;
    calls.push({url,method:request.method||'GET',body});
    if (options.intercept) {const result=await options.intercept({url,request,body,calls});if(result)return result;}
    if (url===`${ROOT}/issues/comments/123456`) return response(comment);
    if (url==='https://api.github.com/graphql' && body.query.startsWith('query(')) {
      return response({data:{repository:{defaultBranchRef:{name:'main',target:{oid:options.movedMain&&committed?MERGED:MAIN}},
        issue:{number:1574,title:'Provider-neutral build and review continuity when Codex capacity is unavailable',state:'OPEN'},
        pullRequests:{totalCount:claims.length,pageInfo:{hasNextPage:false},nodes:claims}}}});
    }
    if (url===`${ROOT}/git/refs`) {
      if (branch || options.branchExists) return response({},422);
      branch=body.sha; return response({ref:body.ref,object:{sha:branch}},201);
    }
    if (url===`${ROOT}/git/ref/heads/chatgpt/goal-1574-bounded-test`) {
      branchReads++;
      if(options.expireDuringRead&&branchReads===2)clock=Date.parse(task.expiresAt);
      return response({object:{sha:options.branchMoved?MERGED:branch}});
    }
    if (url==='https://api.github.com/graphql' && body.query.startsWith('mutation(')) {
      if (options.casConflict) return response({errors:[{message:'expectedHeadOid mismatch'}]});
      assert.equal(body.variables.input.expectedHeadOid,branch);
      branch=HEAD; committed=true;
      if(options.loseAfterCommit)ownershipLost=true;
      if(options.loseCommitAck&&!options.commitAckLost){options.commitAckLost=true;throw new Error('commit ack lost');}
      return response({data:{createCommitOnBranch:{commit:{oid:HEAD,tree:{oid:'d'.repeat(40)}}}}});
    }
    if (url===`${ROOT}/compare/${MAIN}...${HEAD}`)
      return response({status:'ahead',ahead_by:1,total_commits:1,
        files:options.compareFiles||task.edits.map(e=>({filename:e.path,status:'added'}))});
    if (url.startsWith(`${ROOT}/contents/`)) {
      const edit=task.edits.find(e=>url===`${ROOT}/contents/${e.path}?ref=${HEAD}`);
      assert.ok(edit);
      return response({type:'file',path:edit.path,encoding:'base64',
        content:Buffer.from(options.wrongBytes?'wrong source':edit.content).toString('base64')});
    }
    if (url.startsWith(`${ROOT}/pulls?state=all&head=`))return response(pull?[pull]:[]);
    if (url===`${ROOT}/pulls`){
      pull={number:3140,head:{sha:HEAD,ref:body.head,repo:{full_name:REPO}},base:{ref:'main',repo:{full_name:REPO}},merged:false};
      if(options.losePrAck&&!options.prAckLost){options.prAckLost=true;throw new Error('PR ack lost');}
      return response(pull,201);
    }
    if (url===`${ROOT}/pulls/3140`) return response(pull);
    throw new Error('unexpected fixture request '+url);
  };
  let clock=Date.parse(NOW);
  const host = {token:'test-only-not-a-credential',fetchImpl,authority,now:()=>new Date(clock++).toISOString(),
    readCustody:async({task})=>({inventory,ownershipEvidence:options.noCustody?undefined:
      Object.fromEntries(['canonical','seed','island','chatgpt'].map(source=>[source,{
        disposition:'VERIFIED_UNCLAIMED',mainHead:MAIN,observedAtUtc:NOW,issueNumber:1574,
        taskId:task.taskId,paths:task.paths,evidenceRef:`proof/${source}.json`}]))}),
    verifyReservation:async()=>Boolean(claim)&&!ownershipLost,
    appendReceipt:async(receipt,context)=>{
      if(options.receiptFailure===receipt.phase)throw new Error('disk full');
      if(options.falseAck)return {ok:false};
      await mkdir(join(root,'proofs'),{recursive:true});
      await writeFile(join(root,context.evidenceRef),JSON.stringify(context.evidence),{flag:'wx'});
      const persisted=await appendExecutionReceipt(root,receipt);
      if(persisted.ok!==true){const e=new Error(JSON.stringify(persisted));e.code=persisted.reason||persisted.finalVerdict;throw e;}
      receipts.push(receipt);
      durable={issueNumber:1574,commentId:123456,taskId:task.taskId,branch:context.task.branch,
        head:context.head,prNumber:context.prNumber,reservationId:context.lease.reservationId,
        lease:context.lease,commentSha256:context.task.commentSha256};
      return {ok:true,evidenceSha256:context.evidenceSha256};
    }, readExecution:async()=>durable,
    confirmProtectedMerge:async()=>options.protectedProof!==false,
    completeAndRefill:async()=>{completed=true;return{completed:true};}};
  const executor=create(host);
  return {executor,host,task,comment,calls,receipts,root,run:()=>executor.runOnce({issueNumber:1574,commentId:123456}),
    get committed(){return committed;},get completed(){return completed;},get reservations(){return reservations;},
    get pull(){return pull;},get durable(){return durable;},
    merge(){pull.merged=true;pull.merge_commit_sha=MERGED;}};
}

test('real canonical reservation and disk receipt chain surround one CAS commit and PR',async t=>{
  const h=await harness(t);const r=await h.run();
  assert.equal(r.verdict,'PR_OPEN',JSON.stringify(r));assert.equal(h.committed,true);
  assert.equal(h.reservations,1);assert.equal(r.githubPickupProven,true);assert.equal(r.battleBridgePickupProven,false);
  const history=await readExecutionReceiptHistory(h.root,{executionId:'chatgpt-123456'});
  assert.equal(h.receipts.length,5);assert.equal(history.ok,true,JSON.stringify(history));
  assert.equal(history.receipts.length,5);
  assert.deepEqual(h.receipts.map(r=>r.state),['queued','accepted','started','progress','progress']);
  assert.equal(h.receipts.at(-1).sourceHead,HEAD);
  assert.ok(h.receipts.every(r=>r.prNumber===0),'pre-PR execution identity must stay stable');
  assert.equal(JSON.parse(await readFile(join(h.root,h.receipts.at(-1).proofRefs[0]),'utf8')).head,HEAD);
  assert.equal(h.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/pulls')).length,1);
  assert.equal((await h.executor.reconcile({issueNumber:1574,commentId:123456})).verdict,
    'AWAITING_EXISTING_CI_REVIEW_AND_PROTECTED_MERGE');
  assert.equal(h.completed,false);
  h.merge();const reconciled=await h.executor.reconcile({issueNumber:1574,commentId:123456});
  assert.equal(reconciled.verdict,'MERGED_SOURCE_TASK_RECONCILED');assert.equal(h.completed,true);
  assert.equal(reconciled.unattendedRefillProven,false);
});

test('forged/edited/expired owner intake is rejected before any source write',async t=>{
  for(const opts of [{comment:{user:{login:'Cheekyfellastef',id:99,type:'User'}}},
    {comment:{updated_at:'2026-10-16T19:01:00.000Z'}},{task:{expiresAt:NOW}},
    {task:{token:'injected'}},{task:{expectedMain:'wrong'}}]){
    const h=await harness(t,opts);assert.equal((await h.run()).verdict,'HELD');
    assert.equal(h.calls.some(c=>c.url.endsWith('/git/refs')),false);
  }
});

test('unknown custody and active source collision hold only this task',async t=>{
  for(const opts of [{noCustody:true},{prClaims:[{number:80,baseRefName:'main',headRefName:'another',headRefOid:HEAD,
    files:{totalCount:1,pageInfo:{hasNextPage:false},nodes:[{path:'SHARED/AGENTS/independent-example.test.mjs'}]}}]}]){
    const h=await harness(t,opts);assert.equal((await h.run()).verdict,'HELD');assert.equal(h.reservations,0);
  }
  const free=await harness(t);assert.equal((await free.run()).verdict,'PR_OPEN');
});

test('canonical CAS reservation race cannot create branch or commit',async t=>{
  const h=await harness(t,{claimRace:true});assert.equal((await h.run()).verdict,'HELD');
  assert.equal(h.calls.some(c=>c.url.endsWith('/git/refs')),false);
});

test('source path boundary rejects traversal, workflow, runtime, alias and duplicate scopes',async t=>{
  for(const path of ['../bad.test.mjs','.github/workflows/bad.yml','runtime/bad.test.mjs','shared/dist/bad.test.mjs']){
    const h=await harness(t,{task:{edits:[{path,content:'source'}]}});
    assert.equal((await h.run()).verdict,'HELD',path);assert.equal(h.reservations,0);
  }
  const h=await harness(t,{task:{edits:[{path:'shared/a.test.mjs',content:'a'},{path:'SHARED/a.test.mjs',content:'b'}]}});
  assert.equal((await h.run()).verdict,'HELD');assert.equal(h.reservations,0);
});

test('branch create collision, changed ref and commit CAS conflict preserve original branch',async t=>{
  for(const opts of [{branchExists:true},{branchMoved:true},{casConflict:true}]){
    const h=await harness(t,opts);const r=await h.run();assert.equal(r.verdict,'HELD');
    assert.equal(h.committed,false);assert.equal(h.calls.some(c=>c.method==='PATCH'),false);
  }
});

test('lost commit acknowledgment never retries, creates replacement or calls completion',async t=>{
  const h=await harness(t,{intercept:async({body})=>{if(body?.query?.startsWith('mutation('))throw new Error('lost ack');}});
  const r=await h.run();assert.equal(r.blocker,'GITHUB_WRITE_OUTCOME_UNKNOWN');
  assert.equal(h.calls.filter(c=>c.body?.query?.startsWith('mutation(')).length,1);
  assert.equal(h.pull,null);assert.equal(h.completed,false);assert.equal(r.reservationId,'reservation-1574');
  assert.equal(h.receipts.at(-1).state,'failed');
  assert.equal(h.receipts.at(-1).blocker,'GITHUB_WRITE_OUTCOME_UNKNOWN');
});

test('receipt sink failure before pickup prevents source commit',async t=>{
  for(const receiptFailure of ['CANONICAL_CLAIMED','GITHUB_PICKUP_PROVEN']){
    const h=await harness(t,{receiptFailure});assert.equal((await h.run()).verdict,'HELD');assert.equal(h.committed,false);
  }
});

test('post-commit scope mismatch, ownership loss and main movement retain source without PR',async t=>{
  for(const opts of [{compareFiles:[{filename:'extra.test.mjs',status:'added'}]},
    {loseAfterCommit:true},{movedMain:true}]){
    const h=await harness(t,opts);const r=await h.run();assert.equal(r.verdict,'HELD');
    assert.equal(r.head,HEAD);assert.equal(h.pull,null);assert.equal(h.completed,false);
  }
});

test('quota response yields one bounded hold without source mutation or retry',async t=>{
  const h=await harness(t,{intercept:async()=>({ok:false,status:403})});
  assert.equal((await h.run()).blocker,'GITHUB_QUOTA_OR_PERMISSION_HOLD');assert.equal(h.calls.length,1);
});

test('repeated intake does not acquire another canonical claim or create another PR',async t=>{
  const h=await harness(t);assert.equal((await h.run()).verdict,'PR_OPEN');
  assert.equal((await h.run()).verdict,'HELD');assert.equal(h.reservations,1);
  assert.equal(h.calls.filter(c=>c.url.endsWith('/pulls')&&c.method==='POST').length,1);
});

test('merged PR without authenticated protected evidence cannot complete/refill',async t=>{
  const h=await harness(t,{protectedProof:false});await h.run();h.merge();
  assert.equal((await h.executor.reconcile({issueNumber:1574,commentId:123456})).blocker,'PROTECTED_MERGE_RECEIPT_UNPROVEN');
  assert.equal(h.completed,false);
});

test('changed head invalidates continuation even if GitHub says merged',async t=>{
  const h=await harness(t);await h.run();h.merge();h.pull.head.sha=MERGED;
  assert.equal((await h.executor.reconcile({issueNumber:1574,commentId:123456})).blocker,'PR_IDENTITY_CHANGED');
  assert.equal(h.completed,false);
});

test('host custody, canonical authority and protected collector cannot be supplied in task fields',async t=>{
  const h=await harness(t);assert.throws(()=>create({...h.host,readCustody:undefined}),/trusted host/);
  assert.throws(()=>create({...h.host,authority:null}),/canonical construction/);
});

test('negative durable acknowledgment prevents branch/source writes',async t=>{
  const h=await harness(t,{falseAck:true});const r=await h.run();
  assert.equal(r.blocker,'EXECUTION_RECEIPT_PERSISTENCE_UNPROVEN');
  assert.equal(h.calls.some(c=>c.url.endsWith('/git/refs')),false);
});

test('clock failing to advance cannot create an invalid canonical receipt chain',async t=>{
  const h=await harness(t);const fixed=create({...h.host,now:()=>NOW});
  const r=await fixed.runOnce({issueNumber:1574,commentId:123456});
  assert.equal(r.blocker,'EXECUTION_RECEIPT_CLOCK_NOT_ADVANCED');assert.equal(h.committed,false);
  assert.equal(h.calls.some(c=>c.url.endsWith('/git/refs')),false);
});

test('recover a successful commit with a lost acknowledgment without another source mutation',async t=>{
  const h=await harness(t,{loseCommitAck:true});const r=await h.run();
  assert.equal(r.blocker,'GITHUB_WRITE_OUTCOME_UNKNOWN');assert.equal(h.committed,true);
  const recovered=await h.executor.reconcile({issueNumber:1574,commentId:123456});
  assert.equal(recovered.verdict,'AWAITING_EXISTING_CI_REVIEW_AND_PROTECTED_MERGE',JSON.stringify(recovered));
  assert.equal(h.durable.head,HEAD);assert.equal(h.durable.prNumber,3140);assert.equal(h.reservations,1);
  assert.equal(h.calls.filter(c=>c.body?.query?.startsWith('mutation(')).length,1);
  assert.equal(h.calls.filter(c=>c.url===`${ROOT}/pulls`&&c.method==='POST').length,1);
});

test('recover a successful PR POST with lost acknowledgment by discovering the SAME PR',async t=>{
  const h=await harness(t,{losePrAck:true});assert.equal((await h.run()).blocker,'GITHUB_WRITE_OUTCOME_UNKNOWN');
  assert.ok(h.pull);
  assert.equal((await h.executor.reconcile({issueNumber:1574,commentId:123456})).verdict,
    'AWAITING_EXISTING_CI_REVIEW_AND_PROTECTED_MERGE');
  assert.equal(h.calls.filter(c=>c.url===`${ROOT}/pulls`&&c.method==='POST').length,1);
  assert.equal(h.calls.filter(c=>c.body?.query?.startsWith('mutation(')).length,1);
  const again=await h.executor.reconcile({issueNumber:1574,commentId:123456});
  assert.equal(again.verdict,'AWAITING_EXISTING_CI_REVIEW_AND_PROTECTED_MERGE');
});

test('recovery rejects unapproved source bytes and never reruns source construction',async t=>{
  const opts={loseCommitAck:true};const h=await harness(t,opts);await h.run();
  opts.wrongBytes=true;
  assert.equal((await h.executor.reconcile({issueNumber:1574,commentId:123456})).blocker,
    'PUBLISHED_SOURCE_BYTES_UNPROVEN');
  assert.equal(h.calls.filter(c=>c.body?.query?.startsWith('mutation(')).length,1);
  assert.equal(h.pull,null);
});

test('expiry during final paginated/ref observation prevents CAS source write',async t=>{
  const h=await harness(t,{expireDuringRead:true});const r=await h.run();
  assert.equal(r.blocker,'OWNER_TASK_EXPIRED');assert.equal(h.committed,false);
});

test('recovery cannot replace the original owner comment with a changed approval',async t=>{
  const h=await harness(t,{loseCommitAck:true});await h.run();h.comment.body+='\nchanged';
  assert.equal((await h.executor.reconcile({issueNumber:1574,commentId:123456})).blocker,
    'ORIGINAL_RESERVATION_OR_APPROVAL_UNPROVEN');assert.equal(h.pull,null);
});

test('closed unmerged PR is a typed hold rather than completion or automatic replacement',async t=>{
  const h=await harness(t);await h.run();h.pull.state='closed';
  assert.equal((await h.executor.reconcile({issueNumber:1574,commentId:123456})).blocker,
    'PR_CLOSED_UNMERGED_PRESERVE_SOURCE');assert.equal(h.completed,false);
});
