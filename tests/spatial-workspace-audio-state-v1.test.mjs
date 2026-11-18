import test from 'node:test';
import assert from 'node:assert/strict';
import { createHolodeckAudioControls,readSpatialAudioPreferences } from '../apps/spatial-bridge/holodeck-audio-v1.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function mediaStream(){
  const listeners=new Set();
  const track={readyState:'live',stops:0,stop(){this.stops++;this.readyState='ended';},
    addEventListener(event,listener){assert.equal(event,'ended');listeners.add(listener);},
    removeEventListener(event,listener){assert.equal(event,'ended');listeners.delete(listener);},
    end(){this.readyState='ended';for(const listener of [...listeners])listener();}};
  return {track,getTracks:()=>[track],getAudioTracks:()=>[track]};
}
function microphoneHarness(options={}){
  const requests=[],changes=[],statuses=[];
  const audio=createHolodeckAudioControls({AudioContextCtor:null,
    navigatorRef:{mediaDevices:{
      async enumerateDevices(){return ['headset','old-microphone','new-microphone'].map(id=>({kind:'audioinput',deviceId:id,label:id}));},
      getUserMedia(spec){const request=deferred();requests.push({...request,spec});return request.promise;},
    }},
    onChange:state=>changes.push(state),onStatus:message=>statuses.push(message),...options});
  return {audio,requests,changes,statuses};
}

test('one audio state projects device selections to both presentations without requesting permission',async()=>{
  const changes=[],statuses=[],calls=[];
  const audio=createHolodeckAudioControls({AudioContextCtor:null,onChange:s=>changes.push(s),onStatus:s=>statuses.push(s),
    navigatorRef:{mediaDevices:{
      async enumerateDevices(){calls.push('enumerate');return [
        {kind:'audioinput',deviceId:'mic-1',label:'Headset microphone'},
        {kind:'audiooutput',deviceId:'speaker-1',label:'Headset speakers'},
        {kind:'videoinput',deviceId:'camera-1',label:'Camera'},
      ];},getUserMedia(){assert.fail('Listing or selection must not acquire microphone access');},
    }}});
  assert.equal(changes.length,0,'construction must not call a consumer before its binding exists');
  assert.equal(audio.getState().revision,0);
  const listed=await audio.listDevices();assert.equal(listed.ok,true);
  assert.deepEqual(calls,['enumerate']);
  assert.equal(audio.setInput('mic-1'),true);assert.equal(audio.setOutput('speaker-1'),true);
  const state=audio.getState();
  assert.deepEqual(state.inputs,[{id:'mic-1',label:'Headset microphone'}]);
  assert.deepEqual(state.outputs,[{id:'speaker-1',label:'Headset speakers'}]);
  assert.equal(state.inputId,'mic-1');assert.equal(state.outputId,'speaker-1');
  assert.equal(state.microphoneActive,false);assert.equal(state.microphonePending,false);
  assert.deepEqual(changes.at(-1),state);assert.equal(statuses.at(-1),state.status);
  state.inputs[0].label='Changed outside controller';listed.outputs[0].id='replaced';
  assert.equal(audio.getState().inputs[0].label,'Headset microphone');
  assert.equal(audio.getState().outputs[0].id,'speaker-1');
  audio.dispose();
});

test('microphone test uses the shared selection and owns exactly one pending or live grant',async()=>{
  const h=microphoneHarness();await h.audio.listDevices();
  assert.equal(h.audio.setInput('headset'),true,'explicit selection follows live device discovery');
  const opening=h.audio.testMicrophone();
  assert.equal(h.requests.length,1,'permission is requested directly from the explicit test call');
  assert.deepEqual(h.requests[0].spec,{audio:{deviceId:{exact:'headset'}},video:false});
  assert.equal(h.audio.getState().microphonePending,true);
  assert.equal((await h.audio.testMicrophone()).ok,false);assert.equal(h.requests.length,1);
  const stream=mediaStream();h.requests[0].resolve(stream);
  assert.equal((await opening).ok,true);
  assert.equal(h.audio.getState().microphoneActive,true);assert.equal(h.audio.getState().microphonePending,false);
  assert.equal((await h.audio.testMicrophone()).ok,false);assert.equal(h.requests.length,1);
  h.audio.stopMicrophone();assert.equal(stream.track.stops,1);
  assert.equal(h.audio.getState().microphoneActive,false);
  h.audio.stopMicrophone();assert.equal(stream.track.stops,1,'repeated Stop cannot stop a retired owner again');
  h.audio.dispose();
});

test('Stop and dispose settle pending microphone tests and close a later permission grant',async()=>{
  for(const operation of ['stopMicrophone','dispose']){
    const h=microphoneHarness(),opening=h.audio.testMicrophone();let result;
    opening.then(value=>{result=value;});h.audio[operation]();await drain();
    assert.equal(result?.cancelled,true,operation+' must not wait for the browser permission promise');
    const stopped=h.audio.getState(),stream=mediaStream();h.requests[0].resolve(stream);await drain();
    assert.equal(stream.track.stops,1);assert.deepEqual(h.audio.getState(),stopped);
    assert.equal(h.audio.getState().microphoneActive,false);assert.equal(h.audio.getState().microphonePending,false);
    h.audio.dispose();
  }
});

test('an old permission rejection cannot overwrite a fresh explicitly started microphone test',async()=>{
  const h=microphoneHarness();await h.audio.listDevices();
  const old=h.audio.testMicrophone();h.audio.stopMicrophone();
  assert.equal(h.audio.setInput('new-microphone'),true,'new test needs a fresh discovered selection');
  const fresh=h.audio.testMicrophone(),stream=mediaStream();h.requests[1].resolve(stream);
  assert.equal((await fresh).ok,true);const accepted=h.audio.getState();
  h.requests[0].reject(Object.assign(new Error('old denied grant'),{name:'NotAllowedError'}));
  assert.equal((await old).cancelled,true);await drain();
  assert.deepEqual(h.audio.getState(),accepted);assert.equal(stream.track.stops,0);
  h.audio.dispose();assert.equal(stream.track.stops,1);
});

test('changing the selected microphone revokes the old test without opening the new device',async()=>{
  for(const phase of ['pending','active']){
    const h=microphoneHarness();await h.audio.listDevices();
    assert.equal(h.audio.setInput('old-microphone'),true);
    const opening=h.audio.testMicrophone(),stream=mediaStream();
    if(phase==='active'){h.requests[0].resolve(stream);assert.equal((await opening).ok,true);}
    assert.equal(h.audio.setInput('new-microphone'),true);
    const selected=h.audio.getState();
    assert.equal(selected.inputId,'new-microphone');assert.equal(selected.microphoneActive,false);assert.equal(selected.microphonePending,false);
    assert.equal(h.requests.length,1,'selection cannot itself request microphone permission');
    if(phase==='pending'){assert.equal((await opening).cancelled,true);h.requests[0].resolve(stream);await drain();}
    assert.equal(stream.track.stops,1);assert.deepEqual(h.audio.getState(),selected);h.audio.dispose();
  }
});

test('synchronous state subscribers can revoke a test before permission or after its live state',async()=>{
  for(const phase of ['pending','active']){
    let audio,revoked=false;const requests=[],statuses=[];
    audio=createHolodeckAudioControls({AudioContextCtor:null,
      navigatorRef:{mediaDevices:{getUserMedia(){const d=deferred();requests.push(d);return d.promise;}}},
      onStatus:message=>statuses.push(message),
      onChange(state){if(!revoked&&(phase==='pending'?state.microphonePending:state.microphoneActive)){revoked=true;audio.stopMicrophone();}},
    });
    const opening=audio.testMicrophone(),stream=mediaStream();
    if(phase==='active')requests[0].resolve(stream);
    assert.equal((await opening).cancelled,true);assert.equal(revoked,true);
    assert.equal(requests.length,phase==='pending'?0:1);
    assert.equal(stream.track.stops,phase==='pending'?0:1);
    assert.equal(statuses.at(-1),audio.getState().status,'old callbacks must not restore the previous test status');
    assert.match(audio.getState().status,/stopped/);audio.dispose();
  }
});

function audioContextHarness({sink=null,resume=null,failAnalyser=false}={}){
  const contexts=[];
  class FakeContext {
    constructor(){this.state=resume?'suspended':'running';this.currentTime=0;this.destination={speaker:true};this.closes=0;this.starts=0;this.connections=[];contexts.push(this);}
    close(){this.closes++;this.state='closed';return Promise.resolve();}
    setSinkId(id){this.sink=id;return sink?.promise??Promise.resolve();}
    resume(){return resume?.promise??Promise.resolve();}
    createMediaStreamSource(){return {connect:node=>this.connections.push(node),disconnect(){}};}
    createAnalyser(){if(failAnalyser)throw Error('analysis unavailable');return {fftSize:0,getByteTimeDomainData:values=>values.fill(192),disconnect(){}};}
    createGain(){return {gain:{value:0},connect:node=>this.connections.push(node),disconnect(){}};}
    createOscillator(){const oscillator={frequency:{value:0},connect:node=>this.connections.push(node),disconnect(){},
      start:()=>{this.starts++;},stop(){},onended:null};this.oscillator=oscillator;return oscillator;}
  }
  return {AudioContextCtor:FakeContext,contexts};
}

test('live microphone meter stays local and device loss closes its owned audio resources',async()=>{
  const context=audioContextHarness(),h=microphoneHarness(context),opening=h.audio.testMicrophone(),stream=mediaStream();
  h.requests[0].resolve(stream);assert.equal((await opening).ok,true);
  assert.equal(h.audio.microphoneLevel(),0.5);
  assert.equal(context.contexts[0].connections.includes(context.contexts[0].destination),false,'microphone must never feed speakers');
  stream.track.end();assert.equal(h.audio.microphoneLevel(),null);
  assert.equal(h.audio.getState().microphoneActive,false);assert.equal(h.audio.getState().microphonePending,false);
  assert.equal(context.contexts[0].closes,1);h.audio.dispose();assert.equal(context.contexts[0].closes,1);
});

test('microphone setup failure and Stop during suspended audio release the granted stream',async()=>{
  for(const kind of ['setup-failure','suspended']){
    const resume=kind==='suspended'?deferred():null,context=audioContextHarness({resume,failAnalyser:kind==='setup-failure'});
    const h=microphoneHarness(context),opening=h.audio.testMicrophone(),stream=mediaStream();h.requests[0].resolve(stream);await drain();
    if(resume)h.audio.stopMicrophone();
    assert.equal((await opening).ok,false);assert.equal(stream.track.stops,1);
    assert.equal(context.contexts[0].closes,1);assert.equal(h.audio.getState().microphoneActive,false);assert.equal(h.audio.getState().microphonePending,false);
    if(resume){const stopped=h.audio.getState();resume.reject(Error('late audio context failure'));await drain();assert.deepEqual(h.audio.getState(),stopped);}
    h.audio.dispose();
  }
});

test('failed live Quest microphone analyser revokes the one local grant and stops stale meter polling',async()=>{
  const context=audioContextHarness(),h=microphoneHarness(context),stream=mediaStream();
  const opening=h.audio.testMicrophone();h.requests[0].resolve(stream);
  assert.equal((await opening).ok,true);
  assert.equal(h.audio.microphoneLevel(),0.5);
  const analyser=context.contexts[0].connections[0];
  analyser.getByteTimeDomainData=()=>{throw Error('Quest audio analyser detached');};
  assert.equal(h.audio.microphoneLevel(),null,'a detached headset cannot throw into the meter timer');
  assert.equal(stream.track.stops,1,'the owned microphone is immediately released');
  assert.equal(context.contexts[0].closes,1,'its analyser context is closed');
  assert.equal(h.audio.getState().microphoneActive,false);
  assert.equal(h.audio.getState().microphonePending,false);
  assert.match(h.audio.getState().status,/Microphone level analyser failed/);
  assert.equal(h.audio.microphoneLevel(),null,'a later tick cannot restart capture');
  assert.equal(stream.track.stops,1,'no double stop and no automatic reopen');
  h.audio.dispose();
});

test('speaker tests use the shared output selection and never begin after disposal',async()=>{
  const sink=deferred(),context=audioContextHarness({sink});
  const navigatorRef={mediaDevices:{enumerateDevices:async()=>[
    {kind:'audiooutput',deviceId:'headset-output',label:'Headset'},
    {kind:'audiooutput',deviceId:'selected-output',label:'Selected'},
  ]}};
  const audio=createHolodeckAudioControls({...context,navigatorRef});
  await audio.listDevices();assert.equal(audio.setOutput('headset-output'),true);
  const playing=audio.testSpeakers();assert.equal(context.contexts[0].sink,'headset-output');
  audio.dispose();assert.equal((await playing).cancelled,true);const closed=audio.getState();
  sink.resolve();await drain();assert.equal(context.contexts[0].starts,0);assert.equal(context.contexts[0].closes,1);
  assert.deepEqual(audio.getState(),closed);
  const normal=audioContextHarness(),live=createHolodeckAudioControls({...normal,navigatorRef});
  await live.listDevices();assert.equal(live.setOutput('selected-output'),true);
  assert.equal((await live.testSpeakers()).ok,true);
  assert.equal(normal.contexts[0].sink,'selected-output');assert.equal(normal.contexts[0].starts,1);
  normal.contexts[0].oscillator.onended();assert.equal(normal.contexts[0].closes,1);live.dispose();
});

test('superseded device discovery cannot replace a newer list or publish after disposal',async()=>{
  const lists=[];
  const audio=createHolodeckAudioControls({AudioContextCtor:null,navigatorRef:{mediaDevices:{enumerateDevices(){const d=deferred();lists.push(d);return d.promise;}}}});
  const old=audio.listDevices(),fresh=audio.listDevices();
  lists[1].resolve([{kind:'audioinput',deviceId:'fresh',label:'Fresh mic'}]);assert.equal((await fresh).ok,true);
  const current=audio.getState();lists[0].resolve([{kind:'audioinput',deviceId:'old',label:'Old mic'}]);assert.equal((await old).cancelled,true);
  assert.deepEqual(audio.getState(),current);
  const pending=audio.listDevices();audio.dispose();const closed=audio.getState();
  lists[2].resolve([]);assert.equal((await pending).cancelled,true);assert.deepEqual(audio.getState(),closed);
});

test('failed audio discovery revokes stale microphone and speaker selections without clearing inert preferences',async()=>{
  let denied=false,micRequests=0,speakerContexts=0;
  const saved=new Map(),storage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)};
  const navigatorRef={mediaDevices:{
    async enumerateDevices(){
      if(denied)throw Object.assign(Error('permission denied'),{name:'NotAllowedError'});
      return [{kind:'audioinput',deviceId:'quest-mic',label:'Quest Mic'},
        {kind:'audiooutput',deviceId:'quest-speaker',label:'Quest Speaker'}];
    },
    getUserMedia(){micRequests++;throw Error('stale mic opened');},
  }};
  class SpeakerContext{constructor(){speakerContexts++;}}
  const audio=createHolodeckAudioControls({navigatorRef,AudioContextCtor:SpeakerContext,storageRef:storage});
  assert.equal((await audio.listDevices()).ok,true);
  assert.equal(audio.setInput('quest-mic'),true);assert.equal(audio.setOutput('quest-speaker'),true);
  denied=true;
  const failed=await audio.listDevices();assert.equal(failed.ok,false);
  assert.match(failed.reason,/Refresh devices/);
  assert.deepEqual([audio.getState().inputId,audio.getState().outputId],['','']);
  assert.deepEqual([audio.getState().inputs,audio.getState().outputs],[[],[]]);
  assert.equal((await audio.testMicrophone('quest-mic')).ok,false);
  assert.equal((await audio.testSpeakers('quest-speaker')).ok,false);
  assert.equal(micRequests,0);assert.equal(speakerContexts,0);
  assert.deepEqual(readSpatialAudioPreferences(storage),{inputId:'quest-mic',outputId:'quest-speaker'});
  denied=false;assert.equal((await audio.listDevices()).ok,true);
  assert.deepEqual([audio.getState().inputId,audio.getState().outputId],['quest-mic','quest-speaker']);
  audio.dispose();
});

test('failed audio discovery cancels pending microphone permission and stops a late grant',async()=>{
  let denied=false,resolveGrant,stops=0;
  const audio=createHolodeckAudioControls({AudioContextCtor:null,navigatorRef:{mediaDevices:{
    async enumerateDevices(){
      if(denied)throw Object.assign(Error('denied'),{name:'NotAllowedError'});
      return [{kind:'audioinput',deviceId:'mic',label:'Mic'}];
    },
    getUserMedia(){return new Promise(resolve=>{resolveGrant=resolve;});},
  }}});
  await audio.listDevices();assert.equal(audio.setInput('mic'),true);
  const pending=audio.testMicrophone();assert.equal(audio.getState().microphonePending,true);
  denied=true;assert.equal((await audio.listDevices()).ok,false);
  assert.equal((await pending).cancelled,true);
  assert.equal(audio.getState().microphonePending,false);
  resolveGrant({getTracks:()=>[{readyState:'live',stop(){stops++;}}]});
  await drain();assert.equal(stops,1);
  assert.equal((await audio.testMicrophone()).ok,false);
  audio.dispose();
});

test('audio hot-plug revokes pending microphone grant and stale discovery without silently changing devices',async()=>{
  const listeners=new Set(),grant=deferred(),olderList=deferred(),saved=new Map();
  const storage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
  let slowList=false,requests=0,removed=0;
  const discovered=[{kind:'audioinput',deviceId:'quest-mic',label:'Quest microphone'}];
  const mediaDevices={
    addEventListener(name,listener){assert.equal(name,'devicechange');listeners.add(listener);},
    removeEventListener(name,listener){assert.equal(name,'devicechange');removed++;listeners.delete(listener);},
    enumerateDevices(){return slowList?olderList.promise:Promise.resolve(discovered);},
    getUserMedia(){requests++;return grant.promise;},
  };
  const audio=createHolodeckAudioControls({AudioContextCtor:null,navigatorRef:{mediaDevices},storageRef:storage});
  assert.equal(listeners.size,1);
  assert.equal((await audio.listDevices()).ok,true);
  assert.equal(audio.setInput('quest-mic'),true);
  const pending=audio.testMicrophone();
  assert.equal(audio.getState().microphonePending,true);
  assert.equal(requests,1);
  slowList=true;
  const stale=audio.listDevices();
  for(const listener of listeners)listener();
  assert.equal((await pending).cancelled,true);
  const invalidated=audio.getState();
  assert.deepEqual([invalidated.inputs,invalidated.outputs],[[],[]]);
  assert.equal(invalidated.microphonePending,false);
  assert.match(invalidated.status,/Audio devices changed/);
  olderList.resolve(discovered);
  assert.equal((await stale).cancelled,true);
  assert.deepEqual(audio.getState(),invalidated,'old device enumeration cannot revive a detached headset');
  const stream=mediaStream();
  grant.resolve(stream);await drain();
  assert.equal(stream.track.stops,1,'late browser microphone grant is immediately revoked');
  assert.equal((await audio.testMicrophone()).ok,false);
  assert.equal(requests,1,'hot-plug never silently reopens a microphone');
  assert.deepEqual(readSpatialAudioPreferences(storage),{inputId:'quest-mic',outputId:''});
  slowList=false;discovered.length=0;
  assert.equal((await audio.listDevices()).ok,true);
  assert.equal(audio.getState().inputId,'');
  assert.equal((await audio.testMicrophone()).ok,false,'a missing remembered mic cannot fall back to default');
  audio.dispose();
  assert.equal(removed,1);assert.equal(listeners.size,0,'disposed room unregisters the device observer');
});

test('hot-plug cannot silently reuse the same physical route just because device IDs returned',async()=>{
  const listeners=new Set(),saved=new Map();
  const storage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
  let micRequests=0,speakerContexts=0;
  const mediaDevices={
    addEventListener(event,fn){assert.equal(event,'devicechange');listeners.add(fn);},
    removeEventListener(event,fn){assert.equal(event,'devicechange');listeners.delete(fn);},
    async enumerateDevices(){return [
      {kind:'audioinput',deviceId:'quest-mic',label:'Quest microphone'},
      {kind:'audiooutput',deviceId:'quest-speaker',label:'Quest speakers'},
    ];},
    getUserMedia(){micRequests++;throw Error('no automatic microphone request allowed');},
  };
  class SpeakerContext{constructor(){speakerContexts++;}}
  const audio=createHolodeckAudioControls({navigatorRef:{mediaDevices},storageRef:storage,AudioContextCtor:SpeakerContext});
  assert.equal((await audio.listDevices()).ok,true);
  assert.equal(audio.setInput('quest-mic'),true);
  assert.equal(audio.setOutput('quest-speaker'),true);
  const savedHints=readSpatialAudioPreferences(storage);
  assert.deepEqual(savedHints,{inputId:'quest-mic',outputId:'quest-speaker'});
  for(const listener of listeners)listener();
  const listed=await audio.listDevices();
  assert.equal(listed.ok,true);
  assert.match(listed.reason,/Re-select the intended microphone and speaker/);
  assert.deepEqual([audio.getState().inputId,audio.getState().outputId],['',''],
    'device enumeration may not reauthorize saved IDs after hot-plug');
  assert.deepEqual(readSpatialAudioPreferences(storage),savedHints,'inert saved hints remain available for later sessions');
  assert.equal((await audio.testMicrophone('quest-mic')).ok,false);
  assert.equal((await audio.testMicrophone('')).ok,false,'default microphone is not silently substituted');
  assert.equal((await audio.testSpeakers('quest-speaker')).ok,false);
  assert.deepEqual([micRequests,speakerContexts],[0,0]);
  assert.equal(audio.setInput('quest-mic'),true,'fresh explicit selection restores local microphone choice');
  assert.equal(audio.setOutput('quest-speaker'),true,'fresh explicit selection restores local speaker choice');
  assert.deepEqual([audio.getState().inputId,audio.getState().outputId],['quest-mic','quest-speaker']);
  assert.deepEqual([micRequests,speakerContexts],[0,0],'selection alone is not a media grant');
  audio.dispose();assert.equal(listeners.size,0);
});
