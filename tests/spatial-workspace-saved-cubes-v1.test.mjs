import test from 'node:test';
import assert from 'node:assert/strict';
import { createHolodeckCubeScene } from '../apps/spatial-bridge/holodeck-cube-scene-v1.mjs';
import { createHolodeckCubeStore, CUBE_STORAGE_KEY, validateSavedCubes } from '../apps/spatial-bridge/holodeck-cube-store-v1.mjs';
import { createHolodeckCubeInteraction } from '../apps/spatial-bridge/holodeck-cube-interaction-v1.mjs';
import { createHolodeckCubeGeometry } from '../apps/spatial-bridge/holodeck-room-v1.mjs';
import { enterHolodeckBaseline } from '../apps/spatial-bridge/holodeck-baseline-v0.mjs';
import { HOLODECK_CUBES, HOLODECK_TABLE } from '../apps/spatial-bridge/holodeck-layout-v1.mjs';
const close=(a,b,t=0.001)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const memory=()=>{const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};};
const run=(scene,seconds=8)=>{for(let i=0;i<seconds*120;i++)scene.advance(1/120);};
const move=(scene,id,position,q)=>{const p=scene.getBody(id);p.grab('setup');p.moveHeld(position,q);p.release();};
const hand=(state,extra={})=>({id:'quest:left',kind:'quest',position:[...state.position],orientation:[0,0,0,1],
  rayOrigin:state.position.map((v,i)=>v+(i===2?0.3:0)),forward:[0,0,-1],
  grab:false,throw:false,reset:false,reach:0,rotate:0,...extra});

test('both rendered and physical edges are 57 and 114 mm; defaults are separate on the table',()=>{
  const scene=createHolodeckCubeScene();
  assert.deepEqual(scene.getStates().map(c=>c.size),[0.057,0.114]);
  close(HOLODECK_CUBES[1].size/HOLODECK_CUBES[0].size,2);
  for(const state of scene.getStates()) {
    const g=createHolodeckCubeGeometry(state);
    for(let axis=0;axis<3;axis++) {
      const values=g.solidPositions.filter((_,i)=>i%3===axis);
      close(Math.max(...values)-Math.min(...values),state.size);
    }
    close(state.position[1]-state.size/2,HOLODECK_TABLE.top+0.008);
  }
});

test('both sizes drop onto the table and collide with walls and floor',()=>{
  const scene=createHolodeckCubeScene();
  for(const id of ['small','large']) {
    const cube=scene.getBody(id),x=id==='small'?-0.4:0.4;
    move(scene,id,[x,2,-2.2]);run(scene);
    close(cube.getState().position[1]-cube.getState().size/2,0.888);
    move(scene,id,[id==='small'?-2:2,2,0]);cube.release([0,1,-8],[3,2,1]);
    let bounced=false;
    for(let i=0;i<1800;i++) {scene.advance(1/120);const s=cube.getState();assert.ok(s.position[2]>-6);if(s.position[2]<-5&&s.velocity[2]>0)bounced=true;}
    assert.ok(bounced);close(cube.getState().position[1],cube.getState().size/2);
  }
});

test('a held cube cannot cross the other cube, and a stack falls when its support moves',()=>{
  const scene=createHolodeckCubeScene(),small=scene.getBody('small'),large=scene.getBody('large');
  move(scene,'large',[2,1.4,0]);run(scene);
  small.grab('left');small.moveHeld([1.5,1,0]);small.moveHeld([1.5,0.03,0]);small.moveHeld([3,0.03,0]);
  assert.ok(small.getState().position[0]<large.getState().position[0]);
  small.moveHeld([1.5,1,0]);small.moveHeld([2,1,0]);small.release();run(scene);
  close(small.getState().position[1],0.114+0.057/2,0.002);
  assert.equal(small.getState().sleeping,true);
  large.grab('right');large.moveHeld([3,0.0571,0]);
  run(scene);close(small.getState().position[1],0.057/2);
});

test('Quest hands can own different cubes and releasing one does not release the other',()=>{
  const scene=createHolodeckCubeScene(),interaction=createHolodeckCubeInteraction({scene});
  const left=hand(scene.getStates()[0]),right=hand(scene.getStates()[1],{id:'quest:right'});
  interaction.update({time:0,hands:[left,right]});
  interaction.update({time:20,hands:[{...left,grab:true},{...right,grab:true}]});
  assert.deepEqual(scene.getStates().map(c=>c.heldBy),['quest:left','quest:right']);
  interaction.update({time:40,hands:[left,{...right,grab:true}]});
  assert.equal(scene.getStates()[0].heldBy,null);assert.equal(scene.getStates()[1].heldBy,'quest:right');
  interaction.stop();assert.ok(scene.getStates().every(c=>!c.heldBy));
});

test('Xbox selects and throws the large cube independently, then X recalls that cube',()=>{
  const scene=createHolodeckCubeScene(),interaction=createHolodeckCubeInteraction({scene});
  const originalSmall=scene.getStates()[0].position;
  const xbox=hand(scene.getStates()[1],{id:'xbox:0',kind:'xbox'});
  interaction.update({time:0,hands:[xbox]});
  interaction.update({time:20,hands:[{...xbox,grab:true}]});
  assert.equal(scene.getStates()[1].heldBy,'xbox:0');assert.equal(scene.getStates()[0].heldBy,null);
  interaction.update({time:40,hands:[{...xbox,grab:true,throw:true}]});
  assert.ok(scene.getStates()[1].velocity[2]<-2);
  interaction.update({time:60,hands:[{...xbox,reset:true}]});
  assert.deepEqual(scene.getStates()[1].position,HOLODECK_CUBES[1].center);
  assert.deepEqual(scene.getStates()[0].position,originalSmall);
});

test('both exact resting poses survive a new workspace and have no restored ownership',()=>{
  const storage=memory(),scene=createHolodeckCubeScene({store:createHolodeckCubeStore({storage})});
  move(scene,'small',[-0.6,1.2,-2.2]);move(scene,'large',[2,1.5,0]);run(scene);
  scene.checkpoint(1000,true);const before=scene.getStates();
  const restored=createHolodeckCubeScene({store:createHolodeckCubeStore({storage})});
  assert.deepEqual(restored.getStates(),before);
  run(restored);assert.deepEqual(restored.getStates(),before);
  assert.ok(before.every(c=>!c.heldBy));
});

test('restore does not displace a cube whose saved position occupies the other default slot',()=>{
  const storage=memory(),scene=createHolodeckCubeScene({store:createHolodeckCubeStore({storage})});
  move(scene,'large',[2,1.5,0]);run(scene);
  move(scene,'small',[0.28,1.2,-2.2]);run(scene);scene.checkpoint(1000,true);
  const restored=createHolodeckCubeScene({store:createHolodeckCubeStore({storage})});
  assert.deepEqual(restored.getStates(),scene.getStates());
});

test('leaving while held flushes the latest pose without a stuck grip or artificial throw',()=>{
  const storage=memory(),scene=createHolodeckCubeScene({store:createHolodeckCubeStore({storage})});
  const body=scene.getBody('large');body.grab('quest:left');body.moveHeld([2,1.7,0]);
  scene.checkpoint(10);body.moveHeld([2.2,1.8,0]);scene.stop();
  const restored=createHolodeckCubeScene({store:createHolodeckCubeStore({storage})});
  assert.deepEqual(restored.getStates()[1].position,[2.2,1.8,0]);
  assert.equal(restored.getStates()[1].heldBy,null);assert.deepEqual(restored.getStates()[1].velocity,[0,0,0]);
  run(restored);close(restored.getStates()[1].position[1],0.114/2);
});

test('malformed, out-of-room, duplicate and non-finite saved records safely use defaults',()=>{
  const storage=memory();
  const base={version:1,cubes:createHolodeckCubeScene().getStates()};
  for(const raw of ['{broken',JSON.stringify({version:1,cubes:[]}),
    JSON.stringify({...base,cubes:[base.cubes[0],base.cubes[0]]}),
    JSON.stringify({...base,cubes:base.cubes.map(c=>({...c,position:[999,0,0]}))}),
    JSON.stringify({...base,cubes:base.cubes.map(c=>({...c,orientation:[0,0,0,0]}))})]) {
    storage.setItem(CUBE_STORAGE_KEY,raw);
    const scene=createHolodeckCubeScene({store:createHolodeckCubeStore({storage})});
    assert.deepEqual(scene.getStates().map(c=>c.position),HOLODECK_CUBES.map(c=>c.center));
  }
  assert.equal(validateSavedCubes({...base,cubes:base.cubes.map(c=>({...c,velocity:[NaN,0,0]}))}),null);
});

test('blocked/full storage warns without breaking physics; future saves are never overwritten',()=>{
  for(const storage of [{getItem(){throw Error('blocked');}}, {getItem:()=>null,setItem(){throw Error('full');}}]) {
    const messages=[],scene=createHolodeckCubeScene({store:createHolodeckCubeStore({storage,onStatus:m=>messages.push(m)})});
    move(scene,'large',[2,1,0]);scene.stop();run(scene);
    assert.ok(messages.some(m=>/unavailable|Could not save/.test(m)));
    close(scene.getStates()[1].position[1],0.057);
  }
  const storage=memory(),future=JSON.stringify({version:2,cubes:[]});storage.setItem(CUBE_STORAGE_KEY,future);
  const scene=createHolodeckCubeScene({store:createHolodeckCubeStore({storage})});move(scene,'large',[2,1,0]);scene.stop();
  assert.equal(storage.getItem(CUBE_STORAGE_KEY),future);
});

test('an older open workspace cannot replace a save made by another window',()=>{
  const storage=memory(),messages=[];
  const old=createHolodeckCubeScene({store:createHolodeckCubeStore({storage,onStatus:m=>messages.push(m)})});
  const newer=createHolodeckCubeScene({store:createHolodeckCubeStore({storage})});
  move(newer,'large',[2,1,0]);newer.stop();const saved=storage.getItem(CUBE_STORAGE_KEY);
  move(old,'small',[-2,1,0]);old.stop();
  assert.equal(storage.getItem(CUBE_STORAGE_KEY),saved);assert.match(messages.at(-1),/another window/);
});

test('entering and ending VR uses the existing room and flushes it for the next visit',async()=>{
  const storage=memory(),scene=createHolodeckCubeScene({store:createHolodeckCubeStore({storage})});
  move(scene,'large',[2,1,0]);run(scene);
  const before=scene.getStates(),callbacks={};let rendered;
  const session={inputSources:[],visibilityState:'visible',renderState:{},
    updateRenderState(s){Object.assign(this.renderState,s);},requestReferenceSpace:async()=>({}),
    addEventListener:(n,fn)=>callbacks[n]=fn,requestAnimationFrame:fn=>callbacks.frame=fn,
    end:async()=>callbacks.end()};
  const result=await enterHolodeckBaseline({cubeScene:scene,
    navigatorRef:{xr:{requestSession:async()=>session}},canvas:{getContext:()=>({})},xrWebGLLayerCtor:class{},
    rendererFactory:()=>({geometry:{},drawFrame:(_f,_r,data)=>{rendered=data;},dispose(){}})});
  assert.equal(result.ok,true);
  callbacks.frame(0,{session,getViewerPose:()=>({transform:{position:{x:0,y:1.6,z:0},orientation:{x:0,y:0,z:0,w:1}}})});
  assert.deepEqual(rendered.cube.cubes.map(c=>c.position),before.map(c=>c.position));
  await session.end();
  const restored=createHolodeckCubeScene({store:createHolodeckCubeStore({storage})});
  assert.deepEqual(restored.getStates(),before);
});
