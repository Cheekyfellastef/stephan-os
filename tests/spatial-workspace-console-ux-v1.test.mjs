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

test('zoomed composer stays clickable; Scroll arrows use visible viewport centre and Fit resets view',()=>{
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
  h.screen.action('scroll-down');assert.deepEqual(h.inputs.at(-1),{kind:'scroll',x:.75,y:.75,delta:-120},
    'Scroll arrow must not target the recently clicked composer');
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
    // Restore the original modifier before testing ordinary Enter. Shift+Enter
    // intentionally fails closed because the native helper cannot express it.
    h.screen.action('shift');assert.equal(h.screen.getState().shift,shift);
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


test('a refreshed native frame cannot receive input until its actual picture has been painted',()=>{
  const inputs=[],contexts=[];
  let frame={naturalWidth:1920,naturalHeight:1080};
  const state={status:'live',revision:1,message:'Synthetic only',inputStatus:''};
  const documentRef={createElement(){
    const context={pictures:[],clearRect(){},fillRect(){},strokeRect(){},fillText(){},
      drawImage(...args){this.pictures.push(args);}};
    contexts.push(context);return {getContext:()=>context};
  }};
  const screen=createHolodeckScreen({documentRef,client:{getState:()=>state,getFrame:()=>frame,
    input:value=>{inputs.push(value);return true;}}});
  screen.render();
  assert.equal(screen.point(.5,.5,true),true);
  assert.equal(inputs.length,1);
  const before=contexts[0].pictures.length;
  frame={naturalWidth:1080,naturalHeight:1920};
  assert.equal(screen.getState().keyboardEnabled,false,'the new picture has not been painted');
  assert.equal(screen.point(.5,.5,true),false,'pointer cannot target the newer unpainted image');
  screen.action('scroll-down');screen.action('enter');screen.action('key:a');
  assert.equal(inputs.length,1,'scroll, Enter and text must all wait for the painted frame');
  assert.match(screen.getState().inputStatus,/updated view/);
  screen.render();
  assert.equal(contexts[0].pictures.length,before+1,'a new frame repaints even without a status revision');
  assert.equal(contexts[0].pictures.at(-1)[0],frame);
  assert.equal(screen.getState().keyboardEnabled,true);
  screen.action('scroll-down');
  assert.equal(inputs.at(-1).kind,'scroll');
});

test('a failed native-frame draw keeps input fenced until the same new frame is repainted',()=>{
  const h=screenFixture();h.screen.render();
  const before=h.inputs.length;
  h.frame.naturalWidth=1080;h.frame.naturalHeight=1920;
  h.screen.action('zoom-in');
  const draw=h.contexts[0].drawImage;
  h.contexts[0].drawImage=()=>{throw Error('transient canvas failure');};
  assert.throws(()=>h.screen.render(),/transient canvas failure/);
  h.screen.action('enter');assert.equal(h.inputs.length,before);
  h.contexts[0].drawImage=draw;
  h.screen.render();
  h.screen.action('scroll-up');assert.equal(h.inputs.at(-1).kind,'scroll');
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
  h.client.input({kind:'click',x:.5,y:.5});await h.tick();assert.match(h.client.getState().inputStatus,/Windows queued.*not confirmed/);
  assert.equal(h.calls.filter(call=>call.path==='/input').at(-1).body.serial,1,
    'native click must use the precise serial of the last accepted holographic image');
  rejectInput=true;h.client.input({kind:'click',x:.5,y:.5});await h.tick();assert.match(h.client.getState().inputStatus,/did not confirm that input/);
  await h.tick();assert.match(h.client.getState().inputStatus,/did not confirm that input/);
  frameStatus='waiting';await h.tick();assert.match(h.client.getState().inputStatus,/Input paused/);
  frameStatus='frame';await h.tick();assert.equal(h.client.getState().inputStatus,'');
  failFrame=true;await h.tick();assert.match(h.client.getState().inputStatus,/Reconnect/);
  await h.client.stop();assert.equal(h.client.getState().inputStatus,'');
});


test('consented native editor replies are shown as editor readback, not ChatGPT message acceptance',async()=>{
  let reply='editor-accessibility-selected',serial=0;
  const h=clientFixture(({path,body})=>{
    if(path==='/session')return {token};
    if(path==='/windows')return {windows:[windowOne]};
    if(path==='/bind')return {status:'connected'};
    if(path==='/input')return {status:body.kind==='click'&&body.x===.25?'editor-accessibility-selected':reply};
    if(path==='/frame')return {status:'frame',serial:++serial,generation:1,jpeg:'synthetic fixture'};
    return {status:'stopped'};
  });
  await h.client.discover();
  await h.client.connect(windowOne.id);
  await h.tick();
  const cases=[
    [{kind:'click',x:.5,y:.5},'editor-accessibility-selected',/Editable field located/],
    [{kind:'text',text:'x'},'editor-value-readback',/read back.*Confirm the actual app/],
    [{kind:'key',key:'Backspace'},'editor-value-unchanged',/already empty/],
    [{kind:'text',text:'x'},'editor-not-selected',/Click the app composer/],
    [{kind:'text',text:'x'},'editor-reselect-required',/editor changed/],
    [{kind:'text',text:'x'},'editor-unsupported',/does not expose a writable editor/],
    [{kind:'text',text:'x'},'editor-update-refused',/Inspect the draft before retrying/],
    [{kind:'text',text:'x'},'editor-update-not-started',/No editor value update was attempted/],
    [{kind:'text',text:'x'},'editor-update-unverified',/did not confirm.*do not retry/],
    [{kind:'click',x:.5,y:.5},'app-control-invoked',/selected app control was invoked/],
    [{kind:'click',x:.5,y:.5},'app-control-outcome-unverified',/no second click was sent/],
    // A button click is not an editor selection: reselect the composer before Enter is admitted.
    [{kind:'click',x:.5,y:.5},'editor-accessibility-selected',/Editable field located/],
    [{kind:'key',key:'Enter'},'editor-key-focus-unverified',/explicit button rather than Enter/],
    [{kind:'click',x:.5,y:.5},'input-posted',/Windows queued.*not confirmed/],
  ];
  for(const [input,status,re] of cases){
    // An uncertain helper outcome revokes editor consent. Re-select the
    // synthetic original-app composer before each text-status probe.
    if(input.kind==='text'){
      reply='editor-accessibility-selected';
      assert.equal(h.client.input({kind:'click',x:.25,y:.25}),true);
      await h.tick();
    }
    reply=status;assert.equal(h.client.input(input),true);
    await h.tick();assert.match(h.client.getState().inputStatus,re);
    assert.equal(h.client.getState().status,'live');
  }
  const calls=h.calls.filter(call=>call.path==='/input');
  const expectedCount=cases.length+cases.filter(([input])=>input.kind==='text').length;
  assert.equal(calls.length,expectedCount);
  assert.deepEqual(calls.map(call=>call.body.sequence),Array.from({length:expectedCount},(_,i)=>i+1));
  await h.client.stop();
  assert.equal(h.client.getState().inputStatus,'','disconnect must not leave a stale editor-success label');
});

test('virtual Shift+Enter never forwards a bare Enter or impersonates explicit Send',()=>{
  const h=screenFixture();h.screen.render();
  const enter=SCREEN_BUTTONS.find(button=>button.id==='enter');
  assert.equal(screenButtonLabel(enter,false),'Enter (app)');
  assert.match(h.screen.getState().keyboardNotice,/Enter follows app behaviour and may send/);
  h.screen.action('shift');
  assert.equal(h.screen.action('enter'),false,'unsupported newline must be refused locally');
  assert.equal(h.inputs.length,0,'no native Enter was forwarded for Shift+Enter');
  assert.match(h.screen.getState().inputStatus,/Shift\+Enter is not supported.*No key was sent/);
  h.screen.action('shift');
  h.screen.action('enter');
  assert.deepEqual(h.inputs,[{kind:'key',key:'Enter'}],'ordinary Enter remains app-defined, never an explicit Send guarantee');
});

test('Spatial Voice and Disconnect guidance keeps ChatGPT audio control in the original app',()=>{
  const h=screenFixture();h.screen.render();
  const texts=h.contexts[0].texts.map(entry=>entry.text);
  assert.ok(texts.some(text=>text.includes('ChatGPT Voice runs in the original app')),
    'right-side audio tools must not pretend to control ChatGPT Voice');
  assert.ok(texts.some(text=>text.includes('Disconnect does not mute or end Voice')),
    'window disconnect does not stop or mute ChatGPT Voice');
  h.screen.action('voice');h.screen.render();
  const guide=h.contexts[0].texts.map(entry=>entry.text);
  assert.ok(guide.some(text=>text.includes('Mute or end Voice in the original ChatGPT app')));
  assert.ok(guide.some(text=>text.includes('Disconnect stops the window picture and input')));
  assert.equal(h.inputs.length,0,'opening guidance never sends an app action');
});

test('an uncertain native editor update discards queued Enter instead of repeating or submitting a draft',async()=>{
  let serial=0;
  const delivered=[];
  const h=clientFixture(({path,body})=>{
    if(path==='/session')return {token};
    if(path==='/windows')return {windows:[windowOne]};
    if(path==='/bind')return {status:'connected'};
    if(path==='/frame')return {status:'frame',serial:++serial,generation:1,jpeg:'synthetic fixture'};
    if(path==='/input'){
      delivered.push(body);
      return {status:body.kind==='click'?'editor-accessibility-selected':'editor-update-unverified'};
    }
    return {status:'stopped'};
  });
  await h.client.discover();await h.client.connect(windowOne.id);await h.tick();
  assert.equal(h.client.input({kind:'click',x:.5,y:.5}),true);await h.tick();
  assert.equal(h.client.input({kind:'text',text:'unsent draft'}),true);
  assert.equal(h.client.input({kind:'key',key:'Enter'}),true,'operator may queue Enter while the text result is unknown');
  await h.tick();
  assert.match(h.client.getState().inputStatus,/did not confirm.*do not retry/);
  assert.deepEqual(delivered.map(item=>item.kind),['click','text'],'the queued Enter must never reach native input');
  assert.equal(h.client.input({kind:'key',key:'Enter'}),false,'editor consent must be revoked after uncertain mutation');
  assert.equal(h.client.input({kind:'text',text:'duplicate'}),false,'repeated characters require a fresh explicit editor selection');
  assert.deepEqual(delivered.map(item=>item.sequence),[1,2]);
  await h.client.stop();
});

test('a lost native reply cannot replay a potentially applied draft or a pending Send',async()=>{
  let serial=0;
  const delivered=[];
  const h=clientFixture(({path,body})=>{
    if(path==='/session')return {token};
    if(path==='/windows')return {windows:[windowOne]};
    if(path==='/bind')return {status:'connected'};
    if(path==='/frame')return {status:'frame',serial:++serial,generation:1,jpeg:'synthetic fixture'};
    if(path==='/input'){
      delivered.push(body);
      if(body.kind==='text')throw new Error('synthetic lost reply after possible app-side mutation');
      return {status:'editor-accessibility-selected'};
    }
    return {status:'stopped'};
  });
  await h.client.discover();await h.client.connect(windowOne.id);await h.tick();
  assert.equal(h.client.input({kind:'click',x:.5,y:.5}),true);await h.tick();
  assert.equal(h.client.input({kind:'text',text:'possibly applied'}),true);
  assert.equal(h.client.input({kind:'key',key:'Enter'}),true);
  await h.tick();
  assert.equal(h.client.getState().status,'unavailable');
  assert.match(h.client.getState().inputStatus,/may already have changed.*do not resend automatically/);
  assert.deepEqual(delivered.map(item=>item.kind),['click','text'],'uncertain request must not auto-deliver queued Enter');
  assert.equal(h.client.input({kind:'key',key:'Enter'}),false);
  assert.equal(h.client.input({kind:'text',text:'retry'}),false);
  assert.deepEqual(delivered.map(item=>item.sequence),[1,2]);
  await h.client.stop();
});

test('native helper probe requires affirmative interactive identity before advertising readiness',async()=>{
  const buildId='a'.repeat(64);
  const schema='stephanos.spatial-window-health.v1';
  const samples=[
    ['actual installed interactive helper',{schema,buildId,readinessOnly:false},true],
    ['readiness-only helper',{schema,buildId,readinessOnly:true},false],
    ['missing interaction claim',{schema,buildId},false],
    ['string interaction claim',{schema,buildId,readinessOnly:'false'},false],
    ['null interaction claim',{schema,buildId,readinessOnly:null},false],
    ['unverified installed build',{schema,buildId:'invalid',readinessOnly:false},false],
    ['wrong helper schema',{schema:'unexpected',buildId,readinessOnly:false},false],
  ];
  for(const [name,payload,ready] of samples){
    let count=0;
    const client=createHolodeckWindowClient({locationRef:{port:'4173'},sessionStore:null,
      fetchRef:async(url,request)=>{
        count++;assert.equal(new URL(url).pathname,'/health');
        assert.equal(request.method,'GET');
        return {ok:true,status:200,json:async()=>payload};
      }});
    const result=await client.probeHelper();
    assert.equal(result.ok,ready,name);
    assert.equal(count,1,name);
    assert.equal(client.getState().status,'idle',name+' must not claim a bound native session');
  }
});

test('a denied native stop remains a local reconnect fence without sessionStorage',async()=>{
  let permitStop=false;
  const h=clientFixture(({path})=>{
    if(path==='/session')return {token};
    if(path==='/windows')return {windows:[windowOne]};
    if(path==='/stop'){
      if(!permitStop)throw Error('Native capture stop refused (403)');
      return {status:'stopped'};
    }
    throw Error('Unexpected native request '+path);
  });
  await h.client.discover();
  assert.equal(h.calls.filter(call=>call.path==='/session').length,1);
  assert.equal(await h.client.stop(),false,'refused native stop is not an acknowledged release');
  assert.match(h.client.getState().message,/did not confirm capture release/);
  assert.equal(await h.client.discover(),false,'no sessionStorage must not erase an unverified native session');
  assert.equal(h.calls.filter(call=>call.path==='/session').length,1,'no second session before verified stop');
  permitStop=true;
  await h.client.discover();
  assert.equal(h.calls.filter(call=>call.path==='/session').length,2,'retry can reconnect after actual stop acknowledgment');
  assert.equal(h.client.getState().status,'selecting');
  await h.client.stop();
});


test('HTTP success without a stopped receipt cannot release the native session or admit another',async()=>{
  let releaseStatus='still-active';
  const h=clientFixture(({path})=>{
    if(path==='/session')return {token};
    if(path==='/windows')return {windows:[windowOne]};
    if(path==='/stop')return {status:releaseStatus};
    throw Error('Unexpected native request '+path);
  });
  assert.equal(await h.client.discover(),true);
  assert.equal(await h.client.stop(),false,'HTTP 200 with a different status is not a verified native release');
  assert.match(h.client.getState().message,/did not confirm capture release/);
  assert.equal(await h.client.discover(),false,'no replacement session while the previous native capture may exist');
  assert.equal(h.calls.filter(call=>call.path==='/session').length,1);
  releaseStatus='stopped';
  assert.equal(await h.client.discover(),true,'only the fixed terminal receipt admits a new session');
  assert.equal(h.calls.filter(call=>call.path==='/session').length,2);
  assert.equal(await h.client.stop(),true);
});
