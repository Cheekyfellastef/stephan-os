import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import {
  MAILBOX_FREE_GITHUB_READER_SCHEMA,
  readMailboxFreeGoalEvidenceFromGitHubV1 as read,
  readMailboxFreeGitHubJsonV1,
} from './mailboxFreeGitHubEvidenceReaderV1.mjs';

const RUN = 40573665291;
const HEAD = 'a'.repeat(40);
const REPO = 'Cheekyfellastef/stephan-os';
const API = 'https://api.github.com/repos/' + REPO;
const SIGNED = 'https://safe.actions.githubusercontent.com/bounded-signed-zip';
const NOW = '2026-10-27T21:51:00.000Z';
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let j=0;j<8;j++) c=(c>>>1)^(c&1?0xedb88320:0);
  }
  return (c^0xffffffff)>>>0;
}
function zipProof(value) {
  const raw=Buffer.from(JSON.stringify(value));
  const body=deflateRawSync(raw);
  const name=Buffer.from('stephanos-mailbox-free-readonly-proof.json');
  const h=Buffer.alloc(30),cd=Buffer.alloc(46),end=Buffer.alloc(22);
  h.writeUInt32LE(0x04034b50,0);
  h.writeUInt16LE(20,4);
  h.writeUInt16LE(8,8);
  h.writeUInt32LE(crc32(raw),14);
  h.writeUInt32LE(body.length,18);
  h.writeUInt32LE(raw.length,22);
  h.writeUInt16LE(name.length,26);
  const off=h.length+name.length+body.length;
  cd.writeUInt32LE(0x02014b50,0);
  cd.writeUInt16LE(20,4);cd.writeUInt16LE(20,6);cd.writeUInt16LE(8,10);
  cd.writeUInt32LE(crc32(raw),16);
  cd.writeUInt32LE(body.length,20);
  cd.writeUInt32LE(raw.length,24);
  cd.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50,0);
  end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);
  end.writeUInt32LE(cd.length+name.length,12);
  end.writeUInt32LE(off,16);
  return Buffer.concat([h,name,body,cd,name,end]);
}
function proof() {
  return {
    schemaVersion:'stephanos.mailbox-free-dispatch-readonly.v1',
    verdict:'READ_ONLY_OBSERVED', mode:'READ_GOAL_STATUS',
    requestId:'actions-run-'+RUN+'-1',runId:RUN,runAttempt:1,
    goalNumber:2961,goalState:'OPEN',goalCommentCount:253,
    sourceHead:HEAD,observedAtUtc:'2026-10-27T21:50:13.553Z',
    goalUrl:'https://github.com/'+REPO+'/issues/2961',
    runUrl:'https://github.com/'+REPO+'/actions/runs/'+RUN,
    independentVerificationPerformed:false,executionAuthorized:false,
    nativePickupProven:false,sourceMutationAllowed:false,
    protectedMergeAllowed:false,
    nextGate:'EXISTING_GOAL_OWNER_ADMISSION_AND_INDEPENDENT_REVIEW',
  };
}
function fixture() {
  const zip=zipProof(proof());
  return {
    main:{ref:'refs/heads/main',object:{sha:HEAD}},
    run:{id:RUN,name:'Stephanos Control Tower - Mailbox-Free Read-Only Pilot',
      workflow_id:398609082,path:'.github/workflows/stephanos-mailbox-free-readonly.yml',
      event:'workflow_dispatch',run_attempt:1,status:'completed',conclusion:'success',
      head_branch:'main',head_sha:HEAD,
      repository:{full_name:REPO,id:1179385578},
      actor:{login:'Cheekyfellastef',id:267490109},
      triggering_actor:{login:'Cheekyfellastef'},
      created_at:'2026-10-27T21:50:03Z',updated_at:'2026-10-27T21:50:18Z'},
    jobs:{total_count:2,jobs:[
      {id:122434245550,name:'inspect-goal',run_id:RUN,status:'completed',conclusion:'success'},
      {id:122434248382,name:'contract-test',run_id:RUN,status:'completed',conclusion:'skipped'},
    ]},
    artifacts:{total_count:1,artifacts:[{
      id:12765876671,name:'stephanos-mailbox-free-readonly-'+RUN,
      expired:false,size_in_bytes:zip.length,digest:sha(zip),
      workflow_run:{id:RUN,repository_id:1179385578,head_repository_id:1179385578,head_branch:'main',head_sha:HEAD},
    }]},
    zip,goal:{number:2961,state:'open',comments:253},
    redirect:SIGNED,secondMain:null,
  };
}
function stub(data=fixture()) {
  const calls=[];
  let mains=0;
  const fetchImpl=async(url, init)=>{
    calls.push({url,init});
    if(url===API+'/git/ref/heads/main') {
      const value=++mains===2&&data.secondMain?data.secondMain:data.main;
      return new Response(JSON.stringify(value),{status:200});
    }
    if(url===API+'/actions/runs/'+RUN) return new Response(JSON.stringify(data.run),{status:200});
    if(url===API+'/actions/runs/'+RUN+'/jobs?per_page=100') return new Response(JSON.stringify(data.jobs),{status:200});
    if(url===API+'/actions/runs/'+RUN+'/artifacts?per_page=100') return new Response(JSON.stringify(data.artifacts),{status:200});
    if(url===API+'/actions/artifacts/12765876671/zip') return new Response(null,{status:302,headers:{location:data.redirect}});
    if(url===data.redirect) return new Response(data.zip,{status:200});
    if(url===API+'/issues/2961') return new Response(JSON.stringify(data.goal),{status:200});
    throw Error('Unexpected external URL '+url);
  };
  return {fetchImpl,calls,data};
}
const request=(f, rest={})=>read({runId:RUN,token:'fake-test-only-read-token',nowUtc:NOW,fetchImpl:f.fetchImpl,...rest});
async function denied(f,code) {
  const v=await request(f);
  assert.equal(v.schemaVersion,MAILBOX_FREE_GITHUB_READER_SCHEMA);
  assert.equal(v.disposition,'HELD');
  assert.equal(v.blocker,code);
  assert.equal(v.executionAuthorized,false);
  assert.equal(v.sourceMutationAllowed,false);
  assert.equal(v.nativePickupProven,false);
}
test('end to end fixed GitHub GET + one authenticated ZIP is discovery-only', async()=>{
  const f=stub(),v=await request(f);
  assert.equal(v.disposition,'DISCOVERY_CANDIDATE_ONLY');
  assert.equal(v.goalNumber,2961);
  assert.equal(v.runId,RUN);
  assert.equal(v.sourceHead,HEAD);
  assert.equal(v.provenance,'FIXED_GITHUB_GET_AND_BOUNDED_ARTIFACT_ONLY');
  for(const flag of ['independentlyAuthenticatedTransport','originalGoalAdmissionGranted',
    'exclusiveClaimGranted','executionAuthorized','nativePickupProven',
    'sourceMutationAllowed','protectedMergeAllowed']) assert.equal(v[flag],false);
  assert.equal(Object.isFrozen(v),true);
  assert.equal(f.calls.length,8);
  assert.ok(f.calls.every(x=>x.init.method==='GET'));
  assert.ok(f.calls.every(x=>x.init.redirect==='error'||x.init.redirect==='manual'));
  assert.equal(f.calls.filter(x=>x.url===API+'/git/ref/heads/main').length,2);
  const zipCall=f.calls.find(x=>x.url===SIGNED);
  assert.ok(zipCall);
  assert.equal(zipCall.init.headers.Authorization,undefined);
  assert.ok(f.calls.filter(x=>x.url.startsWith(API)).every(x=>x.init.headers.Authorization==='Bearer fake-test-only-read-token'));
  assert.equal(JSON.stringify(v).includes('fake-test-only-read-token'),false);
});
test('reject untrusted run identity before fetching the archive',async()=>{
  for(const patch of [{actor:{login:'Cheekyfellastef',id:1}},
    {repository:{full_name:REPO,id:1}},{event:'pull_request'},
    {run_attempt:2},{head_branch:'not-main'}, {conclusion:'failure'}]) {
    const f=stub();Object.assign(f.data.run,patch);
    await denied(f,'RUN_NOT_CURRENT_OWNER_MAIN');
    assert.equal(f.calls.some(x=>x.url.includes('/actions/artifacts/')),false);
  }
});
test('historical run on old SHA does not become current discovery',async()=>{
  const f=stub();
  f.data.main={ref:'refs/heads/main',object:{sha:'b'.repeat(40)}};
  await denied(f,'RUN_NOT_CURRENT_OWNER_MAIN');
});
test('a run and owner ID cannot be supplied by a goal issue or arbitrary input',async()=>{
  const f=stub();
  assert.equal((await read({runId:0,token:'fake',fetchImpl:f.fetchImpl})).blocker,'RUN_ID_INVALID');
  assert.equal((await read({runId:RUN,fetchImpl:f.fetchImpl})).blocker,'TRUSTED_READ_CREDENTIAL_UNAVAILABLE');
  assert.equal(f.calls.length,0);
});
test('no partial job estate or extra workflow jobs can qualify',async()=>{
  for(const mutation of [
    f=>{f.data.jobs.total_count=3;},
    f=>{f.data.jobs.jobs[0].conclusion='failure';},
    f=>{f.data.jobs.jobs[1].name='source-writer';},
  ]) {
    const f=stub();mutation(f);
    await denied(f,mutation.toString().includes('total_count')?'TERMINAL_JOB_ESTATE_INCOMPLETE':'EXACT_TERMINAL_INSPECTION_JOB_UNPROVEN');
  }
});
test('no artifact inventory substitution, extra archive or wrong provenance',async()=>{
  const a=stub();a.data.artifacts.total_count=2;
  await denied(a,'ARTIFACT_ESTATE_INCOMPLETE');
  const b=stub();b.data.artifacts.artifacts[0].workflow_run.repository_id=12;
  await denied(b,'ARTIFACT_IDENTITY_UNPROVEN');
  const c=stub();c.data.artifacts.artifacts[0].name='other';
  await denied(c,'ARTIFACT_IDENTITY_UNPROVEN');
});
test('artifact signed redirect must be allowlisted HTTPS and never receive the token',async()=>{
  const a=stub();a.data.redirect='https://attacker.invalid/evil';
  await denied(a,'AUTHENTICATED_READ_OR_ARTIFACT_FAILED');
  assert.equal(a.calls.some(x=>x.url==='https://attacker.invalid/evil'),false);
  const b=stub();b.data.redirect='http://safe.actions.githubusercontent.com/a';
  await denied(b,'AUTHENTICATED_READ_OR_ARTIFACT_FAILED');
});
test('ZIP bytes and digest are independently checked by the existing exact classifier',async()=>{
  const a=stub();a.data.artifacts.artifacts[0].digest='sha256:'+'f'.repeat(64);
  await denied(a,'IMMUTABLE_ARTIFACT_IDENTITY_OR_SHA256_INVALID');
  const b=stub();b.data.zip=Buffer.from('not a zip');
  await denied(b,'GOAL_PROOF_UNREADABLE');
});
test('current main moving after awaited artifact and goal reads fails closed',async()=>{
  const a=stub();a.data.secondMain={ref:'refs/heads/main',object:{sha:'b'.repeat(40)}};
  await denied(a,'PROTECTED_MAIN_MOVED_DURING_READBACK');
});
test('a task may not promote prior observation booleans into source authority',async()=>{
  const f=stub();
  f.data.zip=zipProof({...proof(),executionAuthorized:true});
  f.data.artifacts.artifacts[0].size_in_bytes=f.data.zip.length;
  f.data.artifacts.artifacts[0].digest=sha(f.data.zip);
  await denied(f,'READ_ONLY_GOAL_PROOF_SCOPE_INVALID');
});
test('closed, changed or PR goal cannot be nominated',async()=>{
  const a=stub();a.data.goal.state='closed';
  await denied(a,'CURRENT_CANONICAL_GOAL_NOT_OPEN');
  const b=stub();b.data.goal.pull_request={};
  await denied(b,'CURRENT_CANONICAL_GOAL_NOT_OPEN');
});
test('stale proof and poisoned host clock fail closed',async()=>{
  const a=stub();
  const v=await request(a,{nowUtc:'2026-10-29T21:51:00.000Z'});
  assert.equal(v.disposition,'HELD');
  assert.equal(v.blocker,'OBSERVATION_OUTSIDE_FRESH_RUN_WINDOW');
  const b=stub();
  assert.equal((await request(b,{nowUtc:'bad clock'})).blocker,'READER_ENVIRONMENT_INVALID');
});
test('incomplete API response or an HTTP error holds without leaking input credentials',async()=>{
  const f=stub(),orig=f.fetchImpl;
  f.fetchImpl=async(url,opt)=>url.endsWith('/jobs?per_page=100')
    ? new Response(JSON.stringify({error:'no jobs'}),{status:403})
    : orig(url,opt);
  const v=await request(f);
  assert.equal(v.blocker,'AUTHENTICATED_READ_OR_ARTIFACT_FAILED');
  assert.equal(JSON.stringify(v).includes('fake-test-only-read-token'),false);
});
test('response size guard refuses huge metadata',async()=>{
  const f=stub(),orig=f.fetchImpl;
  f.fetchImpl=async(url,opt)=>url.endsWith('/jobs?per_page=100')
    ? new Response('x'.repeat(270000),{status:200,headers:{'content-length':'270000'}})
    : orig(url,opt);
  await denied(f,'AUTHENTICATED_READ_OR_ARTIFACT_FAILED');
});

test('Control Tower dual-event inventory is one exact allowlisted GET, not general workflow access', async () => {
  let requests = 0;
  const current = '/actions/workflows/stephanos-control-tower-build.yml/runs?per_page=10&head_sha=' + HEAD;
  const oldManual = '/actions/workflows/stephanos-control-tower-build.yml/runs?event=workflow_dispatch&per_page=5&head_sha=' + HEAD;
  const fetchImpl = async (url, init) => {
    requests += 1;
    assert.ok(url === API + current || url === API + oldManual);
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer test-read-only');
    return Response.json({ workflow_runs: [], total_count: 0 });
  };
  for (const path of [current, oldManual]) {
    const observed = await readMailboxFreeGitHubJsonV1(fetchImpl, path, 'test-read-only');
    assert.deepEqual(observed.workflow_runs, []);
  }
  assert.equal(requests, 2);
  for (const bad of [
    current.replace('per_page=10', 'per_page=100'),
    current.replace('head_sha=' + HEAD, 'head_sha=main'),
    current + '&event=pull_request',
    current.replace('stephanos-control-tower-build.yml', 'foreign.yml'),
    current.replace('runs?', 'dispatches?'),
    current.replace('head_sha=' + HEAD, 'head_sha=' + 'A'.repeat(40)),
  ]) {
    await assert.rejects(() => readMailboxFreeGitHubJsonV1(fetchImpl, bad, 'test-read-only'), /NONCANONICAL_GET/);
  }
  assert.equal(requests, 2);
});
