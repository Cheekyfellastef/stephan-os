import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const script = await readFile(new URL('./vr-link.js', import.meta.url), 'utf8');
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
function harness({ supported = true, xrPresent = true } = {}) {
  const nodes = Object.fromEntries(['xr','enter','session','notice','backend','device','ping'].map(id => [id, { textContent:'', disabled:id==='enter', handlers:{}, addEventListener(type, cb) { this.handlers[type]=cb; } }]));
  const noop = () => {};
  nodes.chamber={width:700,height:230,getContext(){return { fillRect:noop,beginPath:noop,moveTo:noop,lineTo:noop,stroke:noop,strokeRect:noop,fillText:noop };}};
  const pending=[];
  const healthRequests=[];
  let requestCount=0;
  const xr=xrPresent ? {
    isSessionSupported:async () => supported,
    requestSession:() => { requestCount++;return new Promise((resolve,reject)=>pending.push({resolve,reject})); },
  }:undefined;
  runInNewContext(script,{
    document:{getElementById:id=>nodes[id]},
    navigator:{userAgent:'Test browser',xr},
    location:{protocol:'https:',hostname:'example.com'},
    setTimeout,clearTimeout,AbortController,
    fetch:()=>new Promise((resolve,reject)=>healthRequests.push({resolve,reject})),
  },{timeout:500});
  return {nodes,pending,healthRequests,ping:()=>nodes.ping.handlers.click(),click:()=>nodes.enter.handlers.click(),requestCount:()=>requestCount};
}

test('do not open overlapping immersive XR sessions even on repeated click callbacks',async()=>{
  const h=harness(); await settle();
  assert.equal(h.nodes.enter.disabled,false);
  const first=h.click(); const second=h.click();
  assert.equal(h.requestCount(),1);
  assert.equal(h.nodes.enter.disabled,true);
  let onEnd;
  h.pending[0].resolve({addEventListener:(type,cb)=>{if(type==='end')onEnd=cb;}});
  await Promise.all([first,second]);
  assert.equal(h.nodes.session.textContent,'immersive-vr');
  assert.equal(h.nodes.enter.disabled,true);
  await h.click(); assert.equal(h.requestCount(),1);
  onEnd();
  assert.equal(h.nodes.enter.disabled,false);
  assert.equal(h.nodes.session.textContent,'Fallback');
  const third=h.click(); assert.equal(h.requestCount(),2);
  h.pending[1].reject(new Error('XR denied'));
  await third;
  assert.equal(h.nodes.enter.disabled,false);
  assert.match(h.nodes.notice.textContent,/XR denied/);
});

test('unsupported browser cannot start immersive session through stale callback',async()=>{
  const h=harness({supported:false}); await settle();
  assert.equal(h.nodes.enter.disabled,true);
  await h.click();
  assert.equal(h.requestCount(),0);
});

test('missing navigator.xr keeps baseline offline without request',async()=>{
  const h=harness({xrPresent:false}); await settle();
  assert.equal(h.nodes.enter.disabled,true);
  await h.click();
  assert.equal(h.requestCount(),0);
});

test('late end event from an old XR session cannot terminate the new one', async () => {
  const h = harness(); await settle();
  let firstEnd;
  const firstRequest = h.click();
  h.pending[0].resolve({ addEventListener: (type, cb) => { if (type === 'end') firstEnd = cb; } });
  await firstRequest;
  firstEnd();
  assert.equal(h.nodes.session.textContent, 'Fallback');
  let secondEnd;
  const secondRequest = h.click();
  h.pending[1].resolve({ addEventListener: (type, cb) => { if (type === 'end') secondEnd = cb; } });
  await secondRequest;
  firstEnd(); // Simulate a stale queued event from the previous session.
  assert.equal(h.nodes.session.textContent, 'immersive-vr');
  assert.equal(h.nodes.enter.disabled, true);
  assert.equal(h.requestCount(), 2);
  secondEnd();
  assert.equal(h.nodes.session.textContent, 'Fallback');
  assert.equal(h.nodes.enter.disabled, false);
});

test('late backend health reply cannot mask entered or ended VR session notice', async () => {
  const h = harness(); await settle();
  const ping = h.ping();
  assert.match(h.nodes.notice.textContent, /Checking Stephanos/);
  const entering = h.click();
  assert.match(h.nodes.notice.textContent, /Opening immersive/);
  let end;
  h.pending[0].resolve({ addEventListener: (type, cb) => { if (type === 'end') end = cb; } });
  await entering;
  assert.match(h.nodes.notice.textContent, /WebXR session entered/);
  h.healthRequests[0].resolve({ ok: true, status: 200 });
  await ping;
  assert.match(h.nodes.notice.textContent, /WebXR session entered/);
  end();
  assert.match(h.nodes.notice.textContent, /Desktop fallback ready/);
});

test('older backend ping failure cannot mask later successful ping', async () => {
  const h = harness(); await settle();
  const older = h.ping();
  const newer = h.ping();
  assert.equal(h.healthRequests.length, 2);
  h.healthRequests[1].resolve({ ok: true, status: 200 });
  await newer;
  assert.match(h.nodes.notice.textContent, /reachable \(HTTP 200\)/);
  h.healthRequests[0].reject(new Error('old unreachable'));
  await older;
  assert.match(h.nodes.notice.textContent, /reachable \(HTTP 200\)/);
});
