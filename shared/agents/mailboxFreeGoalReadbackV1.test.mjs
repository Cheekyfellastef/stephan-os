import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailboxFreeGoalReadbackV1 } from './mailboxFreeGoalReadbackV1.mjs';

// Genuine public, sanitized previous-stage run artifact, pinned to GitHub ZIP.
const ZIP = Buffer.from('UEsDBBQACAAIACafW10AAAAAAAAAAAAAAAAqAAAAc3RlcGhhbm9zLW1haWxib3gtZnJlZS1yZWFkb25seS1wcm9vZi5qc29unVJNk5pAFLz7KyzOQT4UEG9EKEPVCpaou8mFGoaHTC3MkPkwblL57ynAdTdbOeXa3a9fT7/5NZlONYFraNEJuCCMaqupJiR0NaJMzFpEmoJd9YoD6CURHZK41jmgktHmZXaxtE+9wwV4SbDsZ/dREOZp8vA1Tz9n0f4UhaOkZSXc+U0aPOTZITgcs5Hl8F2BkHHZSxCWhFGhc0X1hel4c9d1bN/Sb8u4ooPuHfWKB1JC2/U5RujMUJOotgCuraa2776hmURyyJPuokS7w2vWtkDlminau9jOfKAEUxzDF0BDPrxw3AKbyMS+h73Cdj28LBa+5Va4XNqo9M3KsaslHm1ZIYBfoAzkUeJ+3DZtV7dM3fYOlr9yvJU1nznO/NtbiiNvemEtZSdWhnEmslbFDLPWWNcAzy8VNA0SEirjdimdCYMIoUAY/SvvPf2X0a1+gysqjHclj66EltABLYHKE3BSEYx6+Q54xXgLfUEVagQMYrgCVj0dKFkzTn5+4CmS5AI7gp9Vt+PsAvQveqx9q+SwImga9uODQceZBCyh3AI/w78UFK5yc7t19BRnhzjZjP8vfUyifR6E2zjL4jTJgyTM4ySMdlESRskh30enOHrUJr8nfwBQSwcICfYQ7tYBAAAmAwAAUEsBAi0DFAAIAAgAJp9bXQn2EO7WAQAAJgMAACoAAAAAAAAAAAAgAICBAAAAAHN0ZXBoYW5vcy1tYWlsYm94LWZyZWUtcmVhZG9ubHktcHJvb2YuanNvblBLBQYAAAAAAQABAFgAAAAuAgAAAAA=', 'base64');
const RUN = 40573665291;
const HEAD = 'c456bc0a0c97c7b267c8b4916fcd82ad90f52f8c';
const ROOT = 'https://api.github.com/repos/Cheekyfellastef/stephan-os';
const REPO = 'Cheekyfellastef/stephan-os';
const artifact = {
  id: 12765876671, name: 'stephanos-mailbox-free-readonly-40573665291',
  expired: false, size_in_bytes: 668,
  digest: 'sha256:ee7610367d6ea027a31e7d6b03cdb691a15c3f85d8b2a6e9c1da723353dd0545',
  workflow_run: { id: RUN, head_sha: HEAD },
};
const actualRun = {
  id: RUN,
  workflow_id: 398609082,
  name: 'Stephanos Control Tower - Mailbox-Free Read-Only Pilot',
  path: '.github/workflows/stephanos-mailbox-free-readonly.yml',
  event: 'workflow_dispatch', status: 'completed', conclusion: 'success',
  run_attempt: 1, head_branch: 'main', head_sha: HEAD,
  repository: {full_name: REPO, id:1179385578},
  actor: {login: 'Cheekyfellastef', id:267490109},
  triggering_actor: {login:'Cheekyfellastef'},
  created_at:'2026-10-27T19:57:03Z',
  updated_at:'2026-10-27T19:57:18Z',
};
const route = key => ROOT + key;
function fixture({
  run = actualRun, head = HEAD, endHead = head,
  jobs = {
    total_count:2, jobs:[
      {id:122434245550, run_id:RUN, name:'inspect-goal', status:'completed', conclusion:'success'},
      {id:122434248382, run_id:RUN, name:'contract-test', status:'completed', conclusion:'skipped'},
    ],
  },
  artifacts = {total_count:1,artifacts:[artifact]},
  goal = {number:2961,state:'open',comments:253},
  zip = ZIP, failPath = '', responseStatus = 200, oversizePath = '',
  timestamp = '2026-10-27T19:58:00.000Z',
} = {}) {
  const calls=[];
  const endpoints = [
    ['/git/ref/heads/main', {ref:'refs/heads/main',object:{sha:head}}],
    ['/actions/runs/' + RUN, run],
    ['/actions/runs/' + RUN + '/jobs?per_page=100', jobs],
    ['/actions/runs/' + RUN + '/artifacts?per_page=100', artifacts],
    ['/issues/2961', goal],
    ['/git/ref/heads/main', {ref:'refs/heads/main',object:{sha:endHead}}],
  ];
  let index=0,downloads=0;
  const fetchImpl = async (url,options) => {
    calls.push([url,options]);
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer original-host-only-token');
    assert.equal(url,route(endpoints[index][0]),'exact fixed GET call order');
    const [path,body] = endpoints[index++];
    if(path===failPath) throw new Error('PRIVATE_TOKEN_SHOULD_NOT_LEAK');
    if(path===oversizePath) return new Response('x'.repeat(262145),{status:200});
    return new Response(JSON.stringify(body), {status:responseStatus, headers:{'Content-Type':'application/json'}});
  };
  const downloadArtifact = async input => {
    downloads++;
    assert.deepEqual(input,{
      repository:REPO,artifactId:12765876671,maxBytes:65536,
    });
    assert.equal(Object.hasOwn(input,'token'),false);
    assert.equal(Object.hasOwn(input,'url'),false);
    return zip;
  };
  return {
    calls, getDownloads:()=>downloads,
    read:createMailboxFreeGoalReadbackV1({
      token:'original-host-only-token',fetchImpl,downloadArtifact,
      now:()=>timestamp,
    }),
  };
}
function held(result,reason){
  assert.equal(result.disposition,'HELD');
  assert.equal(result.blocker,reason);
  for(const flag of ['independentlyAuthenticatedTransport','originalGoalAdmissionGranted',
    'exclusiveClaimGranted','sourceMutationAllowed','nativePickupProven',
    'executionAuthorized','protectedMergeAllowed'])assert.equal(result[flag],false);
  assert.equal(Object.isFrozen(result),true);
}
test('genuine-shaped GitHub run and archived ZIP produces discovery only',async()=>{
  assert.equal(ZIP.length,668);
  const f=fixture();
  const r=await f.read({runId:RUN,expectedGoalNumber:2961});
  assert.equal(r.disposition,'DISCOVERY_CANDIDATE_ONLY');
  assert.equal(r.runId,RUN);
  assert.equal(r.goalNumber,2961);
  assert.equal(r.artifactId,artifact.id);
  assert.equal(r.sourceHead,HEAD);
  assert.equal(r.independentlyAuthenticatedTransport,false);
  assert.equal(r.executionAuthorized,false);
  assert.equal(f.calls.length,6);
  assert.equal(f.getDownloads(),1);
});
test('zero source writes, job runs, arbitrary paths or bearer passing to downloader',async()=>{
  const f=fixture();
  await f.read({runId:RUN,expectedGoalNumber:2961});
  assert.deepEqual(f.calls.map(x=>x[0]),[
    route('/git/ref/heads/main'),route('/actions/runs/'+RUN),
    route('/actions/runs/'+RUN+'/jobs?per_page=100'),
    route('/actions/runs/'+RUN+'/artifacts?per_page=100'),
    route('/issues/2961'),route('/git/ref/heads/main'),
  ]);
  assert.ok(f.calls.every(x=>x[1].method==='GET'));
});
test('unconfigured token or downloader rejects before any I/O',async()=>{
  const a=createMailboxFreeGoalReadbackV1({token:'',fetchImpl:()=>{throw Error('called')},downloadArtifact:()=>{}});
  held(await a({runId:RUN,expectedGoalNumber:2961}),'TRUSTED_GITHUB_READER_NOT_CONFIGURED');
  const b=createMailboxFreeGoalReadbackV1({token:'test',fetchImpl:()=>{throw Error('called')}});
  held(await b({runId:RUN,expectedGoalNumber:2961}),'TRUSTED_ARTIFACT_DOWNLOADER_NOT_CONFIGURED');
});
test('arbitrary run IDs and goal selectors never produce URL fetches',async()=>{
  const f=fixture();
  for (const input of [
    {runId:'40573665291',expectedGoalNumber:2961},
    {runId:0,expectedGoalNumber:2961},
    {runId:RUN,expectedGoalNumber:0},
    {runId:RUN,expectedGoalNumber:99999999},
    {runId:RUN,expectedGoalNumber:'2961'},
  ]) held(await f.read(input),'BOUNDED_GOAL_OR_RUN_REQUIRED');
  assert.equal(f.calls.length,0);
});
test('tampered operator, repository, workflow, event or permission cannot select run',async()=>{
  for(const patch of [
    {actor:{login:'attacker',id:267490109}},
    {actor:{login:'Cheekyfellastef',id:1}},
    {repository:{full_name:REPO,id:1}},
    {workflow_id:9},{head_branch:'untrusted'},{event:'pull_request'},
    {run_attempt:2},{conclusion:'failure'},
  ]){
    const f=fixture({run:{...actualRun,...patch}});
    held(await f.read({runId:RUN,expectedGoalNumber:2961}),'ORIGINAL_OPERATOR_RUN_NOT_CURRENT');
    assert.equal(f.getDownloads(),0);
  }
});
test('run from older protected source is never a fresh current-main candidate',async()=>{
  const f=fixture({head:'d39b6e6f5fab2e43c24c425b4d0a32798029e6f7'});
  held(await f.read({runId:RUN,expectedGoalNumber:2961}),'ORIGINAL_OPERATOR_RUN_NOT_CURRENT');
});
test('missing, duplicate or unbounded runner job inventory refuses ZIP download',async()=>{
  for(const jobs of [
    {total_count:3,jobs:[]},{total_count:2,jobs:[{}]},
    {total_count:101,jobs:Array(2).fill({})},
  ]){
    const f=fixture({jobs});
    held(await f.read({runId:RUN,expectedGoalNumber:2961}),'BOUNDED_RUN_JOBS_UNPROVEN');
    assert.equal(f.getDownloads(),0);
  }
});
test('wrong artifact inventory and expired artifact are terminal holds',async()=>{
  for(const artifacts of [
    {total_count:2,artifacts:[artifact]},
    {total_count:1,artifacts:[]},
    {total_count:1,artifacts:[{...artifact,expired:true}]},
    {total_count:1,artifacts:[{...artifact,workflow_run:{id:2,head_sha:HEAD}}]},
  ]) {
    const f=fixture({artifacts});
    const reason=artifacts.total_count!==1||artifacts.artifacts.length!==1
      ? 'BOUNDED_ARTIFACT_INVENTORY_UNPROVEN':'BOUNDED_ARTIFACT_IDENTITY_UNPROVEN';
    held(await f.read({runId:RUN,expectedGoalNumber:2961}),reason);
    assert.equal(f.getDownloads(),0);
  }
});
test('corrupt real ZIP and mismatched declared bytes never nominate goals',async()=>{
  const a=fixture({zip:Buffer.from('corrupted')});
  held(await a.read({runId:RUN,expectedGoalNumber:2961}),'TRUSTED_ARTIFACT_BYTES_UNAVAILABLE');
  const corrupt=Buffer.from(ZIP);corrupt[45]^=1;
  const b=fixture({zip:corrupt});
  held(await b.read({runId:RUN,expectedGoalNumber:2961}),'EXPECTED_ORIGINAL_GOAL_MISMATCH');
});
test('unexpected requested original goal cannot be substituted',async()=>{
  const f=fixture();
  held(await f.read({runId:RUN,expectedGoalNumber:2315}),'EXPECTED_ORIGINAL_GOAL_MISMATCH');
  assert.equal(f.calls.length,4);
});
test('goal closure or PR promotion fails after legitimate ZIP reading',async()=>{
  const a=fixture({goal:{number:2961,state:'closed',comments:253}});
  held(await a.read({runId:RUN,expectedGoalNumber:2961}),'CURRENT_CANONICAL_GOAL_NOT_OPEN');
  const b=fixture({goal:{number:2961,state:'open',pull_request:{}}});
  held(await b.read({runId:RUN,expectedGoalNumber:2961}),'CURRENT_CANONICAL_GOAL_NOT_OPEN');
});
test('protected main moving during GET sequence never allows nomination',async()=>{
  const f=fixture({endHead:'b'.repeat(40)});
  held(await f.read({runId:RUN,expectedGoalNumber:2961}),'MAIN_MOVED_DURING_READBACK');
});
test('stale positive observation is held by unchanged Stage 2 source guard',async()=>{
  const f=fixture({timestamp:'2026-10-29T20:00:00.000Z'});
  held(await f.read({runId:RUN,expectedGoalNumber:2961}),'OBSERVATION_OUTSIDE_FRESH_RUN_WINDOW');
});
test('GitHub network failure, redirection and unbounded JSON do not leak credentials',async()=>{
  const f=fixture({failPath:'/actions/runs/'+RUN});
  const r=await f.read({runId:RUN,expectedGoalNumber:2961});
  held(r,'GITHUB_READBACK_OUTCOME_UNKNOWN');
  assert.equal(JSON.stringify(r).includes('PRIVATE_TOKEN'),false);
  assert.equal(JSON.stringify(r).includes('original-host-only-token'),false);
  const g=fixture({responseStatus:403});
  held(await g.read({runId:RUN,expectedGoalNumber:2961}),'GITHUB_FIXED_GET_UNAVAILABLE');
  const h=fixture({oversizePath:'/git/ref/heads/main'});
  held(await h.read({runId:RUN,expectedGoalNumber:2961}),'GITHUB_RESPONSE_UNBOUNDED');
});
