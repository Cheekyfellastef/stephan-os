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
      if(data.readinessOnly!==false)
        return {ok:false,reason:data.readinessOnly===true
          ?'The helper is running an installation check only. Launch the normal Spatial Workspace shortcut to connect a window.'
          :'The local helper has not affirmed an interactive native session. Use the reviewed Spatial Workspace shortcut.'};
      if(locationRef?.port!=='4174'&&(typeof data.buildId!=='string'||!/^[a-f0-9]{64}$/.test(data.buildId)))
        return {ok:false,reason:'The local helper has no valid installed build identity. Use the reviewed Spatial Workspace shortcut.'};
      return {ok:true,reason:'Local Spatial helper responds.'};
    }catch{return {ok:false,reason:'Local window helper unavailable on port '+(locationRef?.port==='4174'?'4184':'4180')+
      '. Open Spatial Workspace using its Windows desktop shortcut.'};}
  }
  let image=null,epoch=0,refreshPromise=null;
  let token=null,active=false,disposed=false,generation=0,serial=0,sequence=0,timer=null,queue=[],busy=false,inputClickPending=false;
  // Room-local acknowledgement, not native keyboard focus. Never infer an editor from a bind or frame.
  let editorClickConfirmed=false;
  // One owner spans picker, native revocation, playback and the accepted view.
  // Late promises retain this record only; they can never close a newer owner.
  let capture=null;
  const captureCancelled=Symbol('capture-cancelled');
  const storageKey='stephanos.spatial-window.session.v1';
  try{const saved=sessionStore?.getItem(storageKey);if(/^[a-f0-9]{64}$/.test(saved??''))token=saved;}catch{}
  let state={status:'idle',message:'Connect your ChatGPT or Codex window.',inputStatus:'',windows:[],title:'',revision:0};
  function publish(changes){state={...state,...changes,revision:state.revision+1};try{onChange({...state});}catch{}}
  const currentEpoch=current=>!disposed&&current===epoch;
  const ownsCapture=owner=>currentEpoch(owner.epoch)&&capture===owner&&owner.phase!=='closed';
  function publishCurrent(current,changes){
    if(!currentEpoch(current))return false;
    publish(changes);
    return currentEpoch(current);
  }
  function stopTracks(stream){
    for(const track of stream?.getTracks?.()??[])try{if(track.readyState!=='ended')track.stop();}catch{}
  }
  function closeCapture(owner){
    if(!owner)return;
    if(capture===owner)capture=null;
    if(owner.phase==='closed')return;
    owner.phase='closed';
    const {stream,video,track,ended,timer,cancel}=owner;
    owner.stream=null;owner.video=null;owner.frame=null;owner.track=null;owner.ended=null;owner.timer=null;owner.cancel=null;
    cancel?.(captureCancelled);
    if(timer!==null)clearTimer(timer);
    try{track?.removeEventListener?.('ended',ended);}catch{}
    stopTracks(stream);
    if(video){try{video.pause?.();}catch{}try{video.srcObject=null;}catch{}}
  }
  function finishCapture(owner,changes){
    const owned=ownsCapture(owner),current=owner.epoch;
    closeCapture(owner);
    if(owned&&currentEpoch(current)&&capture===null)publish(changes);
    return false;
  }
  function captureFrameTick(owner){
    if(!ownsCapture(owner)||owner.phase!=='live')return false;
    owner.timer=null;
    if(owner.track.readyState==='ended')return finishCapture(owner,{status:'idle',message:'Browser window sharing ended.',inputStatus:''});
    try{
      const video=owner.video;
      const ready=Number.isFinite(video.videoWidth)&&video.videoWidth>0&&Number.isFinite(video.videoHeight)&&video.videoHeight>0;
      publish({status:ready?'view-only':'waiting',message:ready
        ?'Shared PC window visible on the hologram (view-only). Native helper required for typing and clicking.'
        :'Waiting for the selected window to draw.',inputStatus:''});
      if(!ownsCapture(owner))return false;
      owner.timer=setTimer(()=>captureFrameTick(owner),100);
      return ownsCapture(owner);
    }catch{
      return finishCapture(owner,{status:'unavailable',message:'The browser could not display the selected window.'});
    }
  }
  async function revokeNativeToken(old){
    if(!old)return true;
    try{
      const response=await fetchRef(endpoint+'/stop',{method:'POST',headers:{'Content-Type':'application/json','X-Spatial-Session':old},body:'{}',keepalive:true,signal:AbortSignal.timeout(10000)});
      if(!response.ok)return false; // 403 and timeouts cannot prove native capture was released.
      try{if(sessionStore?.getItem(storageKey)===old)sessionStore.removeItem(storageKey);}catch{}
      return true;
    }catch{return false;}
  }
  function beginDisconnect(keepCapture=null){
    // Bind the transition before cleanup or publication can reenter this client.
    // Only capture adoption may retain its exact owner across native revocation.
    const current=++epoch,previousCapture=capture;
    capture=keepCapture;
    if(keepCapture)keepCapture.epoch=current;
    let old=token;
    if(!old)try{old=sessionStore?.getItem(storageKey);}catch{}
    token=null;active=false;image=null;refreshPromise=null;queue=[];generation=0;serial=0;busy=false;inputClickPending=false;editorClickConfirmed=false;
    const oldTimer=timer;timer=null;
    if(previousCapture!==keepCapture)closeCapture(previousCapture);
    clearTimer(oldTimer);
    if(current===epoch&&capture===keepCapture)
      publish({status:'idle',windows:[],title:'',inputStatus:'',
        message:old?'Window disconnected locally; verifying native capture release.':'Window disconnected.'});
    // Preserve the original one-hop, token-free disconnect timing: a room
    // with no native session must not delay an explicitly requested discovery.
    const stopped=old?revokeNativeToken(old).then(released=>{
      // A late revocation must never overwrite a newer native bind or view.
      if(old&&currentEpoch(current)&&capture===keepCapture&&state.status==='idle'){
        publish({status:released?'idle':'unavailable',
          message:released?'Window disconnected.':'Local input was revoked, but the Windows helper did not confirm capture release. Verify the native session before reconnecting.',
          inputStatus:released?'':'Native capture release unverified. Do not assume the original app is no longer shared.'});
      }
      return released;
    }):Promise.resolve(true);
    return Object.freeze({epoch:current,stopped});
  }
  // Local browser capture remains an explicit view-only alternative. A display
  // grant never enables native input, audio capture or a remote stream.
  async function shareScreen(){
    const hostname=String(locationRef?.hostname||'').toLowerCase();
    if(disposed||!['127.0.0.1','localhost'].includes(hostname)){
      publish({inputStatus:'Desktop sharing is available only in the PC local Spatial Workspace.'});return false;
    }
    const media=navigatorRef?.mediaDevices;
    if(typeof media?.getDisplayMedia!=='function'){
      publish({inputStatus:'This browser cannot share a window. Use the reviewed Windows Spatial shortcut for the native console.'});return false;
    }
    if(capture){
      publish({inputStatus:'Stop the current shared window or pending request before sharing another.'});return false;
    }
    let cancel;
    const owner={epoch,phase:'picker',stream:null,track:null,ended:null,video:null,frame:null,timer:null,
      cancelled:new Promise(resolve=>{cancel=resolve;}),cancel:value=>cancel(value)};
    capture=owner;
    let accepted=false;
    try{
      // Invoke directly in the actual click stack, before the first await.
      // Cancellation cannot dismiss a browser picker, but a late grant is
      // immediately stopped and cannot become another attempt's resource.
      let stream;
      try{
        const picker=media.getDisplayMedia({video:true,audio:false});
        stream=await Promise.race([Promise.resolve(picker).then(granted=>{
          if(ownsCapture(owner))owner.stream=granted;else stopTracks(granted);
          return granted;
        }),owner.cancelled]);
      }catch{
        return finishCapture(owner,{inputStatus:'Window sharing was cancelled or blocked. No screen was connected.'});
      }
      if(stream===captureCancelled||!ownsCapture(owner))return false;
      const track=stream?.getVideoTracks?.()[0];
      if(!track||track.readyState==='ended')return finishCapture(owner,{inputStatus:'Window capture provided no live picture.'});
      owner.track=track;
      owner.ended=()=>{
        if(ownsCapture(owner))finishCapture(owner,{status:'idle',message:'Browser window sharing ended.',inputStatus:''});
      };
      try{track.addEventListener?.('ended',owner.ended,{once:true});}catch{return false;}
      if(track.readyState==='ended'){owner.ended();return false;}
      owner.phase='native-stop';
      const transition=beginDisconnect(owner);
      if(!ownsCapture(owner))return false;
      const stopped=await Promise.race([transition.stopped,owner.cancelled]);
      if(stopped===captureCancelled||!ownsCapture(owner))return false;
      if(stopped!==true)return finishCapture(owner,{status:'unavailable',
        message:'Native window release unverified. Browser sharing was not adopted.',
        inputStatus:'Verify the Windows helper stopped the previous capture before trying again.'});
      owner.phase='playback';
      try{
        const video=documentRef.createElement('video');owner.video=video;
        video.muted=true;video.autoplay=true;video.playsInline=true;video.srcObject=stream;
        const played=await Promise.race([Promise.resolve(video.play()),owner.cancelled]);
        if(played===captureCancelled||!ownsCapture(owner))return false;
      }catch{
        return finishCapture(owner,{status:'unavailable',message:'The browser could not display the selected window.'});
      }
      if(track.readyState==='ended'){owner.ended();return false;}
      const video=owner.video;
      owner.frame={drawable:video,get naturalWidth(){return video.videoWidth;},get naturalHeight(){return video.videoHeight;}};
      owner.phase='live';
      accepted=captureFrameTick(owner);
      return accepted;
    }finally{
      if(!accepted)closeCapture(owner);
    }
  }
  function showWindows(current,windows,message){
    windows=Array.isArray(windows)?windows:[];
    return publishCurrent(current,{status:'selecting',windows,message:message??(windows.length
      ?'Select the ChatGPT or Codex window you want to use in VR.'
      :'No open windows found. Open ChatGPT on this PC; this list refreshes automatically.')});
  }
  function scheduleDiscovery(current){
    // A selection subscriber may synchronously revoke the selection during publication.
    if(currentEpoch(current)&&state.status==='selecting')timer=setTimer(()=>refreshWindows(current),3000);
  }
  async function refreshWindows(current){
    if(state.status!=='selecting'||!currentEpoch(current))return;
    try{
      refreshPromise=request('/windows');const result=await refreshPromise;
      if(currentEpoch(current)&&state.status==='selecting'&&showWindows(current,result.windows))scheduleDiscovery(current);
    }catch{if(current===epoch&&state.status==='selecting')publish({status:'unavailable',inputStatus:'',message:'Connection expired. Choose window again.'});}
    finally{if(current===epoch)refreshPromise=null;}
  }
  async function request(path,body={}) {
    const response=await fetchRef(endpoint+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{'X-Spatial-Session':token}:{})},
      body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(path==='/bind'?125000:20000)});
    const data=await response.json();if(!response.ok)throw new Error(data.status);return data;
  }
  function stop(){return beginDisconnect().stopped;}
  async function discover() {
    if(disposed)return;
    const transition=beginDisconnect(),current=transition.epoch;
    if(!await transition.stopped)return false; // Do not allocate a new native session after an unverified stop.
    if(!publishCurrent(current,{status:'connecting',message:'Looking for open desktop windows.'}))return;
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
      if(!showWindows(current,result.windows))return;
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
    busy=true;
    try{
      if(!publishCurrent(current,{status:'connecting',message:'Confirm the selected window in the Windows connection prompt.'}))return false;
      if(refreshPromise){
        const refreshed=await refreshPromise;
        if(current!==epoch||disposed)return false;
        const sameWindow=refreshed.windows?.find(window=>window.id===selected.id&&window.pid===selected.pid);
        if(!sameWindow){
          if(showWindows(current,refreshed.windows,'The window list changed. Select the intended app again.'))scheduleDiscovery(current);return false;
        }
        selected=sameWindow;
      }
      if(current!==epoch||disposed)return false;
      const result=await request('/bind',{id});if(current!==epoch)return false;if(result.status!=='connected')throw new Error('bind');
      active=true;sequence=0;queue=[];editorClickConfirmed=false;
      if(!publishCurrent(current,{status:'waiting',windows:[],title:selected.title,message:'Waiting for the selected app to draw.'})||!active)return false;
      timer=setTimer(()=>poll(current),0);return true;
    }catch{if(current===epoch)publish({status:'unavailable',message:'Could not connect that window. Restore it on your desktop and choose it again.'});return false;}
    finally{if(current===epoch)busy=false;}
  }
  async function poll(current) {
    if(!active||!currentEpoch(current))return;
    // A failed response cannot prove whether the selected app applied its input.
    // Keep this uncertainty visible rather than inviting a duplicate Send/key.
    let inputAttempted=false;
    try{
      const input=queue.shift();
      if(input){
        // Serialize capture and input; each operator action is sent once only.
        inputAttempted=true;
        if(input.kind==='click')inputClickPending=true;
        const result=await request('/input',{...input,sequence:++sequence});
        if(current!==epoch)return;
        if(input.kind==='click')inputClickPending=false;
        // Do not allow a stale click or a failed native editor binding to license later non-text keys.
        if(input.kind==='click'){
          editorClickConfirmed=result.status==='editor-accessibility-selected';
          // A legacy pointer or failed click may have focused an unknown app
          // control. Do not send text queued while that click was unresolved.
          if(!editorClickConfirmed)queue=[];
        }
        else if(['editor-not-selected','editor-reselect-required','editor-unsupported','editor-key-focus-unverified'].includes(result.status))
          editorClickConfirmed=false;
        // The app may have applied a mutation before returning an uncertain
        // outcome. Never deliver a previously queued Enter/Send afterwards.
        // App controls and non-text keys can also change the current focus.
        // Retain editor-key eligibility only after an explicitly confirmed
        // text outcome. Unknown or newly introduced helper replies must not
        // flush a previously queued Enter against a possibly changed draft.
        if(input.kind==='key'||(input.kind==='text'&&
          !['editor-value-readback','editor-value-unchanged'].includes(result.status))||
          ['app-control-invoked','app-control-outcome-unverified','input-rejected'].includes(result.status)){
          editorClickConfirmed=false;queue=[];
        }
        if(!publishCurrent(current,{inputStatus:({
          'editor-accessibility-selected':'Editable field located in the selected window. Type a virtual key to test it.',
          'editor-value-readback':'Windows accessibility read back the updated editor text. Confirm the actual app reflects it before Send.',
          'editor-not-selected':'No editable field selected. Click the app composer on the holographic image first.',
          'editor-reselect-required':'The selected editor changed. Click its current location again.',
          'editor-unsupported':'The selected application does not expose a writable editor here.',
          'editor-update-refused':'The editor did not confirm the change. Inspect the draft before retrying.',
          'editor-update-not-started':'No editor value update was attempted. The application was not changed by this request.',
          'editor-update-unverified':'The editor did not confirm the requested value. Check its draft; do not retry Send automatically.',
          'editor-length-refused':'This editor exceeds the allowed text length. No input was applied.',
          'editor-value-unchanged':'Editor was already empty; no character was removed.',
          'app-control-invoked':'The selected app control was invoked. Check its actual result.',
          'app-control-outcome-unverified':'The app control may have acted already. Inspect it before any retry; no second click was sent.',
          'editor-key-focus-unverified':'The selected editor has not established keyboard focus. Use the app’s explicit button rather than Enter.',
          'input-posted':'Windows queued the pointer/key event, but the app has not confirmed it.',
          'input-rejected':'That input was not accepted. The selected app did not confirm that input.'
        }[result.status]??'The selected app did not confirm that input. Click a valid target or wait for a fresh picture.')}))return;
      }
      const frame=await request('/frame');
      if(!active||current!==epoch)return;
      if(frame.status==='frame'&&Number.isSafeInteger(frame.serial)&&Number.isSafeInteger(frame.generation)&&typeof frame.jpeg==='string') {
        if(frame.serial!==serial||frame.generation!==generation||state.status!=='live'){
          const next=documentRef.createElement('img');next.src='data:image/jpeg;base64,'+frame.jpeg;await next.decode();
          if(!active||current!==epoch)return;
          if(generation!==frame.generation){queue=[];editorClickConfirmed=false;}
          image=next;generation=frame.generation;serial=frame.serial;publish({status:'live',...(state.status!=='live'?{inputStatus:''}:{}),message:'Connected to your original app. Point at its controls to interact.'});
        }
      }else{generation=0;queue=[];editorClickConfirmed=false;publish({status:'waiting',inputStatus:'Input paused. Wait for a live picture of your app.',message:'Waiting for your app. Restore a minimized window or reconnect if it closed.'});}
      if(active&&currentEpoch(current))timer=setTimer(()=>poll(current),queue.length?0:67);
    }catch{if(current===epoch){active=false;generation=0;queue=[];image=null;inputClickPending=false;editorClickConfirmed=false;publish({status:'unavailable',
      inputStatus:inputAttempted
        ?'The last input may already have changed the selected app. Inspect its draft before reconnecting; do not resend automatically.'
        :'Input paused. Reconnect the selected app.',
      message:'Window connection lost. Your conversation remains in the original app.'});}}
  }
  function input(value){
    if(capture?.phase==='live'){publish({inputStatus:'View-only capture: connect the native Windows helper to type or click.'});return false;}
    if(!active||!generation||state.status!=='live'||queue.length>=16){publish({inputStatus:'Input paused. Wait for a live connection.'});return false;}
    // A native bind and picture do not select the app composer. Text can wait
    // behind an explicit click, but poll forwards it only after a real editor
    // selection acknowledgement. Never send unsolicited drafts to an app.
    if(value?.kind==='text'&&!editorClickConfirmed&&!inputClickPending&&!queue.some(item=>item.kind==='click')){
      publish({inputStatus:'Select the intended editor on the hologram first. No draft text was sent.'});return false;
    }
    if(value?.kind==='key'&&!editorClickConfirmed){
      publish({inputStatus:'Select the editor in the original app on the holographic image first. No key was sent.'});return false;
    }
    // A new pointer action invalidates the last editor acknowledgement immediately, before queuing.
    if(value?.kind==='click'){
      // New deliberate target supersedes unsent text/keys for an older click.
      // Never replay an already attempted native input; only clear the queue.
      queue=[];
      editorClickConfirmed=false;
    }
    queue.push({...value,generation});publish({inputStatus:'Sending input to the selected app.'});return true;
  }
  return {discover,connect,shareScreen,stop,input,probeHelper,getState:()=>({...state}),
    getFrame:()=>capture?.phase==='live'&&capture.frame?.naturalWidth>0&&capture.frame?.naturalHeight>0?capture.frame:state.status==='live'?image:null,
    // A cached page retains this client. Revoke access on departure, but allow
    // an explicit new connection after Back/Forward restores the page.
    pagehide({persisted=false}={}){if(!persisted)disposed=true;return stop();},
    dispose(){disposed=true;void stop();}};
}
