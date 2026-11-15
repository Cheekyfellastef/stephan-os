import {HOLODECK_PANELS,PANEL_BUTTONS,PANEL_CANVAS,CHATGPT_CONTENT,panelAt,panelButtons,panelButtonAt} from './holodeck-panels-v1.mjs';
export {HOLODECK_PANELS,PANEL_BUTTONS} from './holodeck-panels-v1.mjs';

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
  {id:'enter',label:'Send / Enter',x:0.78,y:0.855,w:0.18,h:0.12},
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
export function createHolodeckScreen({client,comfort,furniture,audio,documentRef=globalThis.document,onReload=()=>{},onStatus=()=>{},now=()=>globalThis.performance?.now?.()??Date.now()}={}) {
  const screen=documentRef.createElement('canvas'),consoleCanvas=documentRef.createElement('canvas');
  screen.width=3072;screen.height=954;consoleCanvas.width=2048;consoleCanvas.height=512;
  const ctx=screen.getContext('2d'),keys=consoleCanvas.getContext('2d');
  let revision=0,drawn='',zoom=1,panX=0,panY=0,viewPending=false,inputFeedback=null,shift=false,hover=null,voiceHelp=false,reloadConfirm=false,lastPoint={x:0.5,y:0.5};
  let lastKeyPress=null;
  let focusedPanel='chatgpt',toolsPage='audio',furnitureTarget='keyboard',selectedWindow=null;
  let connectionPending=null,connectionMessage='Check the Windows helper before connecting.',connectionEpoch=0,inputRevoked=false;
  const pressKeycap=id=>{if(SCREEN_KEYS.some(key=>key.id===id))lastKeyPress={id,at:now()};};
  const getKeycapMotion=()=>lastKeyPress?{id:lastKeyPress.id,ageMs:now()-lastKeyPress.at}:null;
  const changed=()=>{revision++;try{onStatus(getState());}catch{}};
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
  function selectWindow(id){
    const state=client.getState(),selected=state.status==='selecting'&&state.windows?.find(window=>window.id===id);
    selectedWindow=selected?{id:selected.id,pid:selected.pid}:null;changed();return Boolean(selected);
  }
  function keyboardNotice(state){
    if(focusedPanel!=='chatgpt')return 'Keyboard paused — select the centre ChatGPT panel to type.';
    if(state.status==='view-only')return 'VIEW ONLY — use Connection on the right to enable clicks and typing.';
    if(state.status!=='live')return 'Keyboard waiting for an interactive ChatGPT connection.';
    return 'Keyboard targets ChatGPT only. Select a text field in the connected app.';
  }
  function appInputBlocker(state,viewPainted=false){
    const reason=focusedPanel!=='chatgpt'?'local-panel':state.status==='view-only'?'view-only':inputRevoked?'stopped':state.status!=='live'||!client.getFrame()?'connection':voiceHelp?'audio-help':reloadConfirm?'reload':viewPending&&!viewPainted?'view-pending':null;
    if(!reason)return null;
    const message=reason==='local-panel'?keyboardNotice(state):
      reason==='view-only'?'ChatGPT is view-only. Open Connection on the right and connect the Windows helper to click or type.':
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
      focusedPanel,keyboardEnabled:!blocker,keyboardNotice:blocker?.message??keyboardNotice(state),toolsPage,furnitureTarget,
      selectedWindowId:currentSelection()?.id??null,connectionPending,connectionMessage};
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
    const button=panelButtonAt(u,v,toolsPage);
    return {panel:panel.id,id:button?.id??null};
  }
  function point(u,v,activate=false) {
    const hit=hitTest(u,v);if(!hit)return false;
    if(activate&&hit.id==='disconnect-window'){action(hit.id);return true;}
    if(activate)focus(hit.panel);
    if(hit.id){if(activate)action(hit.id);return true;}
    if(hit.panel!=='chatgpt')return true;
    const x=u*PANEL_CANVAS.width,y=v*PANEL_CANVAS.height;
    if(x<SCREEN_CONTENT.x||x>SCREEN_CONTENT.x+SCREEN_CONTENT.w||y<SCREEN_CONTENT.y||y>SCREEN_CONTENT.y+SCREEN_CONTENT.h)return true;
    if(!canForwardAppInput(activate))return client.getState().status==='view-only';
    const image=client.getFrame();
    const source=screenPointToSource(u,v,image.naturalWidth,image.naturalHeight,zoom,panX,panY);
    if(!source)return false;lastPoint=source;
    if(activate)forwardAppInput({kind:'click',...source});return true;
  }
  function settleConnection(owner,promise,completed=()=>{}){
    return Promise.resolve(promise).then(result=>{
      if(owner!==connectionEpoch)return false;
      completed(result);
      connectionMessage=result?.reason??client.getState().message??'The connection check completed.';return result;
    }).catch(()=>{if(owner===connectionEpoch)connectionMessage='Connection action failed. Check the current helper and window status.';return false;})
      .finally(()=>{if(owner===connectionEpoch){connectionPending=null;changed();}});
  }
  function runConnection(label,operation,completed){
    if(connectionPending)return false;
    const owner=++connectionEpoch;connectionPending=label;connectionMessage=label;changed();
    return settleConnection(owner,Promise.resolve().then(()=>owner===connectionEpoch?operation():false),completed);
  }
  function stopConnection(){
    // Revocation is synchronous, before a subscriber or another hand can send
    // input in this frame. Completion only reconciles that original stop.
    const owner=++connectionEpoch;inputRevoked=true;selectedWindow=null;
    connectionPending='Disconnecting the selected ChatGPT window…';connectionMessage=connectionPending;
    let stopped;
    try{stopped=client.stop();}catch(error){stopped=Promise.reject(error);}
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
  function action(id) {
    if(id.startsWith('focus-'))return focus(id.slice(6));
    if(id==='tools-audio'||id==='tools-connection'){
      toolsPage=id.slice(6);focus('tools');changed();return true;
    }
    if(id==='furniture-keyboard'||id==='furniture-table'){
      furnitureTarget=id.slice(10);focus('settings');changed();return true;
    }
    if(id.startsWith('furniture-')){
      const axes={'furniture-left':[0,-.1],'furniture-right':[0,.1],'furniture-away':[2,-.1],
        'furniture-near':[2,.1],'furniture-up':[1,.05],'furniture-down':[1,-.05]};
      focus('settings');
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
    if(['connection-probe','choose-window','window-prev','window-next','connect-window','disconnect-window'].includes(id)){
      if(id==='disconnect-window'){
        focusedPanel='tools';toolsPage='connection';return stopConnection();
      }
      focus('tools');toolsPage='connection';
      if(id==='connection-probe')return runConnection('Checking the Windows helper…',()=>client.probeHelper());
      if(id==='choose-window')return runConnection('Looking for open windows…',()=>client.discover());
      const state=client.getState(),windows=state.status==='selecting'?state.windows??[]:[],selected=currentSelection();
      if(id==='window-prev'||id==='window-next'){
        if(!windows.length)return false;
        const index=windows.findIndex(window=>window.id===selected?.id&&window.pid===selected?.pid);
        return selectWindow(windows[index<0?(id==='window-next'?0:windows.length-1):(index+(id==='window-next'?1:-1)+windows.length)%windows.length].id);
      }
      if(!selected){connectionMessage='Choose an actual window before connecting.';changed();return false;}
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
    const input=id==='scroll-up'||id==='scroll-down'?{kind:'scroll',...lastPoint,delta:id==='scroll-up'?120:-120}:
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
      const crop=screenCrop(1,1,zoom,panX,panY);lastPoint={x:crop.x+crop.w/2,y:crop.y+crop.h/2};
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
    if(button.panel==='settings')return button.id.startsWith('furniture-')?Boolean(furniture):Boolean(comfort);
    if(button.id.startsWith('audio-')){
      if(!audio)return false;
      if(button.id==='audio-test-microphone')return !state.audio?.microphonePending&&!state.audio?.microphoneActive;
      if(button.id==='audio-stop-microphone')return Boolean(state.audio?.microphonePending||state.audio?.microphoneActive);
      return true;
    }
    if(button.id==='connect-window')return !connectionPending&&state.status==='selecting'&&state.selectedWindowId!==null;
    if(button.id==='window-prev'||button.id==='window-next')return !connectionPending&&state.status==='selecting'&&Boolean(state.windows?.length);
    if(button.id==='choose-window'||button.id==='connection-probe')return !connectionPending;
    return true;
  }
  function drawButton(button,state){
    const {x,y,w,h,id}=button,active=enabled(button,state);
    const selected=id==='mode-'+state.comfort?.mode||id==='furniture-'+furnitureTarget||id==='tools-'+toolsPage;
    ctx.fillStyle=!active?'#10232d':hover===id||selected?'#246678':'#153646';
    ctx.fillRect(x*3072,y*954,w*3072,h*954);ctx.strokeStyle=active?'#62e7ff':'#365463';ctx.lineWidth=2;
    ctx.strokeRect(x*3072,y*954,w*3072,h*954);
    text(ctx,button.label,x*3072+12,(y+h*.68)*954,25,active?'#d5f8ff':'#78919d',w*3072-24);
  }
  function drawSettings(state){
    const settings=state.comfort,offset=state.furniture?.[furnitureTarget];
    if(settings){
      const height=Math.round(settings.heightOffset*100);
      text(ctx,'Height '+(height>=0?'+':'')+height+' cm',62,251,28);
      text(ctx,'Keyboard '+settings.keyboardTilt.toFixed(1)+'°',62,338,28);
    }else text(ctx,'Comfort controls unavailable',62,251,26,'#ffd38a',650);
    text(ctx,'MOVE & SAVE FURNITURE',62,541,28);
    if(offset)text(ctx,offset.map(value=>(value>=0?'+':'')+Math.round(value*100)+' cm').join(' / '),62,832,23,'#aad0db',650);
    else text(ctx,'Furniture controls unavailable',62,832,23,'#ffd38a',650);
  }
  function drawTools(state){
    if(toolsPage==='audio'){
      const data=state.audio;
      const mic=data?.inputs?.find(device=>device.id===data.inputId)?.label??'System microphone';
      const output=data?.outputs?.find(device=>device.id===data.outputId)?.label??'System speakers';
      text(ctx,'MICROPHONE FOR LOCAL TEST',2354,326,25,'#73dfe9');text(ctx,mic,2354,358,27,'#d5f8ff',650);
      text(ctx,'SPEAKERS FOR LOCAL TEST',2354,458,25,'#73dfe9');text(ctx,output,2354,490,27,'#d5f8ff',650);
      text(ctx,data?.microphonePending?'Microphone permission pending':data?.microphoneActive?'Microphone test active — not recorded':'Microphone test inactive',2354,651,25,'#aad0db',650);
      paragraph([data?.status??'Audio controls unavailable.', 'ChatGPT uses its own Voice controls and Windows audio routing.'],2354,754,650,25,31,3);
    }else{
      const selected=currentSelection();
      text(ctx,selected?.title??'Choose a window, then select it here.',2354,394,27,'#d5f8ff',650);
      text(ctx,state.status==='selecting'?(state.windows?.length??0)+' windows available':'No window selection in progress',2354,427,24,'#aad0db',650);
      paragraph([connectionMessage,state.message],2354,650,650,26,36,4);
      text(ctx,'Windows asks for this window’s consent.',2354,818,23,'#aad0db',650);
    }
  }
  function render() {
    // Input remains fenced until the new canvas has been completely drawn.
    const state=projectState(true),settings=state.comfort;
    const version=JSON.stringify([revision,state.revision,settings,state.furniture,state.audio,
      state.selectedWindowId,state.status,state.windows,state.message]);
    if(drawn===version)return {screen,console:consoleCanvas,revision:drawn};drawn=version;
    ctx.clearRect(0,0,screen.width,screen.height);ctx.fillStyle='#03131ff5';ctx.fillRect(0,0,screen.width,screen.height);
    ctx.fillStyle='#5de6ff';ctx.fillRect(0,0,8,954);ctx.fillRect(3064,0,8,954);
    text(ctx,'STEPHANOS / SPATIAL WORKSPACE',64,65,37);
    text(ctx,'FOCUS: '+focusedPanel.toUpperCase(),2370,64,27,'#8ff7c1',650);
    ctx.fillStyle='#152d3a';ctx.fillRect(40,92,2992,2);
    for(const panel of HOLODECK_PANELS){
      const x=panel.x*3072,y=panel.y*954,w=panel.w*3072,h=panel.h*954;
      ctx.fillStyle='#071b29';ctx.fillRect(x,y,w,h);
      ctx.strokeStyle=focusedPanel===panel.id?'#8ff7c1':'#396070';ctx.lineWidth=focusedPanel===panel.id?5:2;
      ctx.strokeRect(x,y,w,h);text(ctx,panel.title,x+22,y+42,30,'#e0faff',w-44);
    }
    const mode=state.status==='view-only'?'VIEW ONLY':inputRevoked?'INPUT STOPPED':state.status==='live'?'INTERACTIVE':'NOT CONNECTED';
    text(ctx,mode+' / '+zoom.toFixed(1)+'x',1750,154,27,state.status==='live'&&!inputRevoked?'#8ff7c1':'#ffd38a',530);
    drawSettings(state);drawTools(state);
    for(const panel of HOLODECK_PANELS)for(const button of panelButtons(panel.id,toolsPage))drawButton(button,state);
    const image=client.getFrame();
    if(image&&!voiceHelp&&!reloadConfirm) {
      const r=screenImageRect(image.naturalWidth,image.naturalHeight,zoom,panX,panY),crop=r.crop;
      ctx.drawImage(image.drawable??image,crop.x,crop.y,crop.w,crop.h,r.x,r.y,r.w,r.h);
    } else {
      text(ctx,reloadConfirm?'SAVE & RELOAD ROOM':voiceHelp?'AUDIO HELP / HEADSET SETUP':'YOUR CHATGPT WINDOW',810,316,43,'#eefcff',1460);
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
        'Voice starts a spoken conversation; microphone dictation enters text.',
        'Zoom and View arrows keep the composer, Voice and attachment controls within reach.',
      ]:[
        'Open Connection on the right to choose your real ChatGPT or Codex window.',
        'For clicks and typing, connect the installed Windows helper and confirm its prompt.',
        'Browser window sharing remains view only. Workspace settings still work.',
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
    viewPending=false;
    return {screen,console:consoleCanvas,revision:drawn};
  }
  return {action,point,hitTest,selectWindow,getState,getKeycapMotion,render,comfort,hover:id=>{if(id!==hover){hover=id;changed();}}};
}
