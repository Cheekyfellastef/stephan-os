import test from 'node:test';
import assert from 'node:assert/strict';
import {readChatgptGithubGoalEstateV1 as read, planChatgptGithubAuthenticatedDiscoveryV1 as plan} from './chatgptGithubAuthenticatedDiscoveryV1.mjs';
const HEAD='a'.repeat(40), OTHER='b'.repeat(40), NOW='2026-10-14T18:00:00.000Z';
const pr=(number,path,rest={})=>({number,baseRefName:'main',headRefName:`task/${number}`,headRefOid:HEAD,files:{totalCount:1,pageInfo:{hasNextPage:false},nodes:[{path}]},...rest});
const response=(prs=[],{main=HEAD,title='Provider-neutral build and review continuity when Codex capacity is unavailable',count=prs.length,hasNextPage=false,cursor=null,issueState='OPEN'}={})=>({
  ok:true, status:200, json:async()=>({data:{repository:{
    defaultBranchRef:{name:'main',target:{oid:main}},issue:{number:1574,title,state:issueState},
    pullRequests:{totalCount:count,nodes:prs,pageInfo:{hasNextPage,endCursor:cursor}}
  }}}),
});
const fake=(...responses)=>{const seen=[];let i=0;return {seen,fetchImpl:async (url,options)=>{seen.push({url,...options});return responses[i++];}}};
const base={issueNumber:1574,token:'test-only-not-a-real-token',nowUtc:NOW};
test('fixed read-only query reads complete PR estate and real issue metadata',async()=>{
  const f=fake(response([pr(1,'docs/alpha.md'),pr(2,'shared/a.test.mjs')]));
  const r=await read({...base,fetchImpl:f.fetchImpl});
  assert.equal(r.disposition,'GITHUB_SOURCE_ESTATE_READ_ONLY');
  assert.equal(r.mainHead,HEAD);
  assert.equal(r.issueTitle,'Provider-neutral build and review continuity when Codex capacity is unavailable');
  assert.equal(r.openPrCount,2);assert.equal(r.openPrEvidence.claims.length,2);
  assert.equal(f.seen[0].url,'https://api.github.com/graphql');
  assert.equal(f.seen[0].method,'POST');
  assert.ok(f.seen[0].body.includes('pullRequests(first:40,states:OPEN'));
  assert.equal(r.crossSystemOwnershipAuthenticated,false);
  assert.equal(r.sourceMutationAllowed,false);
});
test('every claim binds the exact PR head and snapshot fingerprints all claimed paths',async()=>{
 const a=await read({...base,fetchImpl:fake(response([pr(7,'docs/alpha.md')])).fetchImpl});
 const b=await read({...base,fetchImpl:fake(response([pr(7,'docs/alpha.md',{headRefOid:OTHER})])).fetchImpl});
 const c=await read({...base,fetchImpl:fake(response([pr(7,'docs/beta.md')])).fetchImpl});
 assert.equal(a.openPrEvidence.claims[0].headSha,HEAD);
 assert.equal(b.openPrEvidence.claims[0].headSha,OTHER);
 assert.equal(b.openPrEvidence.claims[0].evidenceRef,`github:graphql:pr-7:head-${OTHER}`);
 assert.equal(a.snapshotSha256.length,64);
 assert.notEqual(a.snapshotSha256,b.snapshotSha256);
 assert.notEqual(a.snapshotSha256,c.snapshotSha256);
 assert.notEqual(a.openPrEvidence.evidenceRef,b.openPrEvidence.evidenceRef);
 assert.ok(a.openPrEvidence.evidenceRef.endsWith(a.snapshotSha256));
 assert.equal(a.sourceMutationAllowed,false);
});
test('paginates all open PRs rather than taking first page as free ownership',async()=>{
 const f=fake(response([pr(1,'docs/a.md')],{count:2,hasNextPage:true,cursor:'CURSOR_1'}),response([pr(2,'docs/b.md')],{count:2}));
 const r=await read({...base,fetchImpl:f.fetchImpl});assert.equal(r.pagesFetched,2);assert.equal(r.openPrCount,2);
 assert.equal(JSON.parse(f.seen[1].body).variables.cursor,'CURSOR_1');
});
test('same-task branch cannot be silently cleared by unrelated file scope',async()=>{
 const f=fake(response([pr(7,'docs/other.md',{headRefName:'chatgpt/goal-1574-task-name'})]));
 const x=await plan({...base,fetchImpl:f.fetchImpl,tasks:[{taskId:'task-name',taskClass:'docs-only',riskTier:'low',paths:['docs/new.md']}]});
 assert.equal(x.disposition,'GITHUB_VERIFIED_LOCAL_OWNERSHIP_PENDING');
 assert.ok(x.plan.decisions[0].blockers.includes('ACTIVE_GITHUB_WORK_COLLISION'));
});
test('unknown local custody never grants a write even with no GitHub PRs',async()=>{
 const f=fake(response([]));const x=await plan({...base,fetchImpl:f.fetchImpl,tasks:[{taskId:'new-task',taskClass:'docs-only',riskTier:'low',paths:['docs/new.md']}]});
 assert.ok(x.plan.decisions[0].blockers.includes('CROSS_SYSTEM_OWNERSHIP_UNPROVEN'));
 assert.equal(x.plan.suggestedForIndependentVerification,null);
 assert.equal(x.sourceMutationAllowed,false);assert.equal(x.mergeAllowed,false);
});
test('detects source path overlap against current open PR',async()=>{
 const f=fake(response([pr(15,'docs/architecture')]));const r=await plan({...base,fetchImpl:f.fetchImpl,tasks:[{taskId:'docs-scoped',taskClass:'docs-only',riskTier:'low',paths:['docs/architecture/new.md']}]});
 assert.ok(r.plan.decisions[0].blockers.includes('ACTIVE_GITHUB_WORK_COLLISION'));
});
test('missing credential fails closed without network or secret echo',async()=>{
 let called=false;const r=await read({issueNumber:1574,token:'',nowUtc:NOW,fetchImpl:()=>{called=true;throw Error('not called');}});
 assert.equal(r.blocker,'GITHUB_CREDENTIAL_UNAVAILABLE');assert.equal(called,false);
});
test('403 provider quota or permission failure is held without retrying',async()=>{
 let calls=0;const r=await read({...base,fetchImpl:async()=>{calls++;return {ok:false,status:403}}});
 assert.equal(r.blocker,'GITHUB_READ_QUOTA_OR_PERMISSION_HOLD');assert.equal(calls,1);
});
test('GraphQL partial errors cannot masquerade as complete source truth',async()=>{
 const r=await read({...base,fetchImpl:async()=>({ok:true,json:async()=>({errors:[{message:'timeout'}],data:{repository:{}}})})});
 assert.equal(r.blocker,'GITHUB_GRAPHQL_INCOMPLETE_OR_ERROR');
});
test('detects main movement and issue title movement during the scan',async()=>{
 const a=fake(response([pr(1,'docs/a.md')],{count:2,hasNextPage:true,cursor:'C1'}),response([pr(2,'docs/b.md')],{count:2,main:OTHER}));
 assert.equal((await read({...base,fetchImpl:a.fetchImpl})).blocker,'GITHUB_MAIN_MOVED_OR_UNPROVEN');
 const b=fake(response([pr(1,'docs/a.md')],{count:2,hasNextPage:true,cursor:'C1'}),response([pr(2,'docs/b.md')],{count:2,title:'changed title'}));
 assert.equal((await read({...base,fetchImpl:b.fetchImpl})).blocker,'GITHUB_ISSUE_CHANGED_DURING_SCAN');
});
test('rejects unscanned changed-file pages',async()=>{
 const r=await read({...base,fetchImpl:fake(response([pr(1,'docs/a.md',{files:{totalCount:101,pageInfo:{hasNextPage:true},nodes:[{path:'docs/a.md'}]}})])).fetchImpl});
 assert.equal(r.blocker,'GITHUB_PR_SCOPE_UNPROVEN');
});
test('rejects duplicate PR records and changed total count',async()=>{
 const a=fake(response([pr(1,'docs/a.md')],{count:2,hasNextPage:true,cursor:'C1'}),response([pr(1,'docs/a.md')],{count:2}));
 assert.equal((await read({...base,fetchImpl:a.fetchImpl})).blocker,'GITHUB_PR_SCOPE_UNPROVEN');
 const b=fake(response([pr(1,'docs/a.md')],{count:2,hasNextPage:true,cursor:'C1'}),response([pr(2,'docs/b.md')],{count:3}));
 assert.equal((await read({...base,fetchImpl:b.fetchImpl})).blocker,'GITHUB_PR_ESTATE_CHANGED_DURING_SCAN');
});
test('rejects unbounded pages and repeated cursor',async()=>{
 const a=fake(response([],{count:241}));assert.equal((await read({...base,fetchImpl:a.fetchImpl})).blocker,'GITHUB_PR_INVENTORY_UNBOUNDED_OR_INCOMPLETE');
 const b=fake(response([pr(1,'docs/a.md')],{count:3,hasNextPage:true,cursor:'C1'}),response([pr(2,'docs/b.md')],{count:3,hasNextPage:true,cursor:'C1'}));
 assert.equal((await read({...base,fetchImpl:b.fetchImpl})).blocker,'GITHUB_PR_CURSOR_INVALID_OR_REPEATED');
});
test('rejects closed issue, malformed candidate set and executable scope disguise',async()=>{
 const r=await read({...base,fetchImpl:fake(response([],{issueState:'CLOSED'})).fetchImpl});
 assert.equal(r.blocker,'GITHUB_GOAL_NOT_OPEN_OR_UNPROVEN');
 const x=await plan({...base,fetchImpl:fake(response([])).fetchImpl,tasks:'not-list'});
 assert.equal(x.blocker,'TASK_CANDIDATE_SET_INVALID');
 const y=await plan({...base,fetchImpl:fake(response([])).fetchImpl,tasks:[{taskId:'not-low',taskClass:'docs-only',riskTier:'low',paths:['scripts/mutate.ps1']}]});
 assert.ok(y.plan.decisions[0].blockers.includes('SCOPE_INVALID_OR_OVERLAPPING'));
});
