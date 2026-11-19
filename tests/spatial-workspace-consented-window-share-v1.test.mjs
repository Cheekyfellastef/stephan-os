import test from 'node:test';
import assert from 'node:assert/strict';
import { createHolodeckWindowClient } from '../apps/spatial-bridge/holodeck-window-client-v1.mjs';
import { createHolodeckScreen } from '../apps/spatial-bridge/holodeck-screen-v1.mjs';
function harness(hostname='127.0.0.1'){
  let captureCalls=0,stopCalls=0,playCalls=0,networkCalls=0,callback=null;
  const track={readyState:'live',stop(){stopCalls++;this.readyState='ended';},addEventListener(event,fn){if(event==='ended')callback=fn;}};
  const stream={getVideoTracks:()=>[track],getTracks:()=>[track]};
  const video={videoWidth:1280,videoHeight:720,srcObject:null,play(){playCalls++;return Promise.resolve();},pause(){},};
  const navigatorRef={mediaDevices:{getDisplayMedia(spec){captureCalls++;assert.deepEqual(spec,{video:true,audio:false});return Promise.resolve(stream);}}};
  const timers=new Map();let timerSerial=0;const statuses=[];
  const client=createHolodeckWindowClient({locationRef:{hostname,port:'4173'},navigatorRef,
    documentRef:{createElement:name=>{assert.equal(name,'video');return video;}},sessionStore:null,
    setTimer(fn){const n=++timerSerial;timers.set(n,fn);return n;},clearTimer:n=>timers.delete(n),
    fetchRef:async()=>{networkCalls++;throw Error('Native endpoint must never be reached by browser share');},
    onChange:state=>statuses.push(state)});
  return {client,track,video,stream,statuses,callCount:()=>captureCalls,stopCount:()=>stopCalls,
    playCount:()=>playCalls,networkCount:()=>networkCalls,ended:()=>callback?.(),
    tick(){const [id,fn]=timers.entries().next().value??[];if(fn){timers.delete(id);fn();}},timerCount:()=>timers.size};
}
test('PC sharing requires an explicit user call; selected video reaches screen without any native access',async()=>{
  const h=harness();assert.equal(h.callCount(),0);assert.equal(h.client.getFrame(),null);
  assert.equal(await h.client.shareScreen(),true);assert.equal(h.callCount(),1);
  assert.equal(h.playCount(),1);assert.equal(h.networkCount(),0);
  assert.equal(h.client.getState().status,'view-only');assert.equal(h.client.getFrame().drawable,h.video);
  assert.equal(h.client.getFrame().naturalWidth,1280);assert.equal(h.client.getFrame().naturalHeight,720);
  assert.equal(h.video.srcObject,h.stream);h.tick();assert.ok(h.statuses.length>=2);
  assert.equal(h.client.input({kind:'text',text:'secret'}),false);
  assert.match(h.client.getState().inputStatus,/View-only/);assert.equal(h.networkCount(),0);
  await h.client.stop();assert.equal(h.stopCount(),1);assert.equal(h.client.getFrame(),null);
  assert.equal(h.timerCount(),0);
});
test('hosted and remote devices cannot capture the Battle Bridge through this path',async()=>{
  for(const host of ['cheekyfellastef.github.io','battle-bridge.example.ts.net','192.168.1.2']){
    const h=harness(host);assert.equal(await h.client.shareScreen(),false);
    assert.equal(h.callCount(),0);assert.match(h.client.getState().inputStatus,/PC local/);
    assert.equal(h.networkCount(),0);
  }
});
test('browser capture ending and page departure revoke tracks and clear frames',async()=>{
  const h=harness();await h.client.shareScreen();h.ended();assert.equal(h.stopCount(),1);
  assert.equal(h.client.getFrame(),null);assert.equal(h.client.getState().status,'idle');
  await h.client.pagehide();assert.equal(h.stopCount(),1);
  assert.equal(await h.client.shareScreen(),false,'disposed page cannot recapture');
});
test('hologram can focus actual consented video without forwarding pointer or keyboard input',async()=>{
  const h=harness();await h.client.shareScreen();
  const contexts=[];
  const documentRef={createElement:()=>{
    const ctx={pictures:[],fillRect(){},clearRect(){},strokeRect(){},fillText(){},drawImage(...args){this.pictures.push(args);}};
    contexts.push(ctx);return {getContext:()=>ctx};
  }};
  const screen=createHolodeckScreen({client:h.client,documentRef});screen.render();
  assert.equal(contexts[0].pictures.at(-1)[0],h.video);
  assert.equal(screen.point(.5,.5,true),true);assert.equal(screen.getState().focusedPanel,'chatgpt');
  assert.equal(screen.getState().keyboardEnabled,false);screen.action('key:a');screen.action('enter');
  assert.match(screen.getState().inputStatus,/view-only/i);
  assert.equal(h.networkCount(),0);await h.client.stop();
});
test('launcher exposes both real native interactive and user-consented view-only routes',async()=>{
  const {readFileSync}=await import('node:fs');
  const html=readFileSync(new URL('../apps/spatial-bridge/quest-entry.html',import.meta.url),'utf8');
  assert.match(html,/id="choose-window"/);assert.match(html,/id="share-window"/);
  assert.match(html,/client.shareScreen\(\)/);assert.match(html,/screen.action\('connect-window'\)/);
  assert.match(html,/screen.selectWindow\(/);
  assert.match(html,/Windows helper/i);assert.match(html,/view-only/i);
});


function delayedWindowCaptureHarness(){
  let releasePlay,rejectPlay,enteredPlay,acquisitions=0;
  const entered=new Promise(resolve=>{enteredPlay=resolve;});
  const pendingPlay=new Promise((resolve,reject)=>{releasePlay=resolve;rejectPlay=reject;});
  const tracks=[],videos=[];
  const client=createHolodeckWindowClient({
    locationRef:{hostname:'localhost',port:'4173'},sessionStore:null,
    navigatorRef:{mediaDevices:{getDisplayMedia:async()=>{
      acquisitions++;
      const track={readyState:'live',stopCount:0,
        stop(){this.stopCount++;this.readyState='ended';},addEventListener(){}};
      tracks.push(track);
      return {getTracks:()=>[track],getVideoTracks:()=>[track]};
    }}},
    documentRef:{createElement(){
      const n=videos.length;
      const video={videoWidth:640,videoHeight:480,srcObject:null,pause(){},
        play(){if(n===0){enteredPlay();return pendingPlay;}return Promise.resolve();}};
      videos.push(video);return video;
    }},
    setTimer:()=>1,clearTimer:()=>{},fetchRef:async()=>{throw Error('No native request is allowed.');},
  });
  return {client,entered,releasePlay:()=>releasePlay(),rejectPlay:()=>rejectPlay(new Error('Playback failed after revocation')),tracks,videos,count:()=>acquisitions};
}
test('pending browser video playback is revoked immediately by stop, pagehide and dispose',async()=>{
  for(const method of ['stop','pagehide','dispose']){
    const h=delayedWindowCaptureHarness(),share=h.client.shareScreen();
    await h.entered;
    assert.equal(h.tracks[0].readyState,'live');
    await h.client[method]();
    assert.equal(h.tracks[0].readyState,'ended',method+' must not await video.play()');
    assert.equal(h.tracks[0].stopCount,1);
    assert.equal(h.client.getFrame(),null);
    h.releasePlay();
    assert.equal(await share,false,'revoked capture must never be adopted later');
    assert.equal(h.tracks[0].stopCount,1);
  }
});
test('overlapping user clicks do not create orphaned captures and explicit stop permits a fresh share',async()=>{
  const h=delayedWindowCaptureHarness(),first=h.client.shareScreen();
  await h.entered;
  assert.equal(await h.client.shareScreen(),false);
  assert.equal(h.count(),1,'only the original browser picker may run');
  await h.client.stop();
  assert.equal(h.tracks[0].readyState,'ended');
  assert.equal(h.tracks[0].stopCount,1);
  assert.equal(await h.client.shareScreen(),true,'a deliberate new click may start after Stop');
  assert.equal(h.count(),2);
  h.releasePlay();
  assert.equal(await first,false,'old play promise cannot resurrect the old capture');
  assert.equal(h.tracks[0].stopCount,1);
  assert.equal(h.tracks[1].readyState,'live');
  assert.equal(h.client.getFrame()?.drawable,h.videos[1]);
  await h.client.stop();
  assert.equal(h.tracks[1].stopCount,1);
});

test('accepted window share rejects another picker until explicit Stop',async()=>{
  const h=delayedWindowCaptureHarness(),first=h.client.shareScreen();
  h.releasePlay();
  assert.equal(await first,true);
  assert.equal(h.count(),1);
  assert.equal(h.tracks[0].readyState,'live');
  assert.equal(await h.client.shareScreen(),false,'a duplicate click must not request another capture grant');
  assert.equal(h.count(),1,'a live view may own only one granted browser stream');
  assert.match(h.client.getState().inputStatus,/Stop the current shared window/);
  assert.equal(h.tracks[0].readyState,'live','rejecting duplicate must not disrupt the active view');
  await h.client.stop();
  assert.equal(h.tracks[0].readyState,'ended');
  assert.equal(await h.client.shareScreen(),true,'a new explicit click after Stop can request a fresh stream');
  assert.equal(h.count(),2);
  await h.client.stop();
  assert.equal(h.tracks[1].readyState,'ended');
});

test('late video playback rejection preserves Stop, pagehide and disposal state',async()=>{
  for(const method of ['stop','pagehide','dispose']){
    const h=delayedWindowCaptureHarness(),pending=h.client.shareScreen();
    await h.entered;
    await h.client[method]();
    assert.equal(h.tracks[0].readyState,'ended');
    assert.equal(h.client.getState().status,'idle');
    h.rejectPlay();
    assert.equal(await pending,false,'revoked pending capture must remain rejected');
    assert.equal(h.client.getState().status,'idle',method+' must not be overwritten by stale playback error');
    assert.match(h.client.getState().message,/Window disconnected/);
    assert.equal(h.tracks[0].stopCount,1,'stream may be revoked only once');
  }
});
test('old playback rejection cannot overwrite a newly consented live capture',async()=>{
  const h=delayedWindowCaptureHarness(),old=h.client.shareScreen();
  await h.entered;
  await h.client.stop();
  assert.equal(await h.client.shareScreen(),true,'explicit new user consent can start a new view');
  assert.equal(h.client.getState().status,'view-only');
  h.rejectPlay();
  assert.equal(await old,false);
  assert.equal(h.client.getState().status,'view-only','stale failure must not replace new live view');
  assert.equal(h.client.getFrame()?.drawable,h.videos[1]);
  assert.equal(h.tracks[0].readyState,'ended');
  assert.equal(h.tracks[1].readyState,'live');
  await h.client.stop();
  assert.equal(h.tracks[1].readyState,'ended');
});

function pendingWindowPickerHarness(){
  const pending=[],tracks=[];
  const client=createHolodeckWindowClient({
    locationRef:{hostname:'localhost',port:'4173'},sessionStore:null,
    navigatorRef:{mediaDevices:{getDisplayMedia(spec){
      assert.deepEqual(spec,{video:true,audio:false});
      return new Promise((resolve,reject)=>pending.push({resolve,reject}));
    }}},
    documentRef:{createElement(){return {
      videoWidth:640,videoHeight:480,srcObject:null,pause(){},play(){return Promise.resolve();}
    };}},
    setTimer:()=>1,clearTimer:()=>{},
    fetchRef:async()=>{throw Error('Native helper must not be contacted by browser capture');},
  });
  return {client,pending,tracks,
    reject(i){pending[i].reject(new Error('Obsolete picker cancelled'));},
    grant(i){
      const track={readyState:'live',stopCount:0,
        stop(){this.stopCount++;this.readyState='ended';},addEventListener(){}};
      tracks.push(track);
      pending[i].resolve({getTracks:()=>[track],getVideoTracks:()=>[track]});
      return track;
    },
  };
}
for(const method of ['stop','pagehide','dispose']){
  test('late browser picker rejection after '+method+' cannot overwrite revoked Spatial state',async()=>{
    const h=pendingWindowPickerHarness(),old=h.client.shareScreen();
    assert.equal(h.pending.length,1);
    await h.client[method]();
    assert.equal(h.client.getState().status,'idle');
    h.reject(0);
    assert.equal(await old,false);
    assert.equal(h.client.getState().status,'idle');
    assert.equal(h.client.getState().inputStatus,'');
    assert.match(h.client.getState().message,/Window disconnected/);
  });
}
test('late rejected picker cannot overwrite fresh explicitly consented Spatial view',async()=>{
  const h=pendingWindowPickerHarness(),old=h.client.shareScreen();
  await h.client.stop();
  const next=h.client.shareScreen();
  assert.equal(h.pending.length,2);
  const track=h.grant(1);
  assert.equal(await next,true);
  assert.equal(h.client.getState().status,'view-only');
  assert.equal(h.client.getState().inputStatus,'');
  h.reject(0);
  assert.equal(await old,false);
  assert.equal(h.client.getState().status,'view-only');
  assert.equal(h.client.getState().inputStatus,'');
  assert.equal(track.readyState,'live');
  await h.client.stop();
  assert.equal(track.stopCount,1);
});

function boundedPendingShareHarness({pending=false,listenerFailure=false,timerFailure=false}={}){
  let ended,resolvePlayback,pickerCount=0;
  const tracks=[];
  const client=createHolodeckWindowClient({
    locationRef:{hostname:'localhost',port:'4173'},sessionStore:null,
    navigatorRef:{mediaDevices:{getDisplayMedia:async()=>{
      pickerCount++;
      const t={readyState:'live',stops:0,
        stop(){this.stops++;this.readyState='ended';},
        addEventListener(event,fn){if(listenerFailure)throw Error('listener failure');if(event==='ended')ended=fn;}};
      tracks.push(t);return {getVideoTracks:()=>[t],getTracks:()=>[t]};
    }}},
    documentRef:{createElement:()=>({
      videoWidth:640,videoHeight:480,pause(){},srcObject:null,
      play(){return pending?new Promise(resolve=>{resolvePlayback=resolve;}):Promise.resolve();}
    })},
    setTimer(){if(timerFailure)throw Error('timer failure');return 1;},clearTimer(){},
    fetchRef:async()=>{throw Error('Browser share must not contact native helper');}
  });
  return {client,tracks,hasListener:()=>!!ended,hasPlayback:()=>!!resolvePlayback,end:()=>ended?.(),release:()=>resolvePlayback?.(),pickers:()=>pickerCount};
}
async function awaitPendingCapture(h){
  for(let i=0;i<50&&!(h.hasListener()&&h.hasPlayback());i++)await Promise.resolve();
  assert.equal(h.hasListener()&&h.hasPlayback(),true,'early track listener must be installed during pending playback');
}
test('ended track during unresolved video.play settles capture and revokes it exactly once',async()=>{
  const h=boundedPendingShareHarness({pending:true}),p=h.client.shareScreen();
  await awaitPendingCapture(h);h.end();
  assert.equal(await p,false);assert.equal(h.tracks[0].stops,1);
  assert.equal(h.client.getFrame(),null);
});
for(const method of ['stop','pagehide']){
  test(method+' resolves permanently pending share without waiting for video.play',async()=>{
    const h=boundedPendingShareHarness({pending:true}),p=h.client.shareScreen();
    await awaitPendingCapture(h);await h.client[method]();
    assert.equal(await p,false);assert.equal(h.tracks[0].stops,1);
    if(method==='pagehide')assert.equal(await h.client.shareScreen(),false);
  });
}
for(const fault of ['listenerFailure','timerFailure']){
  test(fault+' revokes the stream before capture adoption',async()=>{
    const h=boundedPendingShareHarness({[fault]:true});
    assert.equal(await h.client.shareScreen(),false);
    assert.equal(h.tracks[0].stops,1);
    assert.equal(h.tracks[0].readyState,'ended');
    assert.equal(h.client.getFrame(),null);
  });
}
test('early end listener retains explicit consent and single live stream rule',async()=>{
  const h=boundedPendingShareHarness();
  assert.equal(await h.client.shareScreen(),true);
  assert.equal(await h.client.shareScreen(),false);
  assert.equal(h.pickers(),1);h.end();
  assert.equal(h.tracks[0].stops,1);
  assert.equal(await h.client.shareScreen(),true);
  assert.equal(h.pickers(),2);await h.client.stop();
});

test('synchronous view-only publication revocation never re-arms an orphaned frame timer',async()=>{
  for (const method of ['stop','pagehide','dispose']){
    let client,stops=0,nextTimer=0;
    const timers=new Map();
    const track={readyState:'live',stop(){stops++;this.readyState='ended';},addEventListener(){}};
    const stream={getVideoTracks:()=>[track],getTracks:()=>[track]};
    client=createHolodeckWindowClient({
      locationRef:{hostname:'localhost',port:'4173'},sessionStore:null,
      navigatorRef:{mediaDevices:{getDisplayMedia:async()=>stream}},
      documentRef:{createElement:()=>({videoWidth:640,videoHeight:480,srcObject:null,pause(){},play:()=>Promise.resolve()})},
      setTimer(fn){const n=++nextTimer;timers.set(n,fn);return n;},clearTimer:n=>timers.delete(n),
      fetchRef:async()=>{throw Error('Browser sharing must not contact the native helper');},
      onChange:state=>{if(state.status==='view-only')void client[method]();}
    });
    assert.equal(await client.shareScreen(),false,method+' must revoke during first frame');
    assert.equal(stops,1,method+' must revoke the sole track once');
    assert.equal(timers.size,0,method+' must not leave a post-revocation timer');
    assert.equal(client.getFrame(),null);
    assert.equal(client.getState().status,'idle');
  }
});

// Native interactive mode must not resurrect a timer when its synchronous
// status subscriber revokes the connection while a frame is published.
async function nativePollReentrantHarness(method){
  const timers=new Map();let nextTimerId=0,client,revoked=false,frameCalls=0;
  const token='a'.repeat(64);
  client=createHolodeckWindowClient({
    locationRef:{hostname:'localhost',port:'4173'},sessionStore:{getItem:()=>null,setItem(){},removeItem(){}},
    documentRef:{createElement(kind){assert.equal(kind,'img');return {src:'',decode:async()=>{}};}},
    setTimer(fn,ms){const id=++nextTimerId;timers.set(id,{fn,ms});return id;},
    clearTimer(id){timers.delete(id);},
    onChange(state){if(method!=='normal'&&state.status==='live'&&!revoked){
      revoked=true;void client[method]();
    }},
    fetchRef:async url=>{
      const path=String(url);
      let data;
      if(path.endsWith('/session'))data={token};
      else if(path.endsWith('/windows'))data={windows:[{id:17,pid:19,title:'User-selected window'}]};
      else if(path.endsWith('/bind'))data={status:'connected'};
      else if(path.endsWith('/frame')){frameCalls++;data={status:'frame',serial:1,generation:1,jpeg:'ZmFrZQ=='};}
      else if(path.endsWith('/stop'))data={status:'stopped'};
      else throw Error('Unexpected native operation');
      return {ok:true,status:200,json:async()=>data};
    }
  });
  await client.discover();
  assert.equal(client.getState().status,'selecting');
  assert.equal(await client.connect(17),true);
  assert.equal(timers.size,1,'one initial native poll must be pending');
  const [timerId,initial]=timers.entries().next().value;
  timers.delete(timerId);
  await initial.fn();
  return {client,timers,revoked,frameCalls};
}
test('native interactive poll never resurrects a timer after synchronous Stop, pagehide or dispose',async()=>{
  for(const method of ['stop','pagehide','dispose']){
    const h=await nativePollReentrantHarness(method);
    assert.equal(h.revoked,true,method+' must revoke on live publication');
    assert.equal(h.frameCalls,1,method+' must fetch exactly one frame');
    assert.equal(h.client.getState().status,'idle');
    assert.equal(h.timers.size,0,method+' must not schedule after epoch invalidation');
  }
});
test('native interactive poll continues scheduling while the original connection remains live',async()=>{
  const h=await nativePollReentrantHarness('normal');
  assert.equal(h.revoked,false);
  assert.equal(h.frameCalls,1);
  assert.equal(h.client.getState().status,'live');
  assert.equal(h.timers.size,1,'healthy live polling must be re-armed');
  await h.client.stop();
  assert.equal(h.timers.size,0,'explicit Stop must clear the live poll timer');
});

test('native bind waiting publication cannot resurrect a timer after synchronous lifecycle revocation',async()=>{
  for(const method of ['stop','pagehide','dispose','normal']){
    const timers=new Map();let timerSequence=0,client,revocations=0;
    const token='a'.repeat(64);
    client=createHolodeckWindowClient({
      locationRef:{hostname:'localhost',port:'4173'},
      sessionStore:{getItem:()=>null,setItem(){},removeItem(){}},
      documentRef:{createElement:()=>({src:'',decode:async()=>{}})},
      setTimer(fn,ms){const id=++timerSequence;timers.set(id,{fn,ms});return id;},
      clearTimer(id){timers.delete(id);},
      onChange(state){if(method!=='normal'&&state.status==='waiting'&&!revocations){
        revocations++;void client[method]();
      }},
      fetchRef:async url=>{
        const path=String(url);let data;
        if(path.endsWith('/session'))data={token};
        else if(path.endsWith('/windows'))data={windows:[{id:17,pid:19,title:'User-selected window'}]};
        else if(path.endsWith('/bind'))data={status:'connected'};
        else if(path.endsWith('/stop'))data={status:'stopped'};
        else throw Error('Unexpected native request in waiting-state test');
        return {ok:true,status:200,json:async()=>data};
      }
    });
    await client.discover();assert.equal(client.getState().status,'selecting');
    const connected=await client.connect(17);
    if(method==='normal'){
      assert.equal(connected,true);assert.equal(client.getState().status,'waiting');
      assert.equal(timers.size,1,'healthy native connect schedules exactly one poll');
    }else{
      assert.equal(revocations,1,method+' revokes the waiting-state publication');
      assert.equal(connected,false,method+' cannot return success after revocation');
      assert.equal(client.getState().status,'idle');
      assert.equal(timers.size,0,method+' cannot leave a post-stop poll');
    }
    await client.stop();assert.equal(timers.size,0);
  }
});


function nativeDiscoveryReentrantHarness(stage,method){
  const timers=new Map();let timerId=0,client,revoked=false,windowResponses=0;
  client=createHolodeckWindowClient({
    locationRef:{hostname:'localhost',port:'4173'},
    sessionStore:{getItem:()=>null,setItem(){},removeItem(){}},
    setTimer(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},
    clearTimer(id){timers.delete(id);},
    onChange(state){
      if(method!=='normal'&&!revoked&&state.status==='selecting'&&
        (stage==='discover'||windowResponses>=2)){
        revoked=true;void client[method]();
      }
    },
    fetchRef:async url=>{
      const path=String(url);let data;
      if(path.endsWith('/session'))data={token:'a'.repeat(64)};
      else if(path.endsWith('/windows')){windowResponses++;data={windows:[{id:17,pid:19,title:'Original app'}]};}
      else if(path.endsWith('/stop'))data={status:'stopped'};
      else throw Error('Unexpected native request in selection lifecycle test');
      return {ok:true,status:200,json:async()=>data};
    }
  });
  return {client,timers,revoked:()=>revoked,
    async run(){
      await client.discover();
      if(stage==='refresh'){
        const [id,task]=timers.entries().next().value??[];
        assert.ok(task,'healthy initial selection must schedule one refresh');
        timers.delete(id);await task.fn();
      }
    }};
}
test('native initial window list cannot schedule a timer after synchronous Stop/pagehide/dispose',async()=>{
  for(const method of ['stop','pagehide','dispose','normal']){
    const h=nativeDiscoveryReentrantHarness('discover',method);
    await h.run();
    if(method==='normal'){
      assert.equal(h.client.getState().status,'selecting');
      assert.equal(h.timers.size,1,'normal list should refresh');
    }else{
      assert.equal(h.revoked(),true,method+' must revoke the initial selection');
      assert.equal(h.client.getState().status,'idle');
      assert.equal(h.timers.size,0,method+' cannot rearm a revoked discovery timer');
    }
    await h.client.stop();assert.equal(h.timers.size,0);
  }
});
test('native refreshed window list cannot schedule a timer after synchronous Stop/pagehide/dispose',async()=>{
  for(const method of ['stop','pagehide','dispose','normal']){
    const h=nativeDiscoveryReentrantHarness('refresh',method);
    await h.run();
    if(method==='normal'){
      assert.equal(h.client.getState().status,'selecting');
      assert.equal(h.timers.size,1,'normal refreshed list should schedule the next refresh');
    }else{
      assert.equal(h.revoked(),true,method+' must revoke the refreshed selection');
      assert.equal(h.client.getState().status,'idle');
      assert.equal(h.timers.size,0,method+' cannot rearm a revoked refresh timer');
    }
    await h.client.stop();assert.equal(h.timers.size,0);
  }
});

test('native discovery connecting-state revocation never allocates a new session',async()=>{
  for(const method of ['stop','pagehide','dispose','normal']){
    let client,triggered=false;
    const paths=[];
    const fetchRef=async url=>{
      const path=String(url).slice(String(url).lastIndexOf('/'));
      paths.push(path);
      return {ok:true,status:200,json:async()=>path==='/session'
        ?{token:'a'.repeat(64)}:path==='/windows'
        ?{windows:[{id:'window-1',pid:77,title:'ChatGPT'}]}:{}};
    };
    client=createHolodeckWindowClient({
      locationRef:{hostname:'localhost',port:'4173'},sessionStore:null,
      fetchRef,setTimer:()=>1,clearTimer:()=>{},
      onChange(state){
        if(state.status==='connecting'&&!triggered){
          triggered=true;
          if(method==='dispose')client.dispose();
          else if(method!=='normal')void client[method]();
        }
      }
    });
    await client.discover();
    assert.equal(triggered,true);
    if(method==='normal'){
      assert.deepEqual(paths,['/session','/windows']);
      assert.equal(client.getState().status,'selecting');
    }else{
      assert.deepEqual(paths,[]);
      assert.equal(client.getState().status,'idle');
    }
  }
});

// Transition model: each consent owns its resources from picker to live view.
// This harness schedules external completions independently of UI callbacks.
function captureStep(){
  let resolve,reject,settled=false;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,get settled(){return settled;},resolve(value){if(!settled){settled=true;resolve(value);}},
    reject(error=new Error('late fixture failure')){if(!settled){settled=true;reject(error);}}};
}
async function drainCaptureTransitions(){for(let i=0;i<30;i++)await Promise.resolve();}
async function captureSettled(promise){
  let settled=false,value;
  promise.then(result=>{settled=true;value=result;});
  await drainCaptureTransitions();
  assert.equal(settled,true,'local cancellation must settle without waiting for external completion');
  return value;
}
function captureTransitionHarness({initialNative=false,delayStops=false,inputFailure=null,inputOutcome=()=> 'input-posted'}={}){
  const saved=new Map(),pickers=[],plays=[],tracks=[],videos=[],timers=new Map(),calls=[],stops=[];
  if(initialNative)saved.set('stephanos.spatial-window.session.v1','a'.repeat(64));
  let nextTimer=0,sessions=0,hook=()=>{};
  const client=createHolodeckWindowClient({
    locationRef:{hostname:'localhost',port:'4173'},
    sessionStore:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)},
    navigatorRef:{mediaDevices:{getDisplayMedia(spec){
      assert.deepEqual(spec,{video:true,audio:false});const picker=captureStep();pickers.push(picker);return picker.promise;
    }}},
    documentRef:{createElement(kind){
      if(kind==='img')return {src:'',decode:async()=>{}};
      assert.equal(kind,'video');const playback=captureStep();plays.push(playback);
      const video={videoWidth:640,videoHeight:480,srcObject:null,pauseCount:0,
        play:()=>playback.promise,pause(){this.pauseCount++;}};
      videos.push(video);return video;
    }},
    setTimer(fn){const id=++nextTimer;timers.set(id,fn);return id;},clearTimer:id=>timers.delete(id),
    onChange:state=>hook(state),
    fetchRef:async(url,options)=>{
      const path=new URL(url).pathname;calls.push({path,token:options.headers['X-Spatial-Session']});
      const response=data=>({ok:true,status:200,json:async()=>data});
      if(path==='/stop'){
        if(!delayStops)return response({status:'stopped'});
        const stopped=captureStep();stops.push(stopped);return stopped.promise;
      }
      if(path==='/session')return response({token:(++sessions%2?'b':'c').repeat(64)});
      if(path==='/windows')return response({windows:[{id:17,pid:19,title:'Selected app'}]});
      if(path==='/bind')return response({status:'connected'});
      if(path==='/input'){
        // The application might apply input even when its HTTP reply is lost.
        const body=JSON.parse(options.body);
        if(body.kind==='text'&&inputFailure==='network')throw new Error('Response lost after possible native input');
        if(body.kind==='text'&&inputFailure==='http')return {ok:false,status:503,json:async()=>({status:'unavailable'})};
        return response({status:inputOutcome(JSON.parse(options.body))});
      }
      if(path==='/frame')return response({status:'frame',serial:calls.length,generation:1,jpeg:'fixture'});
      throw Error('Unexpected native request');
    },
  });
  const h={client,pickers,plays,tracks,videos,timers,calls,stops,setHook(fn){hook=fn;},
    grant(index){
      const listeners=new Set();
      const track={readyState:'live',stopCount:0,stop(){this.stopCount++;this.readyState='ended';},
        addEventListener(event,fn){assert.equal(event,'ended');listeners.add(fn);},
        removeEventListener(event,fn){assert.equal(event,'ended');listeners.delete(fn);},
        end(){this.readyState='ended';for(const fn of [...listeners])fn();},listenerCount:()=>listeners.size};
      tracks.push(track);pickers[index].resolve({getVideoTracks:()=>[track],getTracks:()=>[track]});return track;
    },
    releaseStops(){for(const stopped of stops)stopped.resolve({ok:true,status:200,json:async()=>({status:'stopped'})});},
    async tick(){const entry=timers.entries().next().value;assert.ok(entry,'one owned timer must exist');timers.delete(entry[0]);await entry[1]();},
    assertResources(live){
      assert.equal(tracks.filter(track=>track.readyState==='live').length,live);
      assert.ok(tracks.every(track=>track.stopCount<=1),'each track is stopped at most once');
      assert.ok(videos.filter(video=>video.srcObject!==null).length<=1,'only one owned video may be attached');
      assert.ok(timers.size<=1,'only the current owner may schedule work');
    },
    async close(){hook=()=>{};client.dispose();h.releaseStops();for(const pending of [...pickers,...plays])pending.reject();await drainCaptureTransitions();},
  };
  return h;
}

test('capture adoption retains its owner during internal native revocation and rejects reentrant duplicate consent',async()=>{
  const h=captureTransitionHarness({initialNative:true,delayStops:true});let nested,armed=true;
  h.setHook(state=>{if(armed&&state.status==='idle'){armed=false;nested=h.client.shareScreen();}});
  try{
    const outer=h.client.shareScreen();h.grant(0);await drainCaptureTransitions();
    assert.equal(await nested,false);assert.equal(h.pickers.length,1);
    assert.equal(h.videos.length,0,'native revocation must finish before playback');
    h.releaseStops();await drainCaptureTransitions();h.plays[0].resolve();
    assert.equal(await outer,true);assert.equal(h.client.getFrame()?.drawable,h.videos[0]);
    assert.equal(h.timers.size,1);h.assertResources(1);
  }finally{await h.close();}
});

test('Stop or discover reentry during capture disconnect publication cannot share the outer transition epoch',async()=>{
  for(const operation of ['stop','discover']){
    const h=captureTransitionHarness({initialNative:true,delayStops:true});let nested,armed=true;
    h.setHook(state=>{if(armed&&state.status==='idle'){armed=false;nested=h.client[operation]();}});
    try{
      const outer=h.client.shareScreen();const track=h.grant(0);await drainCaptureTransitions();
      assert.equal(await captureSettled(outer),false);
      assert.equal(track.stopCount,1);assert.equal(h.videos.length,0);
      assert.equal(h.calls.some(call=>call.path==='/session'),false);
      assert.ok(h.calls.every(call=>call.path==='/stop'&&call.token==='a'.repeat(64)));
      h.releaseStops();await nested;await drainCaptureTransitions();
      assert.equal(h.calls.filter(call=>call.path==='/session').length,operation==='discover'?1:0);
      assert.equal(h.client.getState().status,operation==='discover'?'selecting':'idle');
      h.assertResources(0);
    }finally{await h.close();}
  }
});

test('nested discovery during disconnect publication allocates only the latest native session',async()=>{
  const h=captureTransitionHarness();let inner,armed=true;
  h.setHook(state=>{if(armed&&state.status==='idle'){armed=false;inner=h.client.discover();}});
  try{
    await h.client.discover();await inner;
    assert.deepEqual(h.calls.map(call=>call.path),['/session','/windows']);
    assert.equal(h.client.getState().status,'selecting');assert.equal(h.timers.size,1);
  }finally{await h.close();}
});

test('cancelled picker and playback completions cannot clean up a newer explicitly consented owner',async()=>{
  for(const stage of ['picker','playback'])for(const outcome of ['resolve','reject'])for(const departure of ['stop','cached-pagehide']){
    const h=captureTransitionHarness();
    try{
      const old=h.client.shareScreen();
      if(stage==='playback'){h.grant(0);await drainCaptureTransitions();assert.equal(h.plays.length,1);}
      if(departure==='stop')await h.client.stop();else await h.client.pagehide({persisted:true});
      assert.equal(await captureSettled(old),false);
      const replacement=h.client.shareScreen();const fresh=h.grant(1);await drainCaptureTransitions();
      const video=h.videos.at(-1);h.plays.at(-1).resolve();assert.equal(await replacement,true);
      if(stage==='picker'){
        if(outcome==='resolve'){const stale=h.grant(0);await drainCaptureTransitions();assert.equal(stale.stopCount,1);}
        else h.pickers[0].reject();
      }else h.plays[0][outcome]();
      await drainCaptureTransitions();
      assert.equal(fresh.readyState,'live');assert.equal(h.client.getFrame()?.drawable,video);
      assert.equal(h.client.getState().status,'view-only');assert.equal(h.timers.size,1);h.assertResources(1);
    }finally{await h.close();}
  }
});

test('track loss revokes its sole owner during native stop playback and accepted view without awaiting external promises',async()=>{
  for(const stage of ['native-stop','playback','live']){
    const h=captureTransitionHarness({initialNative:true,delayStops:true});
    try{
      const sharing=h.client.shareScreen();const track=h.grant(0);await drainCaptureTransitions();
      assert.equal(track.listenerCount(),1,'track loss must be observed before the native stop await');
      if(stage!=='native-stop'){h.releaseStops();await drainCaptureTransitions();}
      if(stage==='live'){h.plays[0].resolve();assert.equal(await sharing,true);}
      track.end();
      if(stage!=='live')assert.equal(await captureSettled(sharing),false);
      assert.equal(h.client.getFrame(),null);assert.equal(h.client.getState().status,'idle');
      assert.equal(track.listenerCount(),0);assert.equal(h.timers.size,0);h.assertResources(0);
      const stops=track.stopCount;
      const first=h.client.stop(),second=h.client.stop();h.releaseStops();await Promise.all([first,second]);
      h.client.dispose();h.releaseStops();await drainCaptureTransitions();
      assert.equal(track.stopCount,stops,'repeated revocation cannot stop a retired track again');
    }finally{await h.close();}
  }
});


test('virtual non-text keys require a current editor acknowledgement before any native request',async()=>{
  const h=captureTransitionHarness({inputOutcome:body=>body.kind==='click'
    ?(body.x<.8?'editor-accessibility-selected':'input-posted')
    :body.kind==='key'?'editor-key-focus-unverified':'editor-value-readback'});
  try{
    await h.client.discover();assert.equal(await h.client.connect(17),true);await h.tick();
    assert.equal(h.client.getState().status,'live');
    assert.equal(h.client.input({kind:'key',key:'Enter'}),false,'binding alone cannot authorise Enter');
    assert.match(h.client.getState().inputStatus,/No key was sent/);
    assert.equal(h.calls.filter(call=>call.path==='/input').length,0);
    assert.equal(h.client.input({kind:'click',x:.3,y:.5}),true);
    assert.equal(h.client.input({kind:'key',key:'Enter'}),false,'queued click is not editor proof');
    await h.tick();
    assert.equal(h.client.input({kind:'key',key:'Enter'}),true,'confirmed editor allows native focus check');
    await h.tick();
    assert.match(h.client.getState().inputStatus,/has not established keyboard focus/);
    assert.equal(h.client.input({kind:'key',key:'Enter'}),false,'native focus uncertainty revokes editor acknowledgement');
    assert.equal(h.calls.filter(call=>call.path==='/input').length,2);
    assert.equal(h.client.input({kind:'click',x:.9,y:.5}),true);
    assert.equal(h.client.input({kind:'key',key:'Tab'}),false,'new click invalidates old editor immediately');
    await h.tick();
    assert.equal(h.client.input({kind:'key',key:'Enter'}),false,'button click is not an editor selection');
    assert.equal(h.client.input({kind:'click',x:.3,y:.5}),true);await h.tick();
    assert.equal(h.client.input({kind:'key',key:'Tab'}),true);
    await h.client.stop();
    assert.equal(h.client.input({kind:'key',key:'Enter'}),false,'stop revokes editor proof');
    assert.equal(h.calls.filter(call=>call.path==='/input').length,4,'no unsupported key was forwarded');
  }finally{await h.close();}
});

test('lost native input acknowledgement remains unverified and never replays a key',async()=>{
  for(const inputFailure of ['network','http']){
    const h=captureTransitionHarness({inputFailure,inputOutcome:body=>
      body.kind==='click'?'editor-accessibility-selected':'input-posted'});
    try{
      await h.client.discover();
      assert.equal(await h.client.connect(17),true);
      await h.tick();
      assert.equal(h.client.getState().status,'live');
      assert.equal(h.client.input({kind:'click',x:.3,y:.5}),true);await h.tick();
      assert.equal(h.client.input({kind:'text',text:'unsent fixture'}),true);
      await h.tick();
      assert.equal(h.calls.filter(call=>call.path==='/input').length,2,
        'an ambiguous transport failure must not replay its native input');
      assert.equal(h.client.getState().status,'unavailable');
      assert.match(h.client.getState().inputStatus,/may already have changed/);
      assert.match(h.client.getState().inputStatus,/do not resend automatically/);
      assert.match(h.client.getState().message,/original app/);
      assert.equal(h.timers.size,0,'no background replay or poll after failed input');
      assert.equal(h.client.input({kind:'text',text:'unsafe retry'}),false);
      assert.equal(h.calls.filter(call=>call.path==='/input').length,2);
    }finally{await h.close();}
  }
});

test('uncertain editor changes discard queued Enter and require fresh editor selection',async()=>{
  for(const outcome of ['editor-update-refused','editor-update-unverified','input-rejected']){
    const h=captureTransitionHarness({inputOutcome:body=>
      body.kind==='click'?'editor-accessibility-selected':
      body.kind==='text'?outcome:'input-posted'});
    try{
      await h.client.discover();assert.equal(await h.client.connect(17),true);await h.tick();
      assert.equal(h.client.input({kind:'click',x:.3,y:.5}),true);
      await h.tick();
      assert.equal(h.client.input({kind:'text',text:'unsent draft'}),true);
      assert.equal(h.client.input({kind:'key',key:'Enter'}),true,
        'Enter may have been queued before the editor reply');
      await h.tick();
      assert.equal(h.calls.filter(call=>call.path==='/input').length,2);
      assert.equal(h.client.input({kind:'key',key:'Enter'}),false,
        'uncertain editor result must revoke the prior keyboard acknowledgement');
      await h.tick();
      assert.equal(h.calls.filter(call=>call.path==='/input').length,2,
        'queued Enter must not be posted after ambiguous text mutation');
      assert.equal(h.client.input({kind:'click',x:.3,y:.5}),true);
      await h.tick();
      assert.equal(h.client.input({kind:'key',key:'Enter'}),true,
        'only a new explicit editor selection can admit a later deliberate key');
      await h.tick();
      assert.equal(h.calls.filter(call=>call.path==='/input').length,4);
      assert.equal(h.client.input({kind:'key',key:'Enter'}),false,
        'a non-text action must not preserve the old keyboard destination');
    }finally{await h.close();}
  }
});

test('native input publication is a transition boundary before fetching the next frame',async()=>{
  for(const operation of ['stop','pagehide','dispose','normal']){
    const h=captureTransitionHarness({inputOutcome:body=>
      body.kind==='click'?'editor-accessibility-selected':'input-posted'});let revoked=false;
    try{
      await h.client.discover();assert.equal(await h.client.connect(17),true);await h.tick();
      assert.equal(h.client.getState().status,'live');
      assert.equal(h.client.input({kind:'click',x:.3,y:.5}),true);await h.tick();
      const framesBefore=h.calls.filter(call=>call.path==='/frame').length;
      h.setHook(state=>{if(!revoked&&operation!=='normal'&&state.inputStatus==='Windows queued the pointer/key event, but the app has not confirmed it.'){
        revoked=true;void h.client[operation]();
      }});
      assert.equal(h.client.input({kind:'text',text:'fixture'}),true);await h.tick();
      assert.equal(h.calls.filter(call=>call.path==='/input').length,2);
      assert.equal(h.calls.filter(call=>call.path==='/frame').length,framesBefore+(operation==='normal'?1:0));
      assert.equal(h.timers.size,operation==='normal'?1:0);
      assert.equal(h.client.getState().status,operation==='normal'?'live':'idle');
    }finally{await h.close();}
  }
});

test('unexpected native text replies revoke queued Enter and require fresh editor selection',async()=>{
  // An unfamiliar helper response or local refusal must never make the room
  // assume the original ChatGPT editor remains a safe keyboard destination.
  for(const outcome of ['editor-length-refused','editor-update-not-started',
    'editor-unsupported','input-posted','unexpected-native-status']){
    const h=captureTransitionHarness({inputOutcome:body=>
      body.kind==='click'?'editor-accessibility-selected':
      body.kind==='text'?outcome:'input-posted'});
    try{
      await h.client.discover();assert.equal(await h.client.connect(17),true);await h.tick();
      assert.equal(h.client.input({kind:'click',x:.3,y:.5}),true);await h.tick();
      assert.equal(h.client.input({kind:'text',text:'unsent draft'}),true);
      assert.equal(h.client.input({kind:'key',key:'Enter'}),true,'Enter queued before native reply');
      await h.tick();
      assert.equal(h.calls.filter(call=>call.path==='/input').length,2);
      assert.equal(h.client.input({kind:'key',key:'Enter'}),false,
        'unconfirmed native outcome must invalidate the editor acknowledgement');
      await h.tick();
      assert.equal(h.calls.filter(call=>call.path==='/input').length,2,
        'previously queued Enter must never reach native input');
      assert.match(h.client.getState().inputStatus,/No key was sent/);
    }finally{await h.close();}
  }
});

test('unverified native clicks discard queued draft text rather than typing into an unknown control',async()=>{
  for(const outcome of ['input-posted','editor-not-selected','editor-reselect-required',
    'editor-unsupported','app-control-invoked','unexpected-click-status']){
    const h=captureTransitionHarness({inputOutcome:body=>
      body.kind==='click'?(body.x<.5?outcome:'editor-accessibility-selected')
      :body.kind==='text'?'editor-value-readback':'input-posted'});
    try{
      await h.client.discover();assert.equal(await h.client.connect(17),true);await h.tick();
      assert.equal(h.client.input({kind:'click',x:.2,y:.5}),true);
      assert.equal(h.client.input({kind:'text',text:'draft waiting for click'}),true,
        'the draft can be queued while the helper is deciding what received the click');
      await h.tick();await h.tick();
      assert.equal(h.calls.filter(call=>call.path==='/input').length,1,
        outcome+' cannot deliver a queued draft into an unverified target');
      assert.equal(h.client.input({kind:'key',key:'Enter'}),false,
        'unverified native click cannot license sending a draft');
      assert.equal(h.client.input({kind:'click',x:.8,y:.5}),true);
      assert.equal(h.client.input({kind:'text',text:'draft after explicit editor selection'}),true);
      await h.tick();await h.tick();
      assert.equal(h.calls.filter(call=>call.path==='/input').length,3,
        'confirmed selection retains a deliberately queued text edit');
    }finally{await h.close();}
  }
});

test('unsolicited draft text is held until the original app editor is explicitly selected',async()=>{
  for(const clickOutcome of ['editor-accessibility-selected','input-posted']){
    const h=captureTransitionHarness({inputOutcome:body=>
      body.kind==='click'?clickOutcome:'editor-value-readback'});
    try{
      await h.client.discover();assert.equal(await h.client.connect(17),true);await h.tick();
      assert.equal(h.client.input({kind:'text',text:'unsolicited draft'}),false,
        'binding and a live frame alone are not editor permission');
      assert.match(h.client.getState().inputStatus,/No draft text was sent/);
      assert.equal(h.calls.filter(call=>call.path==='/input').length,0);
      assert.equal(h.client.input({kind:'click',x:.3,y:.5}),true);
      assert.equal(h.client.input({kind:'text',text:'explicitly queued draft'}),true,
        'a pending deliberate click may own text only after native acknowledgement');
      await h.tick();await h.tick();
      assert.equal(h.calls.filter(call=>call.path==='/input').length,
        clickOutcome==='editor-accessibility-selected'?2:1,
        'only an acknowledged editor may receive queued draft text');
    }finally{await h.close();}
  }
});

test('newer deliberate editor click supersedes draft queued for the previous target',async()=>{
  const observed=[];
  const h=captureTransitionHarness({inputOutcome:body=>{
    observed.push(body);
    return body.kind==='click'?'editor-accessibility-selected':'editor-value-readback';
  }});
  try{
    await h.client.discover();assert.equal(await h.client.connect(17),true);await h.tick();
    assert.equal(h.client.input({kind:'click',x:.2,y:.5}),true);
    assert.equal(h.client.input({kind:'text',text:'old target draft'}),true);
    assert.equal(h.client.input({kind:'click',x:.8,y:.5}),true,
      'a fresh explicit target replaces the older pending click and draft');
    await h.tick();await h.tick();
    assert.deepEqual(observed.map(body=>body.kind),['click'],
      'no obsolete click or queued text may be forwarded to native input');
    assert.equal(observed[0].x,.8,'the latest deliberate target is retained');
    assert.equal(h.client.input({kind:'text',text:'deliberate fresh draft'}),true);
    await h.tick();
    assert.deepEqual(observed.map(body=>body.kind),['click','text']);
    assert.equal(observed[1].text,'deliberate fresh draft');
  }finally{await h.close();}
});

test('a second click during a native click response revokes text queued for the first editor',async()=>{
  let h;const observed=[];
  h=captureTransitionHarness({inputOutcome:body=>{
    observed.push(body);
    if(body.kind==='click'&&body.x===.2){
      assert.equal(h.client.input({kind:'text',text:'queued behind old click'}),true);
      assert.equal(h.client.input({kind:'click',x:.8,y:.5}),true);
    }
    return body.kind==='click'?'editor-accessibility-selected':'editor-value-readback';
  }});
  try{
    await h.client.discover();assert.equal(await h.client.connect(17),true);await h.tick();
    assert.equal(h.client.input({kind:'click',x:.2,y:.5}),true);
    await h.tick();await h.tick();await h.tick();
    assert.deepEqual(observed.map(body=>body.kind),['click','click'],
      'in-flight click is not replayed, and old queued draft is discarded');
    assert.deepEqual(observed.map(body=>body.x),[.2,.8]);
    assert.equal(h.client.input({kind:'text',text:'freshly selected editor only'}),true);
    await h.tick();
    assert.deepEqual(observed.map(body=>body.kind),['click','click','text']);
  }finally{await h.close();}
});


test('native stop refusal is not reported as a verified disconnect and blocks automatic reconnect',async()=>{
  const key='stephanos.spatial-window.session.v1',saved=new Map([[key,'a'.repeat(64)]]);
  const paths=[];let stopAllowed=false;
  const client=createHolodeckWindowClient({
    locationRef:{hostname:'localhost',port:'4173'},
    sessionStore:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value),
      removeItem:key=>saved.delete(key)},
    setTimer:()=>1,clearTimer:()=>{},
    fetchRef:async url=>{
      const path=new URL(url).pathname;paths.push(path);
      if(path==='/stop')return stopAllowed
        ?{ok:true,status:200,json:async()=>({status:'stopped'})}
        :{ok:false,status:403,json:async()=>({status:'refused'})};
      if(path==='/session')return {ok:true,status:200,json:async()=>({token:'b'.repeat(64)})};
      if(path==='/windows')return {ok:true,status:200,json:async()=>({windows:[]})};
      throw Error('Unexpected native request '+path);
    }
  });
  assert.equal(await client.stop(),false,'a refused native stop is not release proof');
  assert.equal(client.getState().status,'unavailable');
  assert.match(client.getState().message,/did not confirm capture release/);
  assert.equal(saved.get(key),'a'.repeat(64),'retain the old token for a deliberate later stop attempt');
  assert.equal(await client.discover(),false,'automatic discovery cannot proceed after unverified stop');
  assert.deepEqual(paths,['/stop','/stop'],'no fresh session is allocated while prior capture may live');
  stopAllowed=true;
  await client.discover();
  assert.equal(client.getState().status,'selecting');
  assert.deepEqual(paths.slice(2),['/stop','/session','/windows']);
  assert.equal(saved.get(key),'b'.repeat(64),'a verified stop permits fresh native consent');
  await client.stop();
});

test('browser view-only fallback never adopts a capture after an unverified native stop',async()=>{
  const key='stephanos.spatial-window.session.v1',saved=new Map([[key,'a'.repeat(64)]]);
  let stops=0;
  const track={readyState:'live',stop(){stops++;this.readyState='ended';},addEventListener(){}};
  const client=createHolodeckWindowClient({
    locationRef:{hostname:'localhost',port:'4173'},
    sessionStore:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value),
      removeItem:key=>saved.delete(key)},
    navigatorRef:{mediaDevices:{getDisplayMedia:()=>Promise.resolve({
      getVideoTracks:()=>[track],getTracks:()=>[track]})}},
    fetchRef:async(url)=>{assert.equal(new URL(url).pathname,'/stop');
      return {ok:false,status:503,json:async()=>({status:'unavailable'})};},
    setTimer:()=>1,clearTimer:()=>{},
  });
  assert.equal(await client.shareScreen(),false);
  assert.equal(track.readyState,'ended');assert.equal(stops,1);
  assert.equal(client.getFrame(),null);assert.equal(client.getState().status,'unavailable');
  assert.match(client.getState().message,/Native window release unverified/);
  assert.equal(saved.get(key),'a'.repeat(64),'unverified native session must not be forgotten');
  await client.stop();
});

test('a cancelled delayed native session grant must be released before any next native session',async()=>{
  // A /session response can arrive after Stop. Its later /stop may fail even
  // though no token existed when Stop ran; that is not proof of release.
  const lateSession=captureStep(),paths=[],originalToken='d'.repeat(64);
  let sessions=0,stopAllowed=false;
  const answer=(data,ok=true)=>({ok,status:ok?200:403,json:async()=>data});
  const client=createHolodeckWindowClient({
    locationRef:{hostname:'localhost',port:'4173'},sessionStore:null,
    setTimer:()=>1,clearTimer:()=>{},
    fetchRef:url=>{
      const path=new URL(url).pathname;paths.push(path);
      if(path==='/session')return ++sessions===1
        ?lateSession.promise:Promise.resolve(answer({token:'e'.repeat(64)}));
      if(path==='/stop')return Promise.resolve(stopAllowed
        ?answer({status:'stopped'}):answer({status:'refused'},false));
      if(path==='/windows')return Promise.resolve(answer({windows:[]}));
      throw Error('Unexpected native request '+path);
    }
  });
  const opening=client.discover();
  await drainCaptureTransitions();
  assert.equal(sessions,1,'one pending native session is being allocated');
  assert.equal(await client.stop(),true,'local Stop cannot know a token not yet returned');
  assert.equal(await client.discover(),false,'second discovery must not allocate while the first grant is pending');
  assert.equal(sessions,1);
  lateSession.resolve(answer({token:originalToken}));
  assert.equal(await opening,false,'cancelled grant can never be adopted');
  assert.deepEqual(paths,['/session','/stop'],'late grant receives one bounded release attempt');
  assert.equal(await client.discover(),false,'failed late release keeps the token as an in-memory fence');
  assert.deepEqual(paths,['/session','/stop','/stop']);
  assert.equal(sessions,1,'no second session may be allocated after denied release');
  stopAllowed=true;
  assert.equal(await client.discover(),true,'verified release admits a subsequent explicit discovery');
  assert.deepEqual(paths.slice(3),['/stop','/session','/windows']);
  assert.equal(sessions,2);
  await client.stop();
});

test('blocked sessionStorage property getter cannot prevent Spatial console bootstrap',async()=>{
  // Some privacy modes throw while obtaining sessionStorage itself, before
  // getItem is reached. Native consent must remain off and the room must load.
  const previous=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
  assert.ok(!previous||previous.configurable,'isolated test must be able to restore the global');
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,
    get(){throw new Error('SecurityError: storage access denied');}});
  try {
    let nativeRequests=0;
    const client=createHolodeckWindowClient({
      locationRef:{hostname:'localhost',port:'4173'},
      fetchRef:async()=>{nativeRequests++;throw Error('no native request expected');},
      setTimer:()=>1,clearTimer:()=>{},
    });
    assert.equal(client.getState().status,'idle');
    assert.equal(client.getFrame(),null);
    assert.equal(nativeRequests,0,'startup must not request a Windows grant');
    assert.equal(await client.stop(),true);
    assert.equal(nativeRequests,0,'inert disconnect must not contact the helper');
  } finally {
    if(previous)Object.defineProperty(globalThis,'sessionStorage',previous);
    else delete globalThis.sessionStorage;
  }
});
