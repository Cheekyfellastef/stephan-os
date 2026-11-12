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
test('hologram paints actual consented video while rejecting pointer and keyboard input',async()=>{
  const h=harness();await h.client.shareScreen();
  const contexts=[];
  const documentRef={createElement:()=>{
    const ctx={pictures:[],fillRect(){},clearRect(){},strokeRect(){},fillText(){},drawImage(...args){this.pictures.push(args);}};
    contexts.push(ctx);return {getContext:()=>ctx};
  }};
  const screen=createHolodeckScreen({client:h.client,documentRef});screen.render();
  assert.equal(contexts[0].pictures.at(-1)[0],h.video);
  assert.equal(screen.point(.5,.5,true),false);screen.action('key:a');screen.action('enter');
  assert.match(screen.getState().inputStatus,/view-only/i);
  assert.equal(h.networkCount(),0);await h.client.stop();
});
test('launcher exposes both real native interactive and user-consented view-only routes',async()=>{
  const {readFileSync}=await import('node:fs');
  const html=readFileSync(new URL('../apps/spatial-bridge/quest-entry.html',import.meta.url),'utf8');
  assert.match(html,/id="choose-window"/);assert.match(html,/id="share-window"/);
  assert.match(html,/client.shareScreen\(\)/);assert.match(html,/client.connect\(Number\(windowSelector.value\)\)/);
  assert.match(html,/native Windows helper/i);
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
