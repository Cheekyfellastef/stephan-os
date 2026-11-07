import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createHolodeckComfortStore,
  HOLODECK_COMFORT_LIMITS,
} from '../apps/spatial-bridge/holodeck-comfort-v1.mjs';
import { SCREEN_BUTTONS } from '../apps/spatial-bridge/holodeck-screen-v1.mjs';
import {
  consoleHit,
  comfortKnobHit,
  comfortKnobAngle,
  createHolodeckScreenInput,
} from '../apps/spatial-bridge/holodeck-screen-input-v1.mjs';
import { HOLODECK_CONSOLE } from '../apps/spatial-bridge/holodeck-layout-v1.mjs';
import { normalize3, normalizeQuaternion } from '../apps/spatial-bridge/holodeck-cube-physics-v1.mjs';
import { trackedPose } from '../apps/spatial-bridge/holodeck-cube-interaction-v1.mjs';

const close=(a,b,tolerance=0.75)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
function memoryStorage(initial={}) {
  const values=new Map(Object.entries(initial));
  return {
    getItem:key=>values.has(key)?values.get(key):null,
    setItem:(key,value)=>values.set(key,String(value)),
    dump:()=>Object.fromEntries(values),
  };
}
function directionTo(origin,target){return normalize3(target.map((value,index)=>value-origin[index]));}
function poseFor(origin,direction){
  const q=normalizeQuaternion([direction[1],-direction[0],0,1-direction[2]]);
  return {transform:{position:{x:origin[0],y:origin[1],z:origin[2]},
    orientation:{x:q[0],y:q[1],z:q[2],w:q[3]}}};
}

test('Seated and Standing persist independent height and keyboard settings',()=>{
  const storage=memoryStorage();
  const comfort=createHolodeckComfortStore({storage});
  assert.equal(comfort.getState().activeProfile,'seated');
  comfort.setHeightOffset(0.35);
  comfort.setKeyboardAngle(37);
  comfort.setActiveProfile('standing');
  assert.deepEqual(comfort.getState().active,{heightOffset:0,keyboardAngle:0});
  comfort.setHeightOffset(-0.1);
  comfort.setKeyboardAngle(72);
  comfort.setActiveProfile('seated');
  assert.deepEqual(comfort.getState().active,{heightOffset:0.35,keyboardAngle:37});

  const restored=createHolodeckComfortStore({storage});
  assert.equal(restored.getState().activeProfile,'seated');
  assert.deepEqual(restored.getState().profiles.seated,{heightOffset:0.35,keyboardAngle:37});
  assert.deepEqual(restored.getState().profiles.standing,{heightOffset:-0.1,keyboardAngle:72});

  restored.setHeightOffset(99);
  restored.setKeyboardAngle(999);
  assert.equal(restored.getState().active.heightOffset,HOLODECK_COMFORT_LIMITS.heightOffsetMax);
  assert.equal(restored.getState().active.keyboardAngle,HOLODECK_COMFORT_LIMITS.keyboardAngleMax);
});

test('keyboard keys remain ray-selectable from flat through vertical',()=>{
  const button=SCREEN_BUTTONS.find(entry=>entry.id==='fit'),c=HOLODECK_CONSOLE;
  const depth=(button.y+button.h/2)*(2*c.halfDepth-0.12);
  const x=-c.halfWidth+0.1+(button.x+button.w/2)*(2*c.halfWidth-0.2);
  const origin=[0,1.7,-4.0],hingeY=c.top+0.002,hingeZ=c.center[2]-c.halfDepth+0.06;
  for(const angle of [0,17,45,73,90]){
    const radians=angle*Math.PI/180;
    const point=[x,hingeY+Math.sin(radians)*depth,hingeZ+Math.cos(radians)*depth];
    const hit=consoleHit(origin,directionTo(origin,point),angle);
    assert.equal(hit?.id,'fit',`angle ${angle}`);
  }
});

test('both large side dials expose the same continuous 0 to 90 degree control',()=>{
  const c=HOLODECK_CONSOLE,origin=[0,1.65,-4.0],hingeY=c.top+0.002,hingeZ=c.center[2]-c.halfDepth+0.06;
  for(const side of [-1,1])for(const angle of [0,15,45,75,90]){
    const radians=angle*Math.PI/180,center=[side*(c.halfWidth+0.18),hingeY+0.10,hingeZ];
    const point=[center[0],center[1]+Math.sin(radians)*0.18,center[2]+Math.cos(radians)*0.18];
    const direction=directionTo(origin,point),hit=comfortKnobHit(origin,direction);
    assert.equal(hit?.side,side);
    close(comfortKnobAngle(origin,direction,side),angle);
  }
});

test('holding a dial and moving the ray updates keyboard angle until release',()=>{
  const storage=memoryStorage(),comfort=createHolodeckComfortStore({storage});
  const screen={point:()=>false,action:()=>{},hover:()=>{}};
  const controls=createHolodeckScreenInput({screen,comfort});
  const c=HOLODECK_CONSOLE,origin=[0,1.65,-4],center=[-(c.halfWidth+0.18),c.top+0.102,c.center[2]-c.halfDepth+0.06];
  const pad={index:0,id:'dial-test',mapping:'xr-standard',connected:true,axes:[0,0,0,0],buttons:[{pressed:false}]};
  const source={targetRayMode:'tracked-pointer',targetRaySpace:{},gamepad:pad};
  let angle=20;
  const rayPose=()=>{
    const r=angle*Math.PI/180,point=[center[0],center[1]+Math.sin(r)*0.18,center[2]+Math.cos(r)*0.18];
    return poseFor(origin,directionTo(origin,point));
  };
  const frame={session:{inputSources:[source]},getPose:()=>rayPose()};
  const sample=()=>({frame,referenceSpace:{},pose:rayPose(),navigation:{x:0,y:0,z:0,yaw:0},gamepads:[],visible:true});
  controls.update(sample());
  pad.buttons[0].pressed=true;controls.update(sample());
  close(comfort.getState().active.keyboardAngle,20);
  angle=68;controls.update(sample());
  close(comfort.getState().active.keyboardAngle,68);
  pad.buttons[0].pressed=false;controls.update(sample());
  angle=35;controls.update(sample());
  close(comfort.getState().active.keyboardAngle,68);
});

test('comfort height translates tracked head and controller rays together',()=>{
  const raw={transform:{position:{x:0.2,y:1.1,z:-0.3},orientation:{x:0,y:0,z:0,w:1}}};
  const shifted=trackedPose(raw,{x:0.4,y:0.35,z:-0.2,yaw:0});
  close(shifted.position[0],0.6,1e-9);close(shifted.position[1],1.45,1e-9);close(shifted.position[2],-0.5,1e-9);
});

test('offline Spatial shell contains the comfort module and launcher exposes both profiles',()=>{
  const worker=readFileSync(new URL('../apps/spatial-bridge/service-worker.js',import.meta.url),'utf8');
  const entry=readFileSync(new URL('../apps/spatial-bridge/quest-entry.html',import.meta.url),'utf8');
  assert.match(worker,/'\.\/holodeck-comfort-v1\.mjs'/);
  assert.match(entry,/Comfort profiles/);
  assert.match(entry,/comfort-seated/);
  assert.match(entry,/comfort-standing/);
});
