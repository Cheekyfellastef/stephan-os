import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { evaluateServedBuildIdentity } from '../shared/runtime/buildParity.mjs';
import { readServedRuntimeBuildSnapshot, readServedRuntimeHead, createStephanosDistServer } from './serve-stephanos-dist.mjs';
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

test('captured identity refuses reader failure, malformed embedded JSON and head changes',async()=>{
 const readMetadata=()=>meta();
 const readIndex=()=>Buffer.from('<script id="stephanos-build-metadata" type="application/json">'+JSON.stringify(meta())+'</script>');
 const good=await readServedRuntimeBuildSnapshot({readHead:()=>head,readMetadata,readIndex});
 assert.equal(evaluateServedBuildIdentity(good).current,true);
 for(const readIndex of [()=>{throw Error('missing');},()=>Buffer.from('<script id="stephanos-build-metadata" type="application/json">broken</script>')])
  assert.equal(evaluateServedBuildIdentity(await readServedRuntimeBuildSnapshot({readHead:()=>head,readMetadata,readIndex})).current,false);
 let reads=0;
 assert.equal(evaluateServedBuildIdentity(await readServedRuntimeBuildSnapshot({readHead:()=>reads++?old:head,readMetadata,readIndex})).current,false);
});

test('real hung identity child is bounded and fails closed',async()=>{
 const started=performance.now();let spawned=false;
 const observed=await readServedRuntimeHead({execFileImpl:(file,args,options,done)=>{
  assert.equal(options.shell,false);assert.equal(options.timeout,1000);
  assert.deepEqual(args.slice(-2),['rev-parse','HEAD']);
  const child=execFile(process.execPath,['-e','setInterval(()=>{},1000)'],options,done);
  child.once('spawn',()=>{spawned=true;});return child;
 }});
 assert.equal(observed,'');assert.equal(spawned,true,'the disposable hung child must actually start');
 assert.ok(performance.now()-started>=750,'must exercise the deadline rather than a spawn refusal');
 assert.ok(performance.now()-started<5000,'hung child exceeded bounded acceptance window');
});

test('in-flight identity captures coalesce without caching authority or blocking restart',async t=>{
 let release,entered,captures=0;let observed=snapshot();
 const started=new Promise(r=>{entered=r;});const held=new Promise(r=>{release=r;});
 const server=createStephanosDistServer({readRuntimeSnapshot:async()=>{captures++;entered();await held;return observed;},shutdownForRestart:async()=>{}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const url='http://127.0.0.1:'+server.address().port;
 const pending=Array.from({length:24},()=>fetch(url+'/__stephanos/health'));
 await started;
 // The identity reader remains blocked throughout this real HTTP request.
 const restart=await fetch(url+'/__stephanos/restart',{method:'POST',body:'{}'});
 assert.equal(restart.status,202);
 await new Promise(r=>setTimeout(r,75));release();
 const responses=await Promise.all(pending);assert.ok(responses.every(r=>r.status===200));
 assert.equal(captures,1);
 observed=snapshot(old);
 assert.equal((await fetch(url+'/__stephanos/health')).status,503);
 assert.equal(captures,2,'completed capture must never be reused as cached authority');
});
