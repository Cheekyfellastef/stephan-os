import test from 'node:test';
import assert from 'node:assert/strict';
import {createHolodeckScreen,SCREEN_CONTENT,screenImageRect,screenCrop,SPATIAL_CONVERSATION_PRESENTATION_KEY,readSpatialConversationPresentation} from '../apps/spatial-bridge/holodeck-screen-v1.mjs';
import {HOLODECK_PANELS,PANEL_BUTTONS,panelAt} from '../apps/spatial-bridge/holodeck-panels-v1.mjs';
import {createHolodeckComfort} from '../apps/spatial-bridge/holodeck-comfort-v1.mjs';
import {createHolodeckFurniture} from '../apps/spatial-bridge/holodeck-furniture-v1.mjs';
import {createHolodeckAudioControls} from '../apps/spatial-bridge/holodeck-audio-v1.mjs';
import {createHolodeckScreenInput} from '../apps/spatial-bridge/holodeck-screen-input-v1.mjs';
import {HOLODECK_DISPLAY} from '../apps/spatial-bridge/holodeck-layout-v1.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const center=id=>{const b=PANEL_BUTTONS.find(button=>button.id===id);assert.ok(b,id);return [b.x+b.w/2,b.y+b.h/2];};
function fixture({status='live',audio,client:overrides={},onStatus=()=>{},stored=new Map()}={}){
  const contexts=[],inputs=[],calls=[],storage=stored;
  const store={getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)};
  const comfort=createHolodeckComfort({storage:store}),furniture=createHolodeckFurniture({storage:store});
  let state={status,revision:0,message:'Synthetic source for tests only.',windows:[],inputStatus:''};
  const frame={naturalWidth:1920,naturalHeight:1080,fixture:true};
  const publish=changes=>{state={...state,...changes,revision:state.revision+1};};
  const client={getState:()=>state,getFrame:()=>['live','view-only'].includes(state.status)?frame:null,
    input:value=>{inputs.push(value);return true;},
    probeHelper:async()=>{calls.push(['probe']);return {ok:false,reason:'Helper is not installed.'};},
    discover:async()=>{calls.push(['discover']);publish({status:'selecting',windows:[{id:44,pid:55,title:'Actual chosen fixture'}]});},
    connect:async id=>{calls.push(['connect',id]);publish({status:'waiting',windows:[],message:'Awaiting consented frame.'});return true;},
    stop:async()=>{calls.push(['stop']);publish({status:'idle',windows:[],message:'Window disconnected.'});},...overrides};
  const documentRef={createElement:()=>{const context={texts:[],images:[],clearRect(){this.texts=[];this.images=[];},fillRect(){},strokeRect(){},
    fillText(text,x,y){this.texts.push({text,x,y});},drawImage(...args){this.images.push(args);}};
    contexts.push(context);return {getContext:()=>context};}};
  const screen=createHolodeckScreen({client,comfort,furniture,audio,documentRef,onStatus,storage:store});
  return {screen,client,comfort,furniture,frame,contexts,inputs,calls,storage,publish,press:id=>{screen.render();return screen.point(...center(id),true);}};
}

test('both room Disconnect controls stop local speaker tests without claiming Voice mute',async()=>{
  const stops=[];
  const audio={getState:()=>({microphoneActive:false,microphonePending:false}),
    stopSpeakers:()=>{stops.push('speaker');return true;},
    stopMicrophone:()=>stops.push('microphone')};
  const h=fixture({audio});
  await h.screen.action('stop');
  await h.screen.action('disconnect-window');
  assert.deepEqual(stops,['speaker','speaker']);
  assert.deepEqual(h.calls,[['stop'],['stop']]);
  assert.deepEqual(h.inputs,[],'neither disconnect may send native application input');
});

test('the three panels paint one actual app frame within its centre viewport, with no recursive entry-page capture',()=>{
  const h=fixture();const frame=h.screen.render();
  assert.equal(frame.screen.width,3072);assert.equal(frame.screen.height,954);
  assert.equal(h.contexts[0].images.length,1);assert.equal(h.contexts[0].images[0][0],h.frame);
  const [,sx,sy,sw,sh,x,y,w,height]=h.contexts[0].images[0];
  assert.deepEqual([sx,sy,sw,sh],[0,0,1920,1080]);
  assert.ok(x>=SCREEN_CONTENT.x&&x+w<=SCREEN_CONTENT.x+SCREEN_CONTENT.w);
  assert.ok(y>=SCREEN_CONTENT.y&&y+height<=SCREEN_CONTENT.y+SCREEN_CONTENT.h);
  assert.deepEqual(HOLODECK_PANELS.map(panel=>panel.id),['settings','chatgpt','tools']);
  assert.ok(h.contexts[0].texts.some(entry=>entry.text.includes('WINDOW LIVE')));
  assert.equal(h.contexts[0].texts.some(entry=>entry.text.includes('INTERACTIVE')),false,'capture alone is not accepted text input');
  for(const button of PANEL_BUTTONS)assert.equal(panelAt(...center(button.id))?.id,button.panel);
  assert.deepEqual(h.calls,[]);assert.deepEqual(h.inputs,[]);
});

test('in-room settings mutate the same saved comfort and furniture while ChatGPT is view only',()=>{
  const h=fixture({status:'view-only'});h.screen.render();
  h.press('left-settings');
  h.press('height-up');h.press('tilt-up');
  assert.equal(h.comfort.getState().heightOffset,.01);assert.equal(h.comfort.getState().keyboardTilt,1);
  h.press('furniture-table');h.press('furniture-right');
  assert.deepEqual(h.furniture.getOffset('table'),[.1,0,0]);
  assert.equal(h.screen.getState().focusedPanel,'settings');assert.equal(h.screen.getState().keyboardEnabled,false);
  h.screen.action('enter');h.screen.action('key:a');assert.deepEqual(h.inputs,[]);
  h.comfort.flush();
  assert.equal(createHolodeckComfort({storage:{getItem:key=>h.storage.get(key)}}).getState().keyboardTilt,1);
  assert.deepEqual(createHolodeckFurniture({storage:{getItem:key=>h.storage.get(key)}}).getOffset('table'),[.1,0,0]);
  assert.deepEqual(h.calls,[]);
});

test('local page focus fences keyboard, scroll and Enter; deliberately selecting ChatGPT restores its sole target',()=>{
  const h=fixture();h.screen.render();h.screen.action('key:a');assert.equal(h.inputs.length,1);
  for(const panel of ['settings','tools']){
    h.screen.action('focus-'+panel);
    for(const action of ['key:b','enter','backspace','scroll-down'])h.screen.action(action);
    assert.equal(h.inputs.length,1);assert.equal(h.screen.getState().keyboardEnabled,false);
    assert.match(h.screen.getState().inputStatus,/centre window/);
  }
  h.screen.action('focus-chatgpt');assert.equal(h.screen.getState().keyboardEnabled,true);
  h.screen.action('key:c');assert.deepEqual(h.inputs.at(-1),{kind:'text',text:'c'});
});

test('the view-only plane remains focusable and gives connection guidance without sending any external input',()=>{
  const h=fixture({status:'view-only'});h.screen.render();h.screen.action('focus-settings');
  assert.deepEqual(h.screen.hitTest(.5,.5),{panel:'chatgpt',id:null});
  assert.equal(h.screen.point(.5,.5,true),true);assert.equal(h.screen.getState().focusedPanel,'chatgpt');
  h.screen.action('key:a');h.screen.action('enter');h.screen.action('scroll-up');
  assert.equal(h.screen.getState().keyboardEnabled,false);assert.match(h.screen.getState().inputStatus,/Console on the left/);
  assert.deepEqual(h.inputs,[]);assert.deepEqual(h.calls,[]);
  h.screen.render();assert.ok(h.contexts[0].texts.some(entry=>entry.text.includes('VIEW ONLY')));
});

test('panel headers and gaps cannot forward app clicks, and centre crop changes remain fenced until painted',()=>{
  const h=fixture();h.screen.render();
  for(const panel of HOLODECK_PANELS)h.screen.point(panel.x+panel.w/2,panel.y+.02,true);
  assert.equal(h.screen.point(0,0,true),false);assert.deepEqual(h.inputs,[]);
  h.press('zoom-in');h.screen.point(.5,.5,true);assert.deepEqual(h.inputs,[]);
  h.screen.action('focus-settings');h.screen.action('focus-chatgpt');h.screen.action('enter');assert.deepEqual(h.inputs,[]);
  h.screen.render();assert.equal(h.screen.point(.5,(SCREEN_CONTENT.y+SCREEN_CONTENT.h/2)/954,true),true);
  assert.equal(h.inputs.length,1);assert.equal(h.inputs[0].kind,'click');
  assert.ok(Math.abs(h.inputs[0].x-.5)<1e-10&&Math.abs(h.inputs[0].y-.5)<1e-10);
});

test('non-live native state cannot borrow input authority from a stale frame',()=>{
  const image={naturalWidth:1920,naturalHeight:1080};
  const h=fixture({status:'waiting',client:{getFrame:()=>image}});h.screen.render();
  h.screen.point(.5,.5,true);h.screen.action('enter');assert.deepEqual(h.inputs,[]);
  assert.equal(h.screen.getState().keyboardEnabled,false);
});

test('a Quest ray targets the view-only panel and requires a fresh trigger without inventing a native click',()=>{
  const h=fixture({status:'view-only'});h.screen.render();h.screen.action('focus-settings');
  const target=[0,HOLODECK_DISPLAY.top-.5*(HOLODECK_DISPLAY.top-HOLODECK_DISPLAY.bottom),HOLODECK_DISPLAY.z];
  const origin=[0,2.4,-3],delta=target.map((v,i)=>v-origin[i]),length=Math.hypot(...delta),d=delta.map(v=>v/length);
  const q=[d[1],-d[0],0,1-d[2]],norm=Math.hypot(...q),rotation=q.map(v=>v/norm);
  const pose={transform:{position:{x:origin[0],y:origin[1],z:origin[2]},orientation:{x:rotation[0],y:rotation[1],z:rotation[2],w:rotation[3]}}};
  const pad={mapping:'xr-standard',connected:true,buttons:[{pressed:true},{pressed:false}]};
  const source={targetRayMode:'tracked-pointer',targetRaySpace:{},gamepad:pad};
  const sample={time:0,frame:{session:{inputSources:[source]},getPose:()=>pose},pose,navigation:{x:0,z:0,yaw:0}};
  const controls=createHolodeckScreenInput({screen:h.screen,comfort:h.comfort});
  const step=()=>controls.update({...sample,time:sample.time+=16});
  assert.ok(step().some(pointer=>pointer.targeted));assert.equal(h.screen.getState().focusedPanel,'settings');
  pad.buttons[0].pressed=false;step();pad.buttons[0].pressed=true;step();
  assert.equal(h.screen.getState().focusedPanel,'chatgpt');assert.match(h.screen.getState().inputStatus,/view-only/);
  for(let i=0;i<5;i++)step();assert.deepEqual(h.inputs,[]);assert.deepEqual(h.calls,[]);
});

test('connection page effects are explicit and read-only health never discovers or binds a window',async()=>{
  const h=fixture({status:'view-only'});h.screen.render();h.screen.action('tools-connection');h.screen.render();
  assert.deepEqual(h.calls,[]);await h.screen.action('connection-probe');
  assert.deepEqual(h.calls,[['probe']]);assert.match(h.screen.getState().connectionMessage,/not installed/);
  assert.equal(h.screen.getState().status,'view-only');assert.equal(h.screen.getState().focusedPanel,'settings');
  assert.equal(h.screen.getState().leftPage,'console');
  assert.equal(h.screen.getState().keyboardEnabled,false);
});

test('DOM and in-room selection share one current HWND/PID, with no implicit binding',async()=>{
  const h=fixture({status:'idle'});await h.screen.action('choose-window');
  assert.equal(h.screen.getState().selectedWindowId,null);assert.equal(await h.screen.action('connect-window'),false);
  assert.equal(h.calls.filter(call=>call[0]==='connect').length,0);
  assert.equal(h.screen.selectWindow(44),true);assert.equal(h.screen.getState().selectedWindowId,44);
  h.publish({windows:[{id:44,pid:99,title:'Reused HWND fixture'}]});
  assert.equal(h.screen.getState().selectedWindowId,null);assert.equal(await h.screen.action('connect-window'),false);
  h.press('window-row-0');assert.equal(h.screen.getState().selectedWindowId,44);
  await h.screen.action('connect-window');assert.deepEqual(h.calls.filter(call=>call[0]==='connect'),[['connect',44]]);
  assert.equal(h.screen.getState().status,'waiting');assert.equal(h.screen.getState().keyboardEnabled,false);
});

test('pending connection effects are single-flight and disconnect invalidates late UI feedback',async()=>{
  const pending=deferred();let probes=0;
  const h=fixture({client:{probeHelper:()=>{probes++;return pending.promise;}}});
  const first=h.screen.action('connection-probe');await Promise.resolve();
  assert.equal(h.screen.action('choose-window'),false);assert.equal(probes,1);
  await h.screen.action('disconnect-window');pending.resolve({ok:true,reason:'Stale health result'});await first;
  assert.equal(h.screen.getState().connectionMessage,'');assert.equal(h.screen.getState().message,'Window disconnected.');
  assert.equal(h.screen.getState().connectionPending,null);
  assert.deepEqual(h.calls,[['stop']]);
});

test('synchronous subscriber cancellation cannot dispatch a queued native discovery afterward',async()=>{
  let h,cancelled=false;
  h=fixture({onStatus:state=>{if(state.connectionPending&&!cancelled){cancelled=true;void h.screen.action('disconnect-window');}}});
  await h.screen.action('choose-window');await Promise.resolve();await Promise.resolve();
  assert.equal(h.calls.filter(call=>call[0]==='discover').length,0);
  assert.equal(h.calls.filter(call=>call[0]==='stop').length,1);
});

test('audio page uses the canonical device selection and mic lifecycle, without any app input',async()=>{
  let permissions=0,stops=0;
  const track={readyState:'live',stop(){stops++;this.readyState='ended';},addEventListener(){},removeEventListener(){}};
  const audio=createHolodeckAudioControls({AudioContextCtor:null,navigatorRef:{mediaDevices:{
    enumerateDevices:async()=>[{kind:'audioinput',deviceId:'quest-mic',label:'Quest mic fixture'},{kind:'audiooutput',deviceId:'quest-out',label:'Quest speakers fixture'}],
    getUserMedia:async spec=>{permissions++;assert.deepEqual(spec,{audio:{deviceId:{exact:'quest-mic'}},video:false});return {getAudioTracks:()=>[track],getTracks:()=>[track]};},
  }}});
  const h=fixture({status:'view-only',audio});h.screen.render();assert.equal(permissions,0);
  await h.screen.action('audio-refresh');h.screen.action('audio-input-next');
  assert.equal(audio.getState().inputId,'quest-mic');assert.equal(h.screen.getState().audio.inputId,'quest-mic');
  const before=h.screen.render().revision;audio.setOutput('quest-out');assert.notEqual(h.screen.render().revision,before);
  assert.ok(h.contexts[0].texts.some(entry=>entry.text==='Quest speakers fixture'));
  await h.screen.action('audio-test-microphone');assert.equal(permissions,1);assert.equal(audio.getState().microphoneActive,true);
  h.screen.action('audio-stop-microphone');assert.equal(stops,1);assert.equal(audio.getState().microphoneActive,false);
  assert.deepEqual(h.inputs,[]);assert.deepEqual(h.calls,[]);assert.equal(h.screen.getState().focusedPanel,'tools');
});

test('Stop revokes input synchronously before another key or pointer in the same frame',async()=>{
  for(const action of ['stop','disconnect-window']){
    const pending=deferred();let stops=0;
    // The fixture deliberately retains a stale live frame while stop awaits
    // transport. The screen must fence it immediately, independently of ACK.
    const h=fixture({client:{stop:()=>{stops++;return pending.promise;}}});h.screen.render();
    const stopped=h.screen.action(action);assert.equal(stops,1);
    h.screen.action('focus-chatgpt');h.screen.action('key:x');h.screen.point(.5,.5,true);h.screen.action('enter');
    assert.deepEqual(h.inputs,[]);assert.equal(h.screen.getState().keyboardEnabled,false);
    h.screen.render();assert.ok(h.contexts[0].texts.some(entry=>entry.text.includes('INPUT STOPPED')));
    pending.resolve();await stopped;
    h.screen.action('key:x');assert.deepEqual(h.inputs,[],'completion does not re-enable an old app frame');
  }
});

test('Stop fences reentrant subscribers before publishing any screen status',async()=>{
  for(const route of ['stop','disconnect-window','point']){
    const pending=deferred();let h,stops=0,armed=false,observed=false;
    h=fixture({client:{stop:()=>{stops++;return pending.promise;}},onStatus:state=>{
      if(armed&&!observed){observed=true;assert.equal(stops,1,'native stop began before the callback');
        h.screen.action('focus-chatgpt');h.screen.action('key:x');h.screen.point(.5,.5,true);}
    }});h.screen.render();h.screen.action('tools-connection');h.screen.action('focus-chatgpt');armed=true;
    const stopped=route==='point'?h.press('disconnect-window'):h.screen.action(route);
    assert.equal(observed,true);assert.deepEqual(h.inputs,[]);
    pending.resolve();await stopped;await Promise.resolve();
  }
});

test('a window replacement between Connect intent and asynchronous dispatch cannot be rebound',async()=>{
  const h=fixture({status:'idle'});await h.screen.action('choose-window');h.screen.selectWindow(44);
  const connecting=h.screen.action('connect-window');
  h.publish({status:'selecting',windows:[{id:44,pid:999,title:'Replaced after the user selected it'}]});
  await connecting;
  assert.equal(h.calls.some(call=>call[0]==='connect'),false);
  assert.match(h.screen.getState().connectionMessage,/selection changed/);
});

test('a fresh explicitly selected native connection can release the Stop fence, after its live frame arrives',async()=>{
  const h=fixture();h.screen.render();await h.screen.action('stop');
  await h.screen.action('choose-window');h.screen.selectWindow(44);await h.screen.action('connect-window');
  h.screen.action('focus-chatgpt');h.screen.action('key:a');assert.deepEqual(h.inputs,[]);
  h.publish({status:'live'});h.screen.render();h.screen.action('key:a');
  assert.deepEqual(h.inputs,[{kind:'text',text:'a'}]);
});

test('connection panel follows waiting-to-live frame state without caching or duplicating the earlier client message',async()=>{
  const h=fixture({status:'idle'});
  await h.screen.action('choose-window');h.screen.selectWindow(44);await h.screen.action('connect-window');
  assert.equal(h.screen.getState().status,'waiting');assert.equal(h.screen.getState().connectionMessage,'');
  const paneTexts=()=>h.contexts[0].texts.filter(text=>text.x<740&&text.y>=720&&text.y<810);
  h.screen.render();assert.equal(paneTexts().filter(text=>text.text==='Awaiting consented frame.').length,1);
  const waitingRevision=h.screen.render().revision;
  h.publish({status:'live',message:'Connected to the current app.'});
  assert.notEqual(h.screen.render().revision,waitingRevision);
  assert.equal(paneTexts()[0].text,'Connected to the current app.');
  assert.equal(paneTexts().filter(text=>text.text==='Connected to the current app.').length,1);
  assert.ok(!h.contexts[0].texts.some(text=>text.text.includes('Awaiting consented frame')));
  assert.equal(h.screen.getState().connectionMessage,'','live client truth is not copied into independent diagnostics');
  h.client.probeHelper=async()=>({ok:true,reason:'Local Spatial helper responds.'});
  await h.screen.action('connection-probe');h.screen.render();
  assert.equal(paneTexts()[0].text,'Connected to the current app.');
  assert.equal(paneTexts().filter(text=>text.text==='Local Spatial helper responds.').length,1);
  h.publish({status:'waiting',message:'Current app has no fresh frame.'});h.screen.render();
  assert.equal(paneTexts()[0].text,'Current app has no fresh frame.');
  assert.ok(!paneTexts().some(text=>text.text.includes('Connected to the current app')));
  assert.equal(h.screen.getState().connectionMessage,'Local Spatial helper responds.');
});

test('dedicated Scroll arrows use visible conversation centre, not composer hover',()=>{
  const h=fixture();h.screen.render();
  const rect=screenImageRect(1920,1080);
  const hover=[(rect.x+rect.w*.85)/SCREEN_CONTENT.width,(rect.y+rect.h*.85)/SCREEN_CONTENT.height];
  assert.equal(h.screen.point(...hover,false),true);
  h.screen.action('scroll-down');
  assert.deepEqual(h.inputs.at(-1),{kind:'scroll',x:.5,y:.5,delta:-120},
    'hover near composer cannot retarget the separate Scroll action');
  h.screen.action('zoom-in');
  const beforePaint=h.inputs.length;h.screen.action('scroll-up');
  assert.equal(h.inputs.length,beforePaint,'unpainted view blocks input');
  h.screen.render();
  h.screen.action('pan-right');h.screen.action('pan-down');h.screen.render();
  h.screen.point(...hover,false);
  const {zoom,panX,panY}=h.screen.getState(),crop=screenCrop(1,1,zoom,panX,panY);
  h.screen.action('scroll-up');
  assert.deepEqual(h.inputs.at(-1),{kind:'scroll',x:crop.x+crop.w/2,y:crop.y+crop.h/2,delta:120});
  const count=h.inputs.length;
  h.screen.action('focus-tools');h.screen.action('scroll-down');
  assert.equal(h.inputs.length,count,'local-panel focus still blocks native Scroll');
});

test('screen view and panel choices restore independently of Windows consent, drafts and Voice',()=>{
  const shared=new Map(),first=fixture({stored:shared});
  first.screen.render();
  first.screen.action('zoom-in');first.screen.action('pan-right');first.screen.action('pan-up');
  first.screen.action('left-settings');first.screen.action('furniture-table');
  const saved=JSON.parse(shared.get(SPATIAL_CONVERSATION_PRESENTATION_KEY));
  assert.deepEqual(Object.keys(saved).sort(),['furnitureTarget','focusedPanel','leftPage','panX','panY','version','zoom'].sort());
  assert.deepEqual([saved.zoom,saved.panX,saved.panY,saved.focusedPanel,saved.leftPage,saved.furnitureTarget],
    [1.5,.5,-.5,'settings','settings','table']);
  const second=fixture({stored:shared}),state=second.screen.getState();
  assert.deepEqual([state.zoom,state.panX,state.panY,state.focusedPanel,state.leftPage,state.furnitureTarget],
    [1.5,.5,-.5,'settings','settings','table']);
  second.screen.action('enter');assert.deepEqual(second.inputs,[],'restored non-app panel cannot type');
  second.screen.action('focus-chatgpt');second.screen.action('key:z');
  assert.deepEqual(second.inputs,[],'unpainted restored crop cannot type');
  second.screen.render();second.screen.action('key:z');
  assert.deepEqual(second.inputs,[{kind:'text',text:'z'}]);
  assert.equal(shared.get(SPATIAL_CONVERSATION_PRESENTATION_KEY).includes('selectedWindow'),false);
  assert.equal(shared.get(SPATIAL_CONVERSATION_PRESENTATION_KEY).includes('microphone'),false);
});

test('invalid, corrupt, oversized, untrusted and forbidden screen preferences fail closed',()=>{
  const defaults={zoom:1,panX:0,panY:0,focusedPanel:'chatgpt',leftPage:'console',furnitureTarget:'keyboard'};
  const load=value=>readSpatialConversationPresentation({getItem:()=>value});
  for(const value of ['{','x'.repeat(2050),JSON.stringify({version:2,zoom:4}),
    JSON.stringify({version:1,zoom:'3',panX:'0.5',panY:Infinity,focusedPanel:'unknown',leftPage:'unknown',furnitureTarget:'bad'})])
    assert.deepEqual(load(value),defaults);
  assert.deepEqual(load(JSON.stringify({version:1,zoom:8,panX:1,panY:-1})),defaults);
  assert.deepEqual(load(JSON.stringify({version:1,zoom:2,panX:0.25,panY:-.5})),
    {...defaults,zoom:2,panX:.25,panY:-.5});
  assert.deepEqual(readSpatialConversationPresentation({getItem(){throw Error('blocked')}}),defaults);
  const h=fixture();h.screen.render();
  const settings={getItem(){throw Error('private storage')},setItem(){throw Error('quota')}};
  const second=createHolodeckScreen({client:h.client,storage:settings,documentRef:{
    createElement(){return {getContext(){return {fillRect(){},strokeRect(){},clearRect(){},fillText(){},drawImage(){}};}};}
  }});
  second.action('zoom-in');assert.equal(second.getState().zoom,1.5);
});

test('Disconnect releases room-local microphone testing without claiming to mute ChatGPT Voice',async()=>{
  for(const [actionId,phase] of [['stop','microphonePending'],['disconnect-window','microphoneActive']]){
    let local={microphonePending:phase==='microphonePending',microphoneActive:phase==='microphoneActive'};
    let localStops=0;
    const audio={
      getState:()=>({...local,inputs:[],outputs:[],status:'Local browser audio test only.'}),
      stopMicrophone:()=>{localStops++;local={microphonePending:false,microphoneActive:false};}
    };
    const h=fixture({audio});h.screen.render();
    const stopped=h.screen.action(actionId);
    assert.equal(localStops,1,'pending or live room-local capture must end synchronously on Disconnect');
    assert.equal(h.calls.filter(call=>call[0]==='stop').length,1,'native window stop must still execute');
    assert.equal(h.screen.getState().keyboardEnabled,false,'window input must be revoked immediately');
    await stopped;
    assert.equal(h.screen.getState().audio.microphonePending,false);
    assert.equal(h.screen.getState().audio.microphoneActive,false);
    assert.deepEqual(h.inputs,[],'Disconnect never sends an app key or ChatGPT message');
    h.screen.render();
    assert.ok(h.contexts[0].texts.some(entry=>entry.text.includes('Disconnect does not mute or end Voice')),
      'local microphone release is never represented as ending original ChatGPT Voice');
    await h.screen.action('stop');
    assert.equal(localStops,1,'an already stopped local microphone must not be reactivated or stopped again');
  }
});
