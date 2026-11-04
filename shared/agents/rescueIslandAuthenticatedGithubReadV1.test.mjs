import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  inspectRescueIslandGithubReadFactsV1 as inspect,
  readRescueIslandPilotGithubFactsV1 as read,
} from './rescueIslandAuthenticatedGithubReadV1.mjs';

const REPO='Cheekyfellastef/stephan-os';
const ROOT='https://api.github.com/repos/'+REPO;
const HEAD='a'.repeat(40);
const CONTENT='# Rescue Island pilot\n\nBounded owner-authenticated source pilot scope.\n';
const digest=createHash('sha256').update(CONTENT).digest('hex');
const TITLE='Rescue Island 01: authenticated one-shot intake and first physical source pickup (#3103)';
function facts() {
  const task={
    schemaVersion:'stephanos.rescue-island-pilot-task.v1',
    repository:REPO,issueNumber:3109,issueTitle:TITLE,
    workerId:'rescue-island-01',taskId:'pilot-3109-01',baseHead:HEAD,
    targetPath:'docs/architecture/rescue-island-pilot-pilot-3109-01.md',
    testPath:'shared/agents/rescueIslandPreflightV1.test.mjs',
    approvalSource:'EXTERNAL_OWNER_ATTESTATION_REQUIRED',
    content:CONTENT,expiresAtUtc:'2026-10-14T12:38:00.000Z',
  };
  return {
    commentId:123,
    nowUtc:'2026-10-14T12:36:00.000Z',
    initialMain:{ref:'refs/heads/main',object:{sha:HEAD}},
    finalMain:{ref:'refs/heads/main',object:{sha:HEAD}},
    task,
    issue:{number:3109,title:TITLE,state:'open',url:ROOT+'/issues/3109'},
    comment:{
      id:123,
      url:ROOT+'/issues/comments/123',
      issue_url:ROOT+'/issues/3109',
      user:{login:'Cheekyfellastef',id:267490109,type:'User'},
      author_association:'OWNER',
      created_at:'2026-10-14T12:35:00.000Z',
      updated_at:'2026-10-14T12:35:00.000Z',
      body:'/rescue-island-01 pilot '+HEAD+' pilot-3109-01 '+digest,
    },
  };
}
test('bounded four-GET owner observation is structurally ready but holds all mutation authority',()=>{
  const x=inspect(facts());
  assert.equal(x.verdict,'GITHUB_FACTS_STRUCTURALLY_VERIFIED');
  assert.equal(x.readOnlyRequestCount,4);
  assert.equal(x.sourceHead,HEAD);
  assert.deepEqual(x.blockers,[]);
  assert.equal(x.nextRequiredProof,'EXTERNAL_OS_AND_OWNERSHIP_PROOF_REQUIRED');
  for(const key of ['approvalAuthenticated','ownershipAuthenticated','independentClaimsAuthenticated',
    'gamingBudgetAuthenticated','physicalPickupAllowed','sourceMutationAllowed',
    'canonicalLeaseAccessAllowed','seedForgeQueueAccessAllowed','mergeAllowed','liveRunnerRegistered'])
    assert.equal(x[key],false,key);
});
test('current main drift and wrong ref reject source admission',()=>{
  for(const mutate of [
    x=>{x.finalMain.object.sha='b'.repeat(40);},
    x=>{x.initialMain.ref='refs/heads/experimental';},
    x=>{x.initialMain.object.sha=['a'.repeat(40)];},
  ]){const x=facts();mutate(x);assert.equal(inspect(x).verdict,'HELD');}
});
test('spoofed comment author/body, issue title and expiry reject',()=>{
  for(const mutate of [
    x=>{x.comment.user.login='github-actions[bot]';},
    x=>{x.issue.title='not the original issue';},
    x=>{x.task.expiresAtUtc='2026-10-14T12:35:00.000Z';},
    x=>{x.comment.body=x.comment.body.replace('pilot-3109-01','pilot-3109-02');},
    x=>{x.comment.updated_at='2026-10-14T12:36:00.000Z';},
  ]){const x=facts();mutate(x);assert.equal(inspect(x).verdict,'HELD');}
});
test('comment replay and malformed consumed inventory are held',()=>{
  for(const inventory of [[123], [2,2], [null], 123]){
    const x=facts();x.consumedCommentIds=inventory;
    assert.equal(inspect(x).verdict,'HELD');
  }
});
test('bad comment ID returns before any network and never turns caller data into approval',async()=>{
  for(const id of [-1,0,'123',1.3,Number.MAX_SAFE_INTEGER+1]){
    const x=await read({commentId:id,task:facts().task,token:''});
    assert.equal(x.verdict,'HELD');
    assert.equal(x.physicalPickupAllowed,false);
    assert.equal(x.sourceMutationAllowed,false);
  }
});
test('native GitHub reader is hard-bound to fixed TLS GETs and never executes shell/write',async()=>{
  const source=await readFile(new URL('./rescueIslandAuthenticatedGithubReadV1.mjs',import.meta.url),'utf8');
  assert.match(source,/readBrokeredGithubJson/);
  assert.match(source,/BROKER_TIMEOUT_MS = 10_000/);
  assert.match(source,/UPSTREAM_REFRESH/);
  assert.match(source,/ISLAND_GITHUB_SHARED_RATE_LIMIT_HOLD/);
  assert.match(source,/GITHUB_RATE_LIMIT_BACKOFF/);
  assert.match(source,/spec\.jq/);
  assert.match(source,/OBSERVATION_TIME_NOT_LIVE/);
  assert.doesNotMatch(source,/workspaceRoot/);
  assert.doesNotMatch(source,/httpsRequest|execSync|child_process|method: 'POST'|sourceMutationAllowed: true|approvalAuthenticated: true/);
});

test('shared broker reader refuses caller-controlled time before any GitHub call',async()=>{
  const x=await read({commentId:123,task:facts().task,nowUtc:'2001-01-01T00:00:00.000Z'});
  assert.equal(x.verdict,'HELD');
  assert.ok(x.blockers.includes('OBSERVATION_TIME_NOT_LIVE'));
  assert.equal(x.sourceMutationAllowed,false);
});
