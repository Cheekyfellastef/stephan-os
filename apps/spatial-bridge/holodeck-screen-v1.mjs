import {HOLODECK_PANELS,PANEL_BUTTONS,PANEL_CANVAS,CHATGPT_CONTENT,WINDOW_ROWS_PER_PAGE,panelAt,panelButtons,panelButtonAt} from './holodeck-panels-v1.mjs';
export {HOLODECK_PANELS,PANEL_BUTTONS} from './holodeck-panels-v1.mjs';

// Versioned, presentation-only preferences. Never persist window selection,
 // consent, microphone state, application thread, text drafts or native input.
export const SPATIAL_CONVERSATION_PRESENTATION_KEY='stephanos.spatial.conversation-presentation.v1';
const presentationDefaults=()=>({zoom:1,panX:0,panY:0,focusedPanel:'chatgpt',leftPage:'console',furnitureTarget:'keyboard'});
export function readSpatialConversationPresentation(storage){
  const fallback=presentationDefaults();
  try{
    const raw=storage?.getItem?.(SPATIAL_CONVERSATION_PRESENTATION_KEY);
    if(typeof raw!=='string'||raw.length>2048)return fallback;
    const value=JSON.parse(raw);
    if(!value||Array.isArray(value)||typeof value!=='object'||value.version!==1)return fallback;
    const zoom=Number.isFinite(value.zoom)&&value.zoom>=1&&value.zoom<=4?value.zoom:1;
    const pan=axis=>zoom>1&&Number.isFinite(value[axis])&&value[axis]>=-1&&value[axis]<=1?value[axis]:0;
    return {zoom,panX:pan('panX'),panY:pan('panY'),
      focusedPanel:['chatgpt','settings','tools'].includes(value.focusedPanel)?value.focusedPanel:fallback.focusedPanel,
      leftPage:['console','settings'].includes(value.leftPage)?value.leftPage:fallback.leftPage,
      furnitureTarget:['keyboard','table'].includes(value.furnitureTarget)?value.furnitureTarget:fallback.furnitureTarget};
  }catch{return fallback;}
}

export const SCREEN_ACTIONS=Object.freeze([
  ['fit','Fit'],['zoom-in','Zoom +'],['zoom-out','Zoom −'],
  ['pan-left','View ←'],['pan-right','View →'],['pan-up','View ↑'],['pan-down','View ↓'],
  ['scroll-up','Scroll ↑'],['scroll-down','Scroll ↓'],['voice','Audio help'],['stop','Disconnect'],['reload','Reload'],
].map(([id,label],i)=>Object.freeze({id,label,x:0.025+i*0.079,y:0.04,w:0.075,h:0.15})));
export const SCREEN_COMFORT_ACTIONS=Object.freeze([
  ['mode-seated','Seated'],['mode-standing','Standing'],
  ['height-down','Height −'],['height-up','Height +'],
  ['tilt-down','Tilt −'],['tilt-up','Tilt +'],
  ['tilt-flat','Flat'],['tilt-vertical','Vertical'],['comfort-reset','Reset profile'],
].map(([id,label],i)=>Object.freeze({id,label,x:0.025+i*0.106,y:0.195,w:0.10,h:0.115})));
export const DISPLAY_COMFORT_BUTTONS=Object.freeze(PANEL_BUTTONS.filter(button=>
  SCREEN_COMFORT_ACTIONS.some(action=>action.id===button.id)));
export function screenComfortHit(u,v) {
  return DISPLAY_COMFORT_BUTTONS.find(b=>u>=b.x&&u<=b.x+b.w&&v>=b.y&&v<=b.y+b.h)??null;
}
export const SCREEN_KEYS=Object.freeze([
  ...['1234567890-=', 'qwertyuiop[]', 'asdfghjkl;\'', 'zxcvbnm,./'].flatMap((row,r)=>[...row].map((key,i)=>
    Object.freeze({id:`key:${key}`,label:key,x:0.055+i*0.07+r*0.015,y:0.35+r*0.123,w:0.063,h:0.106}))),
  {id:'shift',label:'Shift',x:0.055,y:0.855,w:0.12,h:0.12},
  {id:'key: ',label:'Space',x:0.19,y:0.855,w:0.38,h:0.12},
  {id:'backspace',label:'Backspace',x:0.59,y:0.855,w:0.17,h:0.12},
  {id:'enter',label:'Enter (app)',x:0.78,y:0.855,w:0.18,h:0.12},
].map(Object.freeze));
export const SCREEN_BUTTONS=Object.freeze([...SCREEN_ACTIONS.map(b=>Object.freeze({...b,y:0.035,h:0.12})),...SCREEN_COMFORT_ACTIONS,...SCREEN_KEYS]);
export const SCREEN_CONTENT=CHATGPT_CONTENT;
const SHIFTED_KEYS=Object.freeze({'1':'!','2':'@','3':'#','4':'$','5':'%','6':'^','7':'&','8':'*','9':'(','0':')','-':'_','=':'+','[':'{',']':'}',';':':',"'":'"',',':'<','.':'>','/':'?'});
export function screenKeyText(key,shift=false) {return shift?(SHIFTED_KEYS[key]??key.toUpperCase()):key;}
export function screenButtonLabel(button,shift=false) {
  return button.id.startsWith('key:')&&button.id!=='key: '?screenKeyText(button.id.slice(4),shift):button.label;
}
const boundedPan=value=>Math.max(-1,Math.min(1,Number.isFinite(value)?value:0));
export function screenCrop(width,height,zoom=1,panX=0,panY=0) {
  const scale=Math.max(1,Math.min(4,Number.isFinite(zoom)?zoom:1)),w=width/scale,h=height/scale;
  return {x:(width-w)*(boundedPan(panX)+1)/2,y:(height-h)*(boundedPan(panY)+1)/2,w,h};
}
export function screenImageRect(width,height,zoom=1,panX=0,panY=0) {
  const r=SCREEN_CONTENT,crop=screenCrop(width,height,zoom,panX,panY),scale=Math.min(r.w/crop.w,r.h/crop.h),w=crop.w*scale,h=crop.h*scale;
  return {x:r.x+(r.w-w)/2,y:r.y+(r.h-h)/2,w,h,crop};
}
export function screenPointToSource(u,v,width,height,zoom=1,panX=0,panY=0) {
  if(![u,v,width,height].every(Number.isFinite)||width<=0||height<=0)return null;
  const r=screenImageRect(width,height,zoom,panX,panY),x=u*SCREEN_CONTENT.width,y=v*SCREEN_CONTENT.height;
  // Normalising and restoring a canvas edge can differ by a fraction of a
  // floating-point pixel. Clamp that rounding only; real letterboxes stay inert.
  const epsilon=1e-9;
  if(x<r.x-epsilon||x>r.x+r.w+epsilon||y<r.y-epsilon||y>r.y+r.h+epsilon)return null;
  const along=value=>Math.max(0,Math.min(1,value));
  return {x:(r.crop.x+along((x-r.x)/r.w)*r.crop.w)/width,y:(r.crop.y+along((y-r.y)/r.h)*r.crop.h)/height};
}
export function createHolodeckScreen({client,comfort,furniture,audio,storage,documentRef=globalThis.document,onReload=()=>{},onStatus=()=>{},now=()=>globalThis.performance?.now?.()??Date.now()}={}) {
  const screen=documentRef.createElement('canvas'),consoleCanvas=documentRef.createElement('canvas');
  screen.width=3072;screen.height=954;consoleCanvas.width=2048;consoleCanvas.height=512;
  const ctx=screen.getContext('2d'),keys=consoleCanvas.getContext('2d');
  // localStorage access itself may throw for a blocked origin; storage is optional.
  let presentationStore;
  try{presentationStore=storage===undefined?globalThis.localStorage:storage;}catch{}
  const restored=readSpatialConversationPresentation(presentationStore);
  let revision=0,drawn='',zoom=restored.zoom,panX=restored.panX,panY=restored.panY,
    viewPending=restored.zoom!==1||restored.panX!==0||restored.panY!==0,
    inputFeedback=null,shift=false,hover=null,voiceHelp=false,reloadConfirm=false;
  let lastKeyPress=null;
  let focusedPanel=restored.focusedPanel,leftPage=restored.leftPage,toolsPage='audio',furnitureTarget=restored.furnitureTarget,selectedWindow=null,windowPage=0;
  let paintedLeftPage=null,paintedWindowPage=0,paintedWindowRows=[],paintedSelectedWindow=null,paintedFrame=null;
  let connectionPending=null,connectionMessage='',connectionEpoch=0,inputRevoked=false;
  const pressKeycap=id=>{if(SCREEN_KEYS.some(key=>key.id===id))lastKeyPress={id,at:now()};};
  const getKeycapMotion=()=>lastKeyPress?{id:lastKeyPress.id,ageMs:now()-lastKeyPress.at}:null;
  const presentationSnapshot=()=>JSON.stringify({version:1,zoom,panX,panY,focusedPanel,leftPage,furnitureTarget});
  let lastPresentation=presentationSnapshot();
  const savePresentation=()=>{
    const current=presentationSnapshot();
    if(current===lastPresentation)return;
    lastPresentation=current;
    try{presentationStore?.setItem?.(SPATIAL_CONVERSATION_PRESENTATION_KEY,current);}catch{}
  };
  const changed=()=>{savePresentation();revision++;try{onStatus(getState());}catch{}};
  function focus(id){
    if(!HOLODECK_PANELS.some(panel=>panel.id===id))return false;
    if(focusedPanel!==id){focusedPanel=id;inputFeedback=null;changed();}return true;
  }
  function currentSelection(){
    const state=client.getState();
    const selected=state.status==='selecting'&&state.windows?.find(window=>window.id===selectedWindow?.id&&window.pid===selectedWindow?.pid);
    if(!selected)selectedWindow=null;
    return selected??null;
  }
  function selectWindow(id,expectedPid){
    const state=client.getState(),index=state.status==='selecting'?state.windows?.findIndex(window=>window.id===id&&(expectedPid===undefined||window.pid===expectedPid))??-1:-1;
    const selected=index>=0?state.windows[index]:null;
    selectedWindow=selected?{id:selected.id,pid:selected.pid}:null;
    if(selected){windowPage=Math.floor(index/WINDOW_ROWS_PER_PAGE);connectionMessage='';}
    changed();return Boolean(selected);
  }
  function windowChoices(state){
    const windows=state.status==='selecting'?state.windows??[]:[];
    const windowPages=Math.ceil(windows.length/WINDOW_ROWS_PER_PAGE);
    const selectedIndex=windows.findIndex(window=>window.id===selectedWindow?.id&&window.pid===selectedWindow?.pid);
    if(selectedIndex>=0)windowPage=Math.floor(selectedIndex/WINDOW_ROWS_PER_PAGE);
    windowPage=Math.min(windowPage,Math.max(0,windowPages-1));
    return {windowPage,windowPages,windowRows:windows.slice(windowPage*WINDOW_ROWS_PER_PAGE,(windowPage+1)*WINDOW_ROWS_PER_PAGE)
      .map(window=>({id:window.id,pid:window.pid,title:window.title,page:windowPage}))};
  }
  function keyboardNotice(state){
    if(focusedPanel!=='chatgpt')return 'Keyboard paused — select the centre window to type.';
    if(state.status==='view-only')return 'VIEW ONLY — use Console on the left to connect an interactive window.';
    if(state.status!=='live')return 'Keyboard waiting for an interactive window connection.';
    return 'Select a field in the connected app. Enter follows app behaviour and may send; use the app Send button for explicit Send.';
  }
  function appInputBlocker(state,viewPainted=false){
    const currentFrame=client.getFrame();
    const reason=focusedPanel!=='chatgpt'?'local-panel':state.status==='view-only'?'view-only':inputRevoked?'stopped':state.status!=='live'||!currentFrame?'connection':voiceHelp?'audio-help':reloadConfirm?'reload':!viewPainted&&(viewPending||currentFrame!==paintedFrame)?'view-pending':null;
    if(!reason)return null;
    const message=reason==='local-panel'?keyboardNotice(state):
      reason==='view-only'?'This window is view-only. Open Console on the left and connect the Windows helper to click or type.':
      reason==='stopped'?'Input stopped. Connect a window again before clicking or typing.':
      reason==='audio-help'?'Input paused. Close Audio help to use the connected app.':
      reason==='reload'?'Input paused. Press Fit to cancel Reload before using the app.':
      reason==='view-pending'?'Input paused. Wait for the updated view.':
      state.status==='unavailable'?'Input paused. Reconnect the selected app.':
      state.status==='waiting'?'Input paused. Wait for a live picture of your app.':'Input paused. Wait for a live connection.';
    return {reason,status:state.status,message};
  }
  function projectState(viewPainted=false){
    const state=client.getState();
    const blocker=appInputBlocker(state,viewPainted);
    if(inputFeedback&&(inputFeedback.reason!==blocker?.reason||inputFeedback.status!==blocker?.status)){
      inputFeedback=null;revision++;
    }
    return {...state,...(inputFeedback?{inputStatus:inputFeedback.message}:{}),zoom,panX,panY,voiceHelp,shift,
      comfort:comfort?.getState(),furniture:furniture?.getState(),audio:audio?.getState?.(),
      focusedPanel,keyboardEnabled:!blocker,keyboardNotice:blocker?.message??keyboardNotice(state),leftPage,toolsPage,furnitureTarget,
      selectedWindowId:currentSelection()?.id??null,connectionPending,connectionMessage,...windowChoices(state)};
  }
  function getState(){return projectState();}
  function canForwardAppInput(report=false){
    const blocker=appInputBlocker(client.getState());
    if(blocker&&report){inputFeedback=blocker;changed();}
    return !blocker;
  }
  function forwardAppInput(value){
    if(!canForwardAppInput(true))return false;
    inputFeedback=null;return client.input(value);
  }
  function hitTest(u,v){
    const panel=panelAt(u,v);if(!panel)return null;
    if(panel.id==='settings'&&paintedLeftPage!==leftPage)return {panel:panel.id,id:null};
    const button=panelButtonAt(u,v,toolsPage,leftPage);
    if(button?.id.startsWith('window-row-')){
      const row=paintedWindowRows[Number(button.id.slice(11))];
      return {panel:panel.id,id:row&&paintedWindowPage===windowPage?button.id:null,...(row?{window:{...row}}:{})};
    }
    if(button?.id==='connect-window'){
      const selected=currentSelection(),same=selected&&paintedSelectedWindow?.id===selected.id&&paintedSelectedWindow.pid===selected.pid;
      return {panel:panel.id,id:same?button.id:null,...(same?{window:{...paintedSelectedWindow}}:{})};
    }
    return {panel:panel.id,id:button?.id??null};
  }
  function point(u,v,activate=false) {
    const hit=hitTest(u,v);if(!hit)return false;
    if(activate&&hit.id==='disconnect-window'){action(hit.id);return true;}
    if(activate)focus(hit.panel);
    if(hit.id){if(activate)action(hit.id,hit.window);return true;}
    if(hit.panel!=='chatgpt')return true;
    const x=u*PANEL_CANVAS.width,y=v*PANEL_CANVAS.height;
    if(x<SCREEN_CONTENT.x||x>SCREEN_CONTENT.x+SCREEN_CONTENT.w||y<SCREEN_CONTENT.y||y>SCREEN_CONTENT.y+SCREEN_CONTENT.h)return true;
    if(!canForwardAppInput(activate))return client.getState().status==='view-only';
    const image=client.getFrame();
    const source=screenPointToSource(u,v,image.naturalWidth,image.naturalHeight,zoom,panX,panY);
    if(!source)return false;
    if(activate)forwardAppInput({kind:'click',...source});return true;
  }
  function settleConnection(owner,promise,completed=()=>{}){
    return Promise.resolve(promise).then(result=>{
      if(owner!==connectionEpoch)return false;
      completed(result);
      // Only an independent diagnostic or action error belongs here. The
      // client's current phase is projected live and must never be snapshotted.
      connectionMessage=typeof result?.reason==='string'?result.reason:'';return result;
    }).catch(()=>{if(owner===connectionEpoch)connectionMessage='Connection action failed. Check the current helper and window status.';return false;})
      .finally(()=>{if(owner===connectionEpoch){connectionPending=null;changed();}});
  }
  function runConnection(label,operation,completed){
    if(connectionPending)return false;
    const owner=++connectionEpoch;connectionPending=label;connectionMessage='';changed();
    return settleConnection(owner,Promise.resolve().then(()=>owner===connectionEpoch?operation():false),completed);
  }
  function stopConnection(){
    // Revocation is synchronous, before a subscriber or another hand can send
    // input in this frame. Completion only reconciles that original stop.
    const owner=++connectionEpoch;inputRevoked=true;selectedWindow=null;
    connectionPending='Disconnecting the selected window…';connectionMessage='';
    let stopped;
    try{stopped=client.stop();}catch(error){stopped=Promise.reject(error);}
    // Disconnect must also release a room-local microphone test, including a
    // pending browser grant. This never mutes or ends ChatGPT Voice in the app.
    const localMicrophone=audio?.getState?.();
    if(localMicrophone?.microphoneActive||localMicrophone?.microphonePending)audio.stopMicrophone();
    // Local speaker tests may still be selecting an output or playing a tone.
    // Stop those independently; this cannot stop Voice in the selected app.
    audio?.stopSpeakers?.();
    if(owner===connectionEpoch)changed();
    return settleConnection(owner,stopped);
  }
  function cycleDevice(kind,direction){
    const state=audio?.getState?.();if(!state)return;
    const devices=kind==='input'?state.inputs:state.outputs,id=kind==='input'?state.inputId:state.outputId;
    const ids=['',...(devices??[]).map(device=>device.id)],index=Math.max(0,ids.indexOf(id));
    const selected=ids[(index+direction+ids.length)%ids.length];
    if(kind==='input')audio.setInput(selected);else audio.setOutput(selected);changed();
  }
  function scrollTarget() {
    // Dedicated Scroll arrows target the visible selected-app viewport centre,
    // never the last pointer hover (which may be over a composer or toolbar).
    // Normalized crop coordinates respect the current zoom and pan.
    const crop=screenCrop(1,1,zoom,panX,panY);
    return {x:crop.x+crop.w/2,y:crop.y+crop.h/2};
  }
  function action(id,paintedWindow) {
    if(id.startsWith('focus-'))return focus(id.slice(6));
    if(id==='left-console'||id==='left-settings'||id==='tools-connection'){
      leftPage=id==='left-settings'?'settings':'console';focus('settings');changed();return true;
    }
    if(id==='tools-audio'){
      toolsPage='audio';focus('tools');changed();return true;
    }
    if(id==='furniture-keyboard'||id==='furniture-table'){
      furnitureTarget=id.slice(10);leftPage='settings';focus('settings');changed();return true;
    }
    if(id.startsWith('furniture-')){
      const axes={'furniture-left':[0,-.1],'furniture-right':[0,.1],'furniture-away':[2,-.1],
        'furniture-near':[2,.1],'furniture-up':[1,.05],'furniture-down':[1,-.05]};
      leftPage='settings';focus('settings');
      if(id==='furniture-reset')furniture?.reset(furnitureTarget);
      else if(axes[id])furniture?.nudge(furnitureTarget,...axes[id]);
      changed();return Boolean(furniture);
    }
    if(id.startsWith('audio-')){
      focus('tools');toolsPage='audio';
      if(!audio){changed();return false;}
      if(id==='audio-refresh')return Promise.resolve(audio.listDevices()).finally(changed);
      if(id==='audio-input-prev'||id==='audio-input-next')return cycleDevice('input',id.endsWith('next')?1:-1);
      if(id==='audio-output-prev'||id==='audio-output-next')return cycleDevice('output',id.endsWith('next')?1:-1);
      if(id==='audio-test-microphone')return Promise.resolve(audio.testMicrophone()).finally(changed);
      if(id==='audio-stop-microphone'){audio.stopMicrophone();changed();return true;}
      if(id==='audio-test-speakers')return Promise.resolve(audio.testSpeakers()).finally(changed);
      return false;
    }
    if(id.startsWith('window-row-')){
      const row=paintedWindow??paintedWindowRows[Number(id.slice(11))],state=client.getState();
      windowChoices(state);
      if(connectionPending||leftPage!=='console'||paintedLeftPage!=='console'||state.status!=='selecting'
        ||!row||row.page!==windowPage||paintedWindowPage!==windowPage)return false;
      if(!state.windows.some(window=>window.id===row.id&&window.pid===row.pid)){
        selectedWindow=null;connectionMessage='That window changed. Select its current title again.';changed();return false;
      }
      return selectWindow(row.id,row.pid);
    }
    if(['connection-probe','choose-window','window-prev','window-next','connect-window','disconnect-window'].includes(id)){
      if(id==='disconnect-window'){
        focusedPanel='settings';leftPage='console';return stopConnection();
      }
      leftPage='console';focus('settings');
      if(id==='connection-probe')return runConnection('Checking the Windows helper…',()=>client.probeHelper());
      if(id==='choose-window'){
        if(connectionPending)return false;
        windowPage=0;selectedWindow=null;return runConnection('Looking for open windows…',()=>client.discover());
      }
      const state=client.getState(),selected=currentSelection();
      if(id==='window-prev'||id==='window-next'){
        const {windowPages}=windowChoices(state);
        if(connectionPending||windowPages<2)return false;
        selectedWindow=null;
        windowPage=(windowPage+(id==='window-next'?1:-1)+windowPages)%windowPages;changed();return true;
      }
      if(!selected){connectionMessage='Choose an actual window before connecting.';changed();return false;}
      if(paintedWindow&&(paintedWindow.id!==selected.id||paintedWindow.pid!==selected.pid)){
        connectionMessage='Window selection changed. Select the intended window again.';changed();return false;
      }
      return runConnection('Confirm this window in the Windows prompt…',()=>{
        const current=currentSelection();
        if(current?.id!==selected.id||current?.pid!==selected.pid)
          return {ok:false,reason:'Window selection changed. Select the intended window again.'};
        return client.connect(selected.id);
      },
        result=>{if(result===true)inputRevoked=false;});
    }
    if(comfort&&SCREEN_COMFORT_ACTIONS.some(button=>button.id===id)) {
      const state=comfort.getState();
      if(id==='mode-seated'||id==='mode-standing')comfort.setMode(id.slice(5));
      else if(id==='height-down'||id==='height-up')comfort.setHeightOffset(state.heightOffset+(id==='height-up'?0.01:-0.01));
      else if(id==='tilt-down'||id==='tilt-up')comfort.setKeyboardTilt(state.keyboardTilt+(id==='tilt-up'?1:-1));
      else if(id==='tilt-flat'||id==='tilt-vertical')comfort.setKeyboardTilt(id==='tilt-flat'?0:90);
      else if(id==='comfort-reset')comfort.reset();
      changed();return;
    }
    if(id==='stop'){inputFeedback=null;return stopConnection();}
    if(id==='voice'){voiceHelp=!voiceHelp;reloadConfirm=false;viewPending=true;inputFeedback=null;changed();return;}
    if(id==='reload'){
      if(reloadConfirm)onReload();else{reloadConfirm=true;voiceHelp=false;viewPending=true;inputFeedback=null;changed();}return;
    }
    if(id==='shift'){pressKeycap(id);shift=!shift;changed();return;}
    if(id==='enter'&&shift){
      // Virtual Shift changes character labels only. The native helper does
      // not implement Shift+Enter/newline; a bare Enter could send a draft.
      inputFeedback={reason:undefined,status:undefined,
        message:'Shift+Enter is not supported. No key was sent; use the original app editor for newlines.'};
      changed();return false;
    }
    const input=id==='scroll-up'||id==='scroll-down'?{kind:'scroll',...scrollTarget(),delta:id==='scroll-up'?120:-120}:
      id==='enter'||id==='backspace'?{kind:'key',key:id==='enter'?'Enter':'Backspace'}:
      id.startsWith('key:')?{kind:'text',text:screenKeyText(id.slice(4),shift)}:null;
    if(input){pressKeycap(id);forwardAppInput(input);changed();return;}
    const previousView=`${zoom}:${panX}:${panY}:${reloadConfirm}`;
    inputFeedback=null;
    reloadConfirm=false;
    if(id==='fit'){zoom=1;panX=0;panY=0;}
    else if(id==='zoom-in')zoom=Math.min(4,zoom+0.5);
    else if(id==='zoom-out'){zoom=Math.max(1,zoom-0.5);if(zoom===1){panX=0;panY=0;}}
    else if(id==='pan-left'||id==='pan-right')panX=zoom===1?0:boundedPan(panX+(id==='pan-left'?-0.5:0.5));
    else if(id==='pan-up'||id==='pan-down')panY=zoom===1?0:boundedPan(panY+(id==='pan-up'?-0.5:0.5));
    if(previousView!==`${zoom}:${panX}:${panY}:${reloadConfirm}`){
      // A second controller must not click using the old picture in this frame.
      viewPending=true;
    }
    changed();
  }
  function text(context,string,x,y,size=32,color='#c9f6ff',width=null) {
    context.fillStyle=color;context.font=size+'px system-ui, sans-serif';
    if(width===null)context.fillText(String(string),x,y);
    else {
      let value=String(string??''),trimmed=false;
      const measure=value=>context.measureText?.(value)?.width??value.length*size*.54;
      while(value.length&&measure(value+(trimmed?'…':''))>width){value=value.slice(0,-1);trimmed=true;}
      context.fillText(value+(trimmed?'…':''),x,y);
    }
  }
  function paragraph(lines,x,y,width,size=27,step=36,maxLines=6) {
    let row=0;
    for(const line of lines){
      const words=String(line??'').split(/\s+/);let current='';
      for(const word of words){
        const next=current?current+' '+word:word;
        if(next.length*size*.54>width&&current){
          if(row>=maxLines)return;
          text(ctx,current,x,y+row++*step,size);current=word;
        }else current=next;
      }
      if(row>=maxLines)return;
      text(ctx,current,x,y+row++*step,size,'#c9f6ff',width);
    }
  }
  function enabled(button,state){
    if(button.page==='settings')return button.id.startsWith('furniture-')?Boolean(furniture):Boolean(comfort);
    if(button.id.startsWith('audio-')){
      if(!audio)return false;
      if(button.id==='audio-test-microphone')return !state.audio?.microphonePending&&!state.audio?.microphoneActive;
      if(button.id==='audio-stop-microphone')return Boolean(state.audio?.microphonePending||state.audio?.microphoneActive);
      return true;
    }
    if(button.id==='connect-window')return !connectionPending&&state.status==='selecting'&&state.selectedWindowId!==null;
    if(button.id.startsWith('window-row-'))return !connectionPending&&state.status==='selecting'&&Boolean(state.windowRows[Number(button.id.slice(11))]);
    if(button.id==='window-prev'||button.id==='window-next')return !connectionPending&&state.status==='selecting'&&state.windowPages>1;
    if(button.id==='choose-window'||button.id==='connection-probe')return !connectionPending;
    if(button.id==='scroll-up'||button.id==='scroll-down')return state.keyboardEnabled;
    return true;
  }
  function drawButton(button,state){
    const {x,y,w,h,id}=button,active=enabled(button,state);
    const row=id.startsWith('window-row-')?state.windowRows[Number(id.slice(11))]:null;
    const selected=id==='mode-'+state.comfort?.mode||id==='furniture-'+furnitureTarget||id==='tools-'+toolsPage||id==='left-'+leftPage
      ||Boolean(row&&row.id===selectedWindow?.id&&row.pid===selectedWindow?.pid);
    ctx.fillStyle=!active?'#10232d':hover===id||selected?'#246678':'#153646';
    ctx.fillRect(x*3072,y*954,w*3072,h*954);ctx.strokeStyle=selected?'#8ff7c1':active?'#62e7ff':'#365463';ctx.lineWidth=2;
    ctx.strokeRect(x*3072,y*954,w*3072,h*954);
    const label=id.startsWith('window-row-')?(row?(selected?'✓ ':'')+row.title:'—'):button.label;
    text(ctx,label,x*3072+12,(y+h*.68)*954,25,active?'#d5f8ff':'#78919d',w*3072-24);
  }
  function drawSettings(state){
    if(leftPage==='console'){
      const count=state.status==='selecting'?state.windows?.length??0:0;
      text(ctx,count?'Select a title · page '+(state.windowPage+1)+' of '+state.windowPages+' · '+count+' windows'
        :'Choose an interactive window to list its title.',62,378,24,'#aad0db',650);
      paragraph([...new Set([state.message,connectionPending??connectionMessage].filter(Boolean))],62,720,650,25,30,3);
      text(ctx,'View-only sharing uses the browser launcher.',62,818,23,'#aad0db',650);
      return;
    }
    const settings=state.comfort,offset=state.furniture?.[furnitureTarget];
    if(settings){
      const height=Math.round(settings.heightOffset*100);
      text(ctx,'Height '+(height>=0?'+':'')+height+' cm',62,318,26);
      text(ctx,'Keyboard '+settings.keyboardTilt.toFixed(1)+'°',62,402,26);
    }else text(ctx,'Comfort controls unavailable',62,318,26,'#ffd38a',650);
    text(ctx,'MOVE & SAVE FURNITURE',62,588,26);
    if(offset)text(ctx,offset.map(value=>(value>=0?'+':'')+Math.round(value*100)+' cm').join(' / '),62,832,23,'#aad0db',650);
    else text(ctx,'Furniture controls unavailable',62,832,23,'#ffd38a',650);
  }
  function drawTools(state){
      const data=state.audio;
      const mic=data?.inputs?.find(device=>device.id===data.inputId)?.label??'System microphone';
      const output=data?.outputs?.find(device=>device.id===data.outputId)?.label??'System speakers';
      text(ctx,'MICROPHONE FOR LOCAL TEST',2354,326,25,'#73dfe9');text(ctx,mic,2354,358,27,'#d5f8ff',650);
      text(ctx,'SPEAKERS FOR LOCAL TEST',2354,458,25,'#73dfe9');text(ctx,output,2354,490,27,'#d5f8ff',650);
      text(ctx,data?.microphonePending?'Microphone permission pending':data?.microphoneActive?'Microphone test active — not recorded':'Microphone test inactive',2354,651,25,'#aad0db',650);
      paragraph([data?.status??'Audio controls unavailable.',
         'ChatGPT Voice runs in the original app, not this room.',
         'Disconnect does not mute or end Voice. Use the app controls.'],2354,697,650,21,24,6);
  }
  function render() {
    // Input remains fenced until the new canvas has been completely drawn.
    const state=projectState(true),settings=state.comfort;
    const version=JSON.stringify([revision,state.revision,settings,state.furniture,state.audio,
      state.selectedWindowId,state.status,state.windows,state.message,state.leftPage,state.windowPage]);
    const currentFrame=client.getFrame();
    // A newer native picture can arrive before any status callback is painted.
    // Never reuse a cached crop/texture or allow input against the old picture.
    if(drawn===version&&paintedFrame===currentFrame)return {screen,console:consoleCanvas,revision:drawn};
    // Any interrupted paint must retain the input fence and be retried.
    viewPending=true;
    ctx.clearRect(0,0,screen.width,screen.height);ctx.fillStyle='#03131ff5';ctx.fillRect(0,0,screen.width,screen.height);
    ctx.fillStyle='#5de6ff';ctx.fillRect(0,0,8,954);ctx.fillRect(3064,0,8,954);
    text(ctx,'STEPHANOS / SPATIAL WORKSPACE',64,65,37);
    text(ctx,'FOCUS: '+({settings:leftPage==='console'?'CONSOLE':'SETTINGS',chatgpt:'SELECTED WINDOW',tools:'AUDIO'}[focusedPanel]),2370,64,27,'#8ff7c1',650);
    ctx.fillStyle='#152d3a';ctx.fillRect(40,92,2992,2);
    for(const panel of HOLODECK_PANELS){
      const x=panel.x*3072,y=panel.y*954,w=panel.w*3072,h=panel.h*954;
      ctx.fillStyle='#071b29';ctx.fillRect(x,y,w,h);
      ctx.strokeStyle=focusedPanel===panel.id?'#8ff7c1':'#396070';ctx.lineWidth=focusedPanel===panel.id?5:2;
      ctx.strokeRect(x,y,w,h);text(ctx,panel.title,x+22,y+42,30,'#e0faff',w-44);
    }
    const mode=state.status==='view-only'?'VIEW ONLY':inputRevoked?'INPUT STOPPED':state.status==='live'?'WINDOW LIVE':'NOT CONNECTED';
    text(ctx,state.title||(state.status==='view-only'?'Shared browser window':''),1120,154,25,'#aad0db',600);
    text(ctx,mode+' / '+zoom.toFixed(1)+'x',1750,154,27,state.status==='live'&&!inputRevoked?'#8ff7c1':'#ffd38a',530);
    drawSettings(state);drawTools(state);
    for(const panel of HOLODECK_PANELS)for(const button of panelButtons(panel.id,toolsPage,leftPage))drawButton(button,state);
    const image=currentFrame;
    if(image&&!voiceHelp&&!reloadConfirm) {
      const r=screenImageRect(image.naturalWidth,image.naturalHeight,zoom,panX,panY),crop=r.crop;
      ctx.drawImage(image.drawable??image,crop.x,crop.y,crop.w,crop.h,r.x,r.y,r.w,r.h);
    } else {
      text(ctx,reloadConfirm?'SAVE & RELOAD ROOM':voiceHelp?'AUDIO HELP / HEADSET SETUP':'YOUR SELECTED WINDOW',810,316,43,'#eefcff',1460);
      const lines=reloadConfirm?[
        'Press Reload again to save the cubes and leave this VR session.',
        'The page will load the installed room update. Your chat stays in its original app.',
        'Reconnect your window and enter VR again from the launcher.',
      ]:voiceHelp?[
        'This is a setup guide. It does not enable or test your microphone or speakers.',
        'Use the PC browser with Quest Link / Air Link; audio remains in the original app.',
        'Windows Settings > System > Sound > Input: select and test your headset microphone.',
        'Sound > Volume mixer: unmute ChatGPT or its browser and choose headset output.',
        'Press Audio help again to return. Use ChatGPT’s Voice button and allow microphone access.',
        'Mute or end Voice in the original ChatGPT app. This room cannot verify Voice status.',
        'Disconnect stops the window picture and input, not ChatGPT Voice.',
        'Voice starts a spoken conversation; microphone dictation enters text.',
        'Zoom and View arrows keep the composer, Voice and attachment controls within reach.',
      ]:[
        'Choose an interactive window using Console on the left.',
        'Select its title, then Connect selected window. Confirm the Windows prompt.',
        'Its picture appears here. Select this centre panel to click and type in the app.',
        'Browser window sharing remains view only. Settings and audio still work.',
        'Your original app keeps the chat, tools, images and approvals.',
      ];
      paragraph(lines,810,382,1450,28,43,10);
    }
    text(ctx,state.keyboardNotice,64,870,27,'#aad0db',2960);
    if(state.inputStatus)text(ctx,state.inputStatus,64,904,27,'#ffd38a',2960);
    text(ctx,state.message,64,938,27,'#aad0db',2960);
    keys.fillStyle='#071c29';keys.fillRect(0,0,2048,512);
    for(const button of SCREEN_BUTTONS) {
      const {x,y,w,h,id}=button,input=id.startsWith('key:')||['enter','backspace','scroll-up','scroll-down'].includes(id);
      const active=!input||state.keyboardEnabled;
      keys.fillStyle=!active?'#10232d':hover===id||id==='shift'&&shift||id==='mode-'+settings?.mode?'#246678':'#153646';keys.fillRect(x*2048,y*512,w*2048,h*512);
      keys.strokeStyle=!active?'#365463':id==='enter'?'#f5c77b':'#62e7ff';keys.lineWidth=2;keys.strokeRect(x*2048,y*512,w*2048,h*512);
      text(keys,screenButtonLabel(button,shift),x*2048+12,y*512+h*512*.64,id==='comfort-reset'||SCREEN_ACTIONS.some(action=>action.id===id)?22:26,active?'#c9f6ff':'#78919d');
    }
    // Canvas rows retain the exact identity that was actually painted. A
    // heartbeat, page switch or reentrant focus callback cannot retarget them.
    paintedLeftPage=leftPage;paintedWindowPage=state.windowPage;
    paintedWindowRows=leftPage==='console'?state.windowRows.map(window=>({...window})):[];
    paintedSelectedWindow=selectedWindow?{...selectedWindow}:null;
    paintedFrame=currentFrame;
    viewPending=false;
    drawn=version;
    return {screen,console:consoleCanvas,revision:drawn};
  }
  return {action,point,hitTest,selectWindow,getState,getKeycapMotion,render,comfort,hover:id=>{if(id!==hover){hover=id;changed();}}};
}
