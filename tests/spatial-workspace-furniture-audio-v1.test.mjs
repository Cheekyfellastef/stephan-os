import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HOLODECK_CONSOLE, HOLODECK_TABLE } from '../apps/spatial-bridge/holodeck-layout-v1.mjs';
import { createHolodeckRoomGeometry } from '../apps/spatial-bridge/holodeck-room-v1.mjs';
import { createCubeSolids } from '../apps/spatial-bridge/holodeck-cube-physics-v1.mjs';
import { createHolodeckComfortSolids } from '../apps/spatial-bridge/holodeck-comfort-v1.mjs';
import { consoleHit } from '../apps/spatial-bridge/holodeck-screen-input-v1.mjs';
import { SCREEN_KEYS } from '../apps/spatial-bridge/holodeck-screen-v1.mjs';
import { KEYCAP_RISE_METRES } from '../apps/spatial-bridge/holodeck-keycaps-v1.mjs';
import { createHolodeckCubeScene } from '../apps/spatial-bridge/holodeck-cube-scene-v1.mjs';
import {
  createHolodeckFurniture, createHolodeckFurnitureInteraction, FURNITURE_MATERIALS,
  SPATIAL_FURNITURE_STORAGE_KEY, furnitureFollow, furnitureGrabTarget,
} from '../apps/spatial-bridge/holodeck-furniture-v1.mjs';
import { createHolodeckAudioControls } from '../apps/spatial-bridge/holodeck-audio-v1.mjs';

const close = (actual, expected, tolerance=1e-5) =>
  assert.ok(Math.abs(actual-expected) < tolerance, `${actual} ≠ ${expected}`);
const vec = (actual,expected)=>actual.forEach((v,i)=>close(v,expected[i]));
const store = () => {
  const entries = new Map(),writes=[];
  return {writes, getItem:key=>entries.get(key)??null,
    setItem(key,value){writes.push({key,value});entries.set(key,value);}};
};
const tracked = (point) => ({transform:{
  position:{x:point[0],y:point[1],z:point[2]},
  orientation:{x:0,y:0,z:0,w:1},
}});
test('table and keyboard each preserve their precise released position after reload, separately from height/tilt', () => {
  const storage=store(),furniture=createHolodeckFurniture({storage});
  furniture.setOffset('keyboard',[0.34,0.18,0.86]);
  furniture.setOffset('table',[-0.46,0.07,0.23]);
  assert.equal(storage.writes.length,0,'do not write every VR frame');
  assert.equal(furniture.flush(),true);
  assert.equal(storage.writes.length,1,'save positions together at release');
  assert.equal(storage.writes[0].key,SPATIAL_FURNITURE_STORAGE_KEY);
  const next=createHolodeckFurniture({storage});
  vec(next.getOffset('keyboard'),[0.34,0.18,0.86]);
  vec(next.getOffset('table'),[-0.46,0.07,0.23]);
  next.nudge('keyboard',0,0.1);
  vec(next.getOffset('table'),[-0.46,0.07,0.23]);
  const latest=createHolodeckFurniture({storage});
  vec(latest.getOffset('keyboard'),[0.44,0.18,0.86]);
  vec(latest.getOffset('table'),[-0.46,0.07,0.23]);
  latest.reset('keyboard');
  vec(latest.getOffset('table'),[-0.46,0.07,0.23]);
  vec(createHolodeckFurniture({storage}).getOffset('keyboard'),[0,0,0]);
});

test('out-of-room and invalid positions fail closed, and corrupted storage never moves furniture', () => {
  const storage=store(),furniture=createHolodeckFurniture({storage});
  furniture.setOffset('table',[100,100,-100]);
  vec(furniture.getOffset('table'),[1.1,0.18,-0.2]);
  furniture.setOffset('keyboard',[NaN,2,0]);
  vec(furniture.getOffset('keyboard'),[0,0,0]);
  furniture.flush();
  storage.setItem(SPATIAL_FURNITURE_STORAGE_KEY,JSON.stringify({
    version:1,offsets:{table:[999,0,0],keyboard:[0,0,0]},
  }));
  const restored=createHolodeckFurniture({storage});
  vec(restored.getOffset('table'),[0,0,0]);
  vec(restored.getOffset('keyboard'),[0,0,0]);
});

test('plastic material mass slows heavy table more than keyboard while both settle without rebound', () => {
  const start=[0,0,0],target=[0.5,0.14,0.5];
  const table=furnitureFollow(start,target,FURNITURE_MATERIALS.table.massKg,0.05);
  const keyboard=furnitureFollow(start,target,FURNITURE_MATERIALS.keyboard.massKg,0.05);
  assert.ok(table[0]>0&&table[0]<keyboard[0]&&keyboard[0]<target[0]);
  assert.deepEqual(furnitureFollow(table,target,10,0),table);
  assert.ok(FURNITURE_MATERIALS.table.massKg>FURNITURE_MATERIALS.keyboard.massKg);
  assert.equal(FURNITURE_MATERIALS.keyboard.material,'moulded-plastic');
});

test('live furniture shape/collision moves with saved position and no longer blocks the old footprint', () => {
  const furniture=createHolodeckFurniture({storage:store()});
  const before=furniture.obstacles();
  furniture.setOffset('keyboard',[0.5,0.2,1]);
  furniture.setOffset('table',[-0.3,0.1,0.3]);
  const after=furniture.obstacles();
  close(after.find(x=>x.id==='furniture:keyboard').minZ-before.find(x=>x.id==='furniture:keyboard').minZ,1);
  close(after.find(x=>x.id==='furniture:table').minX-before.find(x=>x.id==='furniture:table').minX,-0.3);
  const [table,keyboard]=[furniture.shape('table'),furniture.shape('keyboard')];
  close(table.top,HOLODECK_TABLE.top+0.1);close(keyboard.top,HOLODECK_CONSOLE.top+0.2);
  const solids=createCubeSolids(table,keyboard);
  const unshifted=createCubeSolids();
  assert.notDeepEqual(solids[1],unshifted[1]);
  const refreshed=createHolodeckComfortSolids({keyboardTilt:37,furnitureOffset:furniture.getOffset('keyboard')});
  assert.equal(refreshed.length,4);
  // Fixed atlas coordinates and ray hits translate with the moved keyboard.
  const key=SCREEN_KEYS.find(item=>item.id==='key:g');
  const flat=[
    -HOLODECK_CONSOLE.halfWidth+0.1+
      (key.x+key.w/2)*(2*HOLODECK_CONSOLE.halfWidth-0.2),
    HOLODECK_CONSOLE.top+KEYCAP_RISE_METRES,
    HOLODECK_CONSOLE.center[2]-HOLODECK_CONSOLE.halfDepth+0.06+
      (key.y+key.h/2)*(2*HOLODECK_CONSOLE.halfDepth-0.12),
  ];
  const offset=furniture.getOffset('keyboard'),origin=flat.map((v,i)=>v+offset[i]+(i===1?1:0));
  assert.equal(consoleHit(origin,[0,-1,0],0,offset)?.id,key.id);
  assert.notEqual(consoleHit(origin,[0,-1,0],0,[0,0,0])?.id,key.id);
  const geometry=createHolodeckRoomGeometry();
  assert.ok(geometry.furnitureRanges.table.positions.end>geometry.furnitureRanges.table.positions.start);
  assert.ok(geometry.furnitureRanges.keyboard.solidPositions.end>geometry.furnitureRanges.keyboard.solidPositions.start);
});

test('Quest grip moves furniture with inertia and release saves instead of snapping back', () => {
  const storage=store(),furniture=createHolodeckFurniture({storage});
  const cubeScene={getStates:()=>[]};
  const interaction=createHolodeckFurnitureInteraction({furniture,cubeScene});
  const raySpace={},gripSpace={},buttons=[{}, {pressed:false}];
  const source={targetRayMode:'tracked-pointer',gamepad:{mapping:'xr-standard',connected:true,buttons},targetRaySpace:raySpace,gripSpace};
  let position=[0,0.98,-3.7];
  const frame={session:{inputSources:[source]},getPose(space){return tracked(position);}};
  const update=time=>interaction.update({time,frame,referenceSpace:{},pose:tracked([0,1.4,-3.7]),navigation:{x:0,y:0,z:0,yaw:0},gamepads:[]});
  assert.equal(furnitureGrabTarget(position,[0,0,-1],furniture)?.id,'keyboard');
  update(0);buttons[1].pressed=true;update(16);
  assert.equal(interaction.isHolding(),true);
  position=[0.55,0.98,-3.7];update(32);update(48);update(64);
  const moved=furniture.getOffset('keyboard');
  assert.ok(moved[0]>0&&moved[0]<0.55);
  buttons[1].pressed=false;update(80);
  assert.equal(interaction.isHolding(),false);
  const released=furniture.getOffset('keyboard');
  update(96);vec(furniture.getOffset('keyboard'),released);
  vec(createHolodeckFurniture({storage}).getOffset('keyboard'),released);
  assert.equal(storage.writes.length,1);
});

test('audio devices are real browser-local tests and do not acquire mic without user action', async () => {
  const calls=[],events=[];
  const track={stop(){calls.push('stop');}};
  const devices={
    async enumerateDevices(){calls.push('enumerate');return [
      {kind:'audioinput',deviceId:'mic1',label:'Headset mic'},
      {kind:'audiooutput',deviceId:'out1',label:'Headset speakers'},
    ];},
    async getUserMedia(spec){calls.push(['getUserMedia',spec]);return {getTracks:()=>[track]};},
  };
  const audio=createHolodeckAudioControls({navigatorRef:{mediaDevices:devices},AudioContextCtor:null,onStatus:t=>events.push(t)});
  const found=await audio.listDevices();
  assert.deepEqual(found.inputs,[{id:'mic1',label:'Headset mic'}]);
  assert.deepEqual(found.outputs,[{id:'out1',label:'Headset speakers'}]);
  assert.deepEqual(calls,['enumerate']);
  const opened=await audio.testMicrophone('mic1');
  assert.equal(opened.ok,true);
  assert.equal(calls[1][1].audio.deviceId.exact,'mic1');
  audio.stopMicrophone();
  assert.equal(calls.at(-1),'stop');
  assert.equal(audio.microphoneLevel(),null);
  assert.equal((await audio.testSpeakers('out1')).ok,false);
  assert.ok(events.some(t=>t.includes('ChatGPT')));
});

test('launcher exposes persistent furniture and real device testing without inventing direct Voice control', () => {
  const page=readFileSync(new URL('../apps/spatial-bridge/quest-entry.html',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../apps/spatial-bridge/service-worker.js',import.meta.url),'utf8');
  for(const marker of ['furniture-position','furniture-target','furniture-reset','furniture.flush()',
    'audio-test-microphone','audio-test-speakers','audio-voice-help','probe-capture'])assert.ok(page.includes(marker),marker);
  assert.match(worker,/holodeck-furniture-v1\.mjs/);
  assert.match(worker,/holodeck-audio-v1\.mjs/);
  assert.match(worker,/stephanos-spatial-workspace-v1-movable-furniture-audio-v5/);
});
