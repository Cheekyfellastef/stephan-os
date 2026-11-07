export const SCREEN_ACTIONS=Object.freeze([
  ['fit','Fit'],['zoom-in','Zoom +'],['zoom-out','Zoom -'],['scroll-up','Scroll up'],['scroll-down','Scroll down'],
  ['voice','Audio'],['stop','Disconnect'],['reload','Reload room'],
].map(([id,label],i)=>Object.freeze({id,label,x:0.025+i*0.12,y:0.04,w:0.112,h:0.15})));
export const SCREEN_KEYS=Object.freeze([
  ...['1234567890-=', 'qwertyuiop[]', 'asdfghjkl;\'', 'zxcvbnm,./'].flatMap((row,r)=>[...row].map((key,i)=>
    Object.freeze({id:`key:${key}`,label:key,x:0.055+i*0.07+r*0.015,y:0.24+r*0.145,w:0.063,h:0.12}))),
  {id:'shift',label:'Shift',x:0.055,y:0.83,w:0.12,h:0.12},
  {id:'key: ',label:'Space',x:0.19,y:0.83,w:0.38,h:0.12},
  {id:'backspace',label:'Backspace',x:0.59,y:0.83,w:0.17,h:0.12},
  {id:'enter',label:'Send / Enter',x:0.78,y:0.83,w:0.18,h:0.12},
].map(Object.freeze));
export const SCREEN_BUTTONS=Object.freeze([...SCREEN_ACTIONS,...SCREEN_KEYS]);
export const DISPLAY_COMFORT_CONTROLS=Object.freeze([
  ['comfort:seated','Seated'],['comfort:standing','Standing'],['comfort:height-down','Height -'],
  ['comfort:height-up','Height +'],['comfort:tilt-down','Tilt -'],['comfort:tilt-up','Tilt +'],['comfort:reset','Reset'],
].map(([id,label],i)=>Object.freeze({id,label,x:0.02+i*0.138,y:0.884,w:0.124,h:0.078})));
export const SCREEN_CONTENT=Object.freeze({x:56,y:112,w:2960,h:726,width:3072,height:954});
export function screenCrop(width,height,zoom=1,panX=0,panY=0) {
  const w=width/zoom,h=height/zoom;return {x:(width-w)*(panX+1)/2,y:(height-h)*(panY+1)/2,w,h};
}
export function screenImageRect(width,height,zoom=1) {
  const r=SCREEN_CONTENT,crop=screenCrop(width,height,zoom),scale=Math.min(r.w/crop.w,r.h/crop.h),w=crop.w*scale,h=crop.h*scale;
  return {x:r.x+(r.w-w)/2,y:r.y+(r.h-h)/2,w,h,crop};
}
export function screenPointToSource(u,v,width,height,zoom=1) {
  const r=screenImageRect(width,height,zoom),x=u*SCREEN_CONTENT.width,y=v*SCREEN_CONTENT.height;
  if(x<r.x||x>r.x+r.w||y<r.y||y>r.y+r.h)return null;
  return {x:(r.crop.x+(x-r.x)/r.w*r.crop.w)/width,y:(r.crop.y+(y-r.y)/r.h*r.crop.h)/height};
}
export function createHolodeckScreen({client,comfort,documentRef=globalThis.document,onReload=()=>{},onStatus=()=>{}}={}) {
  const screen=documentRef.createElement('canvas'),consoleCanvas=documentRef.createElement('canvas'),knobCanvas=documentRef.createElement('canvas');
  screen.width=3072;screen.height=954;consoleCanvas.width=2048;consoleCanvas.height=512;knobCanvas.width=256;knobCanvas.height=256;
  const ctx=screen.getContext('2d'),keys=consoleCanvas.getContext('2d'),knob=knobCanvas.getContext('2d');
  let revision=0,drawn='',zoom=1,shift=false,hover=null,voiceHelp=false,reloadConfirm=false,lastPoint={x:0.5,y:0.5};
  const changed=()=>{revision++;try{onStatus(getState());}catch{}};
  comfort?.subscribe?.(()=>changed());
  function getState(){return {...client.getState(),zoom,voiceHelp,shift,comfort:comfort?.getState?.()??null};}
  function point(u,v,activate=false) {
    const local=DISPLAY_COMFORT_CONTROLS.find(button=>u>=button.x&&u<=button.x+button.w&&v>=button.y&&v<=button.y+button.h);
    if(local){if(activate)action(local.id);return true;}
    const image=client.getFrame();if(!image||voiceHelp||reloadConfirm)return false;
    const source=screenPointToSource(u,v,image.naturalWidth,image.naturalHeight,zoom);
    if(!source)return false;lastPoint=source;
    if(activate)client.input({kind:'click',...source});return true;
  }
  function action(id) {
    if(id==='stop'){void client.stop();changed();return;}
    if(id==='voice'){voiceHelp=!voiceHelp;changed();return;}
    if(id==='comfort:seated'){comfort?.setActiveProfile?.('seated');return;}
    if(id==='comfort:standing'){comfort?.setActiveProfile?.('standing');return;}
    if(id==='comfort:height-down'){comfort?.adjustHeight?.(-0.05);return;}
    if(id==='comfort:height-up'){comfort?.adjustHeight?.(0.05);return;}
    if(id==='comfort:tilt-down'){comfort?.adjustKeyboardAngle?.(-5);return;}
    if(id==='comfort:tilt-up'){comfort?.adjustKeyboardAngle?.(5);return;}
    if(id==='comfort:reset'){comfort?.resetActive?.();return;}
    if(id==='reload'){
      if(reloadConfirm)onReload();else{reloadConfirm=true;changed();}return;
    }
    reloadConfirm=false;
    if(id==='fit')zoom=1;
    else if(id==='zoom-in')zoom=Math.min(4,zoom+0.5);
    else if(id==='zoom-out')zoom=Math.max(1,zoom-0.5);
    else if(id==='shift')shift=!shift;
    else if(id==='scroll-up'||id==='scroll-down')client.input({kind:'scroll',...lastPoint,delta:id==='scroll-up'?120:-120});
    else if(id==='enter'||id==='backspace')client.input({kind:'key',key:id==='enter'?'Enter':'Backspace'});
    else if(id.startsWith('key:')){
      const key=id.slice(4),shifted={'1':'!','2':'@','3':'#','4':'$','5':'%','6':'^','7':'&','8':'*','9':'(','0':')','-':'_','=':'+','[':'{',']':'}',';':':',"'":'"',',':'<','.':'>','/':'?'};
      client.input({kind:'text',text:shift?(shifted[key]??key.toUpperCase()):key});
    }
    changed();
  }
  function text(context,string,x,y,size=32,color='#c9f6ff') {
    context.fillStyle=color;context.font=`${size}px system-ui, sans-serif`;context.fillText(string,x,y);
  }
  function render() {
    const state=getState(),version=`${revision}:${state.revision}`;
    if(drawn===version)return {screen,console:consoleCanvas,revision:drawn};drawn=version;
    ctx.clearRect(0,0,screen.width,screen.height);ctx.fillStyle='#03131ff5';ctx.fillRect(0,0,screen.width,screen.height);
    ctx.fillStyle='#5de6ff';ctx.fillRect(0,0,8,954);ctx.fillRect(3064,0,8,954);
    text(ctx,'STEPHANOS  /  SPATIAL CONSOLE',64,65,37);
    text(ctx,`${state.status.toUpperCase()}  /  ${zoom.toFixed(1)}x  /  AUDIO: ORIGINAL APP`,2060,64,27,'#73dfe9');
    ctx.fillStyle='#152d3a';ctx.fillRect(56,92,2960,2);
    const image=client.getFrame();
    if(image&&!voiceHelp&&!reloadConfirm) {
      const r=screenImageRect(image.naturalWidth,image.naturalHeight,zoom),crop=r.crop;
      ctx.drawImage(image,crop.x,crop.y,crop.w,crop.h,r.x,r.y,r.w,r.h);
    } else {
      text(ctx,reloadConfirm?'SAVE & RELOAD ROOM':voiceHelp?'VOICE / TEXT / IMAGES':'YOUR WORKSPACE, EXPANDED',160,290,82,'#eefcff');
      const lines=reloadConfirm?[
        'Press Reload room again to save the cubes and leave this VR session.',
        'The page will load the installed room update. Your chat stays in its original app.',
        'Reconnect your window and enter VR again from the launcher.',
      ]:voiceHelp?[
        'Use the voice or microphone control in your connected ChatGPT window.',
        'Select your Quest headset microphone and speakers in the app / Windows.',
        'Audio stays with the original app; there is no second playback or recording.',
        'Use the app attachment button for images, just as on your desktop.',
        'Press Audio again to return to the conversation.',
      ]:[
        'Connect your existing ChatGPT or Codex window on the desktop launcher.',
        'Point at the hologram and press Quest trigger or Xbox A to click.',
        'Select the chat input, then use the console keyboard to type.',
        'Your original app keeps the chat, tools, images and approvals.',
      ];
      lines.forEach((line,i)=>text(ctx,line,166,405+i*67,35));
    }
    const comfortState=state.comfort;
    for(const button of DISPLAY_COMFORT_CONTROLS){
      const active=(button.id==='comfort:seated'&&comfortState?.activeProfile==='seated')
        ||(button.id==='comfort:standing'&&comfortState?.activeProfile==='standing');
      ctx.fillStyle=active?'#246678':'#102c3a';ctx.fillRect(button.x*3072,button.y*954,button.w*3072,button.h*954);
      ctx.strokeStyle='#62e7ff';ctx.lineWidth=2;ctx.strokeRect(button.x*3072,button.y*954,button.w*3072,button.h*954);
      text(ctx,button.label,button.x*3072+16,(button.y+0.052)*954,24);
    }
    const profile=comfortState?.activeProfile==='standing'?'STANDING':'SEATED';
    const height=Number(comfortState?.active?.heightOffset??0),angle=Number(comfortState?.active?.keyboardAngle??0);
    text(ctx,`${profile}  ·  HEIGHT ${height>=0?'+':''}${height.toFixed(2)} m  ·  KEYBOARD ${Math.round(angle)}°`,64,842,27,'#73dfe9');
    text(ctx,state.message,64,946,24,'#aad0db');
    knob.clearRect(0,0,256,256);knob.fillStyle='#071c29';knob.fillRect(0,0,256,256);
    knob.strokeStyle='#62e7ff';knob.lineWidth=12;knob.beginPath();knob.arc(128,128,92,0,Math.PI*2);knob.stroke();
    knob.strokeStyle='#f5c77b';knob.lineWidth=10;const dial=angle*Math.PI/180;
    knob.beginPath();knob.moveTo(128,128);knob.lineTo(128+Math.cos(dial)*72,128-Math.sin(dial)*72);knob.stroke();
    knob.fillStyle='#c9f6ff';knob.font='bold 30px system-ui, sans-serif';knob.textAlign='center';knob.fillText(`${Math.round(angle)}°`,128,226);knob.textAlign='start';
    keys.fillStyle='#071c29';keys.fillRect(0,0,2048,512);
    for(const button of SCREEN_BUTTONS) {
      const {x,y,w,h,id,label}=button;
      keys.fillStyle=hover===id||id==='shift'&&shift?'#246678':'#153646';keys.fillRect(x*2048,y*512,w*2048,h*512);
      keys.strokeStyle=id==='enter'?'#f5c77b':'#62e7ff';keys.lineWidth=2;keys.strokeRect(x*2048,y*512,w*2048,h*512);
      text(keys,shift&&id.startsWith('key:')?label.toUpperCase():label,x*2048+12,y*512+h*512*0.64,26);
    }
    return {screen,console:consoleCanvas,knob:knobCanvas,revision:drawn};
  }
  return {action,point,getState,render,hover:id=>{if(id!==hover){hover=id;changed();}}};
}
