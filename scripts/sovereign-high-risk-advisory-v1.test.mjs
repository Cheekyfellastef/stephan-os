import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { formatAuthenticatedReviewDiffV1 } from '../shared/agents/sovereignAuthenticatedReviewDiffV1.mjs';
import { prepareSovereignCompleteReviewCandidateV1, COMPLETE_HIGH_RISK_REVIEW_LIMITS_V1 }
  from '../shared/agents/sovereignHighRiskReviewCandidateV1.mjs';
import {
  captureHighRiskAdvisorySnapshotV1 as capture,
  localHighRiskModelV1 as localHighRiskModelActual,
  inspectHighRiskGamingPermissionV1,
  HIGH_RISK_ADVISORY_CRITICAL_SOURCE_PATHS,
  observeHighRiskOllamaDigestV1,
  runSovereignHighRiskAdvisoryV1 as runRaw,
  localCompleteHighRiskModelV1,
  observeCompleteHighRiskOllamaDigestV1,
} from './sovereign-high-risk-advisory-v1.mjs';

// Existing inference fixtures use the reviewed daemon protocol; dedicated
// tests below exercise the production callers without this adapter.
const withSupportedProtocol = generate => async (url, options) => {
  if (url === 'http://127.0.0.1:11434/api/version') {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.body, undefined);
    return new Response('{"version":"0.40.15"}');
  }
  return generate(url, options);
};
const localHighRiskModelV1 = (prompt, chunk, environment, options) => localHighRiskModelActual(
  prompt, chunk, environment, { ...options, fetchImpl: withSupportedProtocol(options.fetchImpl) });

const SHA='a'.repeat(40), BASE='b'.repeat(40), PATH='scripts/battle-bridge-recovery-mesh.mjs';
const canonicalConfig='remote.origin.url\nhttps://github.com/Cheekyfellastef/stephan-os.git\0';
const DIFF='diff --git a/'+PATH+' b/'+PATH+'\nindex aaaaaaa..bbbbbbb 100644\n'+
  '--- a/'+PATH+'\n+++ b/'+PATH+'\n@@ -1 +1 @@\n-old\n+new\n';
const ENV={
  STEPHANOS_REVIEW_EXACT_HEAD:SHA,
  STEPHANOS_REVIEW_EXACT_BASE:BASE,
  STEPHANOS_REVIEW_EXACT_BRANCH:'rescue/lease-observer-20261012',
  STEPHANOS_REVIEW_PR:'3047', STEPHANOS_REVIEW_ISSUE:'1574',
  STEPHANOS_REVIEW_REPOSITORY:'Cheekyfellastef/stephan-os',
  STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER:'github-builder',
  STEPHANOS_REVIEW_IMPLEMENTER_SESSION:'build-a',
  STEPHANOS_REVIEW_SESSION:'local-review-b',
  STEPHANOS_SHARED_AGENT_WORKSPACE:'/tmp/workspace-safe',
};
function fixedSnapshot(){
  return {
    repository:ENV.STEPHANOS_REVIEW_REPOSITORY,issueNumber:1574,prNumber:3047,
    branch:ENV.STEPHANOS_REVIEW_EXACT_BRANCH,
    sourceHead:SHA,baseSha:BASE, changedFiles:[PATH],diff:DIFF,
    reviewedObjectClosureSha256:'c'.repeat(64),
    reviewerSessionId:'local-review-b',implementerSessionId:'build-a',
    implementerProvider:'github-builder',modelClass:'qwen-14b',
  };
}
const clean=(_prompt,c)=>JSON.stringify({
  chunkId:c.chunkId,contentSha256:c.contentSha256,verdict:'clean',findings:[],
});
const modelPin='d'.repeat(64);
const run=options=>runRaw({...options,observeModel:options.observeModel||
  (async()=>({ok:true,digest:modelPin})),
  invokeModel:typeof options.invokeModel==='function'?async(prompt,chunk)=>{
    const response=await options.invokeModel(prompt,chunk);
    return typeof response==='string'?{response,modelDigestSha256:modelPin,
      chunkId:chunk.chunkId,contentSha256:chunk.contentSha256}:response;
  }:options.invokeModel});
test('Windows-safe workspace status is always HELD even after every patch chunk is reviewed',async()=>{
  let published;
  const result=await run({
    env:ENV,now:new Date('2026-10-12T12:00:00.000Z'),root:'/test/repo',
    snapshot:fixedSnapshot,invokeModel:clean,
    publish:async (...args)=>{published=args;return {ok:true}},
  });
  assert.equal(result.status,'HIGH_RISK_LOCAL_CANDIDATE_READY');
  assert.equal(result.publicationOk,true);
  assert.equal(result.specialistAuthority,false);
  assert.equal(result.mergeAuthority,false);
  assert.equal(result.runtimeDeploymentProven,false);
  assert.deepEqual(published[1],['status','sovereign-high-risk-advisory-3047.json']);
  assert.equal(published[2].status,'HELD');
  assert.equal(published[2].highRiskAdvisory.specialistAuthority,false);
  assert.equal(published[2].highRiskAdvisory.independentAttestationProven,false);
  assert.equal(published[2].relatedPr,'#3047');
  assert.equal(published[3].repoRoot,'/test/repo');
});
test('invalid exact head and missing workspace cannot produce valid review or green status',async()=>{
  let published;
  const result=await run({
    env:ENV,root:'/test/repo',
    snapshot:()=>{throw Error('HEAD DRIFT')},
    invokeModel:async()=>{throw Error('must not call')},
    publish:async (...args)=>{published=args;return {ok:false,reason:'UNSAFE_WORKSPACE_PATH'}},
  });
  assert.equal(result.status,'SOVEREIGN_HIGH_RISK_REVIEW_HELD');
  assert.equal(result.publicationOk,false);
  assert.equal(result.publicationReason,'UNSAFE_WORKSPACE_PATH');
  assert.equal(published[2].status,'HELD');
  assert.equal(published[2].highRiskAdvisory.sourceHead,'');
  assert.equal(result.mergeAuthority,false);
});
test('exact-head Git snapshot pins actual executable and high-risk policy bytes',()=>{
  assert.equal(HIGH_RISK_ADVISORY_CRITICAL_SOURCE_PATHS.length,7);
  assert.ok(HIGH_RISK_ADVISORY_CRITICAL_SOURCE_PATHS.includes(
    'shared/agents/sovereignReviewerOllamaBindingV1.mjs'));
  const snapshotOptions=(overrides={})=>{
    let calls=0;
    const captured={root:'/verified/repo',platform:'linux',
      captureDiff:()=>({changedFiles:[PATH],diff:DIFF+'\n',reviewedObjectClosureSha256:'c'.repeat(64)}),
      resolveGit:()=>({executable:'/usr/bin/git',
        fixedConfigArgs:['-c','core.fsmonitor=false'],
        environment:{PATH:'/usr/bin:/bin'}}),
      spawn:(executable,args,options)=>{
        assert.equal(executable,'/usr/bin/git');
        assert.equal(options.shell,false);
        assert.equal(options.env.GIT_EXEC_PATH,undefined);
        assert.ok(args.includes('--git-dir=/verified/repo/.git'));
        assert.ok(args.includes('--work-tree=/verified/repo'));
        calls++;
        const i=args.findIndex(x=>x==='--work-tree=/verified/repo');
        const cmd=args.slice(i+1);
        let stdout='';
        if(cmd[0]==='config')stdout=overrides.configuration??canonicalConfig;
        else if(cmd[0]==='rev-parse'&&cmd[1]==='HEAD')stdout=SHA;
        else if(cmd[0]==='symbolic-ref')stdout=ENV.STEPHANOS_REVIEW_EXACT_BRANCH;
        else if(cmd[0]==='-c'&&cmd[1]==='status.renames=false'&&cmd[2]==='status') {
          stdout=overrides.renameFromRuntimeToSource
            ? 'D  apps/stephanos/dist/tracked.mjs\nA  scripts/introduced.mjs'
            : overrides.renameFromSourceToRuntime
              ? 'D  scripts/original.mjs\nA  apps/stephanos/dist/replaced.mjs'
              : overrides.status||'';
        }
        else if(cmd[0]==='status')throw Error('RENAME_PROTECTION_NOT_APPLIED');
        else if(cmd[0]==='rev-parse'&&cmd[1]==='--verify')stdout=BASE;
        else if(cmd[0]==='ls-files')stdout=(overrides.indexFlag||'H')+' '+cmd.at(-1);
        else if(cmd[0]==='rev-parse'&&cmd[1].startsWith('HEAD:'))
          stdout='d'.repeat(40);
        else if(cmd[0]==='hash-object')
          stdout=overrides.swappedPath===cmd.at(-1)?'e'.repeat(40):'d'.repeat(40);
        else if(cmd[0]==='diff'&&cmd.includes('--name-only'))stdout=PATH;
        else if(cmd[0]==='diff')stdout=DIFF;
        return {status:0,stdout:cmd[0]==='config'?stdout:stdout+'\n'};
      },
    };
    return {captured,getCalls:()=>calls};
  };
  const safe=snapshotOptions();
  const snap=capture({...ENV,GIT_EXEC_PATH:'/attacker',GIT_CONFIG_COUNT:'3'},safe.captured);
  assert.equal(safe.getCalls(),27,'configuration, five identity reads and three for each of seven policy files');
  assert.equal(snap.sourceHead,SHA);
  assert.equal(snap.diff,DIFF+'\n');
  assert.deepEqual(snap.changedFiles,[PATH]);
  const runtimeOnly=snapshotOptions({status:' M stephanos-server/data/memory/durable-memory.json\n?? apps/stephanos/dist/assets/runtime-proof.js'});
  assert.doesNotThrow(()=>capture(ENV,runtimeOnly.captured));
  for(const status of [
    ' M scripts/sovereign-high-risk-advisory-v1.mjs',
    '?? scripts/untracked-reviewer.mjs',
    ' M stephanos-server/data/memory/durable-memory.json\n M scripts/sovereign-high-risk-advisory-v1.mjs',
    '?? apps/stephanos/dist/assets/runtime-proof.js\r\n?? scripts/untracked-reviewer.mjs',
  ]) {
    const dirty=snapshotOptions({status});
    assert.throws(()=>capture(ENV,dirty.captured),/DIRTY_REVIEW_CHECKOUT/);
  }
  for (const fixture of [
    {renameFromRuntimeToSource:true},
    {renameFromSourceToRuntime:true},
  ]) {
    const rename=snapshotOptions(fixture);
    assert.throws(()=>capture(ENV,rename.captured),/DIRTY_REVIEW_CHECKOUT/,
      'staged rename across runtime/source boundary must fail closed');
  }
  for(const indexFlag of ['s','h']) {
    const bad=snapshotOptions({indexFlag});
    assert.throws(()=>capture(ENV,bad.captured),/HIGH_RISK_REVIEWER_INDEX_FLAGS_UNSAFE/);
    assert.equal(bad.getCalls()<27,true);
  }
  for(const swappedPath of HIGH_RISK_ADVISORY_CRITICAL_SOURCE_PATHS) {
    const bad=snapshotOptions({swappedPath});
    assert.throws(()=>capture(ENV,bad.captured),
      /HIGH_RISK_REVIEWER_EXECUTABLE_BYTES_NOT_HEAD/);
  }
  for(const configuration of ['',canonicalConfig+canonicalConfig,
    'remote.origin.url\nhttps://example.invalid/other.git\0',
    canonicalConfig+'filter.fixture.clean\n/tmp/untrusted-helper\0',
    canonicalConfig+'core.fsmonitor\n/tmp/untrusted-monitor\0',
    canonicalConfig+'include.path\n/tmp/untrusted-config\0',
    canonicalConfig+'extensions.worktreeconfig\ntrue\0']) {
    const bad=snapshotOptions({configuration});
    assert.throws(()=>capture(ENV,bad.captured),/HIGH_RISK_REVIEWER_GIT_CONFIGURATION_UNSAFE/);
    assert.equal(bad.getCalls(),1,'configuration refusal precedes status, object and executable reads');
  }
});
test('reader does not call diff after source HEAD changes',()=>{
  let calls=0;
  assert.throws(()=>capture(ENV,{
    root:'/test/repo',platform:'linux',
    resolveGit:()=>({executable:'/usr/bin/git',fixedConfigArgs:[],environment:{}}),
    spawn:(_command,args)=>{calls++;return {status:0,
      stdout:args.includes('config')?canonicalConfig:BASE+'\n'};},
  }),/LOCAL_REVIEW_HEAD_MISMATCH/);
  assert.equal(calls,2);
});
test('blocked local model produces HELD advisory with zero approval authority',async()=>{
  const result=await run({
    env:ENV,root:'/test/repo',snapshot:fixedSnapshot,
    invokeModel:async()=>{throw Error('model offline')},
    publish:async()=>({ok:true}),
  });
  assert.equal(result.status,'SOVEREIGN_HIGH_RISK_REVIEW_HELD');
  assert.equal(result.reason,'LOCAL_MODEL_UNAVAILABLE');
  assert.equal(result.publicationOk,true);
  assert.equal(result.mergeAuthority,false);
});

test('source or principal drift during inference holds candidate even if every chunk is clean',async()=>{
  for (const drift of [
    {sourceHead:'c'.repeat(40)},
    {diff:DIFF+'+changed after review\n'},
    {changedFiles:['scripts/another-worker.mjs']},
    {reviewerSessionId:'another-reviewer'},
  ]) {
    let reads=0, published;
    const result=await run({
      env:ENV,root:'/test/repo',
      snapshot:()=>reads++===0?fixedSnapshot():{...fixedSnapshot(),...drift},
      invokeModel:clean,
      publish:async (...args)=>{published=args;return {ok:true}},
    });
    assert.equal(reads,2);
    assert.equal(result.status,'SOVEREIGN_HIGH_RISK_REVIEW_HELD');
    assert.equal(result.reason,'REVIEW_SOURCE_CHANGED_DURING_INFERENCE');
    assert.equal(result.specialistAuthority,false);
    assert.equal(published[2].status,'HELD');
    assert.equal(published[2].highRiskAdvisory.findingCount,0);
  }
});
test('source readback failure after inference holds rather than publishing stale candidate',async()=>{
  let reads=0;
  const result=await run({
    env:ENV,root:'/test/repo',
    snapshot:()=>{if(reads++===0)return fixedSnapshot();throw Error('git unavailable')},
    invokeModel:clean,publish:async()=>({ok:true}),
  });
  assert.equal(reads,2);
  assert.equal(result.status,'SOVEREIGN_HIGH_RISK_REVIEW_HELD');
  assert.equal(result.reason,'REVIEW_SOURCE_CHANGED_DURING_INFERENCE');
  assert.equal(result.mergeAuthority,false);
});
test('high-risk review uses immutable model digest, gaming guard and releases local GPU residency',async()=>{
  const calls=[],pin='c'.repeat(64),clear=[],checks=[];
  const out=await localHighRiskModelV1('private diff',{},ENV,{
    platform:'linux',
    gamingGuard:()=>{checks.push(true);return {ok:true}},
    modelPin:async()=>({ok:true,digest:pin}),
    startPolling:()=>19,stopPolling:x=>clear.push(x),
    fetchImpl:async(url,opts)=>{calls.push({url,opts});return {ok:true,text:async()=>JSON.stringify({
      model:'sha256:'+pin + ':local',done:true,done_reason:'stop',response:'{"verdict":"clean"}',
    })}},
  });
  assert.equal(out.response,'{"verdict":"clean"}');
  assert.equal(out.modelDigestSha256,pin);
  assert.equal(calls[0].url,'http://127.0.0.1:11434/api/generate');
  assert.equal(calls[0].opts.redirect,'error');
  assert.equal(JSON.parse(calls[0].opts.body).model,'sha256:'+pin + ':local');
  assert.equal(JSON.parse(calls[0].opts.body).keep_alive,0);
  assert.equal(JSON.parse(calls[0].opts.body).prompt,'private diff');
  assert.deepEqual(clear,[19]);assert.equal(checks.length>=3,true);
});
test('model digest observation refuses missing or duplicated untrusted tags',async()=>{
  const pin='b'.repeat(64),model='qwen:14b',calls=[];
  const fetchImpl=async(url,opts)=>{calls.push({url,opts});return {ok:true,text:async()=>JSON.stringify({
    models:[{name:model,digest:pin}],
  })}};
  assert.equal((await observeHighRiskOllamaDigestV1(model,{fetchImpl})).digest,pin);
  assert.equal(calls[0].url,'http://127.0.0.1:11434/api/tags');
  assert.equal(calls[0].opts.redirect,'error');
  for(const models of [[],[{name:model,digest:'wrong'}],
    [{name:model,digest:pin},{model,digest:pin}]]) {
    assert.equal((await observeHighRiskOllamaDigestV1(model,{
      fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify({models})}),
    })).ok,false);
  }
});

test('a whole advisory cannot combine chunks from a changed installed model tag',async()=>{
  let reads=0,calls=0,published;
  const result=await run({env:ENV,root:'/test/repo',snapshot:()=>({...fixedSnapshot(),
    diff:DIFF+'+bounded review line\n'.repeat(700)}),
    observeModel:async()=>({ok:true,digest:++reads===1?modelPin:'e'.repeat(64)}),
    invokeModel:async(p,c)=>{calls++;return clean(p,c)},
    publish:async(...args)=>{published=args;return {ok:true}},
  });
  assert.ok(calls>1);assert.equal(result.status,'SOVEREIGN_HIGH_RISK_REVIEW_HELD');
  assert.equal(result.reviewedChunkCount,0);assert.equal(published[2].highRiskAdvisory.modelDigestSha256,'');
  const pin='c'.repeat(64);
  await assert.rejects(localHighRiskModelV1('private',{
    modelDigestSha256:pin,chunkId:'part',contentSha256:'a'.repeat(64)},ENV,{
    gamingGuard:()=>({ok:true}),modelPin:async()=>({ok:true,digest:'e'.repeat(64)}),
    fetchImpl:async()=>{assert.fail('must not infer with a different whole-review model')},
  }),/REVIEW_MODEL_DIGEST_CHANGED/);
});
test('physical gaming-governor contract denies stale and gaming-active states',()=>{
  const nowMs=Date.parse('2026-10-21T12:00:00Z');
  const idle={schemaVersion:'stephanos.vr-resource-governor.v1',governorVersion:3,
    updatedAtUtc:new Date(nowMs).toISOString(),active:false,flatGameActive:false,
    airLinkActive:false,realAirLinkActive:false,virtualAirLinkTestActive:false,
    prepareLeaseActive:false,localModelAllowed:true,heavyModelAllowed:true,
    ollamaLoadMode:'balanced'};
  const probe=state=>{const raw=JSON.stringify(state);let closed=false;
    const result=inspectHighRiskGamingPermissionV1({
      STEPHANOS_SHARED_AGENT_WORKSPACE:'/tmp/workspace-safe',
    },{platform:'linux',nowMs,openFile:()=>11,readFile:()=>raw,
      statFile:()=>({isFile:()=>true,size:Buffer.byteLength(raw)}),
      closeFile:()=>{closed=true}});
    assert.equal(closed,true);return result};
  assert.equal(probe(idle).ok,true);
  for(const v of [{active:true},{flatGameActive:true},{airLinkActive:true},
    {realAirLinkActive:true},{prepareLeaseActive:true},{heavyModelAllowed:false},
    {localModelAllowed:'true'},{ollamaLoadMode:'cool'},
    {updatedAtUtc:new Date(nowMs-31000).toISOString()}]) {
    assert.equal(probe({...idle,...v}).ok,false);
  }
  assert.equal(inspectHighRiskGamingPermissionV1({}, {platform:'linux'}).ok,false);
});
test('spoofed and truncated model completions never become high-risk review results',async()=>{
  const pin='f'.repeat(64),baseReply={model:'sha256:'+pin + ':local',done:true,
    done_reason:'stop',response:'{"verdict":"clean"}'};
  const settings={platform:'linux',gamingGuard:()=>({ok:true}),
    modelPin:async()=>({ok:true,digest:pin}),
    startPolling:()=>12,stopPolling:()=>{}};
  for(const patch of [{model:'qwen:14b'},{model:'sha256:'+'d'.repeat(64) + ':local'},
    {done:false},{done_reason:'length'},{response:null}]) {
    await assert.rejects(localHighRiskModelV1('private',{},ENV,{
      ...settings,fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify({
        ...baseReply,...patch,
      })}),
    }),/LOCAL_MODEL_COMPLETION_IDENTITY_UNPROVEN/);
  }
  await assert.rejects(localHighRiskModelV1('private',{},ENV,{
    ...settings,fetchImpl:async()=>({ok:false,text:async()=>''}),
  }),/LOCAL_MODEL_REQUEST_FAILED/);
});
test('in-flight VR activation aborts inference and clears polling state',async()=>{
  let game=false,monitor,closed=0;const pin='a'.repeat(64);
  await assert.rejects(localHighRiskModelV1('private',{},ENV,{
    platform:'linux',gamingGuard:()=>({ok:!game}),
    modelPin:async()=>({ok:true,digest:pin}),
    startPolling:fn=>{monitor=fn;return 23},stopPolling:()=>{closed++},
    fetchImpl:async()=>{game=true;monitor();return {ok:true,text:async()=>JSON.stringify({
      model:'sha256:'+pin + ':local',done:true,done_reason:'stop',response:'{"verdict":"clean"}',
    })}},
  }),/HIGH_RISK_GAMING_RESOURCE_PROTECTED/);
  assert.equal(closed,1);
});
test('digest changing before or after inference fails closed',async()=>{
  const pin='a'.repeat(64),bad='b'.repeat(64),settings={
    platform:'linux',gamingGuard:()=>({ok:true}),
    startPolling:()=>12,stopPolling:()=>{}};
  let reads=0,called=false;
  await assert.rejects(localHighRiskModelV1('private',{},ENV,{
    ...settings,modelPin:async()=>({ok:true,digest:++reads===2?bad:pin}),
    fetchImpl:async()=>{called=true;throw Error('should not call')},
  }),/HIGH_RISK_MODEL_DIGEST_CHANGED/);
  assert.equal(called,false);
  reads=0;
  await assert.rejects(localHighRiskModelV1('private',{},ENV,{
    ...settings,modelPin:async()=>({ok:true,digest:++reads===3?bad:pin}),
    fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify({
      model:'sha256:'+pin + ':local',done:true,done_reason:'stop',response:'{"verdict":"clean"}',
    })}),
  }),/HIGH_RISK_MODEL_OR_GAMING_CHANGED_DURING_INFERENCE/);
});

test('production high-risk advisory refuses unsupported protocol before disclosing the diff', async () => {
  const settings={platform:'linux',gamingGuard:()=>({ok:true}),
    modelPin:async()=>({ok:true,digest:'a'.repeat(64)}),
    startPolling:()=>1,stopPolling:()=>{}};
  for(const version of ['0.35.1','0.40.0-rc.1','0.41.0']) {
    const calls=[];
    await assert.rejects(localHighRiskModelActual('private diff',{},ENV,{
      ...settings,fetchImpl:async(url,options)=>{
        calls.push({url,options});return new Response(JSON.stringify({version}));
      },
    }),/LOCAL_OLLAMA_DIGEST_PROTOCOL_UNSUPPORTED/);
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,'http://127.0.0.1:11434/api/version');
    assert.equal(calls[0].options.body,undefined);
  }
});

test('high-risk advisory rejects remote metadata with an echoed local digest selector', async () => {
  const digest='a'.repeat(64),selector='sha256:'+digest+':local';
  for(const patch of [{remote_host:''},{remote_model:'remote'},{model:'sha256:'+digest}]) {
    await assert.rejects(localHighRiskModelActual('private diff',{},ENV,{
      platform:'linux',gamingGuard:()=>({ok:true}),modelPin:async()=>({ok:true,digest}),
      startPolling:()=>1,stopPolling:()=>{},
      fetchImpl:withSupportedProtocol(async()=>({ok:true,text:async()=>JSON.stringify({
        model:selector,done:true,done_reason:'stop',response:'{}',...patch,
      })})),
    }),/LOCAL_MODEL_COMPLETION_IDENTITY_UNPROVEN/);
  }
});

test('high-risk runner preserves fixed protocol refusals and suppresses arbitrary provider errors', async () => {
  const ready={platform:'linux',gamingGuard:()=>({ok:true}),
    modelPin:async()=>({ok:true,digest:modelPin}),startPolling:()=>1,stopPolling:()=>{}};
  for(const [fetchImpl,reason] of [
    [async()=>new Response('{"version":"0.35.1"}'),'LOCAL_OLLAMA_DIGEST_PROTOCOL_UNSUPPORTED'],
    [async()=>new Response('{}',{status:503}),'LOCAL_OLLAMA_DIGEST_PROTOCOL_UNPROVEN'],
    [null,'LOCAL_MODEL_UNAVAILABLE'],
  ]) {
    let published;
    const result=await run({env:ENV,root:'/test/repo',snapshot:fixedSnapshot,
      invokeModel:fetchImpl
        ? (prompt,chunk)=>localHighRiskModelActual(prompt,chunk,ENV,{...ready,fetchImpl})
        : async()=>{throw new Error('private provider error payload')},
      publish:async(_root,_path,value)=>{published=value;return {ok:true}},
    });
    assert.equal(result.status,'SOVEREIGN_HIGH_RISK_REVIEW_HELD');
    assert.equal(result.reason,reason);
    assert.equal(published.highRiskAdvisory.reason,reason);
    assert.equal(result.mergeAuthority,false);
    assert.equal(result.specialistAuthority,false);
    assert.equal(JSON.stringify(result).includes('private provider error payload'),false);
  }
});

function completeSnapshot(contents={
  'shared/agents/producer.mjs':'export const threshold = 1000;\n',
  'shared/agents/consumer.mjs':'import { threshold } from "./producer.mjs";\nacceptMilliseconds(threshold);\n',
}) {
  const blobs=new Map(),after=new Map();
  for(const [path,content]of Object.entries(contents)){
    const bytes=Buffer.from(content),sha=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
    blobs.set(sha,bytes);after.set(path,{mode:'100644',sha});
  }
  const rendered=formatAuthenticatedReviewDiffV1({base:BASE,head:SHA,before:new Map(),after,blobs,
    authenticatedObjectIds:['commit:'+BASE,'commit:'+SHA,'tree:'+'e'.repeat(40),
      ...[...blobs.keys()].map(value=>'blob:'+value)]});
  return {...fixedSnapshot(),...rendered,baseTree:'e'.repeat(40),sourceTree:'f'.repeat(40)};
}
function apiResponse(url,body,options={}) {
  const response=new Response(typeof body==='string'?body:JSON.stringify(body),options);
  Object.defineProperty(response,'url',{value:url});return response;
}
function completeApi(packet,overrides={}) {
  const calls=[],state={tags:0,ps:0,generationStarted:false};
  const response=JSON.stringify({reviewId:packet.reviewId,fullDiffSha256:packet.fullDiffSha256,
    reviewedPathsSha256:packet.reviewedPathsSha256,verdict:'clean',findings:[]});
  const selector='sha256:'+modelPin+':local';
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    assert.equal(options.redirect,'error');assert(options.signal instanceof AbortSignal);
    if(overrides.any){const alternate=await overrides.any(url,options,state);if(alternate)return alternate;}
    if(url.endsWith('/api/tags')){
      state.tags++;return apiResponse(url,{models:[{name:'qwen:14b',digest:overrides.digest?.(state)||modelPin}]});
    }
    if(url.endsWith('/api/version'))return apiResponse(url,{version:overrides.version||'0.40.0'});
    if(url.endsWith('/api/show')){
      assert.deepEqual(JSON.parse(options.body),{model:selector});
      return apiResponse(url,overrides.info||{capabilities:['completion'],model_info:{
        'general.architecture':'qwen2','qwen2.context_length':131072}});
    }
    if(url.endsWith('/api/ps')){
      state.ps++;
      const models=overrides.models?overrides.models(state):state.generationStarted
        ?[{digest:modelPin,context_length:8192}]:[];
      return apiResponse(url,{models});
    }
    if(url.endsWith('/api/generate')){
      state.generationStarted=true;
      const request=JSON.parse(options.body);
      assert.equal(request.prompt,packet.prompt);assert.equal(request.model,selector);
      assert.equal(request.raw,true);assert.equal(request.truncate,false);assert.equal(request.shift,false);
      assert.equal(request.keep_alive,0);assert.equal(request.stream,false);
      assert.deepEqual(request.options,{temperature:0,num_ctx:8192,num_predict:2048});
      if(overrides.generate)return overrides.generate(url,options,state,response);
      return apiResponse(url,{model:selector,done:true,done_reason:'stop',response,
        prompt_eval_count:Math.ceil(packet.promptBytes/3),eval_count:120,...overrides.reply});
    }
    assert.fail('unregistered transport '+url);
  };
  return {fetchImpl,calls,state,response};
}
function completeSettings(api,overrides={}) {
  let poll,stopped=0;
  return {options:{fetchImpl:api.fetchImpl,platform:'win32',gamingGuard:(_env,options)=>{
    assert.equal(options.platform,'win32');return {ok:true};},
    startPolling:(callback,interval)=>{assert.equal(interval,500);poll=callback;return 71;},
    stopPolling:id=>{assert.equal(id,71);stopped++;},...overrides},
    poll:()=>poll?.(),stopped:()=>stopped};
}
const completePacket=snapshot=>({...prepareSovereignCompleteReviewCandidateV1(snapshot),modelDigestSha256:modelPin});

test('complete production transport sends one full prompt with enforced no-truncation and actual 8K context readback',async()=>{
  const packet=completePacket(completeSnapshot()),api=completeApi(packet),settings=completeSettings(api);
  const result=await localCompleteHighRiskModelV1(packet.prompt,packet,{...ENV,
    OLLAMA_HOST:'https://untrusted.invalid',STEPHANOS_REVIEW_CONTEXT:'1048576',
    STEPHANOS_REVIEW_RESIDENT_CONTEXT_APPROVED:'true'},settings.options);
  assert.equal(result.reviewId,packet.reviewId);assert.equal(result.response,api.response);
  assert.equal(result.executionObservation.contextTokens,8192);
  assert.equal(result.executionObservation.observedContextTokens,8192);
  assert.equal(result.executionObservation.contextAdmission,'FIXED_8K_BASELINE');
  assert.equal(result.executionObservation.residencyCustodyObserved,false);
  assert.equal(result.executionObservation.actualPromptTokens,Math.ceil(packet.promptBytes/3));
  assert(result.executionObservation.gamingCheckCount>=2);
  assert.equal(result.executionObservation.gamingInterruptedCount,0);assert.equal(settings.stopped(),1);
  assert.equal(api.calls.filter(row=>row.url.endsWith('/api/generate')).length,1);
  assert(api.calls.every(row=>row.url.startsWith('http://127.0.0.1:11434/api/')));
});

test('installed complete-mode runner preserves full source bindings and emits only bounded observations',async()=>{
  const snapshot=completeSnapshot(),packet=completePacket(snapshot),api=completeApi(packet),settings=completeSettings(api);
  let reads=0,published;
  const result=await runRaw({env:ENV,root:'/test/repo',reviewMode:'complete-diff',
    snapshot:()=>{reads++;return snapshot;},
    observeModel:(model,options)=>observeCompleteHighRiskOllamaDigestV1(model,{...options,fetchImpl:api.fetchImpl}),
    invokeModel:()=>assert.fail('complete mode cannot substitute the legacy chunk engine'),
    invokeCompleteModel:(prompt,review,options)=>localCompleteHighRiskModelV1(prompt,review,ENV,{...settings.options,...options}),
    publish:async(_root,_segments,record)=>{published=record;return {ok:true};},
  });
  assert.equal(reads,2);assert.equal(result.status,'HIGH_RISK_LOCAL_CANDIDATE_READY');
  assert.equal(result.reviewMode,'complete-diff');assert.equal(result.completeCrossFileReviewObserved,true);
  assert.equal(result.reviewedDiffBytes,snapshot.fullDiffBytes);assert.equal(result.reviewedPathCount,2);
  assert.equal(result.reviewedChunkCount,0);assert.equal(result.specialistAuthority,false);
  assert.equal(result.mergeAuthority,false);assert.equal(result.publicationOk,true);
  assert.equal(published.status,'HELD');assert.equal(published.highRiskAdvisory.completeCrossFileReviewObserved,true);
  assert.equal(published.highRiskAdvisory.independentAttestationProven,false);
  assert.equal(JSON.stringify(result).includes(snapshot.diff),false);
  assert.equal(JSON.stringify(published).includes(snapshot.diff),false);
  assert(Buffer.byteLength(JSON.stringify(result))<65536);
});

test('full source metadata and after-inference source changes cannot be replaced by clean model prose',async()=>{
  const snapshot=completeSnapshot(),packet=completePacket(snapshot);
  for(const patch of [{baseTree:'0'.repeat(40)},{sourceTree:'1'.repeat(40)},
    {sourceEvidence:snapshot.sourceEvidence.map((row,i)=>i?row:{...row,newContentSha256:'0'.repeat(64)})},
    {fullDiffBytes:snapshot.fullDiffBytes+1}]){
    const api=completeApi(packet),settings=completeSettings(api);let reads=0;
    const result=await runRaw({env:ENV,root:'/test/repo',reviewMode:'complete-diff',
      snapshot:()=>reads++===0?snapshot:{...snapshot,...patch},
      observeModel:(model,options)=>observeCompleteHighRiskOllamaDigestV1(model,{...options,fetchImpl:api.fetchImpl}),
      invokeCompleteModel:(prompt,review,options)=>localCompleteHighRiskModelV1(prompt,review,ENV,{...settings.options,...options}),
      publish:async()=>({ok:true}),
    });
    assert.equal(result.reason,'REVIEW_SOURCE_CHANGED_DURING_INFERENCE');
    assert.equal(result.completeCrossFileReviewObserved,false);assert.equal(result.completeReviewExecution,null);
    assert.equal(result.reviewedDiffBytes,0);
  }
});

test('a 435KB complete prompt never cold-loads or trusts a purported resident large-context caller flag',async()=>{
  const snapshot=completeSnapshot({'scripts/starfield.mjs':'// complete bounded line\n'.repeat(19000)});
  const packet=completePacket(snapshot);assert(packet.promptBytes>435000);let called=0;
  await assert.rejects(localCompleteHighRiskModelV1(packet.prompt,{
    ...packet,residentContextApproved:true,contextTokens:524288,
  },{...ENV,STEPHANOS_REVIEW_RESIDENT_CONTEXT_APPROVED:'true'},{
    gamingGuard:()=>({ok:true}),fetchImpl:()=>{called++;assert.fail('large allocation must not be attempted');},
  }),/COMPLETE_REVIEW_LARGE_CONTEXT_CUSTODY_UNPROVEN/);
  assert.equal(called,0);
});

test('unknown Ollama feature protocols never receive a full source prompt',async()=>{
  const packet=completePacket(completeSnapshot());
  for(const version of ['0.39.9','0.40.0-rc.1','0.41.0','unknown']){
    const api=completeApi(packet,{version}),settings=completeSettings(api);
    await assert.rejects(localCompleteHighRiskModelV1(packet.prompt,packet,ENV,settings.options),
      /LOCAL_OLLAMA_DIGEST_PROTOCOL_UNSUPPORTED/);
    assert.equal(api.calls.some(row=>row.url.endsWith('/api/generate')),false);
    assert.equal(settings.stopped(),1);
  }
});

test('full inference holds for inadequate model capability, wrong running context and ambiguous resident digest',async()=>{
  const packet=completePacket(completeSnapshot());
  for(const config of [
    {info:{capabilities:['completion'],model_info:{'general.architecture':'qwen2','qwen2.context_length':4096}}},
    {info:{capabilities:['completion'],model_info:{'qwen2.context_length':8192}}},
    {models:state=>state.generationStarted?[{digest:modelPin,context_length:4096}]:[]},
    {models:()=>[{digest:modelPin,context_length:8192},{digest:modelPin,context_length:8192}]},
    {models:()=>[]},
  ]){
    const api=completeApi(packet,config),settings=completeSettings(api);
    await assert.rejects(localCompleteHighRiskModelV1(packet.prompt,packet,ENV,settings.options),
      /COMPLETE_REVIEW_(MODEL_CONTEXT_UNPROVEN|RUNNING_CONTEXT_CHANGED|RUNNING_CONTEXT_AMBIGUOUS|RUNNING_CONTEXT_UNPROVEN)/);
    assert.equal(settings.stopped(),1);
  }
});

test('full inference rejects truncated, remote, aliased or unmeasured model completion',async()=>{
  const packet=completePacket(completeSnapshot());
  for(const reply of [{done_reason:'length'},{done:false},{model:'qwen:14b'},{remote_host:''},
    {context:[]},{debug_info:{}},{prompt_eval_count:undefined},{prompt_eval_count:packet.promptBytes+1},
    {eval_count:undefined},{eval_count:2049},{response:'x'.repeat(12289)}]){
    const api=completeApi(packet,{reply}),settings=completeSettings(api);
    await assert.rejects(localCompleteHighRiskModelV1(packet.prompt,packet,ENV,settings.options),
      /COMPLETE_REVIEW_COMPLETION_UNPROVEN/);
  }
});

test('full inference model drift before or after generation cannot retain a complete candidate',async()=>{
  const packet=completePacket(completeSnapshot());
  for(const changeAt of [2,3]){
    const api=completeApi(packet,{digest:state=>state.tags===changeAt?'e'.repeat(64):modelPin});
    const settings=completeSettings(api);
    await assert.rejects(localCompleteHighRiskModelV1(packet.prompt,packet,ENV,settings.options),
      /COMPLETE_REVIEW_MODEL_DIGEST_CHANGED/);
    assert.equal(api.calls.filter(row=>row.url.endsWith('/api/generate')).length,changeAt===2?0:1);
  }
});

test('full inference cancels active generation when the actual gaming adapter refuses',async()=>{
  const packet=completePacket(completeSnapshot());let game=false,settings;
  const api=completeApi(packet,{generate:async(url,_options,_state,response)=>{
    game=true;settings.poll();return apiResponse(url,{model:'sha256:'+modelPin+':local',done:true,
      done_reason:'stop',response,prompt_eval_count:100,eval_count:100});
  }});
  settings=completeSettings(api,{gamingGuard:()=>({ok:!game})});
  await assert.rejects(localCompleteHighRiskModelV1(packet.prompt,packet,ENV,settings.options),
    /HIGH_RISK_GAMING_RESOURCE_PROTECTED/);
  assert.equal(settings.stopped(),1);
});

test('streaming byte limits refuse overflowing and compressed responses before retaining output',async()=>{
  const packet=completePacket(completeSnapshot());
  for(const encoding of ['', 'gzip']){
    let cancelled=0;
    const api=completeApi(packet,{generate:async url=>{
      const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(65537));},
        cancel(){cancelled++;}});
      const response=new Response(stream,{headers:encoding?{'content-encoding':encoding,'content-length':'50'}:{}});
      Object.defineProperty(response,'url',{value:url});return response;
    }}),settings=completeSettings(api);
    await assert.rejects(localCompleteHighRiskModelV1(packet.prompt,packet,ENV,settings.options),
      /COMPLETE_REVIEW_RESPONSE_UNBOUNDED/);
    assert.equal(cancelled,1);assert.equal(settings.stopped(),1);
  }
});

test('the aggregate abort covers stalled metadata headers and streamed generation bodies',async()=>{
  const packet=completePacket(completeSnapshot());
  for(const stage of ['headers','body']){
    const controller=new AbortController();let cancelled=0;
    const api=completeApi(packet,{any:stage==='headers'?async url=>{
      if(!url.endsWith('/api/show'))return null;
      queueMicrotask(()=>controller.abort());return new Promise(()=>{});
    }:undefined,generate:stage==='body'?async url=>{
      const response=new Response(new ReadableStream({start(){queueMicrotask(()=>controller.abort());},
        cancel(){cancelled++;}}));Object.defineProperty(response,'url',{value:url});return response;
    }:undefined}),settings=completeSettings(api,{signal:controller.signal});
    await assert.rejects(localCompleteHighRiskModelV1(packet.prompt,packet,ENV,settings.options),
      /COMPLETE_REVIEW_AGGREGATE_DEADLINE/);
    assert.equal(settings.stopped(),1);
    if(stage==='body')assert.equal(cancelled,1);
  }
});
