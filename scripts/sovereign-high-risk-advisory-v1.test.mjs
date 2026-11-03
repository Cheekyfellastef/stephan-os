import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureHighRiskAdvisorySnapshotV1 as capture,
  localHighRiskModelV1,
  inspectHighRiskGamingPermissionV1,
  HIGH_RISK_ADVISORY_CRITICAL_SOURCE_PATHS,
  observeHighRiskOllamaDigestV1,
  runSovereignHighRiskAdvisoryV1 as runRaw,
} from './sovereign-high-risk-advisory-v1.mjs';

const SHA='a'.repeat(40), BASE='b'.repeat(40), PATH='scripts/battle-bridge-recovery-mesh.mjs';
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
  assert.equal(HIGH_RISK_ADVISORY_CRITICAL_SOURCE_PATHS.length,6);
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
        if(cmd[0]==='rev-parse'&&cmd[1]==='HEAD')stdout=SHA;
        else if(cmd[0]==='symbolic-ref')stdout=ENV.STEPHANOS_REVIEW_EXACT_BRANCH;
        else if(cmd[0]==='status')stdout='';
        else if(cmd[0]==='rev-parse'&&cmd[1]==='--verify')stdout=BASE;
        else if(cmd[0]==='ls-files')stdout=(overrides.indexFlag||'H')+' '+cmd.at(-1);
        else if(cmd[0]==='rev-parse'&&cmd[1].startsWith('HEAD:'))
          stdout='d'.repeat(40);
        else if(cmd[0]==='hash-object')
          stdout=overrides.swappedPath===cmd.at(-1)?'e'.repeat(40):'d'.repeat(40);
        else if(cmd[0]==='diff'&&cmd.includes('--name-only'))stdout=PATH;
        else if(cmd[0]==='diff')stdout=DIFF;
        return {status:0,stdout:stdout+'\n'};
      },
    };
    return {captured,getCalls:()=>calls};
  };
  const safe=snapshotOptions();
  const snap=capture({...ENV,GIT_EXEC_PATH:'/attacker',GIT_CONFIG_COUNT:'3'},safe.captured);
  assert.equal(safe.getCalls(),23,'five identity reads and three for each of six policy files');
  assert.equal(snap.sourceHead,SHA);
  assert.equal(snap.diff,DIFF+'\n');
  assert.deepEqual(snap.changedFiles,[PATH]);
  for(const indexFlag of ['s','h']) {
    const bad=snapshotOptions({indexFlag});
    assert.throws(()=>capture(ENV,bad.captured),/HIGH_RISK_REVIEWER_INDEX_FLAGS_UNSAFE/);
    assert.equal(bad.getCalls()<23,true);
  }
  for(const swappedPath of HIGH_RISK_ADVISORY_CRITICAL_SOURCE_PATHS) {
    const bad=snapshotOptions({swappedPath});
    assert.throws(()=>capture(ENV,bad.captured),
      /HIGH_RISK_REVIEWER_EXECUTABLE_BYTES_NOT_HEAD/);
  }
});
test('reader does not call diff after source HEAD changes',()=>{
  let calls=0;
  assert.throws(()=>capture(ENV,{
    root:'/test/repo',platform:'linux',
    resolveGit:()=>({executable:'/usr/bin/git',fixedConfigArgs:[],environment:{}}),
    spawn:()=>{calls++;return {status:0,stdout:BASE+'\n'};},
  }),/LOCAL_REVIEW_HEAD_MISMATCH/);
  assert.equal(calls,1);
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
      model:'sha256:'+pin,done:true,done_reason:'stop',response:'{"verdict":"clean"}',
    })}},
  });
  assert.equal(out.response,'{"verdict":"clean"}');
  assert.equal(out.modelDigestSha256,pin);
  assert.equal(calls[0].url,'http://127.0.0.1:11434/api/generate');
  assert.equal(calls[0].opts.redirect,'error');
  assert.equal(JSON.parse(calls[0].opts.body).model,'sha256:'+pin);
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
  const pin='f'.repeat(64),baseReply={model:'sha256:'+pin,done:true,
    done_reason:'stop',response:'{"verdict":"clean"}'};
  const settings={platform:'linux',gamingGuard:()=>({ok:true}),
    modelPin:async()=>({ok:true,digest:pin}),
    startPolling:()=>12,stopPolling:()=>{}};
  for(const patch of [{model:'qwen:14b'},{model:'sha256:'+'d'.repeat(64)},
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
      model:'sha256:'+pin,done:true,done_reason:'stop',response:'{"verdict":"clean"}',
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
      model:'sha256:'+pin,done:true,done_reason:'stop',response:'{"verdict":"clean"}',
    })}),
  }),/HIGH_RISK_MODEL_OR_GAMING_CHANGED_DURING_INFERENCE/);
});
