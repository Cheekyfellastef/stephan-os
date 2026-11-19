import test from 'node:test';
import assert from 'node:assert/strict';
import {createHolodeckScreen} from '../apps/spatial-bridge/holodeck-screen-v1.mjs';
import {createHolodeckScreenInput,displayHit} from '../apps/spatial-bridge/holodeck-screen-input-v1.mjs';
import {PANEL_BUTTONS,panelButtonAt,panelButtons} from '../apps/spatial-bridge/holodeck-panels-v1.mjs';
import {HOLODECK_DISPLAY} from '../apps/spatial-bridge/holodeck-layout-v1.mjs';

// These fixtures prove local canvas routing only. They do not grant Windows
// capture consent, connect a native window, or certify a physical headset.
const choices=Array.from({length:8},(_,index)=>({id:44+index,pid:55+index,title:'Window fixture '+(index+1)}));
const centre=id=>{const button=PANEL_BUTTONS.find(value=>value.id===id);assert.ok(button,id);return [button.x+button.w/2,button.y+button.h/2];};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function fixture({status='idle',windows=choices,onStatus=()=>{},binding}={}){
  const calls=[],inputs=[],contexts=[];
  // A live native frame has stable identity until a genuinely new picture arrives.
  const frame={naturalWidth:1920,naturalHeight:1080};
  let state={status,revision:0,message:'Synthetic window fixture.',windows:status==='selecting'?windows:[],inputStatus:'',title:''};
  const publish=changes=>{state={...state,...changes,revision:state.revision+1};};
  const client={getState:()=>state,getFrame:()=>['live','view-only'].includes(state.status)?frame:null,
    input:value=>{inputs.push(value);return true;},
    discover:async()=>{calls.push(['discover']);publish({status:'selecting',windows,message:'Select an open window.'});},
    connect:async id=>{
      const selected=state.windows.find(window=>window.id===id);calls.push(['connect',id,selected?.pid]);
      publish({status:'connecting',message:'Confirm the selected window in the Windows connection prompt.'});
      if(binding)await binding.promise;
      publish({status:'waiting',title:selected.title,windows:[],message:'Waiting for the selected app to draw.'});return true;
    },
    probeHelper:async()=>{calls.push(['probe']);return {ok:true,reason:'Synthetic helper only.'};},
    stop:async()=>{calls.push(['stop']);publish({status:'idle',windows:[],title:'',message:'Window disconnected.'});}};
  const documentRef={createElement:()=>{const context={texts:[],clearRect(){this.texts=[];},fillRect(){},strokeRect(){},drawImage(){},
    fillText(text,x,y){this.texts.push({text,x,y});}};contexts.push(context);return {getContext:()=>context};}};
  const screen=createHolodeckScreen({client,documentRef,onStatus});
  screen.render();
  return {screen,client,calls,inputs,contexts,publish,
    click:id=>screen.point(...centre(id),true),
    async press(id){screen.render();screen.point(...centre(id),true);await flush();screen.render();}};
}

function rayController(screen,origin){
  const head={transform:{position:{x:origin[0],y:origin[1],z:origin[2]},orientation:{x:0,y:0,z:0,w:1}}};
  const pad={mapping:'xr-standard',connected:true,buttons:[{pressed:false},{pressed:false}]};
  const source={targetRayMode:'tracked-pointer',targetRaySpace:{},gamepad:pad};
  let pose=head,time=0;
  const input=createHolodeckScreenInput({screen});
  const frame={session:{inputSources:[source]},getPose:()=>pose};
  const update=()=>input.update({time:time+=16,frame,pose:head,navigation:{x:0,y:0,z:0,yaw:0},visible:true});
  function aim(u,v){
    const target=[-HOLODECK_DISPLAY.halfWidth+2*HOLODECK_DISPLAY.halfWidth*u,
      HOLODECK_DISPLAY.top-v*(HOLODECK_DISPLAY.top-HOLODECK_DISPLAY.bottom),HOLODECK_DISPLAY.z];
    const delta=target.map((value,index)=>value-origin[index]),length=Math.hypot(...delta),d=delta.map(value=>value/length);
    const q=[d[1],-d[0],0,1-d[2]],norm=Math.hypot(...q);
    pose={transform:{position:head.transform.position,orientation:{x:q[0]/norm,y:q[1]/norm,z:q[2]/norm,w:q[3]/norm}}};
    assert.ok(displayHit(origin,d),'The visible wall must be reachable from the actual room entrance.');
  }
  return {async click(u,v){
    screen.render();aim(u,v);pad.buttons[0].pressed=false;update();pad.buttons[0].pressed=true;
    assert.ok(update().some(pointer=>pointer.targeted));await flush();screen.render();
  },async press(id){return this.click(...centre(id));}};
}

test('left Console is the default, Settings is separately eligible, and right Audio contains no window picker',()=>{
  const h=fixture();assert.equal(h.screen.getState().leftPage,'console');assert.deepEqual(h.calls,[]);
  assert.equal(panelButtonAt(...centre('window-row-0'),'audio','console').id,'window-row-0');
  assert.notEqual(panelButtonAt(...centre('window-row-0'),'audio','settings')?.id,'window-row-0');
  assert.equal(panelButtons('tools').some(button=>/window|connection/.test(button.id)),false);
  assert.ok(h.contexts[0].texts.some(value=>value.text==='Choose interactive window'));
  assert.ok(!h.contexts[0].texts.some(value=>value.text==='Seated'));
  h.click('left-settings');
  assert.equal(h.screen.getState().leftPage,'settings');
  assert.equal(h.screen.hitTest(...centre('choose-window')).id,null,'A tab change fences the old canvas until paint.');
  h.screen.render();assert.ok(h.contexts[0].texts.some(value=>value.text==='Seated'));
  assert.ok(!h.contexts[0].texts.some(value=>value.text==='Choose interactive window'));
  assert.deepEqual(h.calls,[]);
});

for(const height of [1.15,1.7])test(`the complete window picker works from the ${height===1.15?'seated':'standing'} entrance ray, with consent and live-frame fences`,async()=>{
  const binding=deferred(),h=fixture({binding}),ray=rayController(h.screen,[.2,height,0]);
  await ray.press('choose-window');assert.deepEqual(h.calls,[['discover']]);
  assert.equal(h.screen.getState().selectedWindowId,null,'Discovery alone selects or binds nothing.');
  await ray.press('window-row-1');assert.equal(h.screen.getState().selectedWindowId,45);
  assert.deepEqual(h.calls,[['discover']]);
  await ray.press('connect-window');assert.deepEqual(h.calls,[['discover'],['connect',45,56]]);
  assert.equal(h.screen.getState().status,'connecting');assert.equal(h.screen.getState().keyboardEnabled,false);
  await ray.click(.5,.5);h.screen.action('key:a');assert.deepEqual(h.inputs,[]);
  binding.resolve();await flush();h.screen.render();
  assert.equal(h.screen.getState().status,'waiting');assert.equal(h.screen.getState().keyboardEnabled,false);
  await ray.click(.5,.5);h.screen.action('key:a');assert.deepEqual(h.inputs,[]);
  h.publish({status:'live',message:'Connected to the original fixture.'});h.screen.render();
  await ray.click(.5,.5);h.screen.action('key:a');
  assert.equal(h.inputs[0].kind,'click');assert.deepEqual(h.inputs[1],{kind:'text',text:'a'});
  assert.ok(h.contexts[0].texts.some(value=>value.text==='Window fixture 2'),'The connected title remains visible in the centre.');
  assert.equal(h.calls.filter(call=>call[0]==='discover').length,1,'Ordinary centre clicks do not reopen discovery.');
});

test('paging is explicit, never chooses a window, and cannot activate an unpainted page or hidden row',async()=>{
  const h=fixture();await h.press('choose-window');
  assert.equal(h.screen.getState().windowPages,3);
  h.click('window-next');assert.equal(h.screen.getState().windowPage,1);
  assert.equal(h.screen.getState().selectedWindowId,null);
  h.click('window-row-0');assert.equal(h.screen.getState().selectedWindowId,null);
  h.screen.render();h.click('window-row-0');assert.equal(h.screen.getState().selectedWindowId,47);
  h.screen.render();h.click('window-next');h.screen.render();
  assert.equal(h.screen.getState().windowPage,2);
  assert.equal(h.screen.hitTest(...centre('window-row-2')).id,null,'The final page has no third window.');
  assert.equal(h.screen.getState().selectedWindowId,null,'Changing page clears a selection that would no longer be visible.');
  h.click('left-settings');h.click('window-row-0');assert.equal(h.screen.getState().selectedWindowId,null);
  h.screen.render();h.click('left-console');h.click('window-row-0');assert.equal(h.screen.getState().selectedWindowId,null);
  h.screen.render();h.click('window-row-0');assert.equal(h.screen.getState().selectedWindowId,50);
  assert.equal(h.calls.some(call=>call[0]==='connect'),false);
});

test('a removed or reused HWND cannot be selected from an old painted title, including a reentrant repaint',async()=>{
  for(const replacement of [[],[{id:44,pid:999,title:'Replacement fixture'}]]){
    let h,repaint=false;
    h=fixture({windows:[choices[0]],onStatus:()=>{if(repaint){repaint=false;h.screen.render();}}});
    await h.press('choose-window');h.screen.action('focus-chatgpt');h.screen.render();
    h.publish({windows:replacement});repaint=true;
    h.click('window-row-0');
    assert.equal(h.screen.getState().selectedWindowId,null);
    assert.match(h.screen.getState().connectionMessage,/window changed/);
    await h.screen.action('connect-window');assert.equal(h.calls.some(call=>call[0]==='connect'),false);
    if(replacement.length){h.screen.render();h.click('window-row-0');assert.equal(h.screen.getState().selectedWindowId,44);}
  }
});

test('a selected row keeps its identity through reordering, but replacement before Connect cannot bind',async()=>{
  const h=fixture({windows:choices.slice(0,2)});await h.press('choose-window');
  h.publish({windows:[choices[1],{...choices[0],title:'Renamed original fixture'}]});
  h.click('window-row-0');assert.equal(h.screen.getState().selectedWindowId,44,'The user chose the title actually painted, not its new array position.');
  h.screen.render();h.publish({windows:[{...choices[0],pid:999,title:'Reused HWND fixture'}]});
  h.click('connect-window');await flush();assert.equal(h.calls.some(call=>call[0]==='connect'),false);
  assert.equal(h.screen.getState().selectedWindowId,null);
});

test('live and view-only centre pictures never implicitly discover or bind, and view-only remains input-free',()=>{
  for(const status of ['live','view-only','idle','unavailable']){
    const h=fixture({status});h.screen.point(.5,.5,true);h.screen.action('key:a');
    assert.deepEqual(h.calls,[]);
    assert.equal(h.inputs.length,status==='live'?2:0);
    if(status==='view-only')assert.match(h.screen.getState().inputStatus,/Console on the left/);
  }
});
