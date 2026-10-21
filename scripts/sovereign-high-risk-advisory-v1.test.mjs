import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureHighRiskAdvisorySnapshotV1 as capture,
  localHighRiskModelV1,
  runSovereignHighRiskAdvisoryV1 as run,
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
    reviewerSessionId:'local-review-b',implementerSessionId:'build-a',
    implementerProvider:'github-builder',modelClass:'qwen-14b',
  };
}
const clean=(_prompt,c)=>JSON.stringify({
  chunkId:c.chunkId,contentSha256:c.contentSha256,verdict:'clean',findings:[],
});
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
test('trusted git reader checks head, branch, clean worktree, base and read-only diff',()=>{
  let calls=0;
  const outputs=[SHA+'\n',ENV.STEPHANOS_REVIEW_EXACT_BRANCH+'\n','',BASE+'\n','',
    PATH+'\n',DIFF];
  const snapshot=capture({...ENV,PATH:'/attacker',GIT_EXEC_PATH:'/attacker',GIT_CONFIG_COUNT:'3'},{
    root:'/verified/repo',platform:'linux',
    resolveGit:()=>({
      executable:'/usr/bin/git',fixedConfigArgs:['-c','core.fsmonitor=false'],
      environment:{PATH:'/usr/bin:/bin'},
    }),
    spawn:(executable,args,options)=>{
      assert.equal(executable,'/usr/bin/git');
      assert.equal(options.shell,false);
      assert.equal(options.env.GIT_EXEC_PATH,undefined);
      assert.ok(args.includes('--git-dir=/verified/repo/.git'));
      assert.ok(args.includes('--work-tree=/verified/repo'));
      calls++;
      return {status:0,stdout:outputs.shift()};
    },
  });
  assert.equal(calls,7);
  assert.equal(snapshot.sourceHead,SHA);
  assert.equal(snapshot.diff,DIFF);
  assert.deepEqual(snapshot.changedFiles,[PATH]);
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
test('local model reply must be complete and from the explicitly requested model',async()=>{
  const prompts=[];
  const safeReply={model:'qwen:14b',done:true,done_reason:'stop',response:'{"verdict":"clean"}'};
  const fetchImpl=async (url,opts)=>{
    prompts.push({url,opts});
    return {ok:true,text:async()=>JSON.stringify(safeReply)};
  };
  const out=await localHighRiskModelV1('read-only prompt',{}, {},{fetchImpl});
  assert.equal(out,safeReply.response);
  assert.equal(prompts[0].url,'http://127.0.0.1:11434/api/generate');
  assert.equal(prompts[0].opts.redirect,'error');
  assert.equal(JSON.parse(prompts[0].opts.body).model,'qwen:14b');
  for (const change of [{model:'wrong-model'}, {done:false}, {done_reason:'length'},
    {response:null}, {done_reason:undefined}]) {
    await assert.rejects(
      localHighRiskModelV1('safe prompt',{}, {},{fetchImpl:async()=>({
        ok:true,text:async()=>JSON.stringify({...safeReply,...change}),
      })}),
      /LOCAL_MODEL_COMPLETION_IDENTITY_UNPROVEN/
    );
  }
});
