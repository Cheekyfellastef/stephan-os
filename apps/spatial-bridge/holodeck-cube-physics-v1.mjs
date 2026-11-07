import { HOLODECK_ROOM, HOLODECK_TABLE, HOLODECK_CUBE, HOLODECK_CONSOLE } from './holodeck-layout-v1.mjs';

export const CUBE_GRAVITY = 9.81;
const STEP = 1 / 120;
const SKIN = 0.0001;
const dot = (a,b) => a.reduce((sum,v,i) => sum + v*b[i],0);
export const add3 = (a,b) => a.map((v,i) => v+b[i]);
export const scale3 = (a,s) => a.map(v => v*s);
export const subtract3 = (a,b) => a.map((v,i) => v-b[i]);
export const length3 = a => Math.hypot(...a);
export const normalize3 = a => scale3(a,1/(length3(a)||1));
const bounded = (a,max) => scale3(a,Math.min(1,max/(length3(a)||1)));
export function normalizeQuaternion(q) {
  if (!q || q.length!==4 || !q.every(Number.isFinite) || Math.hypot(...q)<1e-6) return [0,0,0,1];
  const n=Math.hypot(...q); return q.map(v=>v/n);
}
export function multiplyQuaternion(a,b) {
  const [x,y,z,w]=a,[X,Y,Z,W]=b;
  return [w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z];
}
export function rotate3(v,q) {
  const [x,y,z]=multiplyQuaternion(multiplyQuaternion(q,[...v,0]),[-q[0],-q[1],-q[2],q[3]]);
  return [x,y,z];
}
export function quaternionFromAngular(angular,dt) {
  const speed=length3(angular),angle=speed*dt/2;
  return speed<1e-8?[0,0,0,1]:[...scale3(angular,Math.sin(angle)/speed),Math.cos(angle)];
}
export function cubeSupport(normal,orientation,size=HOLODECK_CUBE.size) {
  return size/2 * [[1,0,0],[0,1,0],[0,0,1]].reduce((sum,axis)=>sum+Math.abs(dot(normal,rotate3(axis,orientation))),0);
}
function prism(w,d,bottom,top,bevel=0,cx=0,cz=HOLODECK_TABLE.center[2]) {
  const planes=[[[1,0,0],cx+w],[[-1,0,0],w-cx],[[0,1,0],top],[[0,-1,0],-bottom],
    [[0,0,1],cz+d],[[0,0,-1],d-cz]];
  if(bevel) for(const x of [-1,1]) for(const z of [-1,1])
    planes.push([[x/Math.SQRT2,0,z/Math.SQRT2],(w+d-bevel+x*cx+z*cz)/Math.SQRT2]);
  return planes;
}
export function createCubeSolids(table=HOLODECK_TABLE, console=HOLODECK_CONSOLE) {
  const tableOffset=subtract3(table.center,HOLODECK_TABLE.center);
  const consoleOffset=subtract3(console.center,HOLODECK_CONSOLE.center);
  const shapes=[prism(table.halfWidth,table.halfDepth,table.bottom,table.top+0.008,table.bevel,table.center[0],table.center[2]),
    prism(console.halfWidth,console.halfDepth,console.bottom,console.top,console.bevel,0,console.center[2]),
    ...[-1,1].map(side=>prism(0.09,0.38,0.05,console.bottom,0,side*1.3,console.center[2])),
    ...[-1,1].map(side=>prism(0.09,0.28,0.84,1.10,0,side*1.3,-5.72)),
    prism(0.68,0.44,0.035,0.13,0.20),prism(0.20,0.20,0.18,0.58,0.08),
    ...[-1,1].map(side=>{
      const slope=side*0.38/0.55,centre=side*0.24-slope*0.13,n=Math.hypot(1,slope);
      return [[[1/n,-slope/n,0],(centre+0.13)/n],[[-1/n,slope/n,0],(-centre+0.13)/n],
        [[0,1,0],0.68],[[0,-1,0],-0.13],[[0,0,1],HOLODECK_TABLE.center[2]+0.32],[[0,0,-1],-HOLODECK_TABLE.center[2]+0.32]];
    })];
  // The first two prisms already use current absolute placement. All their
  // supports inherit that same furniture transform, without ghost collisions
  // at the former table/keyboard position.
  return shapes.map((planes,index)=>{
    const offset=index===0||index===1?[0,0,0]:index<=5?consoleOffset:tableOffset;
    return planes.map(([normal,d])=>[normal,d+dot(normal,offset)]);
  });
}

// Sweep the cube centre through the support-expanded convex furniture volume.
function sweepSolid(position,delta,planes,orientation,size) {
  let enter=-Infinity,leave=Infinity,normal=null;
  for(const [n,d] of planes) {
    const distance=dot(n,position)-d-cubeSupport(n,orientation,size),speed=dot(n,delta);
    if(Math.abs(speed)<1e-10) { if(distance>=-1e-8) return null; continue; }
    const t=-distance/speed;
    if(speed<0 && t>enter) {enter=t;normal=n;}
    if(speed>0) leave=Math.min(leave,t);
    if(enter>leave) return null;
  }
  return normal && enter>=-1e-8 && enter<=1 && leave>Math.max(enter,0)
    ? {time:Math.max(0,enter),normal}:null;
}
export function createHolodeckCubePhysics({room=HOLODECK_ROOM,table=HOLODECK_TABLE,cube=HOLODECK_CUBE,extraSolids=()=>[],furnitureSource=null}={}) {
  const solids=createCubeSolids(table);
  const contacts=()=>{
    const furniture=typeof furnitureSource==='function'?furnitureSource():null;
    return [...(furniture?.table&&furniture?.keyboard?createCubeSolids(furniture.table,furniture.keyboard):solids),...extraSolids()];
  };
  const walls=[[[1,0,0],-room.halfWidth],[[-1,0,0],-room.halfWidth],[[0,1,0],0],
    [[0,-1,0],-room.height],[[0,0,1],room.frontZ],[[0,0,-1],-room.backZ]];
  let position,orientation,velocity,angularVelocity,heldBy,sleeping,accumulator=0,restTime=0;
  function reset() {
    position=[...cube.center];
    orientation=[0,0,0,1];velocity=[0,0,0];angularVelocity=[0,0,0];heldBy=null;sleeping=true;accumulator=0;restTime=0;
    depenetrate();
    return getState();
  }
  function getState() {return {position:[...position],orientation:[...orientation],velocity:[...velocity],
    angularVelocity:[...angularVelocity],heldBy,sleeping,size:cube.size,id:cube.id};}
  function depenetrate() {
    for(const [n,d] of walls) {
      const depth=d+cubeSupport(n,orientation,cube.size)-dot(n,position);
      if(depth>0) position=add3(position,scale3(n,depth+SKIN));
    }
    for(const planes of contacts()) {
      const distances=planes.map(([n,d])=>({n,distance:dot(n,position)-d-cubeSupport(n,orientation,cube.size)}));
      if(distances.every(p=>p.distance<0)) {
        const nearest=distances.reduce((a,b)=>a.distance>b.distance?a:b);
        position=add3(position,scale3(nearest.n,-nearest.distance+SKIN));
      }
    }
  }
  function travel(delta,bounce=false) {
    let remaining=[...delta],grounded=false;
    for(let pass=0;pass<6 && length3(remaining)>1e-9;pass++) {
      let hit=null;
      for(const [n,d] of walls) {
        const speed=dot(n,remaining),distance=dot(n,position)-d-cubeSupport(n,orientation,cube.size);
        if(speed<-1e-10) {
          const time=-distance/speed;
          if(time>=-1e-8 && time<=1 && (!hit||time<hit.time)) hit={time:Math.max(0,time),normal:n};
        }
      }
      for(const solid of contacts()) {
        const candidate=sweepSolid(position,remaining,solid,orientation,cube.size);
        if(candidate&&(!hit||candidate.time<hit.time)) hit=candidate;
      }
      if(!hit) {position=add3(position,remaining);break;}
      position=add3(add3(position,scale3(remaining,hit.time)),scale3(hit.normal,SKIN));
      remaining=scale3(remaining,1-hit.time);
      const into=dot(remaining,hit.normal);
      if(into<0) remaining=subtract3(remaining,scale3(hit.normal,into));
      if(hit.normal[1]>0.5) grounded=true;
      if(bounce) {
        const impact=dot(velocity,hit.normal);
        if(impact<0) {
          const restitution=Math.abs(impact)>0.35?0.24:0;
          velocity=subtract3(velocity,scale3(hit.normal,(1+restitution)*impact));
          const normalVelocity=scale3(hit.normal,dot(velocity,hit.normal));
          velocity=add3(normalVelocity,scale3(subtract3(velocity,normalVelocity),0.78));
          angularVelocity=scale3(angularVelocity,0.65);
        }
      }
    }
    return grounded;
  }
  function grab(id) {heldBy=id;velocity=[0,0,0];angularVelocity=[0,0,0];sleeping=false;restTime=0;}
  function moveHeld(target,q=orientation) {
    if(!heldBy||!target?.every(Number.isFinite)) return getState();
    // First sweep translation at the current orientation; rotation is then
    // constrained by the same solid surfaces, even while the cube is held.
    travel(subtract3(target,position));orientation=normalizeQuaternion(q);depenetrate();
    return getState();
  }
  function release(linear=[0,0,0],angular=[0,0,0]) {
    heldBy=null;velocity=bounded(linear.every(Number.isFinite)?linear:[0,0,0],8);
    angularVelocity=bounded(angular.every(Number.isFinite)?angular:[0,0,0],16);
    sleeping=false;restTime=0;accumulator=0;
  }
  function settleFlat(amount) {
    let face=[[1,0,0],[0,1,0],[0,0,1]].map(v=>rotate3(v,orientation))
      .sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]))[0];
    if(face[1]<0) face=scale3(face,-1);
    const align=normalizeQuaternion([-face[2],0,face[0],1+face[1]]);
    let target=normalizeQuaternion(multiplyQuaternion(align,orientation));
    if(dot(target,orientation)<0) target=target.map(v=>-v);
    const before=cubeSupport([0,1,0],orientation,cube.size);
    orientation=normalizeQuaternion(orientation.map((v,i)=>v+(target[i]-v)*amount));
    position[1]+=cubeSupport([0,1,0],orientation,cube.size)-before;
    depenetrate();
  }
  function advance(seconds) {
    if(heldBy||!Number.isFinite(seconds)||seconds<=0) return getState();
    // A stacked cube must wake when the supporting cube moves away.
    if(sleeping) {
      const onFloor=position[1]-cubeSupport([0,1,0],orientation,cube.size)<SKIN*3;
      if(onFloor||contacts().some(s=>sweepSolid(position,[0,-SKIN*3,0],s,orientation,cube.size))) return getState();
      sleeping=false;
    }
    accumulator+=Math.min(seconds,0.1);
    while(accumulator>=STEP) {
      accumulator-=STEP;
      orientation=normalizeQuaternion(multiplyQuaternion(quaternionFromAngular(angularVelocity,STEP),orientation));
      depenetrate();velocity[1]-=CUBE_GRAVITY*STEP;
      const grounded=travel(scale3(velocity,STEP),true);
      angularVelocity=scale3(angularVelocity,Math.exp(-(grounded?8:0.12)*STEP));
      velocity=scale3(velocity,Math.exp(-(grounded?4:0.08)*STEP));
      if(grounded&&length3(velocity)<0.3&&length3(angularVelocity)<1) settleFlat(0.12);
      if(grounded&&length3(velocity)<0.07&&length3(angularVelocity)<0.15) restTime+=STEP; else restTime=0;
      if(restTime>0.25) {settleFlat(1);velocity=[0,0,0];angularVelocity=[0,0,0];sleeping=true;accumulator=0;break;}
    }
    return getState();
  }
  function restore(state) {
    if(!state || ![state.position,state.velocity,state.angularVelocity].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))
      || !Array.isArray(state.orientation)||state.orientation.length!==4||!state.orientation.every(Number.isFinite)) return false;
    position=[...state.position];orientation=normalizeQuaternion(state.orientation);
    velocity=bounded(state.velocity,8);angularVelocity=bounded(state.angularVelocity,16);
    heldBy=null;sleeping=state.sleeping===true;accumulator=0;restTime=0;
    depenetrate();return true;
  }
  reset();
  return {getState,reset,grab,moveHeld,release,advance,restore};
}
