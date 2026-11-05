import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { evaluateServedBuildIdentity } from '../shared/runtime/buildParity.mjs';
import { readServedRuntimeBuildSnapshot, createStephanosDistServer } from './serve-stephanos-dist.mjs';
import { runSyncHousekeeperPreservingRuntime } from './battle-bridge-sync-housekeeper-runner.mjs';
import { runIgnitionHousekeep } from './ignite-stephanos-local.mjs';
const head='a'.repeat(40), old='b'.repeat(40), fp='c'.repeat(64);
const meta=(h=head)=>({gitCommit:h,sourceFingerprint:fp,runtimeMarker:'antifriction-live-v3::'+h+'::'+fp.slice(0,12)});
const snapshot=(h=head)=>({expectedHead:head,observedHead:head,metadata:meta(h),embeddedMetadata:meta(h),indexBytes:Buffer.from('<h1>Flywheel fixture</h1>')});
test('identity model never promotes stale, missing, malformed or racing build evidence',()=>{
 assert.equal(evaluateServedBuildIdentity(snapshot()).current,true);
 for(const data of [snapshot(old),{...snapshot(),metadata:null},{...snapshot(),embeddedMetadata:null},{...snapshot(),expectedHead:'git-unavailable'},{...snapshot(),observedHead:old},{...snapshot(),embeddedMetadata:meta(old)},{...snapshot(),metadata:{...meta(),runtimeMarker:'wrong'}},{...snapshot(),metadata:{...meta(),sourceFingerprint:'wrong'}}]) assert.equal(evaluateServedBuildIdentity(data).current,false);
});
test('same server and a restarted server fence rollback and recover only from a fresh coherent build',async t=>{
 let observed=snapshot();
 const start=async()=>{const server=createStephanosDistServer({readRuntimeSnapshot:()=>observed});server.listen(0,'127.0.0.1');await once(server,'listening');return {server,url:'http://127.0.0.1:'+server.address().port};};
 let active=await start();t.after(()=>active.server.close());
 const check=async(status)=>{for(const path of ['/__stephanos/health','/apps/stephanos/dist/index.html?surface=flywheel','/apps/stephanos/dist/assets/obsolete.js', '/apps/stephanos/dist/', ...(process.platform==='win32'?['/APPS/STEPHANOS/DIST/index.html']:[])]){const r=await fetch(active.url+path);assert.equal(r.status,path.includes('obsolete')&&status===200?404:status,path);} const r=await fetch(active.url+'/apps/stephanos/runtime-status.json');const p=await r.json();assert.equal(r.status,status);assert.equal(p.state==='ready',status===200);};
 await check(200);observed=snapshot(old);await check(503);
 await new Promise(resolve=>active.server.close(resolve));active=await start();await check(503);
 observed={...snapshot(),embeddedMetadata:meta(old)};await check(503);
 observed=snapshot();await check(200);
});
test('real sync housekeeper preserves live dist and runtime data even if later refresh fails',()=>{
 const steps=[];let asserted=false;
 const captureStepFn=(label)=>{if(label==='git-status')return {stdout:' M apps/stephanos/dist/index.html\n?? apps/stephanos/dist/assets/current.js\n M stephanos-server/data/memory/durable-memory.json',stderr:''};if(label==='git-untracked-data')return {stdout:'',stderr:''};throw Error(label);};
 const housekeep=options=>runIgnitionHousekeep({...options,captureStepFn,runStepFn:(...args)=>steps.push(args)});
 runSyncHousekeeperPreservingRuntime({assertHead:()=>{asserted=true;},housekeep});
 assert.equal(asserted,true);assert.deepEqual(steps,[]);
 // The former default really did restore the old tracked build and clean its live assets.
 runIgnitionHousekeep({dryRun:false,compact:true,captureStepFn,runStepFn:(...args)=>steps.push(args)});
 assert.ok(steps.some(([label])=>label==='git-restore-auto-generated'));
 assert.ok(steps.some(([label])=>label==='git-clean-dist-untracked'));
});

test('captured identity refuses reader failure, malformed embedded JSON and head changes',()=>{
 const readMetadata=()=>meta();
 const readIndex=()=>Buffer.from('<script id="stephanos-build-metadata" type="application/json">'+JSON.stringify(meta())+'</script>');
 const good=readServedRuntimeBuildSnapshot({readHead:()=>head,readMetadata,readIndex});
 assert.equal(evaluateServedBuildIdentity(good).current,true);
 for(const readIndex of [()=>{throw Error('missing');},()=>Buffer.from('<script id="stephanos-build-metadata" type="application/json">broken</script>')])
  assert.equal(evaluateServedBuildIdentity(readServedRuntimeBuildSnapshot({readHead:()=>head,readMetadata,readIndex})).current,false);
 let reads=0;
 assert.equal(evaluateServedBuildIdentity(readServedRuntimeBuildSnapshot({readHead:()=>reads++?old:head,readMetadata,readIndex})).current,false);
});
