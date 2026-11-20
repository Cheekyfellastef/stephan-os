import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHolodeckCubePhysics,cubeSupport,rotate3,quaternionFromAngular } from '../apps/spatial-bridge/holodeck-cube-physics-v1.mjs';
import { createHolodeckCubeInteraction,cubeTargeted } from '../apps/spatial-bridge/holodeck-cube-interaction-v1.mjs';
import { createHolodeckCubeGeometry } from '../apps/spatial-bridge/holodeck-room-v1.mjs';
import { HOLODECK_TABLE,HOLODECK_CUBE,HOLODECK_OBSTACLES } from '../apps/spatial-bridge/holodeck-layout-v1.mjs';
const close=(a,b,t=0.001)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
function drop(position,linear=[0,0,0],angular=[0,0,0]) {
  const p=createHolodeckCubePhysics();p.grab('setup');p.moveHeld(position);p.release(linear,angular);return p;
}
const run=(p,seconds=8,dt=1/120)=>{for(let t=0;t<seconds;t+=dt)p.advance(dt);return p.getState();};
const hand=(extra={})=>({id:'quest:left:1',kind:'quest',position:[0,1,-2.15],orientation:[0,0,0,1],
  rayOrigin:[0,1,-1.8],forward:[0,-0.2,-0.9797959],grab:false,throw:false,reset:false,reach:0,rotate:0,...extra});

test('cube is 57 mm and has no stale fixed walking obstacle after being moved',()=>{
  const s=createHolodeckCubePhysics().getState();close(s.size,0.057);close(s.position[1]-s.size/2,HOLODECK_TABLE.top+0.008);
  assert.equal(HOLODECK_OBSTACLES.some(o=>o.id==='idea-cube'),false);
  const g=createHolodeckCubeGeometry(s);close(Math.max(...g.solidPositions.filter((_,i)=>i%3===0))-Math.min(...g.solidPositions.filter((_,i)=>i%3===0)),0.057);
});
test('gravity drops the cube onto the table and it settles without sinking',()=>{
  const p=drop([0,1.6,-2.2]);const before=p.getState();p.advance(0.1);assert.ok(p.getState().position[1]<before.position[1]);
  const s=run(p);close(s.position[1]-s.size/2,HOLODECK_TABLE.top+0.008);assert.equal(s.sleeping,true);
  assert.deepEqual(s.velocity,[0,0,0]);const still=run(p,10);assert.deepEqual(still.position,s.position);
});
test('a thrown spinning cube bounces off the wall, falls to the floor and rests flat',()=>{
  const p=drop([2,1.5,0],[0,4,-8],[3,4,2]);let bounced=false;
  for(let i=0;i<1800;i++) {
    const s=p.advance(1/120),radius=cubeSupport([0,0,1],s.orientation);
    assert.ok(s.position[2]>=-6+radius-0.001);assert.ok(s.position[1]>=cubeSupport([0,1,0],s.orientation)-0.001);
    if(s.position[2]<-5&&s.velocity[2]>0)bounced=true;
  }
  assert.equal(bounced,true);const s=p.getState();assert.equal(s.sleeping,true);
  close(s.position[1],s.size/2);
  assert.ok([[1,0,0],[0,1,0],[0,0,1]].some(v=>Math.abs(rotate3(v,s.orientation)[1])>0.999));
});
test('fast motion and low frame rates cannot tunnel through the tabletop, walls or ceiling',()=>{
  for(const dt of [1/120,1/30,0.1]) {
    const p=drop([0,2.6,-2.2],[0,-8,0]);const s=run(p,5,dt);close(s.position[1],HOLODECK_TABLE.top+0.008+s.size/2);
    const ceiling=drop([2,2.8,0],[8,8,8]);
    for(let i=0;i<100;i++){const c=ceiling.advance(dt);for(let axis=0;axis<3;axis++)assert.ok(Number.isFinite(c.position[axis]));
      assert.ok(c.position[0]<5&&c.position[1]<3.2&&c.position[2]<3);}
  }
});
test('held cube is constrained by the same room and furniture surfaces',()=>{
  const p=createHolodeckCubePhysics();p.grab('hand');p.moveHeld([0,-2,-2.2]);
  assert.ok(p.getState().position[1]>=HOLODECK_TABLE.top+0.008+0.0285-0.001);
  p.moveHeld([2,1.5,0]);p.moveHeld([20,1.5,0]);close(p.getState().position[0],5-0.0285);
  p.moveHeld([20,1.5,0],quaternionFromAngular([0,1,0],0.8));assert.ok(p.getState().position[0]+cubeSupport([1,0,0],p.getState().orientation)<=5.001);
});
test('frame-rate variations produce the same free-fall result and invalid time is bounded',()=>{
  const a=drop([2,2,0]),b=drop([2,2,0]);for(let i=0;i<12;i++)a.advance(1/120);for(let i=0;i<3;i++)b.advance(1/30);
  close(a.getState().position[1],b.getState().position[1]);
  const before=a.getState();a.advance(NaN);a.advance(-1);assert.deepEqual(a.getState(),before);
  a.advance(10);assert.ok(a.getState().position[1]>1);
});
test('Quest grip needs a fresh press, follows the hand and throws with measured release velocity',()=>{
  const c=createHolodeckCubeInteraction();let t=0;
  c.update({time:t,hands:[hand({grab:true})]});assert.equal(c.getState().heldBy,null);
  c.update({time:t+=20,hands:[hand()]});c.update({time:t+=20,hands:[hand({grab:true})]});assert.ok(c.getState().heldBy);
  for(let i=0;i<12;i++)c.update({time:t+=20,hands:[hand({grab:true,position:[i*0.025,1.15,-2.15]})]});
  c.update({time:t+=20,hands:[hand({position:[0.30,1.15,-2.15]})]});
  assert.equal(c.getState().heldBy,null);assert.ok(c.getState().velocity[0]>0.5);
});
test('tracking loss, hidden sessions, disconnects and long gaps drop safely without stale throw velocity',()=>{
  for(const stop of [{hands:[]},{visible:false},{time:1000}]) {
    const c=createHolodeckCubeInteraction();c.update({time:0,hands:[hand()]});c.update({time:20,hands:[hand({grab:true})]});
    assert.ok(c.getState().heldBy);c.update({time:40,hands:[hand({grab:true})],...stop});assert.equal(c.getState().heldBy,null);
    close(c.getState().velocity[0],0);close(c.getState().velocity[2],0);
    c.update({time:1020,hands:[hand({grab:true})]});assert.equal(c.getState().heldBy,null);
  }
});
test('distant pickup does not manufacture a throw from the pull towards the hand',()=>{
  const c=createHolodeckCubeInteraction();
  const distant=hand({position:[0,1.6,-0.3],rayOrigin:[0,1.6,-0.3],forward:[0,-0.338,-0.941]});
  c.update({time:0,hands:[distant]});c.update({time:20,hands:[{...distant,grab:true}]});
  assert.ok(c.getState().heldBy);c.update({time:40,hands:[distant]});
  assert.equal(c.getState().heldBy,null);close(c.getState().velocity[2],0);
});
test('Xbox bumper already held at pickup does not convert a later trigger release into a throw',()=>{
  const c=createHolodeckCubeInteraction();
  const xbox=hand({id:'xbox:0',kind:'xbox',position:[0,1.1,-1.7],rayOrigin:[0,1.1,-1.7],forward:[0,-0.344,-0.939],throw:true});
  c.update({time:0,hands:[xbox]});c.update({time:20,hands:[{...xbox,grab:true}]});
  assert.ok(c.getState().heldBy);c.update({time:40,hands:[xbox]});close(c.getState().velocity[2],0);
});
test('Xbox trigger carries, release drops, bumper throws, D-pad adjusts reach, and X resets',()=>{
  const c=createHolodeckCubeInteraction();let t=0;
  const xbox=hand({id:'xbox:0',kind:'xbox',position:[0,1.1,-1.7],rayOrigin:[0,1.1,-1.7],forward:[0,-0.344,-0.939]});
  c.update({time:t,hands:[xbox]});c.update({time:t+=20,hands:[{...xbox,grab:true}]});assert.ok(c.getState().heldBy);
  for(let i=0;i<20;i++) c.update({time:t+=20,hands:[{...xbox,grab:true,reach:1}]});
  const carried=c.getState().position;
  c.update({time:t+=20,hands:[{...xbox,grab:true,throw:true}]});assert.equal(c.getState().heldBy,null);assert.ok(c.getState().velocity[2]<-2);
  c.update({time:t+=20,hands:[{...xbox,reset:true}]});close(c.getState().position[0],0);close(c.getState().position[2],-2.2);
  assert.ok(carried.every(Number.isFinite));
});
test('interaction cannot grab a distant cube or select through the tabletop',()=>{
  const cube=createHolodeckCubePhysics().getState();assert.equal(cubeTargeted(hand({kind:'xbox',rayOrigin:[0,1,5]}),cube),false);
  assert.equal(cubeTargeted(hand({kind:'xbox',rayOrigin:[0,0.5,-2.2],forward:[0,1,0]}),cube),false);
  assert.equal(cubeTargeted(hand({position:[2,0.07,0],rayOrigin:[2,0.07,0],forward:[0,0,1]}),
    {...cube,position:[2,0.0286,0]}),true);
});
test('Quest and Xbox hardware adapters use grip poses and button mappings without consuming locomotion sticks',()=>{
  const grip={},ray={},source={handedness:'left',targetRayMode:'tracked-pointer',gripSpace:grip,targetRaySpace:ray,
    gamepad:{mapping:'xr-standard',buttons:[{}, {pressed:false}]}};
  const tracked={transform:{position:{x:0,y:1,z:-2.15},orientation:{x:0,y:0,z:0,w:1}}};
  const c=createHolodeckCubeInteraction();const frame={session:{inputSources:[source]},getPose:()=>tracked};
  c.update({time:0,pose:tracked,frame});source.gamepad.buttons[1].pressed=true;
  c.update({time:20,pose:tracked,frame});assert.match(c.getState().heldBy,/quest:left/);
  const xbox=createHolodeckCubeInteraction();const pad={index:0,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false}))};
  const looking={transform:{position:{x:0,y:0.9166,z:-1.8},orientation:{x:0,y:0,z:0,w:1}}};
  xbox.update({time:0,pose:looking,gamepads:[pad]});pad.buttons[7].pressed=true;
  xbox.update({time:20,pose:looking,gamepads:[pad]});assert.match(xbox.getState().heldBy,/xbox/);
});
test('offline assets include physics and interaction, and the page explains both controller schemes',()=>{
  const sw=readFileSync(new URL('../apps/spatial-bridge/service-worker.js',import.meta.url),'utf8');
  for(const name of ['holodeck-cube-physics-v1.mjs','holodeck-cube-interaction-v1.mjs'])assert.ok(sw.includes(name));
  const entry=readFileSync(new URL('../apps/spatial-bridge/quest-entry.html',import.meta.url),'utf8');
  assert.match(entry,/hold grip/);assert.match(entry,/hold RT/);assert.match(entry,/press RB/);
});
