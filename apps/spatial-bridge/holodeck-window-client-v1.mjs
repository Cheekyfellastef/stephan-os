// One explicit local desktop connection; images and keystrokes are never logged
// or sent through Stephanos telemetry, GitHub, a relay, or an AI provider API.
export function createHolodeckWindowClient({fetchRef=globalThis.fetch,documentRef=globalThis.document,
  locationRef=globalThis.location,navigatorRef=globalThis.navigator,onChange=()=>{},setTimer=setTimeout,clearTimer=clearTimeout,sessionStore=globalThis.sessionStorage}={}) {
  const endpoint=`http://127.0.0.1:${locationRef?.port==='4174'?4184:4180}`;
  // Diagnostic only: this never starts a native service or binds a window.
  async function probeHelper(){
    try{
      const response=await fetchRef(endpoint+'/health',{method:'GET',cache:'no-store',
        signal:AbortSignal.timeout(4000)});
      if(!response.ok)return {ok:false,reason:'Spatial local capture helper refused health check.'};
      const data=await response.json();
      if(data?.schema!=='stephanos.spatial-window-health.v1')
        return {ok:false,reason:'Unexpected local capture helper identity.'};
      return {ok:true,reason:'Local Spatial window capture helper reachable.'};
    }catch{return {ok:false,reason:'Local window helper unavailable on port '+(locationRef?.port==='4174'?'4184':'4180')+
      '. Open Spatial Workspace using its Windows desktop shortcut.'};}
  }
  let image=null,epoch=0,refreshPromise=null;
  let token=null,active=false,disposed=false,generation=0,serial=0,sequence=0,timer=null,queue=[],busy=false;
  let sharedStream=null,sharedVideo=null,sharedFrame=null,sharedTimer=null;
  let pendingStream=null,pendingVideo=null,shareAttempt=null;
  const storageKey='stephanos.spatial-window.session.v1';
  try{const saved=sessionStore?.getItem(storageKey);if(/^[a-f0-9]{64}$/.test(saved??''))token=saved;}catch{}
  let state={status:'idle',message:'Connect your ChatGPT or Codex window.',inputStatus:'',windows:[],title:'',revision:0};
  function publish(changes){state={...state,...changes,revision:state.revision+1};try{onChange({...state});}catch{}}
  function stopShared(){
    const cancelPlayback=shareAttempt?.cancelPlayback;
    if(cancelPlayback){shareAttempt.cancelPlayback=null;cancelPlayback();}
    if(sharedTimer!==null)clearTimer(sharedTimer);
    sharedTimer=null;
    const streams=[sharedStream,pendingStream],videos=[sharedVideo,pendingVideo];
    sharedStream=null;sharedVideo=null;sharedFrame=null;pendingStream=null;pendingVideo=null;
    for(const stream of streams)for(const track of stream?.getTracks?.()??[])
      if(track.readyState!=='ended')try{track.stop();}catch{}
    for(const video of videos)if(video)try{video.pause?.();video.srcObject=null;}catch{}
  }
  // Local browser capture is an explicit view-only alternative when the
  // independently installed native 4180 adapter is not ready. No window input
  // or remote streaming is granted by a display capture permission.
  async function shareScreen(){
    const hostname=String(locationRef?.hostname||'').toLowerCase();
    if(disposed||!['127.0.0.1','localhost'].includes(hostname)){
      publish({inputStatus:'Desktop sharing is available only in the PC local Spatial Workspace.'});return false;
    }
    const media=navigatorRef?.mediaDevices;
    if(typeof media?.getDisplayMedia!=='function'){
      publish({inputStatus:'This browser cannot share a window. Use the reviewed Windows Spatial shortcut for the native console.'});return false;
    }
    // A second click must not create an unowned capture during the first
    // picker, native stop, or video.play() promise.
    // Do not open a second browser picker while an accepted stream is live.
    // Replacing a view requires a deliberate Stop and a new user grant.
    if(sharedStream || shareAttempt?.epoch===epoch){
      publish({inputStatus:'Stop the current shared window or pending request before sharing another.'});return false;
    }
    const startingEpoch=epoch,attempt={epoch};
    shareAttempt=attempt;
    let stream=null,video=null,accepted=false;
    const revoke=()=>{for(const track of stream?.getTracks?.()??[])
      if(track.readyState!=='ended')try{track.stop();}catch{}};
    try {
      // The picker remains directly inside the real user-initiated click.
      try {stream=await media.getDisplayMedia({video:true,audio:false});}
      catch {
        // A stale browser picker must not alter a revoked or newer session.
        if(!disposed && startingEpoch===epoch && shareAttempt===attempt)
          publish({inputStatus:'Window sharing was cancelled or blocked. No screen was connected.'});
        return false;
      }
      if(disposed||startingEpoch!==epoch)return false;
      const track=stream?.getVideoTracks?.()[0];
      if(!track||track.readyState==='ended'){
        publish({inputStatus:'Window capture provided no live picture.'});return false;
      }
      // Snapshot this attempt's own stop epoch before awaiting its native
      // request, never after a later user Stop or page departure.
      const oldStop=stop(),current=epoch;
      attempt.epoch=current;
      pendingStream=stream;
      await oldStop;
      if(disposed||current!==epoch)return false;
      // Register track loss before playback can remain pending indefinitely.
      const ended=()=>{
        if(!disposed&&current===epoch&&(shareAttempt===attempt||sharedStream===stream)){
          stopShared();publish({status:'idle',message:'Browser window sharing ended.',inputStatus:''});
        }
      };
      try{track.addEventListener?.('ended',ended,{once:true});}catch{return false;}
      if(track.readyState==='ended'){ended();return false;}
      try {
        video=documentRef.createElement('video');
        video.muted=true;video.autoplay=true;video.playsInline=true;
        video.srcObject=stream;pendingVideo=video;
        const playback=video.play();
        const cancelled=new Promise(resolve=>{attempt.cancelPlayback=()=>resolve(false);});
        const played=await Promise.race([Promise.resolve(playback).then(()=>true),cancelled]);
        attempt.cancelPlayback=null;
        if(!played)return false;
      }catch{
        // A late playback failure cannot overrule a newer Stop, departure,
        // or independently consented replacement capture.
        if(!disposed&&current===epoch)
          publish({status:'unavailable',message:'The browser could not display the selected window.'});
        return false;
      }
      if(disposed||current!==epoch||track.readyState==='ended')return false;
      // The uncommitted stream can be revoked immediately on Stop even
      // while play() never settles; only this exact epoch may adopt it.
      pendingStream=null;pendingVideo=null;
      sharedStream=stream;sharedVideo=video;
      sharedFrame={drawable:video,get naturalWidth(){return video.videoWidth;},get naturalHeight(){return video.videoHeight;}};
      const label='Shared PC window visible on the hologram (view-only). Native helper required for typing and clicking.';
      const frameTick=()=>{
        if(sharedStream!==stream||disposed||current!==epoch)return;
        if(track.readyState==='ended'){
          stopShared();publish({status:'idle',message:'Browser window sharing ended.',inputStatus:''});return;
        }
        const ready=Number.isFinite(video.videoWidth)&&video.videoWidth>0&&Number.isFinite(video.videoHeight)&&video.videoHeight>0;
        publish({status:ready?'view-only':'waiting',message:ready?label:'Waiting for the selected window to draw.',inputStatus:''});
        // A synchronous onChange can Stop/dispose this capture during publish.
        // Never re-arm its timer after that revocation.
        if (sharedStream===stream && !disposed && current===epoch) sharedTimer=setTimer(frameTick,100);
      };
      try{frameTick();}catch{
        stopShared();
        if(!disposed&&current===epoch)publish({status:'unavailable',message:'The browser could not display the selected window.'});
        return false;
      }
      if(sharedStream!==stream||track.readyState==='ended')return false;
      accepted=true;
      return true;
    } finally {
      attempt.cancelPlayback=null;
      if(shareAttempt===attempt)shareAttempt=null;
      if(!accepted){
        if(pendingStream===stream){pendingStream=null;pendingVideo=null;}
        revoke();
        if(video)try{video.pause?.();video.srcObject=null;}catch{}
      }
    }
  }
  function showWindows(windows,message){
    windows=Array.isArray(windows)?windows:[];
    publish({status:'selecting',windows,message:message??(windows.length
      ?'Select the ChatGPT or Codex window you want to use in VR.'
      :'No open windows found. Open ChatGPT on this PC; this list refreshes automatically.')});
  }
  function scheduleDiscovery(current){timer=setTimer(()=>refreshWindows(current),3000);}
  async function refreshWindows(current){
    if(state.status!=='selecting'||current!==epoch)return;
    try{
      refreshPromise=request('/windows');const result=await refreshPromise;
      if(current===epoch&&state.status==='selecting'){showWindows(result.windows);scheduleDiscovery(current);}
    }catch{if(current===epoch&&state.status==='selecting')publish({status:'unavailable',inputStatus:'',message:'Connection expired. Choose window again.'});}
    finally{if(current===epoch)refreshPromise=null;}
  }
  async function request(path,body={}) {
    const response=await fetchRef(endpoint+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{'X-Spatial-Session':token}:{})},
      body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(path==='/bind'?125000:20000)});
    const data=await response.json();if(!response.ok)throw new Error(data.status);return data;
  }
  async function stop() {
    stopShared();
    epoch++;active=false;clearTimer(timer);refreshPromise=null;queue=[];generation=0;serial=0;busy=false;
    let old=token;
    if(!old)try{old=sessionStore?.getItem(storageKey);}catch{}
    token=null;image=null;publish({status:'idle',windows:[],title:'',inputStatus:'',message:'Window disconnected.'});
    if(old)try{
      const response=await fetchRef(endpoint+'/stop',{method:'POST',headers:{'Content-Type':'application/json','X-Spatial-Session':old},body:'{}',keepalive:true,signal:AbortSignal.timeout(10000)});
      if(response.ok||response.status===403)try{if(sessionStore?.getItem(storageKey)===old)sessionStore.removeItem(storageKey);}catch{}
    }catch{}
  }
  async function discover() {
    if(disposed)return;
    const stopping=stop(),current=epoch;await stopping;
    if(disposed||current!==epoch)return;publish({status:'connecting',message:'Looking for open desktop windows.'});
    try {
      const session=await request('/session');
      if(disposed||current!==epoch){
        // A delayed session grant still needs revoking after this surface closes.
        if(/^[a-f0-9]{64}$/.test(session.token??''))void fetchRef(endpoint+'/stop',{method:'POST',headers:{'Content-Type':'application/json','X-Spatial-Session':session.token},body:'{}',keepalive:true}).catch(()=>{});
        return;
      }
      if(!/^[a-f0-9]{64}$/.test(session.token??''))throw new Error('Invalid session');
      token=session.token;
      try{sessionStore?.setItem(storageKey,token);}catch{}
      const result=await request('/windows');
      if(current!==epoch)return;
      showWindows(result.windows);
      // Keep the unbound selection alive while the person reads the window list.
      scheduleDiscovery(current);
    }catch(error){if(current===epoch)publish({status:'unavailable',message:error.message==='another-surface-active'
      ?'Another workspace has the connection. Disconnect it first, or wait for it to close.'
      :'The local window connection is unavailable. Start Spatial Workspace from its desktop button.'});}
  }
  async function connect(id) {
    let selected=state.windows.find(w=>w.id===id);if(!selected||busy||state.status!=='selecting')return false;
    clearTimer(timer);
    const current=epoch;
    busy=true;publish({status:'connecting',message:'Confirm the selected window in the Windows connection prompt.'});
    try{
      if(refreshPromise){
        const refreshed=await refreshPromise;
        if(current!==epoch||disposed)return false;
        const sameWindow=refreshed.windows?.find(window=>window.id===selected.id&&window.pid===selected.pid);
        if(!sameWindow){
          showWindows(refreshed.windows,'The window list changed. Select the intended app again.');scheduleDiscovery(current);return false;
        }
        selected=sameWindow;
      }
      if(current!==epoch||disposed)return false;
      const result=await request('/bind',{id});if(current!==epoch)return false;if(result.status!=='connected')throw new Error('bind');
      active=true;sequence=0;queue=[];publish({status:'waiting',windows:[],title:selected.title,message:'Waiting for the selected app to draw.'});
      timer=setTimer(()=>poll(current),0);return true;
    }catch{if(current===epoch)publish({status:'unavailable',message:'Could not connect that window. Restore it on your desktop and choose it again.'});return false;}
    finally{if(current===epoch)busy=false;}
  }
  async function poll(current) {
    if(!active||disposed||current!==epoch)return;
    try{
      const input=queue.shift();
      if(input){
        // Serialize capture and input; each operator action is sent once only.
        const result=await request('/input',{...input,sequence:++sequence});
        if(current!==epoch)return;
        publish({inputStatus:result.status==='input-posted'?'Input sent to the selected app.':'That input was not accepted. Select a text field or wait for a fresh picture.'});
      }
      const frame=await request('/frame');
      if(!active||current!==epoch)return;
      if(frame.status==='frame'&&Number.isSafeInteger(frame.serial)&&Number.isSafeInteger(frame.generation)&&typeof frame.jpeg==='string') {
        if(frame.serial!==serial||frame.generation!==generation||state.status!=='live'){
          const next=documentRef.createElement('img');next.src='data:image/jpeg;base64,'+frame.jpeg;await next.decode();
          if(!active||current!==epoch)return;
          if(generation!==frame.generation)queue=[];
          image=next;generation=frame.generation;serial=frame.serial;publish({status:'live',...(state.status!=='live'?{inputStatus:''}:{}),message:'Connected to your original app. Point at its controls to interact.'});
        }
      }else{generation=0;queue=[];publish({status:'waiting',inputStatus:'Input paused. Wait for a live picture of your app.',message:'Waiting for your app. Restore a minimized window or reconnect if it closed.'});}
      if(active&&!disposed&&current===epoch)timer=setTimer(()=>poll(current),queue.length?0:67);
    }catch{if(current===epoch){active=false;generation=0;queue=[];image=null;publish({status:'unavailable',inputStatus:'Input paused. Reconnect the selected app.',message:'Window connection lost. Your conversation remains in the original app.'});}}
  }
  function input(value){
    if(sharedStream){publish({inputStatus:'View-only capture: connect the native Windows helper to type or click.'});return false;}
    if(!active||!generation||state.status!=='live'||queue.length>=16){publish({inputStatus:'Input paused. Wait for a live connection.'});return false;}
    queue.push({...value,generation});publish({inputStatus:'Sending input to the selected app.'});return true;
  }
  return {discover,connect,shareScreen,stop,input,probeHelper,getState:()=>({...state}),
    getFrame:()=>sharedStream&&sharedFrame?.naturalWidth>0&&sharedFrame?.naturalHeight>0?sharedFrame:state.status==='live'?image:null,
    // A cached page retains this client. Revoke access on departure, but allow
    // an explicit new connection after Back/Forward restores the page.
    pagehide({persisted=false}={}){if(!persisted)disposed=true;return stop();},
    dispose(){disposed=true;void stop();}};
}
