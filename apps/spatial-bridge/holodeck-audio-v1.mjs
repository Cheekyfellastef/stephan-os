// Browser-local microphone and speaker checks for the Spatial Workspace.
// ChatGPT Voice runs in the user's original ChatGPT/Codex app, never here.
// These are origin-local device preference hints, NOT media grants or app Voice state.
export const SPATIAL_AUDIO_PREFERENCE_KEY='stephanos.spatial.audio-preferences.v1';
const emptyAudioPreferences=()=>({inputId:'',outputId:''});
const boundedAudioId=value=>typeof value==='string'&&value.length<=256&&!/[\u0000-\u001f\u007f]/.test(value)?value:'';
export function readSpatialAudioPreferences(storage){
  const fallback=emptyAudioPreferences();
  try {
    const raw=storage?.getItem?.(SPATIAL_AUDIO_PREFERENCE_KEY);
    if(typeof raw!=='string'||raw.length>1024)return fallback;
    const value=JSON.parse(raw);
    if(!value||Array.isArray(value)||typeof value!=='object'||value.version!==1)return fallback;
    return {inputId:boundedAudioId(value.inputId),outputId:boundedAudioId(value.outputId)};
  }catch{return fallback;}
}
export function createHolodeckAudioControls({
  navigatorRef=globalThis.navigator,
  AudioContextCtor=globalThis.AudioContext||globalThis.webkitAudioContext,
  onStatus=()=>{},
  onChange=()=>{},
  storageRef,
}={}) {
  let prefStore;
  try{prefStore=storageRef===undefined?globalThis.localStorage:storageRef;}catch{}
  let preferences=readSpatialAudioPreferences(prefStore);
  // Only explicit, currently discovered choices are saved. Never save permission,
  // microphone-active, app session, device label, transcript or capture state.
  const saveChoice=(kind,id,devices)=>{
    preferences={...preferences,[kind]:uniqueDevice(devices,id)?boundedAudioId(id):''};
    try{prefStore?.setItem?.(SPATIAL_AUDIO_PREFERENCE_KEY,
      JSON.stringify({version:1,inputId:preferences.inputId,outputId:preferences.outputId}));}catch{}
  };
  let microphone=null,speaker=null,disposed=false,listVersion=0,statusIntent=0,deviceRefreshFailed=false;
  // Device IDs may be reused after a Quest/OS hot-plug. A stored hint cannot re-authorize either route.
  let hotplugInputNeedsSelection=false,hotplugOutputNeedsSelection=false;
  let state={inputs:[],outputs:[],inputId:'',outputId:'',status:'Audio test devices not yet selected.',
    microphoneActive:false,microphonePending:false,revision:0};
  const cancelled=Symbol('audio-test-cancelled');
  const getState=()=>({...state,inputs:state.inputs.map(device=>({...device})),outputs:state.outputs.map(device=>({...device}))});
  function publish(changes){
    state={...state,...changes,revision:state.revision+1};
    const current=state.revision,snapshot=getState();
    try{onChange(snapshot);}catch{}
    // A subscriber may synchronously stop a test. Never publish its old status
    // after that newer state has already reached the other presentation.
    if(current===state.revision&&Object.hasOwn(changes,'status'))try{onStatus(state.status);}catch{}
  }
  const status=message=>{publish({status:message});return message;};
  const selection=value=>typeof value==='string'&&value.length<=1024?value:null;
  // A remembered or freshly selected device ID must resolve to exactly one physical route.
  const deviceCount=(devices,id)=>id?devices.filter(device=>device.id===id).length:0;
  const uniqueDevice=(devices,id)=>deviceCount(devices,id)===1;
  const ownsMic=owner=>!disposed&&microphone===owner&&!owner.closed;
  const ownsSpeaker=owner=>!disposed&&speaker===owner&&!owner.closed;
  function ownerRecord(){
    let cancel;
    return {closed:false,stream:null,context:null,source:null,analyser:null,oscillator:null,gain:null,listeners:[],
      cancelled:new Promise(resolve=>{cancel=resolve;}),cancel:()=>cancel(cancelled)};
  }
  function stopTracks(stream){
    for(const track of stream?.getTracks?.()??[])try{if(track.readyState!=='ended')track.stop();}catch{}
  }
  function closeOwner(owner){
    if(!owner||owner.closed)return;
    owner.closed=true;owner.cancel();
    for(const [track,listener] of owner.listeners)try{track.removeEventListener?.('ended',listener);}catch{}
    owner.listeners=[];
    stopTracks(owner.stream);owner.stream=null;
    if(owner.oscillator){owner.oscillator.onended=null;try{owner.oscillator.stop();}catch{}}
    for(const node of [owner.source,owner.analyser,owner.oscillator,owner.gain])try{node?.disconnect?.();}catch{}
    owner.source=null;owner.analyser=null;owner.oscillator=null;owner.gain=null;
    if(owner.context)try{void Promise.resolve(owner.context.close?.()).catch(()=>{});}catch{}
    owner.context=null;
  }
  function releaseMicrophone(){const old=microphone;microphone=null;closeOwner(old);}
  function releaseSpeaker(){const old=speaker;speaker=null;closeOwner(old);}
  const stoppedResult=kind=>({ok:false,cancelled:true,reason:kind+' test was stopped.'});
  // A failed refresh must not leave an old device list usable for a new
  // microphone permission request or speaker test. Keep saved hints inert.
  // A failed enumeration may conceal a replaced/reused headset device ID.
  // Preserve inert preferences, but never reselect the old physical route.
  let deviceRecoveryCause='';
  function invalidateDevices(reason,cause='discovery'){
    deviceRecoveryCause=cause;
    hotplugInputNeedsSelection=true;hotplugOutputNeedsSelection=true;
    deviceRefreshFailed=true;statusIntent++;
    releaseMicrophone();releaseSpeaker();
    const message=reason+' Refresh devices before starting another local audio test.';
    publish({inputs:[],outputs:[],inputId:'',outputId:'',microphoneActive:false,
      microphonePending:false,status:message});
    return {ok:false,inputs:[],outputs:[],reason:message};
  }
  // A headset/device hot-plug invalidates local test ownership immediately.
  // Never silently switch an audio route or confuse a test with ChatGPT Voice.
  const deviceService=navigatorRef?.mediaDevices;
  let deviceChangeListener=null;
  if(typeof deviceService?.addEventListener==='function'){
    deviceChangeListener=()=>{
      if(disposed)return;
      ++listVersion; // An enumeration begun before the change must not restore old devices.
      invalidateDevices('Audio devices changed.','hotplug');
    };
    try{deviceService.addEventListener('devicechange',deviceChangeListener);}
    catch{deviceChangeListener=null;}
  }
  function setInput(id){
    id=selection(id);if(disposed||id===null)return false;
    if(id&&!uniqueDevice(state.inputs,id))return false;
    // A missing remembered microphone is already shown as no current choice.
    // Explicitly selecting system default must still clear that stale hint.
    hotplugInputNeedsSelection=false; // This is a fresh explicit operator selection, including system default.
    if(id===state.inputId&&(id!==''||!preferences.inputId))return true;
    statusIntent++;releaseMicrophone();
    saveChoice('inputId',id,state.inputs);
    publish({inputId:id,microphoneActive:false,microphonePending:false,
      status:'Microphone selected. Start a test when ready.'});return true;
  }
  function setOutput(id){
    id=selection(id);if(disposed||id===null)return false;
    if(id&&!uniqueDevice(state.outputs,id))return false;
    hotplugOutputNeedsSelection=false;
    if(id===state.outputId&&(id!==''||!preferences.outputId))return true;
    statusIntent++;releaseSpeaker();
    saveChoice('outputId',id,state.outputs);
    publish({outputId:id,status:'Speaker output selected. Start a test when ready.'});return true;
  }
  async function listDevices(){
    if(disposed)return {ok:false,inputs:[],outputs:[],reason:'Audio controls have been closed.'};
    const current=++listVersion,intent=++statusIntent;
    if(typeof navigatorRef?.mediaDevices?.enumerateDevices!=='function')
      return invalidateDevices('Audio device discovery unavailable in this browser.');
    try {
      const devices=await navigatorRef.mediaDevices.enumerateDevices();
      if(disposed||current!==listVersion)return {ok:false,inputs:[],outputs:[],cancelled:true,reason:'Audio device discovery was superseded.'};
      const inputs=devices.filter(d=>d.kind==='audioinput').map(d=>({id:d.deviceId,label:d.label||'Microphone'}));
      const outputs=devices.filter(d=>d.kind==='audiooutput').map(d=>({id:d.deviceId,label:d.label||'Speakers'}));
      // A saved hint is not trusted until fresh device enumeration finds an
      // exact match. Never substitute a different microphone or speaker.
      deviceRefreshFailed=false;
      const wantedInput=hotplugInputNeedsSelection?'':state.inputId||preferences.inputId;
      const wantedOutput=hotplugOutputNeedsSelection?'':state.outputId||preferences.outputId;
      const ambiguousInput=deviceCount(inputs,wantedInput)>1,ambiguousOutput=deviceCount(outputs,wantedOutput)>1;
      const inputId=uniqueDevice(inputs,wantedInput)?wantedInput:'';
      const outputId=uniqueDevice(outputs,wantedOutput)?wantedOutput:'';
      // Once an ID was ambiguous, a later refresh must not silently re-adopt it.
      if(ambiguousInput)hotplugInputNeedsSelection=true;
      if(ambiguousOutput)hotplugOutputNeedsSelection=true;
      if(ambiguousInput||ambiguousOutput)deviceRecoveryCause='ambiguous';
      if(inputId!==state.inputId)releaseMicrophone();
      if(outputId!==state.outputId)releaseSpeaker();
      const missingInput=Boolean(wantedInput&&!inputId),missingOutput=Boolean(wantedOutput&&!outputId);
      const reason=ambiguousInput||ambiguousOutput
        ?'Ambiguous audio device identity. Resolve duplicates, then explicitly re-select the intended device; no local test or ChatGPT Voice started.'
        :hotplugInputNeedsSelection||hotplugOutputNeedsSelection
        ?(deviceRecoveryCause==='hotplug'?'Audio devices changed.':deviceRecoveryCause==='ambiguous'?'Ambiguous audio device identity was observed.':'Audio device discovery previously failed.')+
          ' Re-select the intended microphone and speaker; neither local test nor ChatGPT Voice has started.'
        :missingInput||missingOutput
          ?'Previous '+(missingInput&&missingOutput?'microphone and speaker':missingInput?'microphone':'speaker')+
            ' unavailable. Re-select the intended device; no test or ChatGPT Voice session started.'
          :'Devices listed. A test needs your explicit permission.';
      publish({inputs,outputs,inputId,outputId,
        microphoneActive:Boolean(microphone)&&state.microphoneActive,
        microphonePending:Boolean(microphone)&&state.microphonePending,
        ...(intent===statusIntent?{status:reason}:{})});
      return {ok:true,inputs:inputs.map(d=>({...d})),outputs:outputs.map(d=>({...d})),reason};
    }catch(error){
      const reason='Audio devices could not be listed: '+String(error?.name||'unavailable');
      if(!disposed&&current===listVersion)return invalidateDevices(reason);
      return {ok:false,inputs:[],outputs:[],cancelled:true,reason:'Audio device discovery was superseded.'};
    }
  }
  function stopMicrophone(){
    statusIntent++;releaseMicrophone();
    if(!disposed)publish({microphoneActive:false,microphonePending:false,
      status:'Microphone test stopped. No recording was saved or transmitted.'});
  }
  async function testMicrophone(deviceId=state.inputId){
    if(disposed)return stoppedResult('Microphone');
    if(deviceRefreshFailed)return {ok:false,reason:status('Refresh audio devices before testing the microphone.')};
    if(hotplugInputNeedsSelection)return {ok:false,reason:status('Re-select the microphone after audio devices changed before testing.')};
    deviceId=selection(deviceId);
    if(deviceId===null)return {ok:false,reason:status('Select a valid microphone device.')};
    // A remembered headset that vanished must not quietly become the system
    // default when Test is pressed. Only a fresh explicit choice clears it.
    if(!state.inputId&&preferences.inputId)return {ok:false,reason:status('Previous microphone unavailable. Re-select the intended device or explicitly choose system default before testing.')};
    // Test cannot choose a different discovered device: only setInput is a deliberate selection.
    if(deviceId!==state.inputId)return {ok:false,reason:status('Microphone test refused: select the intended microphone before requesting permission.')};
    if(deviceId&&!uniqueDevice(state.inputs,deviceId))return {ok:false,reason:status('Microphone identity is missing or ambiguous. Refresh and re-select it before testing.')};
    if(microphone)return {ok:false,reason:status(state.microphonePending
      ?'A microphone test is already waiting for permission. Stop it before starting another.'
      :'A microphone test is already active. Stop it before starting another.')};
    if(typeof navigatorRef?.mediaDevices?.getUserMedia!=='function')
      return {ok:false,reason:status('This browser cannot request microphone access.')};
    const owner=ownerRecord();microphone=owner;statusIntent++;
    publish({inputId:deviceId,microphoneActive:false,microphonePending:true,status:'Waiting for microphone permission.'});
    if(!ownsMic(owner))return stoppedResult('Microphone');
    let accepted=false;
    try{
      // Keep the permission request in the explicit click stack. Its late grant
      // remains owned even if Stop or page departure wins the race.
      const permission=navigatorRef.mediaDevices.getUserMedia({
        audio:deviceId?{deviceId:{exact:deviceId}}:true,video:false,
      });
      const stream=await Promise.race([Promise.resolve(permission).then(granted=>{
        if(ownsMic(owner))owner.stream=granted;else stopTracks(granted);
        return granted;
      }),owner.cancelled]);
      if(stream===cancelled||!ownsMic(owner))return stoppedResult('Microphone');
      const tracks=stream?.getAudioTracks?.()??stream?.getTracks?.()??[];
      if(!tracks.length||tracks.every(track=>track.readyState==='ended'))throw new Error('No live microphone track');
      // Browser permission is not proof that an explicit Quest microphone was
      // adopted. Check the granted track's current physical device identity
      // before marking the local test live; never fall back to another mic.
      if(deviceId&&!tracks.every(track=>{
        try{return track.getSettings?.().deviceId===deviceId;}catch{return false;}
      })){
        releaseMicrophone();
        const reason='Selected microphone identity could not be verified. Local capture stopped; re-select the intended headset microphone.';
        publish({microphoneActive:false,microphonePending:false,status:reason});
        return {ok:false,reason};
      }
      for(const track of tracks){
        const ended=()=>{if(ownsMic(owner)){
          releaseMicrophone();publish({microphoneActive:false,microphonePending:false,status:'Microphone test ended. Start a new test when ready.'});
        }};
        owner.listeners.push([track,ended]);track.addEventListener?.('ended',ended,{once:true});
      }
      if(tracks.some(track=>track.readyState==='ended')){releaseMicrophone();publish({microphoneActive:false,microphonePending:false,status:'Microphone test ended. Start a new test when ready.'});return stoppedResult('Microphone');}
      if(typeof AudioContextCtor==='function'){
        const context=new AudioContextCtor();owner.context=context;
        owner.source=context.createMediaStreamSource(stream);
        owner.analyser=context.createAnalyser();owner.analyser.fftSize=512;owner.source.connect(owner.analyser);
        // Never route the mic to a speaker, remote API, recording or logger.
        if(context.state==='suspended'){
          const resumed=await Promise.race([Promise.resolve(context.resume()),owner.cancelled]);
          if(resumed===cancelled||!ownsMic(owner))return stoppedResult('Microphone');
        }
      }
      if(!ownsMic(owner))return stoppedResult('Microphone');
      const reason='Microphone opened locally. Windows and ChatGPT still control Voice input.';
      publish({microphoneActive:true,microphonePending:false,status:reason});
      accepted=ownsMic(owner);return accepted?{ok:true,reason}:stoppedResult('Microphone');
    }catch(error){
      if(!ownsMic(owner))return stoppedResult('Microphone');
      releaseMicrophone();
      const reason='Microphone test failed: '+String(error?.name||'unavailable');
      publish({microphoneActive:false,microphonePending:false,status:reason});return {ok:false,reason};
    }finally{if(!accepted)closeOwner(owner);}
  }
  function microphoneLevel(){
    const owner=microphone,analyser=owner?.analyser;
    if(!state.microphoneActive||!analyser)return null;
    try{
      const fftSize=analyser.fftSize;
      if(!Number.isInteger(fftSize)||fftSize<1||fftSize>32768)throw new Error('Invalid microphone analyser size');
      const values=new Uint8Array(fftSize);
      analyser.getByteTimeDomainData(values);
      let total=0;for(const sample of values){const delta=(sample-128)/128;total+=delta*delta;}
      const level=Math.sqrt(total/values.length);
      if(!Number.isFinite(level))throw new Error('Invalid microphone analyser reading');
      return level;
    }catch{
      // An interrupted Quest/OS analyser must not keep a live local mic grant
      // or crash the recurring headset level display. Never retry capture.
      if(ownsMic(owner)){
        releaseMicrophone();
        publish({microphoneActive:false,microphonePending:false,
          status:'Microphone level analyser failed. Local test stopped and the microphone released. ChatGPT Voice is separate.'});
      }
      return null;
    }
  }
  function stopSpeakers(){
    // An app-window disconnect also revokes an in-flight or active local tone.
    // This only controls this room's test, never ChatGPT Voice in the app.
    if(!speaker)return false;
    statusIntent++;releaseSpeaker();
    if(!disposed)status('Local speaker test stopped. ChatGPT Voice remains controlled in the original app.');
    return true;
  }
  async function testSpeakers(deviceId=state.outputId){
    if(disposed)return stoppedResult('Speaker');
    if(deviceRefreshFailed)return {ok:false,reason:status('Refresh audio devices before testing the speakers.')};
    if(hotplugOutputNeedsSelection)return {ok:false,reason:status('Re-select the speakers after audio devices changed before testing.')};
    deviceId=selection(deviceId);
    if(deviceId===null)return {ok:false,reason:status('Select a valid speaker device.')};
    if(!state.outputId&&preferences.outputId)return {ok:false,reason:status('Previous speaker unavailable. Re-select the intended output or explicitly choose system default before testing.')};
    // Test is not a device selector; never silently route a tone to an unchosen headset.
    if(deviceId!==state.outputId)return {ok:false,reason:status('Speaker test refused: select the intended output before testing.')};
    if(deviceId&&!uniqueDevice(state.outputs,deviceId))return {ok:false,reason:status('Speaker identity is missing or ambiguous. Refresh and re-select it before testing.')};
    if(speaker)return {ok:false,reason:status('A speaker test is already active.')};
    if(typeof AudioContextCtor!=='function')
      return {ok:false,reason:status('Browser speaker test is unavailable.')};
    const owner=ownerRecord();speaker=owner;const intent=++statusIntent;
    publish({outputId:deviceId,status:'Starting a short local speaker test.'});
    if(!ownsSpeaker(owner))return stoppedResult('Speaker');
    try{
      const testContext=new AudioContextCtor();owner.context=testContext;
      if(deviceId){
        if(typeof testContext.setSinkId!=='function')
          throw new Error('Speaker selection is not supported here. Use Windows Sound output settings.');
        const selected=await Promise.race([Promise.resolve(testContext.setSinkId(deviceId)),owner.cancelled]);
        if(selected===cancelled||!ownsSpeaker(owner))return stoppedResult('Speaker');
        // A resolved sink request is not proof that the headset was selected.
        // An unverified route must not sound a tone on a different device.
        if(testContext.sinkId!==deviceId)
          throw new Error('Speaker output route could not be verified. No local tone was played.');
      }
      if(testContext.state==='suspended'){
        const resumed=await Promise.race([Promise.resolve(testContext.resume()),owner.cancelled]);
        if(resumed===cancelled||!ownsSpeaker(owner))return stoppedResult('Speaker');
      }
      if(!ownsSpeaker(owner))return stoppedResult('Speaker');
      const oscillator=testContext.createOscillator();owner.oscillator=oscillator;
      const gain=testContext.createGain();owner.gain=gain;
      oscillator.frequency.value=440;gain.gain.value=0.07;
      oscillator.connect(gain);gain.connect(testContext.destination);
      oscillator.onended=()=>{if(ownsSpeaker(owner)){
        releaseSpeaker();status('Local speaker test completed. Headset audibility and ChatGPT Voice are not verified.');
      }};
      oscillator.start();oscillator.stop(testContext.currentTime+0.15);
      const reason='Local speaker test tone started. Listen for it; headset audibility and ChatGPT Voice are not verified.';
      if(ownsSpeaker(owner)&&intent===statusIntent)status(reason);
      return {ok:true,reason};
    }catch(error){
      if(!ownsSpeaker(owner))return stoppedResult('Speaker');
      releaseSpeaker();
      const reason='Speaker test failed: '+String(error?.message||'unavailable');
      if(intent===statusIntent)status(reason);return {ok:false,reason};
    }
  }
  function dispose(){
    if(disposed)return;
    disposed=true;listVersion++;statusIntent++;releaseMicrophone();releaseSpeaker();
    if(deviceChangeListener)try{deviceService?.removeEventListener?.('devicechange',deviceChangeListener);}catch{}
    publish({microphoneActive:false,microphonePending:false,status:'Audio controls closed. Local tests stopped.'});
  }
  return {getState,setInput,setOutput,listDevices,testMicrophone,stopMicrophone,microphoneLevel,testSpeakers,stopSpeakers,dispose};
}
