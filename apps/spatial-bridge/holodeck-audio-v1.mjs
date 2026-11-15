// Browser-local microphone and speaker checks for the Spatial Workspace.
// ChatGPT Voice runs in the user's original ChatGPT/Codex app, never here.
export function createHolodeckAudioControls({
  navigatorRef=globalThis.navigator,
  AudioContextCtor=globalThis.AudioContext||globalThis.webkitAudioContext,
  onStatus=()=>{},
  onChange=()=>{},
}={}) {
  let microphone=null,speaker=null,disposed=false,listVersion=0,statusIntent=0;
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
  function setInput(id){
    id=selection(id);if(disposed||id===null)return false;
    if(id===state.inputId)return true;
    statusIntent++;releaseMicrophone();
    publish({inputId:id,microphoneActive:false,microphonePending:false,
      status:'Microphone selected. Start a test when ready.'});return true;
  }
  function setOutput(id){
    id=selection(id);if(disposed||id===null)return false;
    if(id===state.outputId)return true;
    statusIntent++;releaseSpeaker();
    publish({outputId:id,status:'Speaker output selected. Start a test when ready.'});return true;
  }
  async function listDevices(){
    if(disposed)return {ok:false,inputs:[],outputs:[],reason:'Audio controls have been closed.'};
    const current=++listVersion,intent=++statusIntent;
    if(typeof navigatorRef?.mediaDevices?.enumerateDevices!=='function')
      return {ok:false,inputs:[],outputs:[],reason:status('Audio device discovery unavailable in this browser.')};
    try {
      const devices=await navigatorRef.mediaDevices.enumerateDevices();
      if(disposed||current!==listVersion)return {ok:false,inputs:[],outputs:[],cancelled:true,reason:'Audio device discovery was superseded.'};
      const inputs=devices.filter(d=>d.kind==='audioinput').map(d=>({id:d.deviceId,label:d.label||'Microphone'}));
      const outputs=devices.filter(d=>d.kind==='audiooutput').map(d=>({id:d.deviceId,label:d.label||'Speakers'}));
      const inputId=inputs.some(d=>d.id===state.inputId)?state.inputId:'';
      const outputId=outputs.some(d=>d.id===state.outputId)?state.outputId:'';
      if(inputId!==state.inputId)releaseMicrophone();
      if(outputId!==state.outputId)releaseSpeaker();
      const reason='Devices listed. A test needs your explicit permission.';
      publish({inputs,outputs,inputId,outputId,
        microphoneActive:Boolean(microphone)&&state.microphoneActive,
        microphonePending:Boolean(microphone)&&state.microphonePending,
        ...(intent===statusIntent?{status:reason}:{})});
      return {ok:true,inputs:inputs.map(d=>({...d})),outputs:outputs.map(d=>({...d})),reason};
    }catch(error){
      const reason='Audio devices could not be listed: '+String(error?.name||'unavailable');
      if(!disposed&&current===listVersion&&intent===statusIntent)status(reason);
      return {ok:false,inputs:[],outputs:[],reason};
    }
  }
  function stopMicrophone(){
    statusIntent++;releaseMicrophone();
    if(!disposed)publish({microphoneActive:false,microphonePending:false,
      status:'Microphone test stopped. No recording was saved or transmitted.'});
  }
  async function testMicrophone(deviceId=state.inputId){
    if(disposed)return stoppedResult('Microphone');
    deviceId=selection(deviceId);
    if(deviceId===null)return {ok:false,reason:status('Select a valid microphone device.')};
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
    const analyser=microphone?.analyser;
    if(!state.microphoneActive||!analyser)return null;
    const values=new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(values);
    let total=0;for(const sample of values){const delta=(sample-128)/128;total+=delta*delta;}
    return Math.sqrt(total/values.length);
  }
  async function testSpeakers(deviceId=state.outputId){
    if(disposed)return stoppedResult('Speaker');
    deviceId=selection(deviceId);
    if(deviceId===null)return {ok:false,reason:status('Select a valid speaker device.')};
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
      oscillator.onended=()=>{if(ownsSpeaker(owner))releaseSpeaker();};
      oscillator.start();oscillator.stop(testContext.currentTime+0.15);
      const reason='Played a short local speaker test tone. ChatGPT app audio routing is separate.';
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
    publish({microphoneActive:false,microphonePending:false,status:'Audio controls closed. Local tests stopped.'});
  }
  return {getState,setInput,setOutput,listDevices,testMicrophone,stopMicrophone,microphoneLevel,testSpeakers,dispose};
}
