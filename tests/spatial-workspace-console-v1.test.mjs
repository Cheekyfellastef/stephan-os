import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {createSpatialWindowHost} from '../scripts/spatial-window-host.mjs';
import {validateSpatialSurfaceInput as valid} from '../shared/vr/spatialDesktopSurfaceContractV1.mjs';
import {screenPointToSource,SCREEN_CONTENT,SCREEN_BUTTONS} from '../apps/spatial-bridge/holodeck-screen-v1.mjs';
import {createHolodeckScreenInput,consoleHit,displayHit} from '../apps/spatial-bridge/holodeck-screen-input-v1.mjs';
import {HOLODECK_CONSOLE,HOLODECK_CUBES} from '../apps/spatial-bridge/holodeck-layout-v1.mjs';
import {createHolodeckCubePhysics,normalizeQuaternion,normalize3} from '../apps/spatial-bridge/holodeck-cube-physics-v1.mjs';
import {resolveHolodeckMovement} from '../apps/spatial-bridge/holodeck-collision-v1.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<0.002,`${a} != ${b}`);

test('surface input is bounded operator input, rejecting commands, control bytes and unexpected fields',()=>{
  const base={sequence:1,generation:1};
  for(const input of [{kind:'click',x:0,y:1},{kind:'scroll',x:.5,y:.5,delta:-120},{kind:'text',text:'Edit the room'},{kind:'key',key:'Enter'}])assert.equal(valid({...base,...input}),true);
  for(const input of [{kind:'execute',command:'anything'},{kind:'text',text:'x\n'},{kind:'text',text:'a'.repeat(257)},
    {kind:'key',key:'Alt+F4'},{kind:'click',x:NaN,y:0},{kind:'click',x:1.1,y:0},{kind:'scroll',x:0,y:0,delta:999},
    {kind:'text',text:'x',windowId:44}])assert.equal(valid({...base,...input}),false);
  assert.equal(valid({kind:'text',text:'x',generation:1,sequence:0}),false);
});

test('display hit coordinates preserve source aspect and reject letterbox areas at any zoom',()=>{
  for(const [w,h] of [[1920,1080],[1080,1920],[3440,1440]])for(const zoom of [1,2,4]){
    const point=screenPointToSource(.5,(SCREEN_CONTENT.y+SCREEN_CONTENT.h/2)/SCREEN_CONTENT.height,w,h,zoom);
    close(point.x,.5);close(point.y,.5);
    assert.equal(screenPointToSource(0,0,w,h,zoom),null);
  }
  assert.equal(displayHit([0,1.7,0],[0,0,1]),null);
  assert.ok(displayHit([0,1.7,0],[0,0,-1]));
});

test('Quest trigger and Xbox A require a new press, do not repeat and rearm after tracking loss',()=>{
  const button=SCREEN_BUTTONS[0],c=HOLODECK_CONSOLE;
  const point=[-c.halfWidth+.1+(button.x+button.w/2)*(2*c.halfWidth-.2),c.top+.002,
    c.center[2]-c.halfDepth+.06+(button.y+button.h/2)*(2*c.halfDepth-.12)];
  const origin=[0,1.7,-4],direction=normalize3(point.map((v,i)=>v-origin[i]));
  assert.equal(consoleHit(origin,direction).id,'fit');
  const q=normalizeQuaternion([direction[1],-direction[0],0,1-direction[2]]);
  const pose={transform:{position:{x:origin[0],y:origin[1],z:origin[2]},orientation:{x:q[0],y:q[1],z:q[2],w:q[3]}}};
  for(const kind of ['quest','xbox']){
    const actions=[],screen={action:id=>actions.push(id),hover:()=>{},point:()=>false};
    const controls=createHolodeckScreenInput({screen}),pad={index:1,id:'test',mapping:kind==='quest'?'xr-standard':'standard',connected:true,axes:[0,0,0,0],buttons:[{pressed:true}]};
    const source={targetRayMode:'tracked-pointer',targetRaySpace:{},gamepad:pad};
    const sample={pose,navigation:{x:0,z:0,yaw:0},gamepads:kind==='xbox'?[pad]:[],frame:{session:{inputSources:kind==='quest'?[source]:[]},getPose:()=>pose}};
    controls.update(sample);assert.equal(actions.length,0);
    pad.buttons[0].pressed=false;controls.update(sample);pad.buttons[0].pressed=true;controls.update(sample);controls.update(sample);assert.deepEqual(actions,['fit']);
    controls.update({...sample,visible:false});controls.update(sample);assert.equal(actions.length,1);
    pad.buttons[0].pressed=false;controls.update(sample);pad.buttons[0].pressed=true;controls.update(sample);assert.equal(actions.length,2);
  }
});

test('new console stops walking and supports both cube sizes using the visible layout',()=>{
  const c=HOLODECK_CONSOLE,move=resolveHolodeckMovement({x:0,z:-4},{x:0,z:-2});
  close(-4+move.z,c.center[2]+c.halfDepth+.28);
  for(const cube of HOLODECK_CUBES){
    const body=createHolodeckCubePhysics({cube});body.grab('test');body.moveHeld([0,1.8,c.center[2]]);body.release();
    for(let n=0;n<600;n++)body.advance(1/120);
    close(body.getState().position[1],c.top+cube.size/2);assert.equal(body.getState().sleeping,true);
  }
});

test('local desktop host rejects other origins, forged windows, replay and expired sessions',async()=>{
  let time=1000,stops=0;const calls=[];
  const native={stop(){stops++;},async request(value){calls.push(value);return value.op==='list'?{status:'windows',windows:[{id:44,pid:55,title:'Disposable test'}]}:
    value.op==='bind'?{status:'connected'}:{status:'input-posted'};}};
  const server=createSpatialWindowHost({native,now:()=>time});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const send=(path,body={},token,origin='http://127.0.0.1:4173')=>new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:server.address().port,path,method:'POST',headers:{Host:'127.0.0.1:4180',Origin:origin,'Content-Type':'application/json',...(token?{'X-Spatial-Session':token}:{})}},res=>{
      let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({code:res.statusCode,body:JSON.parse(data)}));
    });req.on('error',reject);req.end(JSON.stringify(body));
  });
  try{
    assert.equal((await send('/session',{},null,'https://example.org')).code,403);assert.equal(calls.length,0);
    const {body:{token}}=await send('/session');assert.match(token,/^[a-f0-9]{64}$/);
    assert.equal((await send('/windows',{},'x'.repeat(64))).code,403);
    assert.equal((await send('/bind',{id:44},token)).code,400);
    await send('/windows',{},token);
    assert.equal((await send('/bind',{id:45},token)).code,400);
    assert.equal((await send('/bind',{id:44},token)).body.status,'connected');
    const input={kind:'text',text:'test',sequence:1,generation:1};
    assert.equal((await send('/input',input,token)).body.status,'input-posted');
    assert.equal((await send('/input',input,token)).code,400);
    assert.equal(calls.filter(c=>c.op==='input').length,1);
    time+=90001;assert.equal((await send('/frame',{},token)).code,403);
    await send('/session');assert.ok(stops>=2);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
