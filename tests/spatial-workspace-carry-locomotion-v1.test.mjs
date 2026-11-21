import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHolodeckNavigationObstacles } from '../apps/spatial-bridge/holodeck-baseline-v0.mjs';
import { createHolodeckDynamicObstacles } from '../apps/spatial-bridge/holodeck-collision-v1.mjs';
import { createHolodeckLocomotion } from '../apps/spatial-bridge/holodeck-locomotion-v1.mjs';
import { createHolodeckFurniture, furnitureGripTarget } from '../apps/spatial-bridge/holodeck-furniture-v1.mjs';
const pose={transform:{position:{x:0,y:1.5,z:0},orientation:{x:0,y:0,z:0,w:1}}};
const neutral={source:'xr',label:'Quest',moveX:0,moveY:0,turn:0,reset:false};
const forward={...neutral,moveY:-1};
function walk(obstacles){const nav=createHolodeckLocomotion({obstacles:[],floorRelativeY:true});nav.update({time:0,pose,input:neutral});let state;for(let t=50;t<=1000;t+=50)state=nav.update({time:t,pose,input:forward,dynamicObstacles:obstacles});return state;}
test('held cube does not freeze walking; releasing restores solid collision',()=>{
  const cube={id:'small',position:[0,0.7,-0.4],size:0.114,heldBy:'left'};
  assert.equal(createHolodeckDynamicObstacles([cube]).length,0);
  assert.ok(walk(createHolodeckNavigationObstacles({cubeStates:[cube]})).z<-0.9);
  assert.ok(walk(createHolodeckNavigationObstacles({cubeStates:[{...cube,heldBy:null}]})).z>-0.3);
});
test('carried furniture does not block its owner, but other obstacles remain solid',()=>{
  const items=[{id:'furniture:table',minX:-1,maxX:1,minZ:-1,maxZ:-0.3},
    {id:'furniture:keyboard',minX:-1,maxX:1,minZ:-2,maxZ:-1.8}];
  const stuck=walk(createHolodeckNavigationObstacles({furnitureObstacles:items}));
  const moving=walk(createHolodeckNavigationObstacles({furnitureObstacles:items,heldFurnitureId:'table'}));
  assert.ok(moving.z<stuck.z-0.25);
  assert.ok(moving.z>-1.8);
});
test('Quest proximity grip can target a real furniture body',()=>{
  const furniture=createHolodeckFurniture({storage:{getItem:()=>null,setItem:()=>{}}});
  assert.equal(furnitureGripTarget([1.22,0.84,-2.2],furniture)?.id,'table');
  assert.equal(furnitureGripTarget([2.5,2,-1],furniture),null);
});
test('Spatial service worker preserves other apps and excludes private API responses',async()=>{
  const src=readFileSync(new URL('../apps/spatial-bridge/service-worker.js',import.meta.url),'utf8');
  const listeners={},removed=[],stored=[],wait=[];
  const cache={addAll:async()=>{},add:async()=>{},put:async req=>{stored.push(req.url);},match:async()=>null};
  const caches={keys:async()=>['stephanos-goal-dashboard-v1','unrelated-cache','stephanos-spatial-workspace-v1-raised-keys-v4'],delete:async key=>{removed.push(key);},open:async()=>cache};
  const self={location:{href:'https://example.test/stephan-os/apps/spatial-bridge/service-worker.js',origin:'https://example.test'},addEventListener:(n,cb)=>{listeners[n]=cb;},skipWaiting:async()=>{},clients:{claim:async()=>{}}};
  const response={ok:true,status:200,type:'basic',headers:{get:()=> 'private, no-store'},clone(){return this;}};
  vm.runInNewContext(src,{self,caches,fetch:async()=>response,URL,Response});
  listeners.activate({waitUntil:p=>wait.push(p)});await Promise.all(wait);
  assert.deepEqual(removed,['stephanos-spatial-workspace-v1-raised-keys-v4']);
  let intercepted=false;
  listeners.fetch({request:{method:'GET',url:'https://example.test/stephan-os/api/private',cache:'default'},respondWith(){intercepted=true;}});
  assert.equal(intercepted,false);
  listeners.fetch({request:{method:'GET',url:'https://example.test/stephan-os/apps/spatial-bridge/quest-entry.html',cache:'default'},waitUntil:p=>wait.push(p),respondWith:p=>wait.push(p)});
  await Promise.all(wait);assert.deepEqual(stored,[]);
});
