import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {request} from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {createNativeSurfaceAdapter,createSpatialWindowHost,verifySpatialWindowInstallation} from '../scripts/spatial-window-host.mjs';
import {createHolodeckScreen} from '../apps/spatial-bridge/holodeck-screen-v1.mjs';
import {createHolodeckWindowClient} from '../apps/spatial-bridge/holodeck-window-client-v1.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const response=(body,status=200)=>({ok:status===200,status,json:async()=>body});
const token='a'.repeat(64);
test('temporary readiness host rejects every session/capture/input route without touching native state',async()=>{
  let nativeCalls=0;
  const native={stop(){nativeCalls++;},request(){nativeCalls++;throw new Error('native must remain untouched');}};
  const buildId='f'.repeat(64);
  const server=createSpatialWindowHost({native,buildId,readinessOnly:true});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const send=(path,method='POST',headers={})=>new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:server.address().port,path,method,
      headers:{Host:'127.0.0.1:4180',Origin:'http://127.0.0.1:4173','Content-Type':'application/json',...headers}},res=>{
      let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({code:res.statusCode,body:JSON.parse(data)}));
    });req.on('error',reject);req.end(method==='POST'?'{}':undefined);
  });
  try{
    assert.deepEqual(await send('/health','GET'),{code:200,body:{schema:'stephanos.spatial-window-health.v1',buildId,readinessOnly:true}});
    for(const path of ['/session','/windows','/bind','/frame','/input','/stop','/unknown']) {
      assert.deepEqual(await send(path),{code:409,body:{status:'readiness-probe-only'}});
    }
    assert.equal((await send('/session','OPTIONS')).code,409);
    assert.equal((await send('/health','GET',{Origin:'https://foreign.invalid'})).code,403);
    assert.equal((await send('/health','GET',{Host:'localhost:4180'})).code,403);
    assert.equal(nativeCalls,0);
  }finally{await new Promise(r=>server.close(r));}
  assert.equal(nativeCalls,0,'closing a probe cannot revoke an existing native session');
});
function clientHarness(fetchRef){
  const timers=new Map(),saved=new Map();let id=0;
  const client=createHolodeckWindowClient({fetchRef,locationRef:{port:'4174'},sessionStore:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},
    documentRef:{createElement:()=>({decode:async()=>{}})},setTimer:fn=>{timers.set(++id,fn);return id;},clearTimer:key=>timers.delete(key)});
  return {client,saved,async tick(){const [key,fn]=timers.entries().next().value??[];if(!fn)return;timers.delete(key);return fn();}};
}
test('two overlapping discoveries cannot both obtain sessions after a slow stop',async()=>{
  const stop=deferred(),calls=[];
  const h=clientHarness(async(url)=>{const path=new URL(url).pathname;calls.push(path);if(path==='/stop')return stop.promise;return response(path==='/session'?{token}:{windows:[{id:1,title:'Test'}]});});
  await h.client.discover();const one=h.client.discover(),two=h.client.discover();stop.resolve(response({status:'stopped'}));await Promise.all([one,two]);
  assert.equal(calls.filter(p=>p==='/session').length,2);assert.equal(h.client.getState().status,'selecting');
});
test('delayed session grants are revoked after disconnect',async()=>{
  const grant=deferred(),calls=[];
  const h=clientHarness(async(url,opts)=>{const path=new URL(url).pathname;calls.push({path,opts});return path==='/session'?grant.promise:response({status:'stopped'});});
  const discover=h.client.discover();await Promise.resolve();await h.client.stop();grant.resolve(response({token}));await discover;
  assert.equal(h.client.getState().status,'idle');assert.equal(calls.filter(x=>x.path==='/stop').length,1);
  assert.equal(calls.at(-1).opts.headers['X-Spatial-Session'],token);
});
test('cached-page departure revokes access and allows explicit reconnection after restore',async()=>{
  const calls=[];let sessions=0;
  const h=clientHarness(async(url,opts)=>{const path=new URL(url).pathname;calls.push({path,opts});return response(
    path==='/session'?{token:(++sessions===1?'a':'b').repeat(64)}:
    path==='/windows'?{windows:[{id:1,title:'Test'}]}:
    path==='/frame'?{status:'frame',serial:1,generation:1,jpeg:'fixture'}:
    {status:path==='/bind'?'connected':'stopped'});});
  await h.client.discover();await h.client.connect(1);await h.tick();
  assert.equal(h.client.input({kind:'text',text:'stale'}),true);
  await h.client.pagehide({persisted:true});await h.tick();
  assert.equal(h.client.getState().status,'idle');assert.equal(h.client.getFrame(),null);
  assert.equal(h.client.input({kind:'text',text:'hidden'}),false);
  assert.equal(calls.at(-1).path,'/stop');assert.equal(calls.at(-1).opts.headers['X-Spatial-Session'],token);
  await h.client.discover();assert.equal(h.client.getState().status,'selecting');
  await h.client.connect(1);await h.tick();assert.equal(h.client.getState().status,'live');
  assert.equal(calls.some(c=>c.path==='/input'),false);
  await h.client.pagehide({persisted:false});await h.client.discover();
  assert.equal(sessions,2);assert.equal(h.client.getState().status,'idle');
});
test('connecting waits for the window-list heartbeat without racing the native bind',async()=>{
  const heartbeat=deferred(),calls=[];let lists=0;
  const h=clientHarness(async(url)=>{const path=new URL(url).pathname;calls.push(path);if(path==='/windows'&&++lists===2)return heartbeat.promise;
    return response(path==='/session'?{token}:path==='/windows'?{windows:[{id:1,title:'Test'}]}:{status:'connected'});});
  await h.client.discover();const refreshing=h.tick(),connecting=h.client.connect(1);assert.equal(calls.includes('/bind'),false);
  heartbeat.resolve(response({windows:[{id:1,title:'Test'}]}));await refreshing;assert.equal(await connecting,true);assert.equal(calls.at(-1),'/bind');
  await h.client.stop();
});
test('native events from an old child cannot stop or answer its replacement',async()=>{
  const children=[];
  const adapter=createNativeSurfaceAdapter('fixture',{spawnRef:()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stdout.setEncoding=()=>{};child.stdin={write:()=>{}};child.kill=()=>{child.killed=true;};children.push(child);return child;}});
  const old=adapter.request({op:'list'});const rejected=assert.rejects(old);adapter.stop();await rejected;
  const next=adapter.request({op:'list'});children[0].emit('error',new Error('late'));children[0].stdout.emit('data','{"status":"connected"}\n');
  assert.equal(children[1].killed,undefined);children[1].stdout.emit('data','{"status":"windows","windows":[]}\n');assert.equal((await next).status,'windows');adapter.stop();
});
test('revocation fences late bind replies and leaves a replacement session unbound',async()=>{
  const binding=deferred(),entered=deferred();
  const native={stop(){},async request(value){if(value.op==='bind'){entered.resolve();return binding.promise;}return {status:'windows',windows:[{id:1,pid:2,title:'Test'}]};}};
  const server=createSpatialWindowHost({native});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const send=(path,body={},cap)=>new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:server.address().port,path,method:'POST',headers:{Host:'127.0.0.1:4180',Origin:'http://127.0.0.1:4173','Content-Type':'application/json',...(cap?{'X-Spatial-Session':cap}:{})}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({code:res.statusCode,...JSON.parse(data)}));});req.on('error',reject);req.end(JSON.stringify(body));});
  try{
    const first=(await send('/session')).token;await send('/windows',{},first);const bind=send('/bind',{id:1},first);await entered.promise;
    await send('/stop',{},first);const next=(await send('/session')).token;binding.resolve({status:'connected'});
    assert.equal((await bind).status,'session-revoked');assert.equal((await send('/frame',{},next)).code,400);
    assert.equal((await send('/windows',{},next)).status,'windows');
  }finally{await new Promise(r=>server.close(r));}
});
test('installation verification rejects replaced sources, binaries and redirected receipt paths',()=>{
  const root=mkdtempSync(join(tmpdir(),'spatial-console-install-')),hash=value=>createHash('sha256').update(value).digest('hex');
  const sources=['src/windows/Stephanos.SpatialWindow/SpatialWindow.cpp','scripts/spatial-window-host.mjs','shared/vr/spatialDesktopSurfaceContractV1.mjs'].map(path=>({path,sha256:hash(path)}));
  const directory=join(root,'.stephanos/local-state-checkpoints/spatial-window');
  try{
    for(const source of sources){mkdirSync(dirname(join(root,source.path)),{recursive:true});writeFileSync(join(root,source.path),source.path);}
    mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'SpatialWindow.exe'),'fixture');
    const receipt={schema:'stephanos.spatial-window-build.v1',sources,nativeSha256:hash('fixture')};receipt.buildId=hash([...sources.map(x=>x.sha256),receipt.nativeSha256].join(':'));
    writeFileSync(join(directory,'build.json'),JSON.stringify(receipt));assert.equal(verifySpatialWindowInstallation(root).buildId,receipt.buildId);
    writeFileSync(join(directory,'SpatialWindow.exe'),'replacement');assert.throws(()=>verifySpatialWindowInstallation(root),/binary/);
    writeFileSync(join(directory,'SpatialWindow.exe'),'fixture');writeFileSync(join(root,sources[0].path),'changed');assert.throws(()=>verifySpatialWindowInstallation(root),/source changed/);
    writeFileSync(join(root,sources[0].path),sources[0].path);receipt.sources[0].path='../outside';writeFileSync(join(directory,'build.json'),JSON.stringify(receipt));assert.throws(()=>verifySpatialWindowInstallation(root),/source changed/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('audio help and reload confirmation do not click through to the concealed app',()=>{
  const calls=[],screen=createHolodeckScreen({documentRef:{createElement:()=>({getContext:()=>({})})},client:{getFrame:()=>({naturalWidth:1920,naturalHeight:1080}),getState:()=>({}),input:x=>calls.push(x)}});
  assert.equal(screen.point(.5,.5,true),true);screen.action('voice');assert.equal(screen.point(.5,.5,true),false);
  screen.action('voice');screen.action('reload');assert.equal(screen.point(.5,.5,true),false);assert.equal(calls.length,1);
});
