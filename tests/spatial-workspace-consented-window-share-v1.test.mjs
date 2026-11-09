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
  let releasePlay,enteredPlay,acquisitions=0;
  const entered=new Promise(resolve=>{enteredPlay=resolve;});
  const pendingPlay=new Promise(resolve=>{releasePlay=resolve;});
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
  return {client,entered,releasePlay:()=>releasePlay(),tracks,videos,count:()=>acquisitions};
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
