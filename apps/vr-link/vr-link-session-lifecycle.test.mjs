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
    fetch:async()=>({ok:true,status:200}),
  },{timeout:500});
  return {nodes,pending,click:()=>nodes.enter.handlers.click(),requestCount:()=>requestCount};
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
