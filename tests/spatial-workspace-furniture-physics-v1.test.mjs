import test from 'node:test';
import assert from 'node:assert/strict';
import { createHolodeckFurniture, FURNITURE_MOVEMENT_BOUNDS,
  SPATIAL_FURNITURE_STORAGE_KEY } from '../apps/spatial-bridge/holodeck-furniture-v1.mjs';
import { createHolodeckCubeScene } from '../apps/spatial-bridge/holodeck-cube-scene-v1.mjs';
import { createHolodeckCubeStore, CUBE_STORAGE_KEY } from '../apps/spatial-bridge/holodeck-cube-store-v1.mjs';
import { createConsoleSolids, createHolodeckCubePhysics, cubeSupport, cubeSolid, solidMotionLimit,
  solidBounds, boxSolid } from '../apps/spatial-bridge/holodeck-cube-physics-v1.mjs';
import { createHolodeckCubeInteraction } from '../apps/spatial-bridge/holodeck-cube-interaction-v1.mjs';
import { resolveHolodeckMovement } from '../apps/spatial-bridge/holodeck-collision-v1.mjs';
import { createHolodeckComfort } from '../apps/spatial-bridge/holodeck-comfort-v1.mjs';
import { createHolodeckRoomGeometry } from '../apps/spatial-bridge/holodeck-room-v1.mjs';
import { buildHolodeckKeycaps, KEYCAP_VERTEX_STRIDE } from '../apps/spatial-bridge/holodeck-keycaps-v1.mjs';
import { HOLODECK_ROOM, HOLODECK_CONSOLE, HOLODECK_TABLE } from '../apps/spatial-bridge/holodeck-layout-v1.mjs';

const close=(actual,expected,tolerance=1e-6)=>
  assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const vec=(actual,expected,tolerance)=>actual.forEach((v,i)=>close(v,expected[i],tolerance));
const memory=()=>{const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};};
const roomAxes=[[-HOLODECK_ROOM.halfWidth,HOLODECK_ROOM.halfWidth],[0,HOLODECK_ROOM.height],
  [HOLODECK_ROOM.frontZ,HOLODECK_ROOM.backZ]];
const run=(scene,seconds=.5)=>{for(let i=0;i<seconds*120;i++)scene.advance(1/120);};
const offsetPosition=(position,offset)=>position.map((v,i)=>v+offset[i]);
const setup=()=>{
  const storage=memory(),furniture=createHolodeckFurniture({storage});
  const scene=createHolodeckCubeScene({furniture,store:createHolodeckCubeStore({storage})});
  return {storage,furniture,scene};
};

test('furniture moves well beyond the former small offset boxes and preserves exact room poses',()=>{
  const storage=memory(),furniture=createHolodeckFurniture({storage});
  const placements={table:[2.5,.7,2.4],keyboard:[-2.3,.8,5.2]};
  for(const [id,offset] of Object.entries(placements))furniture.setOffset(id,offset,{save:true});
  assert.deepEqual(furniture.getState(),placements);
  assert.deepEqual(createHolodeckFurniture({storage}).getState(),placements);
});

test('clear paths still reach the real far walls, ceiling and floor after assembly collision is enabled',()=>{
  const furniture=createHolodeckFurniture({storage:memory()});
  for(const offset of [[0,0,4.48],[3.75,0,4.48],[3.75,2.312,4.48]])furniture.setOffset('table',offset);
  vec(furniture.getOffset('table'),[3.75,2.312,4.48]);
  furniture.setOffset('table',[3.75,-.035,4.48]);
  vec(furniture.getOffset('table'),[3.75,-.035,4.48]);
  const ceiling=FURNITURE_MOVEMENT_BOUNDS.keyboard[1][1];
  for(const offset of [[-3.11,0,0],[-3.11,ceiling,0],[-3.11,ceiling,7.54]])furniture.setOffset('keyboard',offset);
  vec(furniture.getOffset('keyboard'),[-3.11,ceiling,7.54]);
});

test('every extreme translation keeps real table and 0–90 degree keyboard solids inside room walls, floor and ceiling',()=>{
  const furniture=createHolodeckFurniture({storage:memory()});
  for(const id of ['table','keyboard'])for(let axis=0;axis<3;axis++)for(const sign of [-1,1]) {
    const request=[0,0,0];request[axis]=sign*100;
    furniture.setOffset(id,request);
    const offset=furniture.getOffset(id);
    assert.ok(offset[axis]>=FURNITURE_MOVEMENT_BOUNDS[id][axis][0]-1e-7
      &&offset[axis]<=FURNITURE_MOVEMENT_BOUNDS[id][axis][1]+1e-7);
    for(const keyboardTilt of [0,17,37,67,89.8,90]) {
      const geometry=createHolodeckRoomGeometry({keyboardTilt}),range=geometry.furnitureRanges[id].solidPositions;
      for(let i=range.start;i<range.end;i+=3)for(let a=0;a<3;a++) {
        const value=geometry.solidPositions[i+a]+offset[a];
        assert.ok(value>=roomAxes[a][0]-1e-6&&value<=roomAxes[a][1]+1e-6,
          `${id}, axis ${axis}, direction ${sign}, tilt ${keyboardTilt}: vertex outside room on axis ${a}`);
      }
      if(id==='keyboard') {
        const keys=buildHolodeckKeycaps({keyboardTilt,furnitureOffset:offset});
        for(let i=0;i<keys.length;i+=KEYCAP_VERTEX_STRIDE)for(let a=0;a<3;a++)
          assert.ok(keys[i+a]>=roomAxes[a][0]-1e-6&&keys[i+a]<=roomAxes[a][1]+1e-6,'tilted keycap stays in room');
      }
    }
  }
  // Boundaries come from the physical table rim and foot, not its spawn point.
  vec(FURNITURE_MOVEMENT_BOUNDS.table.flat(),[-3.75,3.75,-.035,2.312,-3.08,4.48]);
});

test('legacy below-floor poses clamp independently without erasing the other saved furniture',()=>{
  const storage=memory();
  storage.setItem(SPATIAL_FURNITURE_STORAGE_KEY,JSON.stringify({version:1,offsets:{
    table:[-.46,-.14,.23],keyboard:[.34,.18,.86],
  }}));
  const migrated=createHolodeckFurniture({storage});
  vec(migrated.getOffset('table'),[-.46,-.035,.23]);
  vec(migrated.getOffset('keyboard'),[.34,.18,.86]);
  migrated.flush();
  assert.deepEqual(createHolodeckFurniture({storage}).getState(),migrated.getState());
  storage.setItem(SPATIAL_FURNITURE_STORAGE_KEY,JSON.stringify({version:1,offsets:{
    table:[null,0,0],keyboard:[2,.7,4],
  }}));
  const partial=createHolodeckFurniture({storage});
  vec(partial.getOffset('table'),[0,0,0]);vec(partial.getOffset('keyboard'),[2,.7,4]);
});

test('translated keyboard deck and every support collider receive exactly one identical transform',()=>{
  const furniture=createHolodeckFurniture({storage:memory()}),delta=[-3,.7,3];
  const original=createConsoleSolids(HOLODECK_CONSOLE);
  furniture.setOffset('keyboard',[-3,0,0]);furniture.setOffset('keyboard',[-3,.7,0]);
  furniture.setOffset('keyboard',delta);
  vec(furniture.getOffset('keyboard'),delta);
  const moved=createConsoleSolids(furniture.shape('keyboard'));
  for(let i=0;i<original.length;i++)for(let j=0;j<original[i].length;j++) {
    const [normal,d]=original[i][j];
    vec(moved[i][j][0],normal);
    close(moved[i][j][1],d+normal.reduce((sum,v,a)=>sum+v*delta[a],0));
  }
});

test('boundary notices describe explicit blocked nudges without announcing every held frame',()=>{
  const messages=[],furniture=createHolodeckFurniture({storage:memory(),onStatus:message=>messages.push(message)});
  furniture.setOffset('table',[100,0,0]);
  assert.deepEqual(messages,[]);
  furniture.nudge('table',0,.1);
  assert.match(messages.at(-1),/room wall, floor or ceiling/);
  furniture.reset('table');
  const scene=createHolodeckCubeScene({furniture});
  furniture.setOffset('table',[0,100,0]);messages.length=0;
  furniture.nudge('table',1,.1);
  assert.match(messages.at(-1),/supported cube reached a solid surface/);
  assert.equal(scene.getStates().every(state=>state.sleeping),true);
});

test('the same accepted table translation carries resting cubes once before UI notification',()=>{
  let scene,observed;
  const furniture=createHolodeckFurniture({storage:memory(),onChange:()=>{observed=scene.getStates();}});
  scene=createHolodeckCubeScene({furniture});
  const before=scene.getStates(),delta=[2.2,.7,2.4];
  furniture.setOffset('table',delta);
  for(let i=0;i<before.length;i++) {
    vec(observed[i].position,offsetPosition(before[i].position,delta));
    assert.equal(observed[i].sleeping,true);
  }
  const after=scene.getStates();
  for(let i=0;i<20;i++){furniture.getState();scene.getStates();furniture.setOffset('table',delta);scene.advance(0);}
  run(scene);
  assert.deepEqual(scene.getStates(),after,'reads, identical writes and frame steps do not apply displacement twice');
  furniture.nudge('table',1,-.3);
  for(let i=0;i<before.length;i++)vec(scene.getStates()[i].position,offsetPosition(before[i].position,[2.2,.4,2.4]));
});

test('a settled stack follows its table up, sideways and down without acquiring input ownership or throw velocity',()=>{
  const {furniture,scene}=setup(),small=scene.getBody('small'),large=scene.getBody('large');
  const base=large.getState(),top=small.getState();
  small.restore({...top,position:[base.position[0],base.position[1]+base.size/2+top.size/2+.0001,base.position[2]],sleeping:true});
  const before=scene.getStates();
  for(const delta of [[.6,.4,.5],[1.6,.1,2.2],[-.6,0,1.6]]) {
    furniture.setOffset('table',delta);run(scene);
    for(let i=0;i<before.length;i++) {
      const state=scene.getStates()[i];
      vec(state.position,offsetPosition(before[i].position,delta));
      assert.equal(state.heldBy,null);vec(state.velocity,[0,0,0]);assert.equal(state.sleeping,true);
    }
  }
});

test('the same support graph carries a cube resting on the keyboard without attaching a table cube',()=>{
  const {furniture,scene}=setup(),small=scene.getBody('small');
  small.restore({...small.getState(),position:[0,.9916,-5.12],sleeping:true});
  const before=scene.getStates();
  for(const delta of [[-2,.2,1],[-2,0,1],[0,0,0]]) {
    furniture.setOffset('keyboard',delta);
    vec(furniture.getOffset('keyboard'),delta);
    vec(scene.getBody('small').getState().position,offsetPosition(before[0].position,delta));
    assert.deepEqual(scene.getBody('large').getState(),before[1]);
  }
});

test('table movement does not attach airborne, held or off-table resting cubes',()=>{
  for(const kind of ['airborne','held','off-table','unsupported']) {
    const {furniture,scene}=setup(),body=scene.getBody('small');
    const position=kind==='airborne'?[0,1.5,-2.2]:kind==='unsupported'?[2,.9166,-2.2]:[2,.0286,0];
    body.restore({...body.getState(),position,sleeping:kind!=='airborne'});
    if(kind==='held')body.grab('quest:left');
    const before=body.getState();
    furniture.setOffset('table',[-1,.2,1]);
    assert.deepEqual(body.getState(),before,`${kind} cube must not be cargo`);
  }
});

test('a stack meeting the ceiling clips the table and all cargo atomically at their common clear movement',()=>{
  const {furniture,scene}=setup(),small=scene.getBody('small'),large=scene.getBody('large');
  const base=large.getState(),top=small.getState();
  small.restore({...top,position:[base.position[0],base.position[1]+base.size/2+top.size/2+.0001,base.position[2]],sleeping:true});
  const before=scene.getStates();
  furniture.setOffset('table',[0,100,0]);
  const accepted=furniture.getOffset('table');
  assert.ok(accepted[1]>1.5&&accepted[1]<FURNITURE_MOVEMENT_BOUNDS.table[1][1]);
  const states=scene.getStates();
  for(let i=0;i<states.length;i++) {
    vec(states[i].position,offsetPosition(before[i].position,accepted));
    assert.ok(states[i].position[1]+cubeSupport([0,1,0],states[i].orientation,states[i].size)<HOLODECK_ROOM.height);
  }
  close(large.getState().position[1]-large.getState().size/2,furniture.shape('table').top+.0081);
  for(let i=0;i<5;i++)furniture.nudge('table',1,.1);
  vec(furniture.getOffset('table'),accepted);
  run(scene);vec(scene.getBody('small').getState().position,states[0].position);
});

test('static solid contact limits shared cargo displacement instead of clipping only the cubes',()=>{
  const {furniture,scene}=setup();
  const obstacle=[[[1,0,0],1.1],[[-1,0,0],-1],[[0,1,0],2],[[0,-1,0],-.9],
    [[0,0,1],-1.5],[[0,0,-1],3]];
  scene.setEnvironmentSolids(()=>[obstacle]);
  const before=scene.getStates();
  furniture.setOffset('table',[2,0,0]);
  const delta=furniture.getOffset('table');
  assert.ok(delta[0]>.6&&delta[0]<.7);
  for(let i=0;i<before.length;i++)vec(scene.getStates()[i].position,offsetPosition(before[i].position,delta));
  close(scene.getBody('large').getState().position[0]+.057,1-.0001);
});

test('moved table and supported poses survive reload; cube recall uses the current table',()=>{
  const {storage,furniture,scene}=setup(),delta=[2.2,.6,2.7];
  furniture.setOffset('table',delta,{save:true});
  const saved=scene.getStates(),nextFurniture=createHolodeckFurniture({storage});
  const next=createHolodeckCubeScene({furniture:nextFurniture,store:createHolodeckCubeStore({storage})});
  for(let i=0;i<saved.length;i++)vec(next.getStates()[i].position,saved[i].position);
  const body=next.getBody('small');body.grab('setup');body.moveHeld([0,2,0]);body.release();
  body.reset();
  vec(body.getState().position,[HOLODECK_TABLE.center[0]+delta[0],.9166+delta[1],HOLODECK_TABLE.center[2]+delta[2]]);
});

test('cargo persists at release without storage writes during intermediate held-frame translations',()=>{
  const backing=memory(),writes=[],storage={getItem:backing.getItem,
    setItem(key,value){writes.push(key);backing.setItem(key,value);}};
  const furniture=createHolodeckFurniture({storage});
  createHolodeckCubeScene({furniture,store:createHolodeckCubeStore({storage})});
  for(let i=1;i<=20;i++)furniture.setOffset('table',[i*.01,0,0]);
  assert.deepEqual(writes,[]);
  furniture.flush();
  assert.equal(writes.length,2);assert.equal(new Set(writes).size,2,'one furniture record and one cube record');
  const restored=createHolodeckCubeScene({furniture:createHolodeckFurniture({storage}),store:createHolodeckCubeStore({storage})});
  close(restored.getBody('small').getState().position[0],.2);
});

test('recall does not spawn a cube through the ceiling when an empty raised table has no headroom',()=>{
  const {furniture,scene}=setup();
  for(const [i,body] of ['small','large'].map(id=>scene.getBody(id)).entries()) {
    body.grab('setup');body.moveHeld([i?-3:3,1.5,0]);
  }
  furniture.setOffset('table',[0,100,0]);
  close(furniture.shape('table').top+.008,HOLODECK_ROOM.height);
  const body=scene.getBody('small');body.reset();
  close(body.getState().position[1],body.getState().size/2+.0001);
  assert.equal(body.getState().heldBy,null);
  assert.ok(body.getState().position[1]+body.getState().size/2<=HOLODECK_ROOM.height);
});

test('empty table and keyboard stop at one another under large moves, and Reset follows the same physical path',()=>{
  for(const [id,direction] of [['table',-1],['keyboard',1]]) {
    const furniture=createHolodeckFurniture({storage:memory()});
    furniture.setOffset(id,[0,0,direction*4]);
    close(furniture.getOffset(id)[2],direction*1.7799);
    const stopped=furniture.getOffset(id);
    furniture.setOffset(id,[0,0,direction*4]);vec(furniture.getOffset(id),stopped);
    furniture.reset(id);vec(furniture.getOffset(id),[0,0,0]);
  }
});

test('moving an assembly clears its former collision volume, including its physical supports',()=>{
  const furniture=createHolodeckFurniture({storage:memory()});
  furniture.setOffset('keyboard',[0,1,0]);
  furniture.setOffset('table',[0,0,-2.4]);
  close(furniture.getOffset('table')[2],-2.4);
  furniture.reset('table');furniture.reset('keyboard');
  furniture.setOffset('table',[0,0,2]);furniture.setOffset('keyboard',[0,0,3]);
  close(furniture.getOffset('keyboard')[2],3);
});

test('stationary held and floor cubes stop a moving keyboard without becoming attached or being teleported',()=>{
  for(const held of [true,false]) {
    const furniture=createHolodeckFurniture({storage:memory()});
    furniture.setOffset('table',[-3.7,0,0]);
    const scene=createHolodeckCubeScene({furniture}),body=scene.getBody('small');
    body.restore({...body.getState(),position:held?[0,.94,-3.6]:[1.3,.0286,-3.6],sleeping:!held});
    if(held)body.grab('quest:left');
    const before=body.getState();
    furniture.setOffset('keyboard',[0,0,3]);
    close(furniture.getOffset('keyboard')[2],held?1.0374:1.1114);
    assert.deepEqual(body.getState(),before);
    furniture.reset('keyboard');vec(furniture.getOffset('keyboard'),[0,0,0]);
    assert.deepEqual(body.getState(),before);
  }
});

test('actual keyboard tilt and side dials participate in assembly sweeps',()=>{
  for(const {tilt,position,limit} of [{tilt:0,position:[1.82,.96,-3.7],limit:.8114},
    {tilt:90,position:[0,1.5,-3.7],limit:.9374}]) {
    const comfort=createHolodeckComfort({storage:memory()});comfort.setKeyboardTilt(tilt);
    const furniture=createHolodeckFurniture({storage:memory(),comfort});
    furniture.setOffset('table',[-3.7,0,0]);
    const scene=createHolodeckCubeScene({furniture}),body=scene.getBody('small');
    body.restore({...body.getState(),position,sleeping:false});body.grab('quest:left');
    const before=body.getState();
    furniture.setOffset('keyboard',[0,0,3]);
    close(furniture.getOffset('keyboard')[2],limit);
    assert.deepEqual(body.getState(),before);
  }
});

test('an unrelated initial penetration can escape but cannot deepen or borrow the display-mount exception',()=>{
  const make=(id,x)=>cubeSolid({id,position:[x,1,0],size:1,orientation:[0,0,0,1]});
  const moving=make('moving',0),obstacle=make('obstacle',.8);
  close(solidMotionLimit([moving],[obstacle],[1,0,0]),0);
  close(solidMotionLimit([moving],[obstacle],[-1,0,0]),1);
});

test('keyboard walking footprint includes moved rear supports and respects known physical height',()=>{
  const furniture=createHolodeckFurniture({storage:memory()});
  furniture.setOffset('table',[-3.75,0,0]);furniture.setOffset('keyboard',[0,0,4]);
  close(furniture.getOffset('keyboard')[2],4);
  const obstacle=furniture.obstacles().find(item=>item.id==='furniture:keyboard');
  close(obstacle.minZ,-2);
  const start={x:1.3,z:-3},move=resolveHolodeckMovement(start,{x:0,z:2},{obstacles:[obstacle]});
  assert.ok(start.z+move.z<=-2.28);
  furniture.setOffset('table',[-3.75,2,0]);
  const table=furniture.obstacles().find(item=>item.id==='furniture:table');
  close(table.minY,2.035);
  const beneath=resolveHolodeckMovement({x:-3.75,z:-4},{x:0,z:3},{obstacles:[table],bodyBottomY:0,bodyTopY:1.7});
  close(beneath.z,3);
});

test('legacy tabletop cargo and stacks migrate before depenetration, persist on flush and remain stable through repeated reloads',()=>{
  for(const mode of ['separate','stack','off-table']) {
    const storage=memory(),source=createHolodeckCubeScene().getStates();
    const saved=source.map(state=>({...state,position:offsetPosition(state.position,[0,-.14,0])}));
    if(mode==='stack')saved[0].position=[saved[1].position[0],saved[1].position[1]+.057+.0285+.0001,saved[1].position[2]];
    if(mode==='off-table')saved[0].position=[2,.0286,1];
    const store=createHolodeckCubeStore({storage});store.load();assert.equal(store.save(saved),true);
    storage.setItem(SPATIAL_FURNITURE_STORAGE_KEY,JSON.stringify({version:1,offsets:{table:[0,-.14,0],keyboard:[.34,.18,.86]}}));
    const expected=saved.map((state,index)=>mode==='off-table'&&index===0?state.position:offsetPosition(state.position,[0,.105,0]));
    for(let visit=0;visit<3;visit++) {
      const furniture=createHolodeckFurniture({storage});
      const scene=createHolodeckCubeScene({furniture,store:createHolodeckCubeStore({storage})});
      scene.getStates().forEach((state,index)=>vec(state.position,expected[index]));
      vec(furniture.getOffset('keyboard'),[.34,.18,.86]);
      furniture.flush();
      JSON.parse(storage.getItem(CUBE_STORAGE_KEY)).cubes.forEach((state,index)=>vec(state.position,expected[index]));
      run(scene);scene.getStates().forEach((state,index)=>vec(state.position,expected[index]));
    }
  }
});

test('furniture placement reserves the whole later hinge sweep in both approach directions while actual contacts keep the selected tilt',()=>{
  const overlapping=(a,b)=>{
    const left=solidBounds(a),right=solidBounds(b);
    return [0,1,2].every(axis=>left.max[axis]>right.min[axis]+1e-7&&left.min[axis]<right.max[axis]-1e-7);
  };
  for(const moving of ['keyboard','table']) {
    const comfort=createHolodeckComfort({storage:memory()}),furniture=createHolodeckFurniture({storage:memory(),comfort});
    if(moving==='keyboard') {
      furniture.setOffset('table',[0,.5,0]);furniture.setOffset('keyboard',[2.65,0,0]);
      furniture.setOffset('keyboard',[2.65,0,2.4]);
      close(furniture.getOffset('keyboard')[2],1.7459);
    }else {
      furniture.setOffset('table',[-3.7,.5,0]);
      furniture.setOffset('keyboard',[2.65,0,0]);furniture.setOffset('keyboard',[2.65,0,2.4]);
      vec(furniture.getOffset('keyboard'),[2.65,0,2.4]);
      furniture.setOffset('table',[0,.5,0]);
      assert.ok(furniture.getOffset('table')[0]<-.1);
    }
    const flat=furniture.solids('keyboard');
    for(const tilt of [0,17,37,67,90]) {
      comfort.setKeyboardTilt(tilt);
      const table=furniture.solids('table'),keyboard=furniture.solids('keyboard');
      assert.equal(table.some(a=>keyboard.some(b=>overlapping(a,b))),false,`physical parts overlap at ${tilt} degrees`);
      if(tilt===90)assert.notDeepEqual(keyboard,flat,'support contacts are actual tilted planes, not the reserved void');
    }
  }
});

test('the shared hinge clearance contains every visible raised keycap through the complete tilt range',()=>{
  const furniture=createHolodeckFurniture({storage:memory()}),clearance=furniture.motionSolids('keyboard');
  for(const tilt of [0,17,37,67,89.8,90]) {
    const keys=buildHolodeckKeycaps({keyboardTilt:tilt});
    for(let i=0;i<keys.length;i+=KEYCAP_VERTEX_STRIDE) {
      const point=Array.from(keys.slice(i,i+3));
      assert.ok(clearance.some(solid=>solid.every(([n,d])=>n.reduce((sum,v,axis)=>sum+v*point[axis],0)<=d+1e-6)),
        `raised keycap protrudes beyond clearance at ${tilt} degrees`);
    }
  }
});

test('recall validates both cube sizes against the occupied floor beneath a ceiling-height table',()=>{
  const {furniture,scene}=setup();
  for(const [i,body] of ['small','large'].map(id=>scene.getBody(id)).entries()) {
    body.grab('setup');body.moveHeld([3+i*.3,2,1]);
  }
  furniture.setOffset('table',[0,100,0]);furniture.setOffset('keyboard',[-1.3,0,2.92]);
  vec(furniture.getOffset('keyboard'),[-1.3,0,2.92]);
  for(const id of ['small','large']) {
    const body=scene.getBody(id),result=body.reset();assert.equal(result.resetPlaced,true);
    const state=body.getState();
    for(let axis=0;axis<3;axis++) {
      const normal=[0,0,0];normal[axis]=1;
      const radius=cubeSupport(normal,state.orientation,state.size);
      assert.ok(state.position[axis]-radius>=roomAxes[axis][0]-1e-8);
      assert.ok(state.position[axis]+radius<=roomAxes[axis][1]+1e-8);
    }
    const solids=[...furniture.solids('table'),...furniture.solids('keyboard'),
      ...scene.getStates().filter(other=>other.id!==id).map(cubeSolid)];
    assert.equal(solids.some(solid=>solid.every(([n,d])=>n.reduce((sum,v,i)=>sum+v*state.position[i],0)
      <d+cubeSupport(n,state.orientation,state.size)-1e-8)),false);
    assert.equal(state.heldBy,null);
  }
});

test('rejected reset and restore preserve the complete valid rotated held pose rather than dropping or invalidating it',()=>{
  let blocked=false;
  const obstacle=boxSolid([-5,0,-6],[5,1.3,3]);
  const body=createHolodeckCubePhysics({extraSolids:()=>blocked?[obstacle]:[]});
  body.grab('quest:left');body.moveHeld([3,2,1],[0,Math.sin(.4),0,Math.cos(.4)]);
  const before=body.getState();blocked=true;
  assert.equal(body.reset().resetPlaced,false);assert.deepEqual(body.getState(),before);
  assert.equal(body.restore({...before,position:[0,.2,0],heldBy:null}),false);
  assert.deepEqual(body.getState(),before);
});

test('a controller keeps ownership after a rejected reset and can still release its cube normally',()=>{
  let blocked=false;
  const body=createHolodeckCubePhysics({extraSolids:()=>blocked?[boxSolid([-5,0,-6],[5,1.3,3])]:[]});
  const scene={getStates:()=>[body.getState()],getBody:()=>body,
    advance:seconds=>[body.advance(seconds)],checkpoint(){},stop(){}};
  const interaction=createHolodeckCubeInteraction({scene});
  const hand={id:'quest:left',kind:'quest',position:[...body.getState().position],orientation:[0,0,0,1],
    rayOrigin:[0,1.1,-1.8],forward:[0,-.2,-.98],grab:false,throw:false,reset:false,reach:0,rotate:0};
  interaction.update({time:0,hands:[hand]});interaction.update({time:16,hands:[{...hand,grab:true}]});
  assert.equal(body.getState().heldBy,hand.id);
  body.moveHeld([3,2,1]);blocked=true;
  const moved={...hand,position:[3,2,1],rayOrigin:[3,2,1],grab:true};
  interaction.update({time:32,hands:[{...moved,reset:true}]});
  assert.equal(body.getState().heldBy,hand.id);
  interaction.update({time:48,hands:[{...moved,grab:false}]});
  assert.equal(body.getState().heldBy,null);
});
