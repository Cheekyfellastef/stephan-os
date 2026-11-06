import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHolodeckRoomGeometry, createHolodeckRoomRenderer } from '../apps/spatial-bridge/holodeck-room-v1.mjs';
import { HOLODECK_ROOM, HOLODECK_TABLE, HOLODECK_CUBE, HOLODECK_OBSTACLES, HOLODECK_BODY_RADIUS } from '../apps/spatial-bridge/holodeck-layout-v1.mjs';
import { resolveHolodeckMovement } from '../apps/spatial-bridge/holodeck-collision-v1.mjs';
import { createHolodeckLocomotion, sampleHolodeckControls } from '../apps/spatial-bridge/holodeck-locomotion-v1.mjs';
const close = (a,b) => assert.ok(Math.abs(a-b)<0.001, `${a} != ${b}`);
const obstacle = { id:'test', minX:-0.5, maxX:0.5, minZ:-2, maxZ:-1 };
const pose = (x=0,z=0) => ({transform:{position:{x,y:1.7,z},orientation:{x:0,y:0,z:0,w:1}}});
const expandedInside = (p,b) => p.x>b.minX-HOLODECK_BODY_RADIUS+1e-7
  && p.x<b.maxX+HOLODECK_BODY_RADIUS-1e-7 && p.z>b.minZ-HOLODECK_BODY_RADIUS+1e-7
  && p.z<b.maxZ+HOLODECK_BODY_RADIUS-1e-7;

test('solid furniture, lighting and collisions share the same scene dimensions', () => {
  const g=createHolodeckRoomGeometry();
  assert.equal(g.table,HOLODECK_TABLE);
  assert.equal(g.ideaCube,HOLODECK_CUBE);
  assert.equal(g.room,HOLODECK_ROOM);
  assert.equal(g.obstacles,HOLODECK_OBSTACLES);
  assert.ok(g.solidVertexCount>500);
  assert.equal(g.solidPositions.length,g.solidVertexCount*3);
  assert.equal(g.solidColors.length,g.solidPositions.length);
  assert.equal(g.normals.length,g.solidPositions.length);
  assert.equal(g.emissions.length,g.solidVertexCount);
  for (const array of [g.positions,g.colors,g.solidPositions,g.solidColors,g.normals,g.emissions])
    assert.ok(array.every(Number.isFinite));
  for (let i=0;i<g.normals.length;i+=3) close(Math.hypot(...g.normals.slice(i,i+3)),1);
  assert.ok(g.emissions.some(n=>n===1));
  assert.ok(HOLODECK_CUBE.center[1]-HOLODECK_CUBE.size/2>HOLODECK_TABLE.top);
});

test('floor, ceiling and every wall have grid lines in both directions', () => {
  const g=createHolodeckRoomGeometry();
  const segments=[];
  for (let i=0;i<g.positions.length;i+=6) segments.push(Array.from(g.positions.slice(i,i+6)));
  for (const [axis,plane,axes] of [[1,0.008,[0,2]],[1,3.192,[0,2]],
    [0,-4.992,[1,2]],[0,4.992,[1,2]],[2,-5.992,[0,1]],[2,2.992,[0,1]]]) {
    for (const direction of axes) assert.ok(segments.filter(s=>Math.abs(s[axis]-plane)<0.0001
      && Math.abs(s[axis+3]-plane)<0.0001 && Math.abs(s[direction]-s[direction+3])>2).length>=6,
    `missing grid axis ${direction} on plane ${axis}:${plane}`);
  }
});

test('swept collisions stop long movements at every side, including a thin cube', () => {
  for (const [p,d,axis,edge] of [
    [{x:0,z:0},{x:0,z:-5},'z',-0.72], [{x:0,z:-4},{x:0,z:4},'z',-2.28],
    [{x:-3,z:-1.5},{x:6,z:0},'x',-0.78], [{x:3,z:-1.5},{x:-6,z:0},'x',0.78],
  ]) {
    const result=resolveHolodeckMovement(p,d,{obstacles:[obstacle]});
    close(p[axis]+result[axis],edge);
    assert.equal(expandedInside({x:p.x+result.x,z:p.z+result.z},obstacle),false);
  }
  const cube={minX:-0.0285,maxX:0.0285,minZ:-2.2285,maxZ:-2.1715};
  const travel=resolveHolodeckMovement({x:0,z:0},{x:0,z:-5},{obstacles:[cube]});
  close(travel.z,cube.maxZ+HOLODECK_BODY_RADIUS);
});

test('diagonal contact slides along a face and can move away from a blocked edge', () => {
  const p={x:0,z:-0.7};
  const hit=resolveHolodeckMovement(p,{x:0.2,z:-0.2},{obstacles:[obstacle]});
  close(hit.x,0.2); close(p.z+hit.z,-0.72);
  const escaped=resolveHolodeckMovement({x:p.x+hit.x,z:p.z+hit.z},{x:0,z:0.2},{obstacles:[obstacle]});
  close(escaped.z,0.2);
});

test('corners, multiple objects and randomized approaches never tunnel into an obstacle', () => {
  const boxes=[obstacle,{minX:1,maxX:1.1,minZ:-4,maxZ:-0.5}];
  let seed=1947;
  const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
  for (let i=0;i<2000;i++) {
    const p={x:random()*8-4,z:random()*7-5};
    if (boxes.some(b=>expandedInside(p,b))) continue;
    const delta={x:random()*10-5,z:random()*10-5};
    const move=resolveHolodeckMovement(p,delta,{obstacles:boxes});
    const next={x:p.x+move.x,z:p.z+move.z};
    assert.equal(boxes.some(b=>expandedInside(next,b)),false,JSON.stringify({p,delta,next}));
  }
});

test('physical overlap is not snapped and sticks only recover towards the nearest exit', () => {
  const p={x:0,z:-0.9};
  assert.deepEqual(resolveHolodeckMovement(p,{x:0,z:0},{obstacles:[obstacle]}),{x:0,z:0});
  assert.deepEqual(resolveHolodeckMovement(p,{x:0,z:-0.1},{obstacles:[obstacle]}),{x:0,z:0});
  close(resolveHolodeckMovement(p,{x:0,z:0.1},{obstacles:[obstacle]}).z,0.1);
  const centre={x:0,z:-2.2};
  close(resolveHolodeckMovement(centre,{x:0,z:0.1}).z,0.1);
});

test('Xbox and Quest stop at the visible table while smooth turning remains available', () => {
  for (const device of ['xbox','quest']) {
    const sample=(forward=0,turn=0)=>sampleHolodeckControls(device==='xbox'
      ? {gamepads:[{mapping:'standard',connected:true,index:0,axes:[0,forward,turn,0]}]}
      : {inputSources:[{targetRayMode:'tracked-pointer',handedness:'left',gamepad:{mapping:'xr-standard',axes:[0,0,0,forward]}},
        {targetRayMode:'tracked-pointer',handedness:'right',gamepad:{mapping:'xr-standard',axes:[0,0,turn,0]}}]});
    const nav=createHolodeckLocomotion();
    nav.update({time:0,pose:pose(),input:sample()});
    let state;
    for (let time=50;time<=5000;time+=50) state=nav.update({time,pose:pose(),input:sample(-1)});
    close(state.z,HOLODECK_OBSTACLES[0].maxZ+HOLODECK_BODY_RADIUS);
    const turned=nav.update({time:5050,pose:pose(),input:sample(0,1)});
    close(turned.yaw,-Math.PI/40); close(turned.z,state.z);
  }
});

test('offline shell includes the shared layout and collision modules', () => {
  const worker=readFileSync(new URL('../apps/spatial-bridge/service-worker.js',import.meta.url),'utf8');
  assert.match(worker,/'\.\/holodeck-layout-v1\.mjs'/);
  assert.match(worker,/'\.\/holodeck-collision-v1\.mjs'/);
});

test('lit renderer draws both eyes with distinct tracked matrices and releases GPU resources', () => {
  const calls=[];
  const gl={drawingBufferWidth:800,drawingBufferHeight:400};
  for (const key of ['VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS','ARRAY_BUFFER',
    'STATIC_DRAW','DYNAMIC_DRAW','DEPTH_TEST','LEQUAL','BLEND','CULL_FACE','SCISSOR_TEST','FRAMEBUFFER','FLOAT','TRIANGLES','LINES','FRONT','BACK','SRC_ALPHA','ONE_MINUS_SRC_ALPHA']) gl[key]=key;
  gl.COLOR_BUFFER_BIT=1; gl.DEPTH_BUFFER_BIT=2;
  for (const key of ['createShader','createProgram','createBuffer']) gl[key]=()=>({});
  gl.getShaderParameter=gl.getProgramParameter=()=>true;
  gl.getAttribLocation=(_p,name)=>name;
  gl.getUniformLocation=(_p,name)=>name;
  for (const key of ['shaderSource','compileShader','deleteShader','attachShader','linkProgram','deleteProgram',
    'bindBuffer','bufferData','enableVertexAttribArray','vertexAttribPointer','disableVertexAttribArray',
    'vertexAttrib1f','vertexAttrib3f','bindFramebuffer','enable','depthFunc','depthMask','disable','clearColor',
    'clear','useProgram','uniformMatrix4fv','uniform1f','uniform3f','blendFunc','cullFace','drawArrays','viewport','deleteBuffer'])
    gl[key]=(...args)=>calls.push([key,...args.map(v=>v instanceof Float32Array?Array.from(v):v)]);
  const renderer=createHolodeckRoomRenderer({gl});
  const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,-1.7,0,1]);
  const views=[-0.032,0.032].map((eyeX,i)=>{
    const matrix=identity(); matrix[12]=-eyeX;
    return {eye:i,projectionMatrix:identity(),transform:{inverse:{matrix}}};
  });
  const frame={session:{renderState:{baseLayer:{framebuffer:{},getViewport:view=>({x:view.eye*400,y:0,width:400,height:400})}}}};
  calls.length=0;
  assert.deepEqual(renderer.drawFrame(frame,{}, {pose:{views},navigation:{x:0.4,z:-1,yaw:0.2}}),{poseAvailable:true,viewCount:2});
  assert.deepEqual(calls.filter(c=>c[0]==='viewport').map(c=>c.slice(1)),[[0,0,400,400],[400,0,400,400]]);
  assert.deepEqual(calls.filter(c=>c[0]==='drawArrays').map(c=>c[1]),
    ['TRIANGLES','LINES','TRIANGLES','TRIANGLES','LINES','TRIANGLES','LINES','TRIANGLES','TRIANGLES','LINES']);
  const matrices=calls.filter(c=>c[0]==='uniformMatrix4fv'&&c[1]==='uView').map(c=>c[3]);
  close(matrices[0][13],-1.7); close(matrices[1][13],-1.7);
  close(matrices[0][12]-matrices[1][12],0.064);
  calls.length=0;
  renderer.drawFrame(frame,{}, {pose:null});
  assert.equal(calls.filter(c=>c[0]==='drawArrays').length,0);
  renderer.drawPreview();
  for (const call of calls.filter(c=>c[0]==='uniformMatrix4fv')) assert.ok(call[3].every(Number.isFinite));
  renderer.dispose();
  assert.equal(calls.filter(c=>c[0]==='deleteBuffer').length,12);
  assert.equal(calls.filter(c=>c[0]==='deleteProgram').length,1);
});
