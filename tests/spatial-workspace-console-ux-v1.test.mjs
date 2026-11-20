import test from 'node:test';
import assert from 'node:assert/strict';
import {createHolodeckScreen,screenCrop,screenImageRect,screenPointToSource,screenButtonLabel,SCREEN_BUTTONS,SCREEN_CONTENT} from '../apps/spatial-bridge/holodeck-screen-v1.mjs';
import {createHolodeckWindowClient} from '../apps/spatial-bridge/holodeck-window-client-v1.mjs';

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
function screenFixture(){
  const contexts=[],inputs=[],frame={naturalWidth:1920,naturalHeight:1080};
  let state={status:'live',revision:0,message:'Synthetic fixture; no native connection.',inputStatus:''};
  const documentRef={createElement(){
    const context={texts:[],images:[],clearRect(){this.texts=[];this.images=[];},fillRect(){},strokeRect(){},fillText(text,x,y){this.texts.push({text,x,y});},drawImage(...args){this.images.push(args);}};
    contexts.push(context);return {getContext:()=>context};
  }};
  const screen=createHolodeckScreen({documentRef,client:{getState:()=>state,getFrame:()=>state.status==='live'?frame:null,input:value=>{inputs.push(value);return true;}}});
  return {screen,contexts,inputs,frame,publish(changes){state={...state,...changes,revision:state.revision+1};}};
}
function viewPoint(x,y,width,height,zoom,panX,panY){
  const rect=screenImageRect(width,height,zoom,panX,panY);
  return {u:(rect.x+(x*width-rect.crop.x)/rect.crop.w*rect.w)/SCREEN_CONTENT.width,
    v:(rect.y+(y*height-rect.crop.y)/rect.crop.h*rect.h)/SCREEN_CONTENT.height};
}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const response=value=>({ok:true,json:async()=>value});
function clientFixture(handler){
  const calls=[],timers=new Map();let timerId=0;
  const client=createHolodeckWindowClient({locationRef:{port:'4174'},sessionStore:null,
    documentRef:{createElement:()=>({decode:async()=>{}})},
    fetchRef:async(url,options)=>{const call={path:new URL(url).pathname,body:JSON.parse(options.body)};calls.push(call);return response(await handler(call));},
    setTimer:fn=>{timers.set(++timerId,fn);return timerId;},clearTimer:id=>timers.delete(id),
  });
  return {client,calls,timers,async tick(){const entry=timers.entries().next().value;if(!entry)return;const [id,fn]=entry;timers.delete(id);return fn();}};
}
const token='a'.repeat(64),windowOne={id:44,pid:55,title:'ChatGPT fixture'};

test('pan bounds keep every crop in the source and edge hit mapping matches portrait and landscape draws',()=>{
  for(const [width,height] of [[1920,1080],[1080,1920]])for(const zoom of [1,2,4])for(const panX of [-1,0,1])for(const panY of [-1,0,1]){
    const r=screenImageRect(width,height,zoom,panX,panY);
    assert.ok(r.crop.x>=0&&r.crop.y>=0&&r.crop.x+r.crop.w<=width&&r.crop.y+r.crop.h<=height);
    for(const t of [0,.5,1]){
      const point=screenPointToSource((r.x+r.w*t)/SCREEN_CONTENT.width,(r.y+r.h*t)/SCREEN_CONTENT.height,width,height,zoom,panX,panY);
      close(point.x,(r.crop.x+r.crop.w*t)/width);close(point.y,(r.crop.y+r.crop.h*t)/height);
    }
    assert.equal(screenPointToSource(0,0,width,height,zoom,panX,panY),null);
  }
  assert.deepEqual(screenCrop(1920,1080,2,99,-99),screenCrop(1920,1080,2,1,-1));
  assert.deepEqual(screenCrop(1920,1080,NaN,NaN,NaN),{x:0,y:0,w:1920,h:1080});
});

test('zoomed bottom-right composer is reachable; draw, pointer and scroll agree and Fit resets the view',()=>{
  const h=screenFixture();h.screen.render();
  h.screen.action('zoom-in');h.screen.action('zoom-in');
  for(let i=0;i<5;i++){h.screen.action('pan-right');h.screen.action('pan-down');}
  assert.equal(h.screen.getState().zoom,2);assert.equal(h.screen.getState().panX,1);assert.equal(h.screen.getState().panY,1);
  assert.equal(h.screen.point(.5,.5,true),false,'old displayed coordinates cannot click before the changed view is painted');
  h.screen.render();
  assert.deepEqual(h.contexts[0].images.at(-1).slice(1,5),[960,540,960,540]);
  const point=viewPoint(.94,.94,1920,1080,2,1,1);
  assert.equal(h.screen.point(point.u,point.v,true),true);
  const click=h.inputs.at(-1);assert.equal(click.kind,'click');close(click.x,.94);close(click.y,.94);
  h.screen.action('scroll-down');assert.deepEqual(h.inputs.at(-1),{kind:'scroll',x:click.x,y:click.y,delta:-120});
  h.screen.action('pan-left');h.screen.render();h.screen.action('scroll-up');
  assert.deepEqual(h.inputs.at(-1),{kind:'scroll',x:.625,y:.75,delta:120});
  h.screen.action('fit');h.screen.render();
  assert.deepEqual([h.screen.getState().zoom,h.screen.getState().panX,h.screen.getState().panY],[1,0,0]);
  assert.deepEqual(h.contexts[0].images.at(-1).slice(1,5),[0,0,1920,1080]);
  h.screen.action('pan-up');h.screen.action('pan-left');
  assert.deepEqual([h.screen.getState().panX,h.screen.getState().panY],[0,0]);
});

test('Shift uses one label and text map for digits, punctuation, letters and Space',()=>{
  const h=screenFixture();h.screen.action('shift');h.screen.render();
  const examples={'1':'!','2':'@','0':')','-':'_','=':'+','[':'{',']':'}',';':':',"'":'"',',':'<','.':'>','/':'?','a':'A',' ':' '};
  for(const [key,text] of Object.entries(examples)){
    const button=SCREEN_BUTTONS.find(button=>button.id==='key:'+key),label=key===' '?'Space':text;
    assert.equal(screenButtonLabel(button,true),label);
    assert.ok(h.contexts[1].texts.some(entry=>entry.text===label));
    h.screen.action(button.id);assert.deepEqual(h.inputs.at(-1),{kind:'text',text});
  }
  h.screen.action('shift');h.screen.action('key:1');assert.deepEqual(h.inputs.at(-1),{kind:'text',text:'1'});
  h.screen.action('enter');assert.deepEqual(h.inputs.at(-1),{kind:'key',key:'Enter'});
});

test('the hologram paints input feedback and changes its texture revision for a rejection',()=>{
  const h=screenFixture(),before=h.screen.render().revision;
  const rejected='That input was not accepted. Select a text field or wait for a fresh picture.';
  h.publish({inputStatus:rejected});const after=h.screen.render().revision;
  assert.notEqual(after,before);assert.ok(h.contexts[0].texts.some(entry=>entry.text===rejected&&entry.y===904));
  h.publish({inputStatus:''});h.screen.render();assert.ok(!h.contexts[0].texts.some(entry=>entry.text===rejected));
});

test('Audio help states the setup boundary and never clicks through a hidden or not-yet-painted app',()=>{
  const h=screenFixture();h.screen.render();h.screen.action('voice');h.screen.render();
  const texts=h.contexts[0].texts.map(entry=>entry.text);
  assert.ok(texts.some(text=>text.includes('does not enable or test')));
  assert.ok(texts.some(text=>text.includes('Audio help again to return')));
  assert.ok(texts.some(text=>text.includes('Voice button and allow microphone')));
  assert.ok(texts.some(text=>text.includes('microphone dictation enters text')));
  assert.equal(h.screen.point(.5,.5,true),false);
  h.screen.action('voice');assert.equal(h.screen.point(.5,.5,true),false);
  h.screen.render();assert.equal(h.screen.point(.5,.5,true),true);assert.equal(h.inputs.length,1);
});

test('all app input is blocked by Audio help, Reload and unpainted views, with local controls still usable',()=>{
  const h=screenFixture();h.screen.render();
  for(const overlay of ['voice','reload']){
    h.screen.action(overlay);h.screen.render();
    const count=h.inputs.length;
    for(const action of ['enter','backspace','key:a','scroll-up','scroll-down'])h.screen.action(action);
    assert.equal(h.screen.point(.5,.5,true),false);assert.equal(h.inputs.length,count);
    assert.match(h.screen.getState().inputStatus,/Input paused/);
    h.screen.render();assert.ok(h.contexts[0].texts.some(entry=>entry.text.includes('Input paused')));
    const shift=h.screen.getState().shift;h.screen.action('shift');assert.equal(h.screen.getState().shift,!shift);
    h.screen.action(overlay==='voice'?'voice':'fit');
    h.screen.action('enter');assert.equal(h.inputs.length,count,'returning to the app must paint before it can receive input');
    h.screen.render();h.screen.action('enter');assert.equal(h.inputs.length,count+1);
  }
  h.screen.action('zoom-in');h.screen.action('scroll-up');assert.match(h.screen.getState().inputStatus,/updated view/);
  h.publish({status:'unavailable',inputStatus:'Input paused. Reconnect the selected app.'});
  assert.match(h.screen.getState().inputStatus,/Reconnect/,'fresh connection state must supersede local feedback');
});

test('switching between Audio help and Reload replaces the visible overlay and its input guidance',()=>{
  const h=screenFixture();h.screen.action('voice');h.screen.render();h.screen.action('reload');h.screen.render();
  assert.equal(h.screen.getState().voiceHelp,false);h.screen.action('enter');assert.match(h.screen.getState().inputStatus,/cancel Reload/);
  h.screen.action('voice');h.screen.render();assert.equal(h.screen.getState().voiceHelp,true);
  h.screen.action('enter');assert.match(h.screen.getState().inputStatus,/Close Audio help/);
  assert.equal(h.inputs.length,0);
});

test('blocked-input guidance survives live frame revisions and is retired by actual connection-state changes',()=>{
  const h=screenFixture();h.screen.render();h.screen.action('voice');h.screen.render();h.screen.action('enter');
  const notice=h.screen.getState().inputStatus;assert.match(notice,/Close Audio help/);
  for(let i=0;i<3;i++){h.publish({status:'live'});h.screen.render();assert.equal(h.screen.getState().inputStatus,notice);}
  assert.ok(h.contexts[0].texts.some(entry=>entry.text===notice));
  h.publish({status:'waiting',inputStatus:'Input paused. Wait for a live picture of your app.'});
  assert.match(h.screen.getState().inputStatus,/live picture/);
  h.publish({status:'live',inputStatus:''});assert.equal(h.screen.getState().inputStatus,'','a retired notice must not return after the picture resumes');
  h.screen.action('enter');assert.match(h.screen.getState().inputStatus,/Close Audio help/);
  h.publish({status:'unavailable',inputStatus:'Input paused. Reconnect the selected app.'});assert.match(h.screen.getState().inputStatus,/Reconnect/);
  h.publish({status:'idle',inputStatus:''});assert.equal(h.screen.getState().inputStatus,'');
  h.publish({status:'live',inputStatus:''});assert.equal(h.screen.getState().inputStatus,'','a new live connection must not resurrect the previous notice');
});

test('painting a pending view retires its notice in the same rendered image and restores forwarding',()=>{
  const h=screenFixture();h.screen.render();h.screen.action('zoom-in');h.screen.action('enter');
  assert.match(h.screen.getState().inputStatus,/updated view/);assert.equal(h.inputs.length,0);
  const painted=h.screen.render();assert.equal(h.screen.getState().inputStatus,'');
  assert.ok(!h.contexts[0].texts.some(entry=>entry.text.includes('updated view')));
  h.publish({status:'live'});const next=h.screen.render();assert.notEqual(next.revision,painted.revision);
  assert.equal(h.screen.getState().inputStatus,'');assert.ok(!h.contexts[0].texts.some(entry=>entry.text.includes('updated view')));
  assert.equal(h.screen.point(.5,.5,true),true);assert.equal(h.inputs.length,1);
});

test('discovery publishes newly opened windows on the existing heartbeat without binding automatically',async()=>{
  let lists=0;
  const h=clientFixture(({path})=>path==='/session'?{token}:path==='/windows'?{windows:++lists===1?[]:[windowOne]}:{});
  await h.client.discover();assert.match(h.client.getState().message,/No open windows/);assert.deepEqual(h.client.getState().windows,[]);
  await h.tick();assert.deepEqual(h.client.getState().windows,[windowOne]);assert.equal(h.client.getState().status,'selecting');
  assert.equal(h.calls.some(call=>call.path==='/bind'),false);assert.equal(h.timers.size,1);
});

test('a missing selection does not stop the discovery heartbeat',async()=>{
  const h=clientFixture(({path})=>path==='/session'?{token}:{windows:[windowOne]});
  await h.client.discover();assert.equal(await h.client.connect(999),false);assert.equal(h.timers.size,1);
  await h.tick();assert.equal(h.calls.filter(call=>call.path==='/windows').length,2);
});

for(const windows of [[],[{...windowOne,pid:99}]])test(`a window ${windows.length?'replaced':'removed'} during a heartbeat cannot be bound from stale selection`,async()=>{
  let lists=0;const pending=deferred();
  const h=clientFixture(({path})=>path==='/session'?{token}:path==='/windows'?(++lists===1?{windows:[windowOne]}:pending.promise):{status:'connected'});
  await h.client.discover();const refresh=h.tick(),connect=h.client.connect(windowOne.id);
  assert.equal(h.calls.some(call=>call.path==='/bind'),false);
  pending.resolve({windows});await refresh;assert.equal(await connect,false);
  assert.equal(h.calls.some(call=>call.path==='/bind'),false);assert.equal(h.client.getState().status,'selecting');
  assert.deepEqual(h.client.getState().windows,windows);assert.equal(h.timers.size,1);
});

test('valid selection survives a title refresh and binds that same identity once',async()=>{
  let lists=0;const pending=deferred(),renamed={...windowOne,title:'ChatGPT fixture updated'};
  const h=clientFixture(({path})=>path==='/session'?{token}:path==='/windows'?(++lists===1?{windows:[windowOne]}:pending.promise):{status:'connected'});
  await h.client.discover();const refresh=h.tick(),connect=h.client.connect(windowOne.id);
  pending.resolve({windows:[renamed]});await refresh;assert.equal(await connect,true);
  assert.deepEqual(h.calls.filter(call=>call.path==='/bind'),[{path:'/bind',body:{id:windowOne.id}}]);
  assert.equal(h.client.getState().title,renamed.title);
});

test('a late discovery response cannot repopulate a disconnected session',async()=>{
  let lists=0;const pending=deferred();
  const h=clientFixture(({path})=>path==='/session'?{token}:path==='/windows'?(++lists===1?{windows:[windowOne]}:pending.promise):{status:'stopped'});
  await h.client.discover();const refresh=h.tick();await h.client.stop();pending.resolve({windows:[windowOne]});await refresh;
  assert.equal(h.client.getState().status,'idle');assert.deepEqual(h.client.getState().windows,[]);assert.equal(h.timers.size,0);
});

test('input feedback retains rejection while live and is superseded by waiting, lost connection and disconnect',async()=>{
  let frameStatus='frame',rejectInput=false,failFrame=false,serial=0;
  const h=clientFixture(({path})=>{
    if(path==='/session')return {token};if(path==='/windows')return {windows:[windowOne]};if(path==='/bind')return {status:'connected'};
    if(path==='/input')return {status:rejectInput?'input-rejected':'input-posted'};
    if(path==='/frame'){if(failFrame)throw new Error('fixture connection loss');return {status:frameStatus,serial:++serial,generation:1,jpeg:'synthetic fixture'};}
    return {status:'stopped'};
  });
  await h.client.discover();await h.client.connect(windowOne.id);await h.tick();
  h.client.input({kind:'text',text:'fixture'});await h.tick();assert.match(h.client.getState().inputStatus,/Input sent/);
  rejectInput=true;h.client.input({kind:'text',text:'fixture'});await h.tick();assert.match(h.client.getState().inputStatus,/not accepted/);
  await h.tick();assert.match(h.client.getState().inputStatus,/not accepted/);
  frameStatus='waiting';await h.tick();assert.match(h.client.getState().inputStatus,/Input paused/);
  frameStatus='frame';await h.tick();assert.equal(h.client.getState().inputStatus,'');
  failFrame=true;await h.tick();assert.match(h.client.getState().inputStatus,/Reconnect/);
  await h.client.stop();assert.equal(h.client.getState().inputStatus,'');
});
