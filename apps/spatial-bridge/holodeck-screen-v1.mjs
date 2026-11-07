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
export const DISPLAY_COMFORT_BUTTONS=Object.freeze(SCREEN_COMFORT_ACTIONS.map(button=>
  Object.freeze({...button,y:0.103,h:0.065})));
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
export const SCREEN_CONTENT=Object.freeze({x:56,y:180,w:2960,h:658,width:3072,height:954});
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
  const r=screenImageRect(width,height,zoom,panX,panY),x=u*SCREEN_CONTENT.width,y=v*SCREEN_CONTENT.height;
  if(x<r.x||x>r.x+r.w||y<r.y||y>r.y+r.h)return null;
  return {x:(r.crop.x+(x-r.x)/r.w*r.crop.w)/width,y:(r.crop.y+(y-r.y)/r.h*r.crop.h)/height};
}
export function createHolodeckScreen({client,comfort,documentRef=globalThis.document,onReload=()=>{},onStatus=()=>{}}={}) {
  const screen=documentRef.createElement('canvas'),consoleCanvas=documentRef.createElement('canvas');
  screen.width=3072;screen.height=954;consoleCanvas.width=2048;consoleCanvas.height=512;
  const ctx=screen.getContext('2d'),keys=consoleCanvas.getContext('2d');
  let revision=0,drawn='',zoom=1,panX=0,panY=0,viewPending=false,inputFeedback=null,shift=false,hover=null,voiceHelp=false,reloadConfirm=false,lastPoint={x:0.5,y:0.5};
  const changed=()=>{revision++;try{onStatus(getState());}catch{}};
  function appInputBlocker(state,viewPainted=false){
    const reason=!client.getFrame()?'connection':voiceHelp?'audio-help':reloadConfirm?'reload':viewPending&&!viewPainted?'view-pending':null;
    if(!reason)return null;
    const message=reason==='audio-help'?'Input paused. Close Audio help to use the connected app.':
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
    return {...state,...(inputFeedback?{inputStatus:inputFeedback.message}:{}),zoom,panX,panY,voiceHelp,shift,comfort:comfort?.getState()};
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
  function point(u,v,activate=false) {
    const control=comfort&&screenComfortHit(u,v);
    if(control){if(activate)action(control.id);return true;}
    if(!canForwardAppInput(activate))return false;
    const image=client.getFrame();
    const source=screenPointToSource(u,v,image.naturalWidth,image.naturalHeight,zoom,panX,panY);
    if(!source)return false;lastPoint=source;
    if(activate)forwardAppInput({kind:'click',...source});return true;
  }
  function action(id) {
    if(comfort&&SCREEN_COMFORT_ACTIONS.some(button=>button.id===id)) {
      const state=comfort.getState();
      if(id==='mode-seated'||id==='mode-standing')comfort.setMode(id.slice(5));
      else if(id==='height-down'||id==='height-up')comfort.setHeightOffset(state.heightOffset+(id==='height-up'?0.01:-0.01));
      else if(id==='tilt-down'||id==='tilt-up')comfort.setKeyboardTilt(state.keyboardTilt+(id==='tilt-up'?1:-1));
      else if(id==='tilt-flat'||id==='tilt-vertical')comfort.setKeyboardTilt(id==='tilt-flat'?0:90);
      else if(id==='comfort-reset')comfort.reset();
      changed();return;
    }
    if(id==='stop'){inputFeedback=null;void client.stop();changed();return;}
    if(id==='voice'){voiceHelp=!voiceHelp;reloadConfirm=false;viewPending=true;inputFeedback=null;changed();return;}
    if(id==='reload'){
      if(reloadConfirm)onReload();else{reloadConfirm=true;voiceHelp=false;viewPending=true;inputFeedback=null;changed();}return;
    }
    if(id==='shift'){shift=!shift;changed();return;}
    const input=id==='scroll-up'||id==='scroll-down'?{kind:'scroll',...lastPoint,delta:id==='scroll-up'?120:-120}:
      id==='enter'||id==='backspace'?{kind:'key',key:id==='enter'?'Enter':'Backspace'}:
      id.startsWith('key:')?{kind:'text',text:screenKeyText(id.slice(4),shift)}:null;
    if(input){forwardAppInput(input);changed();return;}
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
  function text(context,string,x,y,size=32,color='#c9f6ff') {
    context.fillStyle=color;context.font=`${size}px system-ui, sans-serif`;context.fillText(string,x,y);
  }
  function render() {
    // This image represents the completed view. Keep forwarding fenced until
    // drawing ends, but do not paint a notice about its previous unpainted state.
    const state=projectState(true),settings=state.comfort;
    const version=`${revision}:${state.revision}:${settings?.mode}:${settings?.heightOffset}:${settings?.keyboardTilt}`;
    if(drawn===version)return {screen,console:consoleCanvas,revision:drawn};drawn=version;
    ctx.clearRect(0,0,screen.width,screen.height);ctx.fillStyle='#03131ff5';ctx.fillRect(0,0,screen.width,screen.height);
    ctx.fillStyle='#5de6ff';ctx.fillRect(0,0,8,954);ctx.fillRect(3064,0,8,954);
    text(ctx,'STEPHANOS  /  SPATIAL CONSOLE',64,65,37);
    text(ctx,`${state.status.toUpperCase()}  /  ${zoom.toFixed(1)}x  /  AUDIO: ORIGINAL APP`,2060,64,27,'#73dfe9');
    ctx.fillStyle='#152d3a';ctx.fillRect(56,92,2960,2);
    const image=client.getFrame();
    if(image&&!voiceHelp&&!reloadConfirm) {
      const r=screenImageRect(image.naturalWidth,image.naturalHeight,zoom,panX,panY),crop=r.crop;
      ctx.drawImage(image,crop.x,crop.y,crop.w,crop.h,r.x,r.y,r.w,r.h);
    } else {
      text(ctx,reloadConfirm?'SAVE & RELOAD ROOM':voiceHelp?'AUDIO HELP / HEADSET SETUP':'YOUR WORKSPACE, EXPANDED',160,290,82,'#eefcff');
      const lines=reloadConfirm?[
        'Press Reload again to save the cubes and leave this VR session.',
        'The page will load the installed room update. Your chat stays in its original app.',
        'Reconnect your window and enter VR again from the launcher.',
      ]:voiceHelp?[
        'This is a setup guide. It does not enable or test your microphone or speakers.',
        'Use the PC browser with Quest Link / Air Link; audio remains in the original app.',
        'Windows Settings > System > Sound > Input: select and test your headset microphone.',
        'Sound > Volume mixer: unmute ChatGPT or its browser and choose headset output.',
        'Press Audio help again to return, then use ChatGPT’s Voice button and allow microphone access.',
        'Voice starts a spoken conversation; microphone dictation enters text. Availability depends on your app/account.',
        'Zoom and View arrows keep the composer, Voice and image attachment controls within reach.',
      ]:[
        'Connect your existing ChatGPT or Codex window on the desktop launcher.',
        'Point at the hologram and press Quest trigger or Xbox A to click.',
        'Select the chat input, then use the console keyboard to type.',
        'Your original app keeps the chat, tools, images and approvals.',
      ];
      lines.forEach((line,i)=>text(ctx,line,166,385+i*57,35));
    }
    const height=Math.round((settings?.heightOffset??0)*100),tilt=(settings?.keyboardTilt??0).toFixed(1);
    text(ctx,settings?`${settings.mode.toUpperCase()}  /  HEIGHT ${height>=0?'+':''}${height} cm  /  KEYBOARD ${tilt}°  ·  Hold trigger or grip on a side dial and turn your controller.`:state.message,64,870,27,'#aad0db');
    if(state.inputStatus)text(ctx,state.inputStatus,64,904,27,'#ffd38a');
    if(settings)text(ctx,state.message,64,938,27,'#aad0db');
    if(settings)for(const button of DISPLAY_COMFORT_BUTTONS) {
      ctx.fillStyle=hover===button.id||button.id==='mode-'+settings.mode?'#246678':'#153646';
      ctx.fillRect(button.x*3072,button.y*954,button.w*3072,button.h*954);
      ctx.strokeStyle='#62e7ff';ctx.lineWidth=2;ctx.strokeRect(button.x*3072,button.y*954,button.w*3072,button.h*954);
      text(ctx,button.label,button.x*3072+12,(button.y+button.h*0.65)*954,26);
    }
    keys.fillStyle='#071c29';keys.fillRect(0,0,2048,512);
    for(const button of SCREEN_BUTTONS) {
      const {x,y,w,h,id}=button;
      keys.fillStyle=hover===id||id==='shift'&&shift||id==='mode-'+settings?.mode?'#246678':'#153646';keys.fillRect(x*2048,y*512,w*2048,h*512);
      keys.strokeStyle=id==='enter'?'#f5c77b':'#62e7ff';keys.lineWidth=2;keys.strokeRect(x*2048,y*512,w*2048,h*512);
      text(keys,screenButtonLabel(button,shift),x*2048+12,y*512+h*512*0.64,id==='comfort-reset'||SCREEN_ACTIONS.some(action=>action.id===id)?22:26);
    }
    viewPending=false;
    return {screen,console:consoleCanvas,revision:drawn};
  }
  return {action,point,getState,render,comfort,hover:id=>{if(id!==hover){hover=id;changed();}}};
}
