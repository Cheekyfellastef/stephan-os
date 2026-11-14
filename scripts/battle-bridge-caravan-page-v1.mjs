// Fixed UI template for the existing private Commander; no network or authority logic.
const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#08121b">
<title>Stephanos · Caravan</title>
<style>
:root{color-scheme:dark;--bg:#08121b;--line:#29414f;--ink:#edf6f5;--muted:#abc0c9;--teal:#72e8d6;--amber:#ffd28a}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at top right,#153b42,transparent 58%),var(--bg);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;min-height:100svh}
.shell{max-width:1120px;margin:auto;padding:32px 32px 20px}header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:32px}
.brand{letter-spacing:.18em;font-size:14px;font-weight:750}.brand span{color:var(--teal)}.route{color:var(--muted);font-size:13px}.connection{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)}
.dot{width:8px;height:8px;border-radius:50%;background:#8f9eaa}.dot.live{background:var(--teal)}.eyebrow{color:var(--teal);text-transform:uppercase;font-size:12px;letter-spacing:.15em;font-weight:700}
h1{font-size:clamp(30px,4.5vw,50px);font-weight:650;letter-spacing:-.04em;line-height:1.08;margin:12px 0 16px}p{line-height:1.6;margin:0;color:var(--muted)}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:20px}.screen{background:linear-gradient(135deg,#122b38,#10212e 65%);border:1px solid #35505b;border-radius:24px;padding:32px;min-height:400px;display:flex;flex-direction:column;box-shadow:0 20px 70px #0003}
.topline{display:flex;gap:10px;align-items:center;justify-content:space-between}.target{color:var(--muted);font-size:13px}.pill{border:1px solid #665b42;color:var(--amber);background:#302b23;border-radius:20px;padding:6px 11px;font-size:12px;white-space:nowrap}
.pill.ready{border-color:#377568;color:var(--teal);background:#163d37}.body{flex:1;padding:22px 0 26px}h2{font-size:clamp(24px,3vw,34px);letter-spacing:-.03em;font-weight:600;margin:0 0 14px;line-height:1.18}.body p{max-width:600px}.actions{display:flex;gap:12px;flex-wrap:wrap}.button,button{font:inherit;min-height:48px;display:inline-flex;justify-content:center;align-items:center;padding:13px 18px;border-radius:12px;border:1px solid var(--line);background:#172d3b;color:var(--ink);text-decoration:none;font-weight:650;cursor:pointer;touch-action:manipulation}
.primary{background:var(--teal);border-color:var(--teal);color:#082124}button:disabled{opacity:.5;cursor:default}button:focus-visible,a:focus-visible{outline:3px solid #fff;outline-offset:4px}[hidden]{display:none!important}
.side{padding:24px 20px;background:#0b1924a8;border:1px solid var(--line);border-radius:24px}.side h3{font-size:15px;margin:0 0 16px}.side p{font-size:14px}.side .button{width:100%;margin-top:18px}.line{border:0;border-top:1px solid var(--line);margin:24px 0}.note{font-size:13px;color:var(--muted);margin-top:18px;min-height:20px}
details{margin-top:22px;border-top:1px solid var(--line);padding-top:16px;font-size:13px;color:var(--muted)}summary{cursor:pointer;min-height:32px}dl{display:grid;grid-template-columns:90px minmax(0,1fr);gap:8px;margin:12px 0 0}dt{color:#809ea9}dd{margin:0;overflow-wrap:anywhere;font-family:ui-monospace,monospace;font-size:12px}
footer{display:flex;justify-content:space-between;gap:16px;color:#809ea9;font-size:12px;margin-top:22px;padding:0 4px}.intro{margin-bottom:28px;max-width:760px}
@media(max-width:760px){.shell{padding:20px 16px}.grid{grid-template-columns:1fr}.screen{padding:24px;min-height:360px}.side{padding:20px}.side .button{width:auto;margin-top:12px}.side .line{margin:16px 0}.route{display:none}header{margin-bottom:26px}.intro{margin-bottom:22px}footer{flex-wrap:wrap}.topline{align-items:flex-start}.target{max-width:58%;line-height:1.5}}
@media(prefers-reduced-motion:no-preference){button,.button{transition:background .15s,opacity .15s}}
</style>
</head>
<body>
<div class="shell">
<header><div class="brand"><span>◈</span> STEPHANOS <span class="route">/ CARAVAN</span></div><div class="connection"><span id="dot" class="dot"></span><span id="connection">Connecting</span></div></header>
<section class="intro"><div class="eyebrow">Your private control deck</div><h1>Keep your workspace moving.</h1><p>Open the holodeck, check Battle Bridge, and follow an installation from your iPad.</p></section>
<main class="grid">
<section class="screen" aria-labelledby="title">
<div class="topline"><span class="target">BATTLE BRIDGE · INSTALLATION</span><span id="pill" class="pill">Checking</span></div>
<div class="body" aria-live="polite" aria-atomic="true"><h2 id="title">Checking your connection…</h2><p id="description">Reading the current installation status.</p></div>
<div class="actions"><button id="approve" class="primary" hidden>Approve installation</button><button id="later" hidden>Not now</button><button id="cancelrequest" hidden>Cancel request</button><button id="refresh">Refresh status</button><button id="newrequest" hidden>Check for updates</button></div>
<p id="notice" class="note" role="status"></p>
<details><summary>Installation details</summary><dl><dt>Request</dt><dd id="request">None</dd><dt>Version</dt><dd id="version">Not confirmed</dd><dt>Observed</dt><dd id="observed">Not yet</dd><dt>Result</dt><dd id="reason">Checking</dd></dl></details>
</section>
<aside class="side"><h3>Spatial workspace</h3><p>Your holodeck opens in the browser. Installation readiness is shown separately.</p><a class="button primary" href="https://cheekyfellastef.github.io/stephan-os/apps/spatial-bridge/quest-entry.html" target="_blank" rel="noopener noreferrer">Open spatial workspace ↗</a><hr class="line"><h3>Stephanos controls</h3><p>Use your existing private Ignition control to start Stephanos.</p><a class="button" href="/ignite">Open Ignition</a></aside>
</main>
<footer><span>Private Commander connection</span><span>Installation decisions use your paired device</span></footer>
</div>
<script>
'use strict';
let nonce=__CARAVAN_NONCE_JSON__;
const $=id=>document.getElementById(id);
const key='stephanos.caravan.installation.request.v1';
const submittedKey=key+'.submitted';
let requestId='', busy=false, halted=false, view=null, prepared=null, pollTimer=null, refreshEpoch=0, approvalAttempt=0, credentialAbort=null;
try{const saved=localStorage.getItem(key)||'';if(/^mobile-install-[a-z0-9][a-z0-9-]{7,63}$/.test(saved))requestId=saved;halted=!!requestId&&localStorage.getItem(submittedKey)===requestId;}catch{}
function remember(id){requestId=id;try{localStorage.setItem(key,id);}catch{}}
function b64bytes(value){const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
function b64url(buffer){let raw='';for(const n of new Uint8Array(buffer))raw+=String.fromCharCode(n);return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function render(next){
 if(next.receiptVerified&&view?.receiptVerified&&next.requestId===view.requestId&&next.sequence<view.sequence)return;
 view=next;$('title').textContent=next.title||'Status unavailable';$('description').textContent=next.description||'Refresh to check the same request.';
 const labels={SETUP_REQUIRED:'Setup required',SIGN_IN_REQUIRED:'Sign-in required',AWAITING_APPROVAL:'Ready for approval',APPROVAL_RECORDED:'Approved',STARTING:'Starting',INSTALLING:'Installing',INSTALLED_PENDING_BOOT:'Restart required',READY:'Ready',UNKNOWN:'Unconfirmed',FAILED:'Failed',CANCELLED:'Cancelled',BLOCKED:'Blocked'};
 $('pill').textContent=labels[next.state]||'Check status';$('pill').classList.toggle('ready',next.state==='READY');
 $('approve').hidden=next.canApprove!==true||halted;$('later').hidden=$('approve').hidden;$('approve').disabled=busy;$('later').disabled=halted;
 $('newrequest').hidden=!next.receiptVerified||!['READY','FAILED','CANCELLED'].includes(next.state);$('newrequest').disabled=busy;
 $('cancelrequest').hidden=!next.receiptVerified||!next.requestId||['READY','FAILED','CANCELLED','INSTALLED_PENDING_BOOT'].includes(next.state);$('cancelrequest').disabled=busy;
 $('request').textContent=next.requestId||requestId||'None';$('version').textContent=next.sourceHead?next.sourceHead.slice(0,12):'Not confirmed';
 $('observed').textContent=next.observedAtUtc?new Date(next.observedAtUtc).toLocaleString():'Not yet';
 $('reason').textContent=(next.blockers||[]).join(', ')||(next.receiptVerified?'Verified receipt':'Awaiting protected evidence');
 if(next.requestId)remember(next.requestId);
}
async function call(path,body,show=true){
 const options=body?{method:'POST',headers:{'content-type':'application/json','x-stephanos-caravan-nonce':nonce},body:JSON.stringify(body)}:{cache:'no-store'};
 const response=await fetch('/caravan/'+path,options);let data;
 try{data=await response.json();}catch{throw Error('Connection interrupted');}
 if(data.csrfNonce)nonce=data.csrfNonce;
 if(data.view&&show)render(data.view);
 if(!response.ok)throw Error(data.message||'The request could not be completed. Refresh its status.');
 return data;
}
async function refresh(){
 if(busy)return;
 const epoch=++refreshEpoch;
 clearTimeout(pollTimer);$('refresh').disabled=true;
 try{
  const data=await call(requestId?'reconcile?requestId='+encodeURIComponent(requestId):'status',undefined,false);
  if(epoch!==refreshEpoch||busy)return;
  $('connection').textContent='Commander connected';$('dot').classList.add('live');
  if(!data.view)throw Error('No status returned');
  render(data.view);
 }catch{if(epoch!==refreshEpoch||busy)return;$('connection').textContent='Connection unavailable';$('dot').classList.remove('live');render({state:'UNKNOWN',title:'Connection interrupted',description:'Reconnect to check Battle Bridge and the result of your existing request.',canApprove:false,requestId,receiptVerified:false,blockers:[]});$('notice').textContent='Connection interrupted. Reconnect to check this same request.';}
 finally{$('refresh').disabled=false;}
 if(!document.hidden&&requestId&&!['READY','FAILED','CANCELLED','BLOCKED'].includes(view?.state))pollTimer=setTimeout(refresh,15000);
}
$('approve').addEventListener('click',async()=>{
 if(busy||halted||!view?.canApprove)return;
 const attempt=++approvalAttempt;
 busy=true;refreshEpoch++;$('approve').disabled=true;$('later').disabled=false;$('refresh').disabled=true;$('notice').textContent='Preparing your device confirmation…';
 let submitted=false;
 try{
  if(!window.isSecureContext||!navigator.credentials?.get)throw Error('Device confirmation needs your secure private address and a compatible browser.');
  const expectedRequest=view.requestId,expectedCandidate=view.candidateSha256;
  prepared=await call('prepare',{requestId:expectedRequest,candidateSha256:expectedCandidate});if(!prepared.publicKey||!prepared.view?.requestId)throw Error('The protected installer is not ready.');
  if(attempt!==approvalAttempt||halted)return;
  if(prepared.view.requestId!==expectedRequest||prepared.view.candidateSha256!==expectedCandidate)throw Error('The installation changed. Review the updated details before approving.');
  remember(prepared.view.requestId);
  const options={...prepared.publicKey,challenge:b64bytes(prepared.publicKey.challenge),allowCredentials:prepared.publicKey.allowCredentials.map(c=>({...c,id:b64bytes(c.id)}))};
  credentialAbort=new AbortController();
  const credential=await navigator.credentials.get({publicKey:options,signal:credentialAbort.signal});
  if(attempt!==approvalAttempt||halted)return;
  if(!credential)throw Error('Device confirmation was cancelled.');
  if(halted)throw Error('Approval was cancelled before it was sent.');
  const assertion={id:credential.id,rawId:b64url(credential.rawId),type:credential.type,response:{clientDataJSON:b64url(credential.response.clientDataJSON),authenticatorData:b64url(credential.response.authenticatorData),signature:b64url(credential.response.signature),userHandle:credential.response.userHandle?b64url(credential.response.userHandle):null}};
  submitted=true;halted=true;$('later').disabled=true;try{localStorage.setItem(submittedKey,requestId);}catch{}
  const result=await call('approve',{requestId,assertion});
  $('notice').textContent=result.view?.receiptVerified?'Following the protected installation receipt.':'Checking the same request for its actual outcome.';
 }catch(error){
  if(attempt!==approvalAttempt)return;
  if(submitted){halted=true;$('notice').textContent='Approval was sent. Its outcome needs confirmation; it will not be sent again automatically.';}
  else{$('notice').textContent=error?.name==='NotAllowedError'?'Device confirmation was cancelled.':error.message;}
 }finally{if(attempt===approvalAttempt){busy=false;credentialAbort=null;$('refresh').disabled=false;if(view)render(view);refresh();}}
});
$('later').addEventListener('click',()=>{if(halted)return;halted=true;approvalAttempt++;credentialAbort?.abort();credentialAbort=null;busy=false;$('refresh').disabled=false;$('approve').hidden=true;$('later').hidden=true;$('notice').textContent='No approval has been sent. You can return when you are ready.';});
$('cancelrequest').addEventListener('click',async()=>{
 if(busy||!view?.receiptVerified||!view.requestId||['READY','FAILED','CANCELLED','INSTALLED_PENDING_BOOT'].includes(view.state))return;
 const original=view.requestId;halted=true;approvalAttempt++;credentialAbort?.abort();credentialAbort=null;busy=true;refreshEpoch++;clearTimeout(pollTimer);
 try{localStorage.setItem(submittedKey,original);}catch{}
 render(view);$('notice').textContent='Cancelling the current request…';
 try{const result=await call('cancel',{requestId:original});$('notice').textContent=result.view?.state==='CANCELLED'&&result.view?.receiptVerified?'The protected installer confirmed cancellation.':'Checking the same request for the cancellation result.';}
 catch{$('notice').textContent='Cancellation needs confirmation. Refresh the same request; approval will not be sent again.';}
 finally{busy=false;if(view)render(view);refresh();}
});
$('newrequest').addEventListener('click',()=>{if(busy||!view?.receiptVerified||!['READY','FAILED','CANCELLED'].includes(view.state))return;requestId='';halted=false;view=null;try{localStorage.removeItem(key);localStorage.removeItem(submittedKey);}catch{}$('notice').textContent='Checking for the next installation.';refresh();});
$('refresh').addEventListener('click',refresh);
document.addEventListener('visibilitychange',()=>{clearTimeout(pollTimer);if(!document.hidden)refresh();});
refresh();
</script>
</body></html>`;

export function renderBattleBridgeCaravanPageV1(nonce) {
  if (typeof nonce !== 'string' || !/^[a-f0-9]{64}$/.test(nonce)) throw new Error('CARAVAN_NONCE_INVALID');
  return PAGE.replace('__CARAVAN_NONCE_JSON__', JSON.stringify(nonce));
}
