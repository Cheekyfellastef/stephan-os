// Browser-local microphone and speaker checks for the Spatial Workspace.
// ChatGPT Voice runs in the user's original ChatGPT/Codex app, never here.
export function createHolodeckAudioControls({
  navigatorRef=globalThis.navigator,
  AudioContextCtor=globalThis.AudioContext||globalThis.webkitAudioContext,
  onStatus=()=>{},
}={}) {
  let stream=null,context=null,analyser=null,micSource=null;
  const status=(message)=>{try{onStatus(message);}catch{}return message;};
  async function listDevices(){
    if(typeof navigatorRef?.mediaDevices?.enumerateDevices!=='function')
      return {ok:false,inputs:[],outputs:[],reason:status('Audio device discovery unavailable in this browser.')};
    try {
      const devices=await navigatorRef.mediaDevices.enumerateDevices();
      return {
        ok:true,inputs:devices.filter(d=>d.kind==='audioinput').map(d=>({id:d.deviceId,label:d.label||'Microphone'})),
        outputs:devices.filter(d=>d.kind==='audiooutput').map(d=>({id:d.deviceId,label:d.label||'Speakers'})),
        reason:status('Devices listed. A test needs your explicit permission.'),
      };
    }catch(error){return {ok:false,inputs:[],outputs:[],reason:status('Audio devices could not be listed: '+String(error?.name||'unavailable'))};}
  }
  function stopMicrophone(){
    for(const track of stream?.getTracks?.()??[])try{track.stop();}catch{}
    stream=null;
    try{micSource?.disconnect();}catch{}
    micSource=null;analyser=null;
    if(context){void context.close?.().catch?.(()=>{});context=null;}
    status('Microphone test stopped. No recording was saved or transmitted.');
  }
  async function testMicrophone(deviceId=''){
    stopMicrophone();
    if(typeof navigatorRef?.mediaDevices?.getUserMedia!=='function')
      return {ok:false,reason:status('This browser cannot request microphone access.')};
    try{
      stream=await navigatorRef.mediaDevices.getUserMedia({
        audio:deviceId?{deviceId:{exact:deviceId}}:true,video:false,
      });
      if(typeof AudioContextCtor==='function'){
        context=new AudioContextCtor();
        micSource=context.createMediaStreamSource(stream);
        analyser=context.createAnalyser();analyser.fftSize=512;micSource.connect(analyser);
        // Never route the mic to a speaker, remote API, recording or logger.
      }
      return {ok:true,reason:status('Microphone opened locally. Windows and ChatGPT still control Voice input.')};
    }catch(error){stopMicrophone();return {ok:false,reason:status('Microphone test failed: '+String(error?.name||'unavailable'))};}
  }
  function microphoneLevel(){
    if(!analyser)return null;
    const values=new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(values);
    let total=0;for(const sample of values){const delta=(sample-128)/128;total+=delta*delta;}
    return Math.sqrt(total/values.length);
  }
  async function testSpeakers(deviceId=''){
    if(typeof AudioContextCtor!=='function')
      return {ok:false,reason:status('Browser speaker test is unavailable.')};
    let testContext=null;
    try{
      testContext=new AudioContextCtor();
      if(deviceId){
        if(typeof testContext.setSinkId!=='function')
          throw new Error('Speaker selection is not supported here. Use Windows Sound output settings.');
        await testContext.setSinkId(deviceId);
      }
      if(testContext.state==='suspended')await testContext.resume();
      const oscillator=testContext.createOscillator(),gain=testContext.createGain();
      oscillator.frequency.value=440;gain.gain.value=0.07;
      oscillator.connect(gain);gain.connect(testContext.destination);
      oscillator.start();oscillator.stop(testContext.currentTime+0.15);
      oscillator.onended=()=>{void testContext.close?.().catch?.(()=>{});};
      return {ok:true,reason:status('Played a short local speaker test tone. ChatGPT app audio routing is separate.')};
    }catch(error){
      if(testContext)try{await testContext.close();}catch{}
      return {ok:false,reason:status('Speaker test failed: '+String(error?.message||'unavailable'))};
    }
  }
  return {listDevices,testMicrophone,stopMicrophone,microphoneLevel,testSpeakers};
}
